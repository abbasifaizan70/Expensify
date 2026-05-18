import {useMemo} from 'react';
import type {OnyxCollection, OnyxEntry} from 'react-native-onyx';
import {useAllReportsTransactionsAndViolations} from '@components/OnyxListItemProvider';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Report, Transaction, TransactionViolation} from '@src/types/onyx';
import useNetwork from './useNetwork';
import useOnyx from './useOnyx';
import useReportTransactions from './useReportTransactions';

const DEFAULT_TRANSACTIONS: Record<string, Transaction> = {};
const DEFAULT_FILTERED_TRANSACTIONS: Transaction[] = [];
const DEFAULT_VIOLATIONS: Record<string, TransactionViolation[]> = {};

function useReportWithTransactionsAndViolations(reportID?: string): [OnyxEntry<Report>, Transaction[], OnyxCollection<TransactionViolation[]>] {
    const [report] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${reportID}`);

    // It connects to single Onyx instance held in OnyxListItemProvider, so it can be safely used in list items without affecting performance.
    const allReportTransactionsAndViolations = useAllReportsTransactionsAndViolations();
    const {transactions, violations} = allReportTransactionsAndViolations?.[reportID ?? CONST.DEFAULT_NUMBER_ID] ?? {transactions: DEFAULT_TRANSACTIONS, violations: DEFAULT_VIOLATIONS};
    const {isOffline} = useNetwork();
    const directReportTransactions = useReportTransactions(reportID);
    const filteredTransactions = useMemo(() => {
        const fromDerived = Object.values(transactions).filter((transaction): transaction is Transaction => !!transaction && (isOffline || transaction.pendingAction !== CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE));

        if (fromDerived.length > 0) {
            return fromDerived;
        }

        // Fall back to the TRANSACTION collection when the derived bucket is briefly empty (e.g. cross-tab policy category sync).
        return directReportTransactions.filter((transaction) => isOffline || transaction.pendingAction !== CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE);
    }, [transactions, directReportTransactions, isOffline]);

    return [report, filteredTransactions ?? DEFAULT_FILTERED_TRANSACTIONS, violations];
}

export default useReportWithTransactionsAndViolations;
