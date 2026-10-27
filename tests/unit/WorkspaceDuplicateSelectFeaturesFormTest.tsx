import {act, render} from '@testing-library/react-native';

import OnyxListItemProvider from '@components/OnyxListItemProvider';
import type {ConfirmButtonOptions, ListItem} from '@components/SelectionList/types';

import {toIndexMap} from '@libs/RuleUtils';

import WorkspaceDuplicateSelectFeaturesForm from '@pages/workspace/duplicate/WorkspaceDuplicateSelectFeaturesForm';

import {duplicateWorkspace} from '@userActions/Policy/Policy';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Policy, PolicyCategories} from '@src/types/onyx';
import type Rule from '@src/types/onyx/Rule';

import React from 'react';
import Onyx from 'react-native-onyx';

import createRandomPolicy from '../utils/collections/policies';
import * as TestHelper from '../utils/TestHelper';
import waitForBatchedUpdates from '../utils/waitForBatchedUpdates';

const POLICY_ID = '1';
const TARGET_POLICY_ID = '2';

type CapturedSelectionListProps = {
    data: ListItem[];
    onSelectRow: (item: ListItem) => void;
    confirmButtonOptions: ConfirmButtonOptions<ListItem>;
};
let mockSelectionListProps: CapturedSelectionListProps | undefined;

// The list itself isn't under test, so it is replaced by a stub that captures the rows, the row handler and the Continue button.
jest.mock('@components/SelectionList', () => ({
    __esModule: true,
    default: (props: CapturedSelectionListProps) => {
        mockSelectionListProps = props;
        return null;
    },
}));

jest.mock('@react-navigation/native', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const actualNav = jest.requireActual('@react-navigation/native');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...actualNav,
        useRoute: () => ({params: {policyID: POLICY_ID}}),
    };
});

jest.mock('@libs/Navigation/Navigation', () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    closeRHPFlow: jest.fn(),
}));

jest.mock('@hooks/useConfirmModal', () => ({
    __esModule: true,
    default: () => ({showConfirmModal: jest.fn(() => Promise.resolve({action: 'cancel'}))}),
}));

// The form fires openDuplicatePolicyPage on mount and duplicateWorkspace on Continue. Both are stubbed so the test can read the parts the form sends.
jest.mock('@userActions/Policy/Policy', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const actual = jest.requireActual('@userActions/Policy/Policy');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...actual,
        openDuplicatePolicyPage: jest.fn(),
        duplicateWorkspace: jest.fn(),
    };
});

const MERCHANT_RULE: Rule = {
    scope: CONST.RULES.SCOPE.POLICY,
    scopeID: POLICY_ID,
    triggers: toIndexMap([CONST.RULES.TRIGGERS.CREATE_TRANSACTION]),
    filters: {left: CONST.RULES.EXPENSE_DEFAULT.FIELD.MERCHANT, operator: CONST.SEARCH.SYNTAX_OPERATORS.EQUAL_TO, right: 'Acme'},
    actions: toIndexMap([{name: CONST.RULES.ACTIONS.SET, field: CONST.RULES.EXPENSE_DEFAULT.FIELD.CATEGORY, value: 'Travel'}]),
};

/** Stands for an `areRulesEnabled` that was never written, as on a Control workspace migrated from Classic. */
const UNSET = 'unset';

/** A category whose rules are the only thing a migrated Control workspace has to infer the Rules feature from. */
const CATEGORY_WITH_RULES: PolicyCategories = {Travel: {name: 'Travel', enabled: true, maxExpenseAmount: 5000}};

/** A Control workspace whose only possible workspace-level rule is eReceipts, so the test decides whether the Rules row is shown. */
function createSourcePolicy(hasWorkspaceRules: boolean, areRulesEnabled: boolean | typeof UNSET): Policy {
    return {
        ...createRandomPolicy(Number(POLICY_ID), CONST.POLICY.TYPE.CORPORATE),
        areRulesEnabled: areRulesEnabled === UNSET ? undefined : areRulesEnabled,
        preventSelfApproval: false,
        maxExpenseAmountNoReceipt: CONST.DISABLED_MAX_EXPENSE_VALUE,
        maxExpenseAmount: CONST.DISABLED_MAX_EXPENSE_VALUE,
        maxExpenseAge: CONST.DISABLED_MAX_EXPENSE_VALUE,
        eReceipts: hasWorkspaceRules,
    };
}

async function renderForm(hasWorkspaceRules: boolean, areRulesEnabled: boolean | typeof UNSET = true, policyCategories?: PolicyCategories) {
    await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${POLICY_ID}`, createSourcePolicy(hasWorkspaceRules, areRulesEnabled));
    await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY_CATEGORIES}${POLICY_ID}`, policyCategories ?? null);
    await Onyx.set(`${ONYXKEYS.COLLECTION.RULE}merchantRule`, MERCHANT_RULE);
    await Onyx.set(ONYXKEYS.RAM_ONLY_HAS_RULES_DATA_BEEN_FETCHED, true);
    await Onyx.set(ONYXKEYS.DUPLICATE_WORKSPACE, {name: 'Duplicate', policyID: TARGET_POLICY_ID});
    await waitForBatchedUpdates();

    render(
        <OnyxListItemProvider>
            <WorkspaceDuplicateSelectFeaturesForm policyID={POLICY_ID} />
        </OnyxListItemProvider>,
    );
    await waitForBatchedUpdates();
}

function getRow(key: string): ListItem | undefined {
    return mockSelectionListProps?.data.find((item) => item.keyForList === key);
}

async function pressRow(key: string) {
    const row = getRow(key);
    expect(row).toBeDefined();
    if (!row) {
        return;
    }
    act(() => {
        mockSelectionListProps?.onSelectRow(row);
    });
    await waitForBatchedUpdates();
}

function pressContinue() {
    act(() => {
        mockSelectionListProps?.confirmButtonOptions.onConfirm?.();
    });
}

function getSentParts(): Record<string, boolean> | undefined {
    return jest.mocked(duplicateWorkspace).mock.calls.at(0)?.[1].parts;
}

describe('WorkspaceDuplicateSelectFeaturesForm Rules and Merchant rules', () => {
    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(() => {
        // Without a fetch mock, background requests reach the real fetch and fail in the test environment.
        global.fetch = TestHelper.createGlobalFetchMock();
        mockSelectionListProps = undefined;
    });

    afterEach(async () => {
        await Onyx.clear();
        await waitForBatchedUpdates();
        jest.clearAllMocks();
    });

    it('deselects Merchant rules when Rules is deselected, so neither is copied', async () => {
        // Given a source with workspace-level rules and a merchant rule, where every row starts selected
        await renderForm(true);
        expect(getRow('rules')?.isSelected).toBe(true);
        expect(getRow('codingRules')?.isSelected).toBe(true);

        // When the admin deselects Rules and continues
        await pressRow('rules');
        pressContinue();

        // Then Merchant rules is deselected too, because merchant rules live under Rules and can't be copied without it
        expect(getRow('codingRules')?.isSelected).toBe(false);
        expect(getSentParts()).toMatchObject({expenses: false, codingRules: false});
    });

    it('selects Rules when Merchant rules is selected while Rules is deselected', async () => {
        // Given Rules and Merchant rules were both deselected
        await renderForm(true);
        await pressRow('rules');

        // When the admin selects Merchant rules and continues
        await pressRow('codingRules');
        pressContinue();

        // Then Rules is selected too, so the merchant rules are copied along with the Rules feature they belong to
        expect(getRow('rules')?.isSelected).toBe(true);
        expect(getRow('codingRules')?.isSelected).toBe(true);
        expect(getSentParts()).toMatchObject({expenses: true, codingRules: true});
    });

    it('keeps Rules selected when only Merchant rules is deselected', async () => {
        // Given every row starts selected
        await renderForm(true);

        // When the admin deselects only Merchant rules and continues
        await pressRow('codingRules');
        pressContinue();

        // Then the workspace-level rules are still copied without the merchant rules, because Rules doesn't depend on Merchant rules
        expect(getRow('rules')?.isSelected).toBe(true);
        expect(getSentParts()).toMatchObject({expenses: true, codingRules: false});
    });

    it('copies merchant rules on their own when the source has no workspace-level rules', async () => {
        // Given a source with a merchant rule but no workspace-level rules, so the Rules row is hidden
        await renderForm(false);
        expect(getRow('rules')).toBeUndefined();
        expect(getRow('codingRules')?.isSelected).toBe(true);

        // When the admin continues
        pressContinue();

        // Then the merchant rules are still copied, because there is no Rules row they could depend on
        expect(getSentParts()).toMatchObject({expenses: false, codingRules: true});
    });

    it('offers neither Rules nor Merchant rules when the Rules feature is off on the source', async () => {
        // Given a Control source with the Rules feature off that still holds a rule value and a merchant rule, as every
        // workspace does once Rules has been turned off: the values are kept, only the feature is disabled
        await renderForm(true, false);

        // When the admin continues
        pressContinue();

        // Then neither row is offered and neither part is copied, so the duplicate can't come out with Rules the source doesn't use
        expect(getRow('rules')).toBeUndefined();
        expect(getRow('codingRules')).toBeUndefined();
        expect(getSentParts()).toMatchObject({expenses: false, codingRules: false});
    });

    it('still offers Rules on a migrated Control source whose flag is unset but has category rules', async () => {
        // Given a Control workspace migrated from Classic, where areRulesEnabled is unset and the category rules are the
        // only sign the feature is in use - the same signal the workspace menu uses to show the Rules page
        await renderForm(true, UNSET, CATEGORY_WITH_RULES);

        // When the admin continues
        pressContinue();

        // Then Rules is still offered and copied, because the source does have Rules
        expect(getRow('rules')).toBeDefined();
        expect(getSentParts()).toMatchObject({expenses: true});
    });

    it('offers no Rules row on a Control source with the flag unset and no category rules', async () => {
        // Given a migrated Control workspace with no category rules at all, so nothing indicates the feature is in use
        await renderForm(true, UNSET);

        // When the admin continues
        pressContinue();

        // Then the Rules row is not offered, matching the source's own workspace menu
        expect(getRow('rules')).toBeUndefined();
        expect(getSentParts()).toMatchObject({expenses: false});
    });
});
