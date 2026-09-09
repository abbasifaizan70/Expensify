import handleSecondaryLoginInvites from '@libs/Middleware/HandleSecondaryLoginInvites';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type Request from '@src/types/onyx/Request';
import type {AnyOnyxUpdate} from '@src/types/onyx/Request';
import type Response from '@src/types/onyx/Response';

import type {OnyxKey} from 'react-native-onyx';

import Onyx from 'react-native-onyx';

import waitForBatchedUpdates from '../utils/waitForBatchedUpdates';

const POLICY_ID = '1234';
const POLICY_KEY = `${ONYXKEYS.COLLECTION.POLICY}${POLICY_ID}`;
const ADMIN_ACCOUNT_ID = 1;
const INVITEE_ACCOUNT_ID = 4321;
const OTHER_ACCOUNT_ID = 8765;
const PRIMARY_LOGIN = 'primary@example.com';
const SECONDARY_LOGIN = 'secondary@example.com';
const OTHER_LOGIN = 'other@example.com';
const SECONDARY_CHAT_REPORT_ID = '7001';
const OTHER_CHAT_REPORT_ID = '7002';

type EmployeeListSuccessValue = Record<string, {pendingAction: null} | null>;

function buildEmployeeSuccessData(logins: string[]): AnyOnyxUpdate[] {
    const employeeList: EmployeeListSuccessValue = {};
    for (const login of logins) {
        employeeList[login] = {pendingAction: null};
    }
    return [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: POLICY_KEY,
            value: {employeeList},
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${SECONDARY_CHAT_REPORT_ID}`,
            value: {pendingFields: {createChat: null}},
        },
    ];
}

function buildInviteRequest(logins: string[], reportCreationData: Record<string, {reportID: string}> | null = {[SECONDARY_LOGIN]: {reportID: SECONDARY_CHAT_REPORT_ID}}): Request<OnyxKey> {
    return {
        command: 'AddMembersToWorkspace',
        data: {
            policyID: POLICY_ID,
            employees: JSON.stringify(logins.map((login) => ({email: login, role: CONST.POLICY.ROLE.USER}))),
            ...(reportCreationData ? {reportCreationData: JSON.stringify(reportCreationData)} : {}),
        },
        successData: buildEmployeeSuccessData(logins),
    } as Request<OnyxKey>;
}

function policyUpdate(logins: string[]): AnyOnyxUpdate {
    const employeeList: Record<string, {email: string; role: string}> = {};
    for (const login of logins) {
        employeeList[login] = {email: login, role: CONST.POLICY.ROLE.USER};
    }
    return {onyxMethod: Onyx.METHOD.MERGE, key: POLICY_KEY, value: {employeeList}};
}

function personalDetailsUpdate(details: Record<number, string>): AnyOnyxUpdate {
    const value: Record<number, {accountID: number; login: string}> = {};
    for (const [accountID, login] of Object.entries(details)) {
        value[Number(accountID)] = {accountID: Number(accountID), login};
    }
    return {onyxMethod: Onyx.METHOD.MERGE, key: ONYXKEYS.PERSONAL_DETAILS_LIST, value};
}

/** Mirrors the measured AddMembersToWorkspace response: the chat the client created comes back as a merge that adds the invitee as a participant. */
function chatReportUpdate(reportID: string, ...participantAccountIDs: number[]): AnyOnyxUpdate {
    const participants: Record<number, {notificationPreference: string}> = {};
    for (const accountID of participantAccountIDs) {
        participants[accountID] = {notificationPreference: CONST.REPORT.NOTIFICATION_PREFERENCE.ALWAYS};
    }
    return {
        onyxMethod: Onyx.METHOD.MERGE,
        key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
        value: {participants},
    };
}

function ownedReportUpdate(reportID: string, ownerAccountID: number): AnyOnyxUpdate {
    return {
        onyxMethod: Onyx.METHOD.MERGE,
        key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
        value: {reportID, ownerAccountID, chatType: CONST.REPORT.CHAT_TYPE.POLICY_EXPENSE_CHAT, policyID: POLICY_ID},
    };
}

function buildResponse(onyxData: AnyOnyxUpdate[], jsonCode = 200): Response<OnyxKey> {
    return {jsonCode, onyxData} as Response<OnyxKey>;
}

/** What the backend returns for an invite typed with a secondary login: the account under its primary login, plus the chat we asked it to create. */
function secondaryLoginResponse(): Response<OnyxKey> {
    return buildResponse([policyUpdate([PRIMARY_LOGIN]), personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN}), chatReportUpdate(SECONDARY_CHAT_REPORT_ID, INVITEE_ACCOUNT_ID)]);
}

function getEmployeeListSuccessValue(request: Request<OnyxKey>): EmployeeListSuccessValue {
    const update = ((request.successData ?? []) as AnyOnyxUpdate[]).find((item) => item.key === POLICY_KEY);
    return (update?.value as {employeeList: EmployeeListSuccessValue}).employeeList;
}

describe('HandleSecondaryLoginInvites middleware', () => {
    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(async () => {
        await Onyx.clear();
        await Onyx.merge(ONYXKEYS.SESSION, {accountID: ADMIN_ACCOUNT_ID, email: 'admin@example.com'});
        await Onyx.merge(ONYXKEYS.PERSONAL_DETAILS_LIST, {
            [ADMIN_ACCOUNT_ID]: {accountID: ADMIN_ACCOUNT_ID, login: 'admin@example.com'},
        });
        await waitForBatchedUpdates();
    });

    it('leaves a response for another command untouched', async () => {
        const request = {...buildInviteRequest([SECONDARY_LOGIN]), command: 'UpdateWorkspaceMembersRole'} as Request<OnyxKey>;

        await handleSecondaryLoginInvites(Promise.resolve(secondaryLoginResponse()), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}});
    });

    it('leaves a failed invite to failureData', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN]);

        await handleSecondaryLoginInvites(Promise.resolve(buildResponse(secondaryLoginResponse().onyxData ?? [], 400)), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}});
    });

    it('retires the typed key when the account comes back under its primary login, paired through the chat the client asked for', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN]);

        await handleSecondaryLoginInvites(Promise.resolve(secondaryLoginResponse()), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: null});
        // The rest of successData is left alone.
        expect(request.successData).toHaveLength(2);
    });

    it('does not need any local state to pair the two logins, so a replayed offline invite reconciles too', async () => {
        // No personal detail for the typed login anywhere in Onyx: the only link is the request's reportCreationData.
        const request = buildInviteRequest([SECONDARY_LOGIN]);

        await handleSecondaryLoginInvites(Promise.resolve(secondaryLoginResponse()), request, false);

        expect(getEmployeeListSuccessValue(request)[SECONDARY_LOGIN]).toBeNull();
    });

    it('ignores the inviter among the chat participants and still pairs the invitee', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN]);
        const response = buildResponse([
            policyUpdate([PRIMARY_LOGIN, 'admin@example.com']),
            personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN, [ADMIN_ACCOUNT_ID]: 'admin@example.com'}),
            chatReportUpdate(SECONDARY_CHAT_REPORT_ID, ADMIN_ACCOUNT_ID, INVITEE_ACCOUNT_ID),
        ]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: null});
    });

    it('does not guess when the chat names two accounts that both came back as new members', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN]);
        const response = buildResponse([
            policyUpdate([PRIMARY_LOGIN, OTHER_LOGIN]),
            personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN, [OTHER_ACCOUNT_ID]: OTHER_LOGIN}),
            chatReportUpdate(SECONDARY_CHAT_REPORT_ID, INVITEE_ACCOUNT_ID, OTHER_ACCOUNT_ID),
        ]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}});
    });

    it('also accepts the account as the ownerAccountID of the returned chat', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN]);
        const response = buildResponse([
            policyUpdate([PRIMARY_LOGIN]),
            personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN}),
            ownedReportUpdate(SECONDARY_CHAT_REPORT_ID, INVITEE_ACCOUNT_ID),
        ]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: null});
    });

    it('re-invite typed offline: pairs the one unechoed login with the one new member when the backend reused an existing chat', async () => {
        // Measured shape: the backend `set`s the client's optimistic chat away and answers with the member's existing chat under
        // a reportID the request never mentioned, so neither the chat nor a local personal detail can name the account.
        await Onyx.merge(POLICY_KEY, {
            id: POLICY_ID,
            employeeList: {'admin@example.com': {role: CONST.POLICY.ROLE.ADMIN}, [SECONDARY_LOGIN]: {pendingAction: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD}},
        });
        await waitForBatchedUpdates();
        const request = buildInviteRequest([SECONDARY_LOGIN]);
        const response = buildResponse([
            {onyxMethod: Onyx.METHOD.SET, key: `${ONYXKEYS.COLLECTION.REPORT}${SECONDARY_CHAT_REPORT_ID}`, value: {}},
            chatReportUpdate(OTHER_CHAT_REPORT_ID, INVITEE_ACCOUNT_ID),
            personalDetailsUpdate({[ADMIN_ACCOUNT_ID]: 'admin@example.com', [INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN}),
            policyUpdate([PRIMARY_LOGIN]),
        ]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: null});
    });

    it('does not use that arithmetic when the new member was already in the local employeeList', async () => {
        await Onyx.merge(POLICY_KEY, {
            id: POLICY_ID,
            employeeList: {[PRIMARY_LOGIN]: {role: CONST.POLICY.ROLE.USER}, [SECONDARY_LOGIN]: {pendingAction: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD}},
        });
        await waitForBatchedUpdates();
        const request = buildInviteRequest([SECONDARY_LOGIN]);
        const response = buildResponse([personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN}), policyUpdate([PRIMARY_LOGIN])]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}});
    });

    it('does not use that arithmetic when two sent logins are unechoed', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN, OTHER_LOGIN], null);
        const response = buildResponse([personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN}), policyUpdate([PRIMARY_LOGIN])]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}, [OTHER_LOGIN]: {pendingAction: null}});
    });

    it('does not use that arithmetic when the new member has no personal detail in the response', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN], null);
        const response = buildResponse([policyUpdate([PRIMARY_LOGIN])]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}});
    });

    it('keeps an ordinary invite whose typed login the server kept', async () => {
        const request = buildInviteRequest([PRIMARY_LOGIN], {[PRIMARY_LOGIN]: {reportID: SECONDARY_CHAT_REPORT_ID}});

        await handleSecondaryLoginInvites(Promise.resolve(secondaryLoginResponse()), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[PRIMARY_LOGIN]: {pendingAction: null}});
    });

    it('retires only the re-keyed login when several members are invited at once', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN, OTHER_LOGIN], {
            [SECONDARY_LOGIN]: {reportID: SECONDARY_CHAT_REPORT_ID},
            [OTHER_LOGIN]: {reportID: OTHER_CHAT_REPORT_ID},
        });
        const response = buildResponse([
            policyUpdate([PRIMARY_LOGIN, OTHER_LOGIN]),
            personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN, [OTHER_ACCOUNT_ID]: OTHER_LOGIN}),
            chatReportUpdate(SECONDARY_CHAT_REPORT_ID, INVITEE_ACCOUNT_ID),
            chatReportUpdate(OTHER_CHAT_REPORT_ID, OTHER_ACCOUNT_ID),
        ]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: null, [OTHER_LOGIN]: {pendingAction: null}});
    });

    it('falls back to the account the client had resolved for the login when the response carries no chat for it', async () => {
        // Search had resolved the secondary login to the real account before the invite was sent.
        await Onyx.merge(ONYXKEYS.PERSONAL_DETAILS_LIST, {[INVITEE_ACCOUNT_ID]: {accountID: INVITEE_ACCOUNT_ID, login: SECONDARY_LOGIN}});
        await waitForBatchedUpdates();
        const request = buildInviteRequest([SECONDARY_LOGIN], null);
        const response = buildResponse([policyUpdate([PRIMARY_LOGIN]), personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN})]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: null});
    });

    it('ignores an optimistic personal detail in that fallback, since its accountID is a client-side guess', async () => {
        await Onyx.merge(ONYXKEYS.PERSONAL_DETAILS_LIST, {
            [INVITEE_ACCOUNT_ID]: {accountID: INVITEE_ACCOUNT_ID, login: SECONDARY_LOGIN, isOptimisticPersonalDetail: true},
        });
        await waitForBatchedUpdates();
        // Two unechoed logins keep the one-to-one fallback out of the picture, so only the personal-detail pairing could fire here.
        const request = buildInviteRequest([SECONDARY_LOGIN, OTHER_LOGIN], null);
        const response = buildResponse([policyUpdate([PRIMARY_LOGIN]), personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN})]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}, [OTHER_LOGIN]: {pendingAction: null}});
    });

    it('never removes a key the server merely did not echo', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN]);
        // The chat came back, but the account it belongs to is not listed under any other login in the response.
        const response = buildResponse([policyUpdate([OTHER_LOGIN]), chatReportUpdate(SECONDARY_CHAT_REPORT_ID, INVITEE_ACCOUNT_ID)]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}});
    });

    it('does nothing when the response does not echo the employeeList at all', async () => {
        const request = buildInviteRequest([SECONDARY_LOGIN]);
        const response = buildResponse([personalDetailsUpdate({[INVITEE_ACCOUNT_ID]: PRIMARY_LOGIN}), chatReportUpdate(SECONDARY_CHAT_REPORT_ID, INVITEE_ACCOUNT_ID)]);

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);

        expect(getEmployeeListSuccessValue(request)).toEqual({[SECONDARY_LOGIN]: {pendingAction: null}});
    });

    it('removes the typed key from Onyx once the response and the rewritten successData are applied in order', async () => {
        await Onyx.merge(POLICY_KEY, {
            id: POLICY_ID,
            employeeList: {
                'admin@example.com': {email: 'admin@example.com', role: CONST.POLICY.ROLE.ADMIN},
                [SECONDARY_LOGIN]: {email: SECONDARY_LOGIN, role: CONST.POLICY.ROLE.USER, pendingAction: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD},
            },
        });
        await waitForBatchedUpdates();
        const request = buildInviteRequest([SECONDARY_LOGIN]);
        const response = secondaryLoginResponse();

        await handleSecondaryLoginInvites(Promise.resolve(response), request, false);
        // Mirrors applyHTTPSOnyxUpdates: response onyxData first, then the request's successData.
        await Onyx.update(response.onyxData ?? []);
        await Onyx.update(request.successData ?? []);
        await waitForBatchedUpdates();

        const policy = await new Promise<{employeeList?: Record<string, unknown>} | undefined>((resolve) => {
            const connection = Onyx.connectWithoutView({
                key: POLICY_KEY,
                callback: (value) => {
                    Onyx.disconnect(connection);
                    resolve(value as {employeeList?: Record<string, unknown>} | undefined);
                },
            });
        });

        expect(Object.keys(policy?.employeeList ?? {}).sort()).toEqual(['admin@example.com', PRIMARY_LOGIN]);
        expect(policy?.employeeList?.[SECONDARY_LOGIN]).toBeUndefined();
    });
});
