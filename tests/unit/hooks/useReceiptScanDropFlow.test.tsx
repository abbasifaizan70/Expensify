import {act, renderHook} from '@testing-library/react-native';
import useReceiptScanDrop from '@hooks/useReceiptScanDrop';
import {navigateToParticipantPage} from '@libs/IOUUtils';
import Navigation from '@libs/Navigation/Navigation';
import {setMoneyRequestParticipantsFromReport} from '@userActions/IOU';
import waitForBatchedUpdatesWithAct from '../../utils/waitForBatchedUpdatesWithAct';

jest.mock('@hooks/useCurrentReportID', () => ({
    __esModule: true,
    useCurrentReportIDState: jest.fn(() => ({currentReportID: 'report1'})),
}));

jest.mock('@hooks/useCurrentUserPersonalDetails', () => ({
    __esModule: true,
    default: jest.fn(() => ({accountID: 123, login: 'user@test.com'})),
}));

jest.mock('@hooks/useFilesValidation', () => ({
    __esModule: true,
    default: (callback: (files: unknown[]) => void) => ({
        validateFiles: callback,
        PDFValidationComponent: null,
        ErrorModal: null,
    }),
}));

jest.mock('@hooks/useIsAnonymousUser', () => ({
    __esModule: true,
    default: jest.fn(() => false),
}));

jest.mock('@hooks/useSelfDMReport', () => ({
    __esModule: true,
    default: jest.fn(() => ({reportID: 'selfDMReportID'})),
}));

jest.mock('@hooks/useOnyx', () => ({
    __esModule: true,
    default: jest.fn((key: string) => {
        if (key === 'nvp_expensify_activePolicyID') {
            return [undefined];
        }
        if (key === 'report_report1') {
            return [{reportID: 'report1', policyID: 'policy1', chatType: 'policyExpenseChat'}];
        }
        if (key === 'policy_policy1') {
            return [{id: 'policy1', isPolicyExpenseChatEnabled: true, autoReporting: true, type: 'team'}];
        }
        if (key === 'personalPolicyID') {
            return ['personalPolicy1'];
        }
        if (key === 'policy_personalPolicy1') {
            return [{}];
        }
        if (key === 'collection_transactionDraft_') {
            return [[]];
        }
        return [undefined];
    }),
}));

jest.mock('@libs/PolicyUtils', () => ({
    __esModule: true,
    hasOnlyPersonalPolicies: jest.fn(() => false),
    isPaidGroupPolicy: jest.fn(() => true),
}));

jest.mock('@libs/ReportUtils', () => ({
    __esModule: true,
    generateReportID: jest.fn(() => 'generatedReportID'),
    getPolicyExpenseChat: jest.fn(() => ({reportID: 'policyExpenseReportID'})),
    isPolicyExpenseChat: jest.fn(() => true),
    isSelfDM: jest.fn(() => false),
}));

jest.mock('@libs/SubscriptionUtils', () => ({
    __esModule: true,
    shouldRestrictUserBillableActions: jest.fn(() => false),
}));

jest.mock('@libs/Navigation/Navigation', () => ({
    __esModule: true,
    default: {
        navigate: jest.fn(),
    },
}));

jest.mock('@libs/IOUUtils', () => ({
    __esModule: true,
    navigateToParticipantPage: jest.fn(),
}));

jest.mock('@libs/actions/Transaction', () => ({
    __esModule: true,
    setTransactionReport: jest.fn(),
}));

jest.mock('@userActions/IOU', () => ({
    __esModule: true,
    initMoneyRequest: jest.fn(() => ({transactionID: 'transaction1'})),
    setMoneyRequestParticipantsFromReport: jest.fn(() => Promise.resolve()),
}));

jest.mock('@userActions/IOU/Receipt', () => ({
    __esModule: true,
    setMoneyRequestReceipt: jest.fn(),
}));

jest.mock('@userActions/TransactionEdit', () => ({
    __esModule: true,
    buildOptimisticTransactionAndCreateDraft: jest.fn(() => ({transactionID: 'transaction-draft'})),
}));

describe('useReceiptScanDrop flow routing', () => {
    beforeAll(() => {
        global.URL.createObjectURL = jest.fn(() => 'blob:receipt');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('navigates to confirmation when active policy is missing but current report is a workspace expense chat', async () => {
        const {result} = renderHook(() => useReceiptScanDrop());
        await waitForBatchedUpdatesWithAct();

        const file = {name: 'receipt.jpg', type: 'image/jpeg'} as File;
        const dropEvent = {
            dataTransfer: {
                files: [file],
                items: [],
            },
        } as unknown as DragEvent;

        await act(async () => {
            result.current.initScanRequest(dropEvent);
            await Promise.resolve();
        });

        expect(setMoneyRequestParticipantsFromReport).toHaveBeenCalled();
        expect(navigateToParticipantPage).not.toHaveBeenCalled();
        expect(Navigation.navigate).toHaveBeenCalled();
    });
});
