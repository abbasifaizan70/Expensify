/* eslint-disable @typescript-eslint/naming-convention */
import CONST from '@src/CONST';
import {convertApprovalWorkflowToPolicyEmployees, convertPolicyEmployeesToApprovalWorkflows, updateWorkflowDataOnApproverRemoval} from '@src/libs/WorkflowUtils';
import type {Policy} from '@src/types/onyx';
import type ApprovalWorkflow from '@src/types/onyx/ApprovalWorkflow';
import type {PersonalDetailsList} from '@src/types/onyx/PersonalDetails';
import type {PolicyEmployeeList} from '@src/types/onyx/PolicyEmployee';

import {buildPersonalDetails, localeCompare} from '../utils/TestHelper';

const OWNER = 'owner@customer.com';
const ADMIN = 'admin@customer.com';
const APPROVER = 'approver@customer.com';
const SUBMITTER = 'submitter@customer.com';
const GHOST = 'ghost@customer.com';
const GUIDE = 'guide@expensify.com';

const personalDetails: PersonalDetailsList = {
    1: buildPersonalDetails(OWNER, 1, 'Owner'),
    2: buildPersonalDetails(ADMIN, 2, 'Admin'),
    3: buildPersonalDetails(APPROVER, 3, 'Approver'),
    4: buildPersonalDetails(SUBMITTER, 4, 'Submitter'),
    5: buildPersonalDetails(GUIDE, 5, 'Guide'),
};

function buildPolicy(employeeList: PolicyEmployeeList, overrides: Partial<Policy> = {}): Policy {
    return {
        id: 'P1',
        name: 'Customer workspace',
        role: 'admin',
        type: 'team',
        owner: OWNER,
        ownerAccountID: 1,
        outputCurrency: 'USD',
        isPolicyExpenseChatEnabled: true,
        approver: OWNER,
        employeeList,
        ...overrides,
    } as Policy;
}

/** Mirrors exactly what WorkspaceMemberDetailsPage.removeUser() does with the converter output. */
function simulateRemoveUser(policy: Policy, removedLogin: string, workflows: ApprovalWorkflow[]) {
    const removedApprover = Object.values(personalDetails).find((details) => details?.login === removedLogin);
    const ownerDetails = personalDetails[1];
    if (!removedApprover || !ownerDetails) {
        throw new Error('bad fixture');
    }
    const updated = updateWorkflowDataOnApproverRemoval({approvalWorkflows: workflows, removedApprover, ownerDetails});
    const previousEmployeeList = Object.fromEntries(Object.entries(policy.employeeList ?? {}).map(([key, value]) => [key, {...value, pendingAction: null}]));
    const submitted: Array<{isDefault: boolean; firstApprover: string | undefined; removed: boolean}> = [];
    for (const workflow of updated) {
        const type = workflow.removeApprovalWorkflow ? CONST.APPROVAL_WORKFLOW.TYPE.REMOVE : CONST.APPROVAL_WORKFLOW.TYPE.UPDATE;
        // This is the call that throws in production (Workflow.ts updateApprovalWorkflow / removeApprovalWorkflow)
        convertApprovalWorkflowToPolicyEmployees({approvalWorkflow: workflow, previousEmployeeList, type, membersToRemove: [], approversToRemove: [], defaultApprover: OWNER});
        submitted.push({isDefault: !!workflow.isDefault, firstApprover: workflow.approvers.at(0)?.email, removed: !!workflow.removeApprovalWorkflow});
    }
    return submitted;
}

describe('Issue #100266 — zero-approver workflows reaching updateApprovalWorkflow', () => {
    describe('producer 1: default approver is not a member (server-held state)', () => {
        // A custom workflow (SUBMITTER -> APPROVER) exists, the owner self-submits, and policy.approver
        // points at an email that is not in employeeList. This is the shape Sentry APP-9JM needs.
        const employeeList: PolicyEmployeeList = {
            [OWNER]: {email: OWNER, submitsTo: OWNER},
            [ADMIN]: {email: ADMIN, submitsTo: OWNER, role: 'admin'},
            [APPROVER]: {email: APPROVER, submitsTo: OWNER},
            [SUBMITTER]: {email: SUBMITTER, submitsTo: APPROVER},
        };

        it('policy.approver ghost: the converter must not emit a default workflow with zero approvers, and removing an approver must not throw', () => {
            const policy = buildPolicy(employeeList, {approver: GHOST});
            const {approvalWorkflows} = convertPolicyEmployeesToApprovalWorkflows({policy, personalDetails, localeCompare, currentUserLogin: ADMIN});

            expect(approvalWorkflows.every((workflow) => workflow.approvers.length > 0)).toBe(true);
            const defaultWorkflow = approvalWorkflows.find((workflow) => workflow.isDefault);
            expect(defaultWorkflow?.approvers.at(0)?.email).toBe(OWNER);

            // Removing the custom approver submits the (untouched) default workflow too — it must carry the owner so
            // UpdateWorkspaceApproval repairs policy.approver instead of throwing.
            const submitted = simulateRemoveUser(policy, APPROVER, approvalWorkflows);
            expect(submitted.find((entry) => entry.isDefault)?.firstApprover).toBe(OWNER);
        });

        it('HR finalApprover ghost (Gusto basic mode): same guarantee', () => {
            const policy = buildPolicy(employeeList, {
                connections: {gusto: {config: {approvalMode: CONST.GUSTO.APPROVAL_MODE.BASIC, finalApprover: GHOST}}},
            } as Partial<Policy>);
            const {approvalWorkflows} = convertPolicyEmployeesToApprovalWorkflows({policy, personalDetails, localeCompare, currentUserLogin: ADMIN});

            expect(approvalWorkflows.every((workflow) => workflow.approvers.length > 0)).toBe(true);
            expect(() => simulateRemoveUser(policy, APPROVER, approvalWorkflows)).not.toThrow();
        });
    });

    describe('producer 2: the customer-facing Expensify-team filter empties a chain', () => {
        const employeeList: PolicyEmployeeList = {
            [OWNER]: {email: OWNER, submitsTo: OWNER},
            [ADMIN]: {email: ADMIN, submitsTo: OWNER, role: 'admin'},
            [APPROVER]: {email: APPROVER, submitsTo: OWNER},
            [GUIDE]: {email: GUIDE, submitsTo: OWNER},
            [SUBMITTER]: {email: SUBMITTER, submitsTo: GUIDE},
        };

        it('with the display filter on, no stored workflow may have zero approvers', () => {
            const policy = buildPolicy(employeeList);
            const {approvalWorkflows} = convertPolicyEmployeesToApprovalWorkflows({policy, personalDetails, localeCompare, currentUserLogin: ADMIN});

            expect(approvalWorkflows.every((workflow) => workflow.approvers.length > 0)).toBe(true);
        });

        it('the mutation path (no display filter) keeps the guide chain so the removal logic can act on it', () => {
            const policy = buildPolicy(employeeList);
            const {approvalWorkflows} = convertPolicyEmployeesToApprovalWorkflows({policy, personalDetails, localeCompare});

            const guideWorkflow = approvalWorkflows.find((workflow) => workflow.approvers.at(0)?.email === GUIDE);
            expect(guideWorkflow?.members.map((member) => member.email)).toEqual([SUBMITTER]);
            // Removing the guide hands its members back to the default workflow instead of throwing
            const submitted = simulateRemoveUser(policy, GUIDE, approvalWorkflows);
            expect(submitted.find((entry) => entry.firstApprover === GUIDE)?.removed).toBe(true);
        });
    });

    describe('defense in depth: updateWorkflowDataOnApproverRemoval', () => {
        it('drops a workflow with no approvers instead of passing it through', () => {
            const removedApprover = personalDetails[3];
            const ownerDetails = personalDetails[1];
            if (!removedApprover || !ownerDetails) {
                throw new Error('bad fixture');
            }
            const result = updateWorkflowDataOnApproverRemoval({
                approvalWorkflows: [
                    {members: [], approvers: [], isDefault: true},
                    {members: [], approvers: [{email: APPROVER, displayName: 'Approver', isCircularReference: false}], isDefault: false},
                ],
                removedApprover,
                ownerDetails,
            });
            expect(result.every((workflow) => workflow.approvers.length > 0)).toBe(true);
        });
    });
});
