import {WRITE_COMMANDS} from '@libs/API/types';
import {getPersonalDetailByEmail} from '@libs/PersonalDetailsUtils';
import type {Middleware} from '@libs/Request';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {AnyOnyxUpdate} from '@src/types/onyx/Request';

import type {OnyxKey} from 'react-native-onyx';

import Onyx from 'react-native-onyx';

/** The shape of a response update this middleware reads, kept loose so it accepts the updates of any command. */
type ResponseUpdate = {
    key: OnyxKey;
    value?: unknown;
};

/**
 * Request middleware runs outside React, so `useOnyx` is not available here. The inviter is a participant of every chat the
 * invite creates and must not be mistaken for the invitee when pairing the response's participants to the typed login.
 */
let currentUserAccountID: number | undefined;
Onyx.connectWithoutView({
    key: ONYXKEYS.SESSION,
    callback: (value) => {
        currentUserAccountID = value?.accountID;
    },
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function getAccountID(value: unknown): number | undefined {
    const accountID = Number(value);
    return Number.isFinite(accountID) && accountID > 0 ? accountID : undefined;
}

/** Reads the `login -> reportID` pairs the client sent for the workspace chats it created for the invitees. */
function parseReportCreationData(raw: unknown): Map<string, string> {
    const reportIDByLogin = new Map<string, string>();
    const data = getString(raw);
    if (!data) {
        return reportIDByLogin;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(data);
    } catch {
        return reportIDByLogin;
    }
    if (!isRecord(parsed)) {
        return reportIDByLogin;
    }
    for (const [login, entry] of Object.entries(parsed)) {
        const reportID = isRecord(entry) ? getString(entry.reportID) : undefined;
        if (reportID) {
            reportIDByLogin.set(login.toLowerCase(), reportID);
        }
    }
    return reportIDByLogin;
}

/** The employeeList keys the backend echoed for this policy. A key the response nulls is not an echo. */
function collectEchoedLogins(onyxData: ResponseUpdate[], policyKey: string): Set<string> {
    const echoedLogins = new Set<string>();
    for (const update of onyxData) {
        if (update.key !== policyKey || !isRecord(update.value) || !isRecord(update.value.employeeList)) {
            continue;
        }
        for (const [login, employee] of Object.entries(update.value.employeeList)) {
            if (employee === null) {
                continue;
            }
            echoedLogins.add(login.toLowerCase());
        }
    }
    return echoedLogins;
}

/** The `accountID -> login` pairs the backend returned in personalDetailsList. */
function collectLoginByAccountID(onyxData: ResponseUpdate[]): Map<number, string> {
    const loginByAccountID = new Map<number, string>();
    for (const update of onyxData) {
        if (update.key !== ONYXKEYS.PERSONAL_DETAILS_LIST || !isRecord(update.value)) {
            continue;
        }
        for (const [accountID, detail] of Object.entries(update.value)) {
            const login = isRecord(detail) ? getString(detail.login) : undefined;
            const parsedAccountID = getAccountID(accountID);
            if (!login || !parsedAccountID) {
                continue;
            }
            loginByAccountID.set(parsedAccountID, login.toLowerCase());
        }
    }
    return loginByAccountID;
}

/**
 * The accounts the backend attached to each report it returned: the owner and every participant. For the workspace chat
 * the client created for an invitee this is how the response names the account the invite settled on.
 */
function collectAccountIDsByReportID(onyxData: ResponseUpdate[]): Map<string, Set<number>> {
    const accountIDsByReportID = new Map<string, Set<number>>();
    for (const update of onyxData) {
        if (!update.key?.startsWith(ONYXKEYS.COLLECTION.REPORT) || !isRecord(update.value)) {
            continue;
        }
        const reportID = update.key.slice(ONYXKEYS.COLLECTION.REPORT.length);
        const accountIDs = accountIDsByReportID.get(reportID) ?? new Set<number>();
        const ownerAccountID = getAccountID(update.value.ownerAccountID);
        if (ownerAccountID) {
            accountIDs.add(ownerAccountID);
        }
        if (isRecord(update.value.participants)) {
            for (const participantAccountID of Object.keys(update.value.participants)) {
                const accountID = getAccountID(participantAccountID);
                if (accountID) {
                    accountIDs.add(accountID);
                }
            }
        }
        if (accountIDs.size) {
            accountIDsByReportID.set(reportID, accountIDs);
        }
    }
    return accountIDsByReportID;
}

/**
 * The account the client had already resolved for the typed login before sending the request. Only a real account
 * counts: an optimistic personal detail carries a generated accountID that never matches anything the server returns.
 */
function getResolvedAccountIDForLogin(login: string): number | undefined {
    const personalDetail = getPersonalDetailByEmail(login);
    if (!personalDetail || personalDetail.isOptimisticPersonalDetail) {
        return undefined;
    }
    return getAccountID(personalDetail.accountID);
}

/** The successData update that clears `pendingAction` on the invited employeeList keys, if the request carries one. */
function findEmployeeListSuccessUpdate(successData: AnyOnyxUpdate[] | undefined, policyKey: string): Record<string, unknown> | undefined {
    for (const update of successData ?? []) {
        if (update.key !== policyKey || !isRecord(update.value) || !isRecord(update.value.employeeList)) {
            continue;
        }
        return update.value.employeeList;
    }
    return undefined;
}

/**
 * The employeeList keys the client holds for the policy at response time: the members it already had plus the keys it
 * wrote optimistically for this invite. Request middleware runs outside React, so `useOnyx` is not available here, and a
 * one-shot read is cheaper than keeping every policy in memory for a lookup that only the fallback below needs.
 */
function getLocalEmployeeLogins(policyKey: `${typeof ONYXKEYS.COLLECTION.POLICY}${string}`): Promise<Set<string>> {
    return new Promise((resolve) => {
        const connection = Onyx.connectWithoutView({
            key: policyKey,
            callback: (policy) => {
                Onyx.disconnect(connection);
                resolve(new Set(Object.keys(policy?.employeeList ?? {}).map((login) => login.toLowerCase())));
            },
        });
    });
}

type PairingContext = {
    reportIDByLogin: Map<string, string>;
    accountIDsByReportID: Map<string, Set<number>>;
    loginByAccountID: Map<number, string>;
    echoedLogins: Set<string>;
};

/**
 * The login the backend settled the typed login on, or undefined when the response does not confirm one. The account is
 * taken from the chat the client asked the backend to create for this login; when the response carries no such chat, the
 * account the client had already resolved for the login is used instead. Either way the account must come back in the
 * response's personal details under a different login that is present in the echoed employeeList.
 */
function getSettledLogin(normalizedTypedLogin: string, typedLogin: string, {reportIDByLogin, accountIDsByReportID, loginByAccountID, echoedLogins}: PairingContext): string | undefined {
    const isConfirmedReKey = (accountID: number): string | undefined => {
        const settledLogin = loginByAccountID.get(accountID);
        return settledLogin && settledLogin !== normalizedTypedLogin && echoedLogins.has(settledLogin) ? settledLogin : undefined;
    };

    const reportID = reportIDByLogin.get(normalizedTypedLogin);
    const chatAccountIDs = reportID ? accountIDsByReportID.get(reportID) : undefined;
    if (chatAccountIDs?.size) {
        const settledLogins = new Set<string>();
        for (const accountID of chatAccountIDs) {
            if (accountID === currentUserAccountID) {
                continue;
            }
            const settledLogin = isConfirmedReKey(accountID);
            if (settledLogin) {
                settledLogins.add(settledLogin);
            }
        }
        // More than one candidate means the chat cannot tell us which account is the invitee; do not guess.
        if (settledLogins.size > 1) {
            return undefined;
        }
        if (settledLogins.size === 1) {
            return settledLogins.values().next().value;
        }
    }

    const resolvedAccountID = getResolvedAccountIDForLogin(typedLogin);
    return resolvedAccountID ? isConfirmedReKey(resolvedAccountID) : undefined;
}

/**
 * When a member is invited by one of their secondary logins, the client writes `employeeList[<typed login>]`
 * optimistically, but the backend adds the account under its primary login and echoes that key instead. The request's
 * successData only clears `pendingAction` on the typed key, so both logins survive and the Members page renders the
 * typed one as a second, detail-less row for the same person.
 *
 * This middleware pairs the two logins from the request and its response alone. For every invited login the client
 * sent `reportCreationData[login].reportID` for the member's workspace chat; the backend creates that chat under the
 * same reportID with the real account as its participant, and returns that account's personal detail under its primary
 * login. A typed login that did not come back as its own employeeList key, whose chat came back with an account that the
 * response lists under a different login that *is* in the echoed employeeList, is a confirmed duplicate: its successData
 * entry is
 * replaced with `null` so the key is removed when the invite settles. Replacing (rather than appending) matters because
 * merging `{pendingAction: null}` into a removed key would recreate it as an empty entry.
 *
 * When the response carries no usable chat for the login (the backend reuses an existing chat when a removed member is
 * re-invited, and deletes the client's optimistic one), the account the client had already resolved for the login is used
 * instead; when there is none either (the login was typed offline), the last resort is the response's own arithmetic: one
 * sent login unechoed against exactly one echoed member the client neither sent nor already had.
 *
 * Everything it reads is persisted with the request or arrives in the response, so an invite queued offline is
 * reconciled the same way when it is replayed after reconnect. A login the server kept, a partial echo, or a non-200
 * response leave the request's updates untouched.
 */
const handleSecondaryLoginInvites: Middleware = (requestResponse, request) =>
    requestResponse.then(async (response) => {
        if (request?.command !== WRITE_COMMANDS.ADD_MEMBERS_TO_WORKSPACE || response?.jsonCode !== CONST.JSON_CODE.SUCCESS) {
            return response;
        }

        const policyID = getString(request.data?.policyID);
        if (!policyID) {
            return response;
        }
        const policyKey = `${ONYXKEYS.COLLECTION.POLICY}${policyID}` as const;

        const successEmployeeList = findEmployeeListSuccessUpdate(request.successData as AnyOnyxUpdate[] | undefined, policyKey);
        if (!successEmployeeList) {
            return response;
        }

        const onyxData: ResponseUpdate[] = response.onyxData ?? [];
        const echoedLogins = collectEchoedLogins(onyxData, policyKey);
        if (!echoedLogins.size) {
            return response;
        }
        const loginByAccountID = collectLoginByAccountID(onyxData);
        const accountIDsByReportID = collectAccountIDsByReportID(onyxData);
        const reportIDByLogin = parseReportCreationData(request.data?.reportCreationData);

        const typedLogins = Object.keys(successEmployeeList);
        const normalizedTypedLogins = new Set(typedLogins.map((login) => login.toLowerCase()));
        const settledLogins = new Set<string>();
        const unpairedTypedLogins: string[] = [];

        for (const typedLogin of typedLogins) {
            const normalizedTypedLogin = typedLogin.toLowerCase();
            if (echoedLogins.has(normalizedTypedLogin)) {
                // Ordinary invite: the server kept the key we wrote.
                continue;
            }

            const settledLogin = getSettledLogin(normalizedTypedLogin, typedLogin, {reportIDByLogin, accountIDsByReportID, loginByAccountID, echoedLogins});
            if (!settledLogin) {
                unpairedTypedLogins.push(typedLogin);
                continue;
            }

            // The same account came back under its primary login: retire the typed key instead of just clearing its pendingAction.
            settledLogins.add(settledLogin);
            successEmployeeList[typedLogin] = null;
        }

        // Neither signal above is available when the client never had the account (the login was typed offline) and the
        // backend discarded the chat the client created because the member already had one (a re-invite). What is left is
        // the response itself: the server accepted the whole request, echoed exactly one member the client neither sent nor
        // already had, and left exactly one sent login unechoed. That one-to-one match is the re-keyed login. Anything else
        // (several unpaired logins, several new members, a member without personal details) is left alone.
        const [unpairedTypedLogin] = unpairedTypedLogins;
        if (unpairedTypedLogins.length !== 1 || !unpairedTypedLogin) {
            return response;
        }
        const localEmployeeLogins = await getLocalEmployeeLogins(policyKey);
        const returnedLogins = new Set(loginByAccountID.values());
        const newEchoedLogins = [...echoedLogins].filter(
            (login) => !normalizedTypedLogins.has(login) && !localEmployeeLogins.has(login) && !settledLogins.has(login) && returnedLogins.has(login),
        );
        if (newEchoedLogins.length === 1) {
            successEmployeeList[unpairedTypedLogin] = null;
        }

        return response;
    });

export default handleSecondaryLoginInvites;
