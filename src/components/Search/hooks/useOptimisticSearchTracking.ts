import type {SearchQueryJSON} from '@components/Search/types';

import {flushDeferredWrite, getOptimisticWatchKey, hasDeferredWrite} from '@libs/deferredLayoutWrite';
import {getOriginalMessage, isMoneyRequestAction} from '@libs/ReportActionsUtils';
import {isSearchDataLoaded, isTransactionSearchType} from '@libs/SearchUIUtils';
import {getPendingSubmitFollowUpAction} from '@libs/telemetry/submitFollowUpAction';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Transaction} from '@src/types/onyx';
import type {ReportActions} from '@src/types/onyx/ReportAction';
import type SearchResults from '@src/types/onyx/SearchResults';

import type {OnyxCollection} from 'react-native-onyx';

import {useEffect, useMemo, useRef, useState} from 'react';

import type {OptimisticTrackingState, TrackingMutableState} from './useStableOptimisticSortedData';

import {OPTIMISTIC_TRACKING_TIMEOUT_MS, resolveWatchKey} from './useStableOptimisticSortedData';

type UseOptimisticSearchTrackingParams = {
    /** Current search results snapshot from Onyx. */
    searchResults: SearchResults | undefined;
    /** Parsed query controlling the active search (type, filters, etc.). */
    queryJSON: SearchQueryJSON;
    /** Full transactions collection used to resolve optimistic watch keys. */
    transactions: OnyxCollection<Transaction> | undefined;
    /** Report actions collection used to augment search data with optimistic IOU actions. */
    reportActions: OnyxCollection<ReportActions> | undefined;
};

/**
 * Phase 1: Call this hook BEFORE computing sortedData.
 *
 * Manages optimistic item tracking state: watch key resolution, split parent
 * swapping, data augmentation, timeouts, and cleanup.
 *
 * Returns `searchDataWithOptimisticTransaction` (used to compute filteredData -> sortedData)
 * and a `trackingState` object to pass to `useStableOptimisticSortedData`.
 */
function useOptimisticSearchTracking({searchResults, queryJSON, transactions, reportActions}: UseOptimisticSearchTrackingParams) {
    const {type} = queryJSON;

    const hasPendingWriteOnMount = hasDeferredWrite(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH);
    const initialWatchKey = getOptimisticWatchKey(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH);

    const mutableRef = useRef<TrackingMutableState>({
        hasPendingWriteOnMount,
        optimisticWatchKey: initialWatchKey,
        cachedOptimisticItem: null,
        cachedOptimisticItemIndex: 0,
        isCleanedUp: false,
        hasSwappedFromParent: false,
        rollbackTimeout: undefined,
    });

    const [optimisticWatchKey, setOptimisticWatchKey] = useState(() => initialWatchKey);
    const skipDeferralOnFocusRef = useRef(isSearchDataLoaded(searchResults, queryJSON) && !hasPendingWriteOnMount);

    const [shouldDeferHeavySearchWork, setShouldDeferHeavySearchWork] = useState(() => !isSearchDataLoaded(searchResults, queryJSON) || hasPendingWriteOnMount);
    const [showPendingExpensePlaceholder, setShowPendingExpensePlaceholder] = useState(() => hasPendingWriteOnMount);
    const [isOptimisticTrackingCleared, setIsOptimisticTrackingCleared] = useState(false);

    const clearOptimisticTracking = () => {
        const tracking = mutableRef.current;
        if (tracking.isCleanedUp) {
            return;
        }
        tracking.isCleanedUp = true;
        tracking.cachedOptimisticItem = null;
        tracking.optimisticWatchKey = undefined;
        setOptimisticWatchKey(undefined);
        setShowPendingExpensePlaceholder(false);
        setIsOptimisticTrackingCleared(true);
    };

    // Safety timeout: clear skeleton if the lifecycle hasn't resolved within 10s.
    useEffect(() => {
        if (!showPendingExpensePlaceholder) {
            return;
        }
        const id = setTimeout(() => setShowPendingExpensePlaceholder(false), OPTIMISTIC_TRACKING_TIMEOUT_MS);
        return () => clearTimeout(id);
    }, [showPendingExpensePlaceholder]);

    // Flush on unmount so the API.write() still executes if user navigates away.
    useEffect(
        () => () => {
            if (getPendingSubmitFollowUpAction()?.followUpAction !== CONST.TELEMETRY.SUBMIT_FOLLOW_UP_ACTION.NAVIGATE_TO_SEARCH) {
                flushDeferredWrite(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH);
            }
            if (mutableRef.current.rollbackTimeout) {
                clearTimeout(mutableRef.current.rollbackTimeout);
            }
        },
        [],
    );

    // Unified watch-key effect: resolves the key when missing, then swaps from
    // split-parent to child when applicable. Merging avoids the PERF-9 pattern
    // where one effect's setState triggers another.
    useEffect(() => {
        const tracking = mutableRef.current;

        if (isOptimisticTrackingCleared || !tracking.hasPendingWriteOnMount) {
            return;
        }

        // Step 1: resolve watch key if not yet available.
        if (!optimisticWatchKey) {
            const cleanup = resolveWatchKey(tracking, setOptimisticWatchKey);
            if (!cleanup && !hasDeferredWrite(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH)) {
                clearOptimisticTracking();
            }
            return cleanup;
        }

        // Step 2: if the watched transaction is a split parent, swap to child.
        // The O(n) scan over transactions only runs when the watched tx is
        // confirmed to be a split parent (reportID === SPLIT_REPORT_ID), which
        // is a rare, single-occurrence event per optimistic lifecycle.
        // Guard: only swap once per lifecycle to prevent an infinite rAF loop
        // if the child also temporarily has SPLIT_REPORT_ID during rollback.
        if (tracking.hasSwappedFromParent) {
            return;
        }
        const watchedTx = transactions?.[optimisticWatchKey as `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`];
        if (watchedTx?.reportID !== CONST.REPORT.SPLIT_REPORT_ID) {
            return;
        }

        const parentTransactionID = watchedTx.transactionID;
        const childEntry = Object.entries(transactions ?? {}).find(([, tx]) => tx?.comment?.originalTransactionID === parentTransactionID && tx.reportID !== CONST.REPORT.SPLIT_REPORT_ID);
        if (!childEntry) {
            return;
        }
        const childKey = childEntry[0] as `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`;
        tracking.optimisticWatchKey = childKey;
        tracking.hasSwappedFromParent = true;
        const rafID = requestAnimationFrame(() => setOptimisticWatchKey(childKey));
        return () => cancelAnimationFrame(rafID);
    }, [isOptimisticTrackingCleared, optimisticWatchKey, transactions]);

    // Augment search data with the optimistic transaction (before it appears in server snapshot).
    const searchDataWithTrackedOptimisticTransaction = (() => {
        const searchData = searchResults?.data;
        if (!searchData || !isTransactionSearchType(type) || !optimisticWatchKey || isOptimisticTrackingCleared) {
            return searchData;
        }

        const optimisticTransactionKey = optimisticWatchKey.startsWith(ONYXKEYS.COLLECTION.TRANSACTION)
            ? (optimisticWatchKey as `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`)
            : undefined;
        const optimisticTransaction = optimisticTransactionKey ? transactions?.[optimisticTransactionKey] : undefined;
        if (!optimisticTransactionKey || !optimisticTransaction?.transactionID || searchData[optimisticTransactionKey] || optimisticTransaction.reportID === CONST.REPORT.SPLIT_REPORT_ID) {
            return searchData;
        }

        const nextSearchData = {
            ...searchData,
            [optimisticTransactionKey]: optimisticTransaction,
        } as SearchResults['data'];

        for (const [reportActionsKey, actions] of Object.entries(reportActions ?? {})) {
            if (!actions) {
                continue;
            }

            const hasOptimisticTransactionAction = Object.values(actions).some((action) => {
                if (!isMoneyRequestAction(action)) {
                    return false;
                }
                const originalMessage = getOriginalMessage(action);
                return originalMessage?.IOUTransactionID === optimisticTransaction.transactionID;
            });
            if (!hasOptimisticTransactionAction) {
                continue;
            }

            nextSearchData[reportActionsKey as `${typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS}${string}`] = actions;
        }

        return nextSearchData;
    })();

    // Reconcile transactions created OUTSIDE Search's own optimistic-tracking lifecycle (e.g. an expense
    // added from a workspace chat) that belong to a report already present on this Reports page.
    //
    // The block above only ever patches in ONE transaction: the one Search itself is watching via
    // `optimisticWatchKey`, which is only armed when a deferred-write channel (SEARCH/DISMISS_MODAL) was
    // reserved by a Search-adjacent submission flow (see deferredLayoutWrite.ts). requestMoney's
    // TrackExpense.ts call hardcodes `shouldDeferForSearch: false` and no channel is reserved for a plain
    // "add expense in a workspace chat" action, so `optimisticWatchKey` is never set for that flow and the
    // block above is a no-op for it.
    //
    // Separately, Onyx's snapshot mirroring (react-native-onyx OnyxUtils.updateSnapshots) can only refresh
    // fields on keys that already exist in the cached SNAPSHOT_ entry - it can never insert a brand-new
    // `transactions_<id>` key. That's why the report's own `total`/`totalDisplaySpend` (existing fields on
    // the already-snapshotted `report_<id>`) update correctly, while the report's nested `transactions`
    // array (built at render time purely from what keys are present in `data`) permanently omits the new
    // expense - which is exactly the stale selection count/total from #95627.
    //
    // This reconciles that gap generally: any live transaction whose reportID matches a report already in
    // `data` - regardless of how or where it was created - gets folded in before grouping/selection use it.
    const searchDataWithOptimisticTransaction = useMemo(() => {
        if (!searchDataWithTrackedOptimisticTransaction || type !== CONST.SEARCH.DATA_TYPES.EXPENSE_REPORT || !transactions) {
            return searchDataWithTrackedOptimisticTransaction;
        }

        let result: SearchResults['data'] | undefined;
        for (const [transactionKey, transaction] of Object.entries(transactions)) {
            if (!transaction || searchDataWithTrackedOptimisticTransaction[transactionKey as `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`]) {
                continue;
            }

            const reportKey = `${ONYXKEYS.COLLECTION.REPORT}${transaction.reportID}` as const;
            if (!searchDataWithTrackedOptimisticTransaction[reportKey]) {
                continue;
            }

            result ??= {...searchDataWithTrackedOptimisticTransaction};
            result[transactionKey as `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`] = transaction;
        }

        return result ?? searchDataWithTrackedOptimisticTransaction;
    }, [searchDataWithTrackedOptimisticTransaction, transactions, type]);

    /**
     * Re-arms optimistic tracking for subsequent expense creations while Search
     * stays mounted. Called from useFocusEffect when hasDeferredWrite is detected
     * on re-focus.
     *
     * Safe to call setState here: useFocusEffect only fires while the component
     * is mounted, and React 18+ silently ignores setState on unmounted components.
     */
    const rearmTracking = () => {
        const tracking = mutableRef.current;
        tracking.hasPendingWriteOnMount = true;
        tracking.isCleanedUp = false;
        tracking.hasSwappedFromParent = false;
        tracking.cachedOptimisticItem = null;
        setIsOptimisticTrackingCleared(false);
        setShowPendingExpensePlaceholder(true);
        const latestKey = getOptimisticWatchKey(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH);
        tracking.optimisticWatchKey = latestKey;
        setOptimisticWatchKey(latestKey);
    };

    const trackingState: OptimisticTrackingState = {
        mutableRef,
        optimisticWatchKey,
        isOptimisticTrackingCleared,
        clearOptimisticTracking,
        setShowPendingExpensePlaceholder,
        setOptimisticWatchKey,
    };

    return {
        showPendingExpensePlaceholder,
        shouldDeferHeavySearchWork,
        setShouldDeferHeavySearchWork,
        searchDataWithOptimisticTransaction,
        hasPendingWriteOnMountRef: mutableRef,
        skipDeferralOnFocusRef,
        rearmTracking,
        trackingState,
    };
}

export default useOptimisticSearchTracking;
