import {openApp} from '@libs/actions/App';
import clearOnyxAndSeedFullReconnect from '@libs/actions/clearOnyxAndSeedFullReconnect';
import {flushQueue, queueOnyxUpdates} from '@libs/actions/QueuedOnyxUpdates';
import {writeWithNoDuplicatesOpenAppConflictAction, writeWithNoDuplicatesReconnectConflictAction} from '@libs/API';
import {WRITE_COMMANDS} from '@libs/API/types';
import DateUtils from '@libs/DateUtils';
import {recordFullReconnectTimeFromResponse} from '@libs/FullReconnectUtils';

import ONYXKEYS from '@src/ONYXKEYS';
import type {AnyOnyxUpdate} from '@src/types/onyx/Request';
import '@libs/subscribeToFullReconnect';

import Onyx from 'react-native-onyx';

import getOnyxValue from '../utils/getOnyxValue';
import waitForBatchedUpdates from '../utils/waitForBatchedUpdates';

jest.mock('@libs/API');
jest.mock('@libs/Log');

// reconnectApp() and openApp() each go through their own wrapper. Both are recorded into
// capturedCommands/capturedOnyxData in call order so the index-based helpers below work.
const mockReconnectWriteCommand = jest.mocked(writeWithNoDuplicatesReconnectConflictAction);
const mockOpenAppWriteCommand = jest.mocked(writeWithNoDuplicatesOpenAppConflictAction);

// The case under test: this device's clock is behind the server, so the server cutoff is ahead of "now".
const CLIENT_NOW = '2026-06-12 10:00:00.000';
const SERVER_CUTOFF = '2026-06-12 10:05:00.000';
const NEWER_SERVER_CUTOFF = '2026-06-12 10:10:00.000';
// Before CLIENT_NOW - models the measured case in #97159, where the cutoff predated the boot by days.
const OLD_SERVER_CUTOFF = '2026-06-12 09:00:00.000';

// Ordered log of two things: when we record the completion time (via the Onyx subscription below) and
// when a reconnect request is sent (via the API mock). Lets tests assert we record before we request.
let events: Array<{type: 'completion' | 'request'; value: string}> = [];
let capturedOnyxData: Array<NonNullable<Parameters<typeof writeWithNoDuplicatesReconnectConflictAction>[2]>> = [];
let capturedCommands: string[] = [];
Onyx.connectWithoutView({
    key: ONYXKEYS.LAST_FULL_RECONNECT_TIME,
    callback: (value) => {
        events.push({type: 'completion', value: value ?? ''});
    },
});

function getReconnectRequests() {
    return capturedCommands.filter((command) => command === WRITE_COMMANDS.RECONNECT_APP);
}

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
        if (predicate()) {
            return;
        }
        await waitForBatchedUpdates();
    }
    throw new Error(`Timed out waiting for: ${label}`);
}

async function applyServerResponse(redeliveredCutoff: string): Promise<void> {
    return applyCapturedResponseThroughMiddleware(0, redeliveredCutoff);
}

function getOpenAppRequestIndex() {
    return capturedCommands.findIndex((command) => command === WRITE_COMMANDS.OPEN_APP);
}

async function runMiddlewareTransform(callIndex: number, deliveredCutoff: string | null) {
    const successData = capturedOnyxData.at(callIndex)?.successData ?? [];
    const knownCutoff = (await getOnyxValue(ONYXKEYS.NVP_RECONNECT_APP_IF_FULL_RECONNECT_BEFORE)) ?? '';
    const responseOnyxData: AnyOnyxUpdate[] =
        deliveredCutoff === null ? [] : [{onyxMethod: Onyx.METHOD.MERGE, key: ONYXKEYS.NVP_RECONNECT_APP_IF_FULL_RECONNECT_BEFORE, value: deliveredCutoff}];
    recordFullReconnectTimeFromResponse(responseOnyxData, knownCutoff);
    return {responseOnyxData, successData};
}

// Mirrors the side-effect ReconnectApp path: onyxData and successData land as two separate, fully-settled Onyx.update calls.
async function applyCapturedResponseThroughMiddleware(callIndex: number, deliveredCutoff: string | null): Promise<void> {
    const {responseOnyxData, successData} = await runMiddlewareTransform(callIndex, deliveredCutoff);
    await Onyx.update(responseOnyxData);
    await waitForBatchedUpdates();
    await Onyx.update(successData);
    await waitForBatchedUpdates();
    await waitForBatchedUpdates();
}

// Mirrors how WRITE requests (OpenApp, the normal ReconnectApp) land in production: onyxData and successData flush as one combined Onyx.update.
async function applyCapturedResponseThroughWriteQueue(callIndex: number, deliveredCutoff: string | null): Promise<void> {
    const {responseOnyxData, successData} = await runMiddlewareTransform(callIndex, deliveredCutoff);
    await queueOnyxUpdates(responseOnyxData);
    await queueOnyxUpdates(successData);
    await flushQueue();
    await waitForBatchedUpdates();
    await waitForBatchedUpdates();
}

async function setServerCutoff(cutoff: string): Promise<void> {
    await Onyx.merge(ONYXKEYS.NVP_RECONNECT_APP_IF_FULL_RECONNECT_BEFORE, cutoff);
    await waitForCondition(() => getReconnectRequests().length > 0, 'first ReconnectApp request');
}

describe('subscribeToFullReconnect', () => {
    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(async () => {
        await Onyx.clear();
        await waitForBatchedUpdates();
        jest.clearAllMocks();
        events = [];
        capturedOnyxData = [];
        capturedCommands = [];
        jest.spyOn(DateUtils, 'getDBTime').mockReturnValue(CLIENT_NOW);
        mockReconnectWriteCommand.mockImplementation((command, params, onyxData) => {
            events.push({type: 'request', value: String(command)});
            capturedCommands.push(String(command));
            capturedOnyxData.push(onyxData ?? {});
            return Promise.resolve();
        });
        // The OpenApp wrapper has the command baked in, so record it rather than reading it off the call.
        mockOpenAppWriteCommand.mockImplementation((params, onyxData) => {
            events.push({type: 'request', value: WRITE_COMMANDS.OPEN_APP});
            capturedCommands.push(WRITE_COMMANDS.OPEN_APP);
            capturedOnyxData.push(onyxData ?? {});
            return Promise.resolve();
        });
        // reconnectApp falls back to openApp until the app has loaded once
        await Onyx.merge(ONYXKEYS.HAS_LOADED_APP, true);
        await waitForBatchedUpdates();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('fires exactly one ReconnectApp across a full response cycle on a client clock behind the server', async () => {
        await setServerCutoff(SERVER_CUTOFF);

        await applyServerResponse(SERVER_CUTOFF);

        expect(getReconnectRequests()).toHaveLength(1);
        expect(capturedCommands).toHaveLength(1);
        expect(await getOnyxValue(ONYXKEYS.LAST_FULL_RECONNECT_TIME)).toBe(SERVER_CUTOFF);
    });

    it('records the completion time as max(now, cutoff) before the reconnect request is sent', async () => {
        await setServerCutoff(SERVER_CUTOFF);

        const firstRequestIndex = events.findIndex((event) => event.type === 'request');
        const completionIndex = events.findIndex((event) => event.type === 'completion' && event.value === SERVER_CUTOFF);

        expect(firstRequestIndex).toBeGreaterThan(-1);
        expect(completionIndex).toBeGreaterThan(-1);
        expect(completionIndex).toBeLessThan(firstRequestIndex);
    });

    it('still fires a fresh reconnect when a genuinely newer cutoff arrives after a completed cycle', async () => {
        await setServerCutoff(SERVER_CUTOFF);
        await applyServerResponse(SERVER_CUTOFF);
        expect(getReconnectRequests()).toHaveLength(1);

        await Onyx.merge(ONYXKEYS.NVP_RECONNECT_APP_IF_FULL_RECONNECT_BEFORE, NEWER_SERVER_CUTOFF);
        await waitForCondition(() => getReconnectRequests().length > 1, 'reconnect for the newer server cutoff');

        expect(getReconnectRequests()).toHaveLength(2);
    });

    it('does not start a reconnect loop when an OpenApp response re-delivers an already-known cutoff on a client clock behind the server', async () => {
        await setServerCutoff(SERVER_CUTOFF);
        await applyServerResponse(SERVER_CUTOFF);
        jest.clearAllMocks();
        capturedOnyxData = [];
        capturedCommands = [];

        openApp();
        await waitForCondition(() => getOpenAppRequestIndex() > -1, 'OpenApp request');
        await applyCapturedResponseThroughMiddleware(getOpenAppRequestIndex(), SERVER_CUTOFF);

        expect(getReconnectRequests()).toHaveLength(0);
        expect(await getOnyxValue(ONYXKEYS.LAST_FULL_RECONNECT_TIME)).toBe(SERVER_CUTOFF);
    });

    it('does not fire an extra reconnect when an OpenApp response delivers a newer cutoff than was known at build time', async () => {
        await setServerCutoff(SERVER_CUTOFF);
        await applyServerResponse(SERVER_CUTOFF);
        jest.clearAllMocks();
        capturedOnyxData = [];
        capturedCommands = [];

        openApp();
        await waitForCondition(() => getOpenAppRequestIndex() > -1, 'OpenApp request');
        await applyCapturedResponseThroughMiddleware(getOpenAppRequestIndex(), NEWER_SERVER_CUTOFF);

        expect(getReconnectRequests()).toHaveLength(0);
        expect(await getOnyxValue(ONYXKEYS.LAST_FULL_RECONNECT_TIME)).toBe(NEWER_SERVER_CUTOFF);
    });

    it('does not fire an extra reconnect when the newer-cutoff OpenApp response lands as one write-queue batch', async () => {
        await setServerCutoff(SERVER_CUTOFF);
        await applyServerResponse(SERVER_CUTOFF);
        jest.clearAllMocks();
        capturedOnyxData = [];
        capturedCommands = [];

        openApp();
        await waitForCondition(() => getOpenAppRequestIndex() > -1, 'OpenApp request');
        await applyCapturedResponseThroughWriteQueue(getOpenAppRequestIndex(), NEWER_SERVER_CUTOFF);

        expect(getReconnectRequests()).toHaveLength(0);
        expect(await getOnyxValue(ONYXKEYS.LAST_FULL_RECONNECT_TIME)).toBe(NEWER_SERVER_CUTOFF);
    });

    it('does not fire an extra reconnect when a successful OpenApp response delivers no cutoff while an older cutoff is still held', async () => {
        await setServerCutoff(SERVER_CUTOFF);
        await applyServerResponse(SERVER_CUTOFF);
        jest.clearAllMocks();
        capturedOnyxData = [];
        capturedCommands = [];

        openApp();
        await waitForCondition(() => getOpenAppRequestIndex() > -1, 'OpenApp request');
        await applyCapturedResponseThroughWriteQueue(getOpenAppRequestIndex(), null);

        expect(getReconnectRequests()).toHaveLength(0);
        expect(await getOnyxValue(ONYXKEYS.LAST_FULL_RECONNECT_TIME)).toBe(SERVER_CUTOFF);
    });

    it('fires no third reconnect when a newer cutoff overtakes an in-flight OpenApp whose response delivers the older one', async () => {
        await setServerCutoff(SERVER_CUTOFF);
        await applyServerResponse(SERVER_CUTOFF);
        jest.clearAllMocks();
        capturedOnyxData = [];
        capturedCommands = [];

        openApp();
        await waitForCondition(() => getOpenAppRequestIndex() > -1, 'OpenApp request');
        await Onyx.merge(ONYXKEYS.NVP_RECONNECT_APP_IF_FULL_RECONNECT_BEFORE, NEWER_SERVER_CUTOFF);
        await waitForCondition(() => getReconnectRequests().length === 1, 'the reconnect for the newer cutoff');
        await applyCapturedResponseThroughWriteQueue(getOpenAppRequestIndex(), SERVER_CUTOFF);

        expect(getReconnectRequests()).toHaveLength(1);
        expect(await getOnyxValue(ONYXKEYS.LAST_FULL_RECONNECT_TIME)).toBe(NEWER_SERVER_CUTOFF);
    });

    it('does not fire a redundant reconnect through clearOnyxAndSeedFullReconnect and records client-now when there is no cutoff', async () => {
        await clearOnyxAndSeedFullReconnect([]);
        await waitForBatchedUpdates();
        await waitForBatchedUpdates();

        expect(capturedCommands).toHaveLength(0);
        expect(await getOnyxValue(ONYXKEYS.LAST_FULL_RECONNECT_TIME)).toBe(CLIENT_NOW);
    });

    it('does not fire a duplicate full download when a cutoff becomes visible during the initial OpenApp window', async () => {
        // Fresh client: nothing recorded yet, and the app has not loaded - on a cold boot HAS_LOADED_APP's
        // `true` is parked in queueFlushedData until the sequential queue drains, so reconnectApp reads it as unset.
        await Onyx.merge(ONYXKEYS.HAS_LOADED_APP, false);
        await waitForBatchedUpdates();

        openApp();
        await waitForCondition(() => getOpenAppRequestIndex() > -1, 'the boot OpenApp request');
        // Production applies a write's optimisticData when the request is dispatched; the API mock only records it.
        await Onyx.update(capturedOnyxData.at(getOpenAppRequestIndex())?.optimisticData ?? []);
        await waitForBatchedUpdates();

        // The cutoff reaches Onyx on an immediate pipe (a read command's response, a Pusher update) while the
        // OpenApp response's spliced record is still queued behind the flush. The value models the measured
        // case in #97159: a cutoff at or before the client's clock.
        await Onyx.merge(ONYXKEYS.NVP_RECONNECT_APP_IF_FULL_RECONNECT_BEFORE, OLD_SERVER_CUTOFF);
        // Generous flush: the failure path crosses several promise hops (cutoff subscription -> chained
        // LAST_FULL_RECONNECT_TIME read -> triggerFullReconnect's merge -> reconnectApp -> hasLoadedAppPromise).
        for (let i = 0; i < 8; i++) {
            // eslint-disable-next-line no-await-in-loop
            await waitForBatchedUpdates();
        }

        // Without the dispatch-time record in getOnyxDataForOpenOrReconnect, subscribeToFullReconnect fires,
        // reconnectApp downgrades (hasLoadedApp unset) and a second OpenApp goes out - the duplicate behind #97159.
        expect(capturedCommands.filter((command) => command === WRITE_COMMANDS.OPEN_APP)).toHaveLength(1);
        expect(getReconnectRequests()).toHaveLength(0);
    });
});
