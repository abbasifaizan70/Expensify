import {setInboxTab} from '@libs/actions/User';
import getReportAttributesUpdates from '@libs/getReportAttributesUpdates';
import Log from '@libs/Log';
import SidebarUtils from '@libs/SidebarUtils';
import type {BrickRoad} from '@libs/WorkspacesSettingsUtils';
import {getChatTabBrickRoad} from '@libs/WorkspacesSettingsUtils';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type * as OnyxTypes from '@src/types/onyx';
import arraysEqual from '@src/utils/arraysEqual';

import type {ValueOf} from 'type-fest';

import {authTokenTypeSelector} from '@selectors/Session';
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';

import useCollectionDelta from './useCollectionDelta';
import {useCurrentReportIDState} from './useCurrentReportID';
import useCurrentUserPersonalDetails from './useCurrentUserPersonalDetails';
import useLocalize from './useLocalize';
import useNetwork from './useNetwork';
import useOnyx from './useOnyx';
import usePermissions from './usePermissions';
import usePrevious from './usePrevious';
import useReportAttributes from './useReportAttributes';
import useResponsiveLayout from './useResponsiveLayout';
import useStableArrayReference from './useStableArrayReference';

type SidebarOrderedReportsContextProviderProps = {
    children: React.ReactNode;
    currentReportIDForTests?: string;
};

type SidebarOrderedReportsStateContextValue = {
    /** The report IDs rendered in the LHN for the active Inbox tab (a filtered subset of orderedReportIDs). Keeps its reference while the list is unchanged. */
    filteredReportIDs: string[];
    /** All ordered LHN report IDs, unfiltered by the active Inbox tab. Used for total counts (e.g. focus-mode switch) and brick road. */
    orderedReportIDs: string[];
    currentReportID: string | undefined;
    chatTabBrickRoad: BrickRoad;
    activeTab: ValueOf<typeof CONST.INBOX_TAB>;
    inboxTabCounts: Record<typeof CONST.INBOX_TAB.TODO | typeof CONST.INBOX_TAB.UNREAD, number>;
    /** Whether the Unread tab holds a report whose newest message is older than CONST.INBOX_TAB_STALE_UNREAD_MONTHS. */
    hasStaleUnreadReport: boolean;
};

type SidebarOrderedReportsActionsContextValue = {
    clearLHNCache: () => void;
    setActiveTab: (tab: ValueOf<typeof CONST.INBOX_TAB>) => void;
    setStickyReportID: (reportID: string) => void;
    /** The report IDs listed under the given Inbox tab, read on demand by bulk tab actions (e.g. "Mark all as read"). */
    getReportIDsForTab: (tab: ValueOf<typeof CONST.INBOX_TAB>) => string[];
};

type ReportsToDisplayInLHN = Record<
    string,
    OnyxTypes.Report & {
        hasErrorsOtherThanFailedReceipt?: boolean;
        requiresAttention?: boolean;
        isUnreadReport?: boolean;
    }
>;

const SidebarOrderedReportsStateContext = createContext<SidebarOrderedReportsStateContextValue>({
    filteredReportIDs: [],
    orderedReportIDs: [],
    currentReportID: '',
    chatTabBrickRoad: undefined,
    activeTab: CONST.INBOX_TAB.ALL,
    inboxTabCounts: {
        [CONST.INBOX_TAB.TODO]: 0,
        [CONST.INBOX_TAB.UNREAD]: 0,
    },
    hasStaleUnreadReport: false,
});

/** The Inbox tab's status alone, so tab bars re-render only when it changes, not on every LHN update. */
const SidebarChatTabBrickRoadContext = createContext<BrickRoad>(undefined);

const SidebarOrderedReportsActionsContext = createContext<SidebarOrderedReportsActionsContextValue>({
    clearLHNCache: () => {},
    setActiveTab: () => {},
    setStickyReportID: () => {},
    getReportIDsForTab: () => [],
});

// This file does not compile with React Compiler (render-time ref cache below keeps referential
// stability), so the manual useMemo/useCallback in this provider are load-bearing and must stay.
function SidebarOrderedReportsContextProvider({
    children,
    /**
     * Only required to make unit tests work, since we
     * explicitly pass the currentReportID in LHNTestUtils
     * to SidebarLinksData, so this context doesn't have
     * access to currentReportID in that case.
     *
     * This is a workaround to have currentReportID available in testing environment.
     */
    currentReportIDForTests,
}: SidebarOrderedReportsContextProviderProps) {
    const {localeCompare} = useLocalize();
    const [priorityMode = CONST.PRIORITY_MODE.DEFAULT] = useOnyx(ONYXKEYS.NVP_PRIORITY_MODE);
    const [inboxTab = CONST.INBOX_TAB.ALL] = useOnyx(ONYXKEYS.NVP_INBOX_TAB);
    const activeTab = inboxTab ?? CONST.INBOX_TAB.ALL;
    const [chatReports] = useOnyx(ONYXKEYS.COLLECTION.REPORT);
    const reportUpdates = useCollectionDelta(chatReports);
    const [allPolicies] = useOnyx(ONYXKEYS.COLLECTION.POLICY);
    const policiesUpdates = useCollectionDelta(allPolicies);
    const [transactions] = useOnyx(ONYXKEYS.COLLECTION.TRANSACTION);
    const transactionsUpdates = useCollectionDelta(transactions);
    const [transactionViolations] = useOnyx(ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS);
    const transactionViolationsUpdates = useCollectionDelta(transactionViolations);
    const [reportNameValuePairs] = useOnyx(ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS);
    const reportNameValuePairsUpdates = useCollectionDelta(reportNameValuePairs);
    const [reportsDrafts] = useOnyx(ONYXKEYS.COLLECTION.REPORT_DRAFT_COMMENT);
    const reportsDraftsUpdates = useCollectionDelta(reportsDrafts);
    const {isBetaEnabled} = usePermissions();
    const isDefaultRoomsBetaEnabled = isBetaEnabled(CONST.BETAS.DEFAULT_ROOMS);
    // useOnyx only gives us a new reference when the guide set actually differs, so comparing references
    // below is enough to detect late guide hydration.
    const [guideAccountIDs] = useOnyx(ONYXKEYS.DERIVED.GUIDE_ACCOUNT_IDS);
    const prevGuideAccountIDs = usePrevious(guideAccountIDs);
    const [conciergeReportID] = useOnyx(ONYXKEYS.CONCIERGE_REPORT_ID);
    const [session] = useOnyx(ONYXKEYS.SESSION, {selector: authTokenTypeSelector});
    const reportAttributes = useReportAttributes();
    const prevReportAttributes = usePrevious(reportAttributes);
    const reportAttributesUpdates = useMemo(() => getReportAttributesUpdates(reportAttributes, prevReportAttributes), [reportAttributes, prevReportAttributes]);
    // REPORT_ATTRIBUTES is rewritten with a new object on every recompute, even when nothing changed (see
    // getReportAttributesUpdates). Everything below only needs the attributes' content, so it reads a reference that
    // advances only when that value diff reports a change — otherwise every no-op rewrite would recompute the LHN set,
    // re-sort it and republish the context to every consumer.
    const lhnReportAttributesRef = useRef(reportAttributes);
    const lhnReportAttributes = useMemo(() => {
        if (reportAttributesUpdates === undefined && reportAttributes !== undefined && lhnReportAttributesRef.current !== undefined) {
            return lhnReportAttributesRef.current;
        }
        lhnReportAttributesRef.current = reportAttributes;
        return reportAttributes;
    }, [reportAttributes, reportAttributesUpdates]);
    // The incremental cache the memo below starts from. It is a ref, not state: publishing the memo result into it must
    // not schedule a render, because every provider commit here is a synchronous useOnyx commit whose passive effects
    // React flushes inside the commit — a setState there leaves an update pending after each commit, which is what
    // React's nested-update counter counts (React #185 once 50 commits in a row do it).
    const currentReportsToDisplayRef = useRef<ReportsToDisplayInLHN>({});
    const currentReportsToDisplay = currentReportsToDisplayRef.current;
    const {shouldUseNarrowLayout} = useResponsiveLayout();
    const {isOffline} = useNetwork();
    const {accountID, login: currentUserLogin} = useCurrentUserPersonalDetails();
    const {currentReportID: currentReportIDValue} = useCurrentReportIDState();
    const derivedCurrentReportID = currentReportIDForTests ?? currentReportIDValue;
    const prevDerivedCurrentReportID = usePrevious(derivedCurrentReportID);

    // we need to force reportsToDisplayInLHN to re-compute when we clear currentReportsToDisplay, but the way it currently works relies on not having currentReportsToDisplay as a memo dependency, so we just need something we can change to trigger it
    // I don't like it either, but clearing the cache is only a hack for the debug modal and I will endeavor to make it better as I work to improve the cache correctness of the LHN more broadly
    const [clearCacheDummyCounter, setClearCacheDummyCounter] = useState(0);

    const prevIsDefaultRoomsBetaEnabled = usePrevious(isDefaultRoomsBetaEnabled);
    const prevPriorityMode = usePrevious(priorityMode);
    const prevIsOffline = usePrevious(isOffline);
    const prevConciergeReportID = usePrevious(conciergeReportID);

    /**
     * Find the reports that need to be updated in the LHN
     */
    const getUpdatedReports = useCallback(() => {
        const reportsToUpdate = new Set<string>();

        if (isDefaultRoomsBetaEnabled !== prevIsDefaultRoomsBetaEnabled || priorityMode !== prevPriorityMode || isOffline !== prevIsOffline || conciergeReportID !== prevConciergeReportID) {
            for (const key of Object.keys(chatReports ?? {})) {
                reportsToUpdate.add(key);
            }
        }
        if (reportUpdates) {
            for (const key of Object.keys(reportUpdates ?? {})) {
                reportsToUpdate.add(key);
            }
        }
        if (reportNameValuePairsUpdates) {
            for (const key of Object.keys(reportNameValuePairsUpdates ?? {}).map((reportKey) => reportKey.replace(ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS, ONYXKEYS.COLLECTION.REPORT))) {
                reportsToUpdate.add(key);
            }
        }
        if (reportAttributesUpdates) {
            for (const reportID of reportAttributesUpdates) {
                reportsToUpdate.add(`${ONYXKEYS.COLLECTION.REPORT}${reportID}`);
            }
        }
        if (transactionsUpdates) {
            for (const key of Object.values(transactionsUpdates ?? {}).map((transaction) => `${ONYXKEYS.COLLECTION.REPORT}${transaction?.reportID}`)) {
                reportsToUpdate.add(key);
            }
        }
        if (transactionViolationsUpdates) {
            for (const key of Object.keys(transactionViolationsUpdates ?? {})
                .map((violationKey) => violationKey.replace(ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS, ONYXKEYS.COLLECTION.TRANSACTION))
                .map((transactionKey) => `${ONYXKEYS.COLLECTION.REPORT}${transactions?.[transactionKey]?.reportID}`)) {
                reportsToUpdate.add(key);
            }
        }
        if (reportsDraftsUpdates) {
            for (const key of Object.keys(reportsDraftsUpdates).map((draftKey) => draftKey.replace(ONYXKEYS.COLLECTION.REPORT_DRAFT_COMMENT, ONYXKEYS.COLLECTION.REPORT))) {
                reportsToUpdate.add(key);
            }
        }
        if (policiesUpdates) {
            const updatedPolicies = new Set(Object.keys(policiesUpdates).map((policyKey) => policyKey.replace(ONYXKEYS.COLLECTION.POLICY, '')));
            for (const key of Object.entries(chatReports ?? {})
                .filter(([, value]) => {
                    if (!value?.policyID) {
                        return;
                    }

                    return updatedPolicies.has(value.policyID);
                })
                .map(([reportKey]) => reportKey)) {
                reportsToUpdate.add(key);
            }
        }

        // Make sure the previous and current reports are always included in the updates when we switch reports.
        if (prevDerivedCurrentReportID !== derivedCurrentReportID) {
            reportsToUpdate.add(`${ONYXKEYS.COLLECTION.REPORT}${prevDerivedCurrentReportID}`);
            reportsToUpdate.add(`${ONYXKEYS.COLLECTION.REPORT}${derivedCurrentReportID}`);
        }

        return Array.from(reportsToUpdate);
    }, [
        reportUpdates,
        reportNameValuePairsUpdates,
        reportAttributesUpdates,
        transactionsUpdates,
        transactionViolationsUpdates,
        reportsDraftsUpdates,
        policiesUpdates,
        chatReports,
        transactions,
        isDefaultRoomsBetaEnabled,
        priorityMode,
        prevIsDefaultRoomsBetaEnabled,
        prevPriorityMode,
        isOffline,
        prevIsOffline,
        conciergeReportID,
        prevConciergeReportID,
        prevDerivedCurrentReportID,
        derivedCurrentReportID,
    ]);

    const reportsToDisplayInLHN = useMemo(() => {
        const updatedReports = getUpdatedReports();
        const hasCachedReports = Object.keys(currentReportsToDisplay).length > 0;

        // When a dependency changes but no report-specific keys were updated, getUpdatedReports() returns [].
        // Rather than falling through to a full scan of all reports, recheck only the already-displayed reports.
        let effectiveUpdatedReports = updatedReports.length === 0 && hasCachedReports ? Object.keys(currentReportsToDisplay) : updatedReports;

        // When guide personal details hydrate after the reports collection, guideAccountIDs changes but
        // getUpdatedReports() returns no report keys. Re-evaluate all reports so domain rooms previously
        // filtered out can appear in the LHN.
        if (hasCachedReports && prevGuideAccountIDs !== undefined && guideAccountIDs !== prevGuideAccountIDs) {
            effectiveUpdatedReports = Object.keys(chatReports ?? {});
        }
        const shouldDoIncrementalUpdate = effectiveUpdatedReports.length > 0 && hasCachedReports;
        let reportsToDisplay: ReportsToDisplayInLHN = {};
        if (shouldDoIncrementalUpdate) {
            reportsToDisplay = SidebarUtils.updateReportsToDisplayInLHN({
                displayedReports: currentReportsToDisplay,
                reports: chatReports,
                policies: allPolicies,
                updatedReportsKeys: effectiveUpdatedReports,
                currentReportId: derivedCurrentReportID,
                isInFocusMode: priorityMode === CONST.PRIORITY_MODE.GSD,
                isDefaultRoomsBetaEnabled,
                transactionViolations,
                reportNameValuePairs,
                reportAttributes: lhnReportAttributes,
                draftComments: reportsDrafts,
                transactions,
                isOffline,
                currentUserLogin: currentUserLogin ?? '',
                currentUserAccountID: accountID,
                conciergeReportID,
                guideAccountIDs,
                session,
            });
        } else {
            Log.info('[useSidebarOrderedReports] building reportsToDisplay from scratch');
            reportsToDisplay = SidebarUtils.getReportsToDisplayInLHN({
                currentReportId: derivedCurrentReportID,
                reports: chatReports,
                policies: allPolicies,
                isDefaultRoomsBetaEnabled,
                priorityMode,
                draftComments: reportsDrafts,
                transactionViolations,
                transactions,
                isOffline,
                currentUserLogin: currentUserLogin ?? '',
                currentUserAccountID: accountID,
                reportNameValuePairs,
                reportAttributes: lhnReportAttributes,
                conciergeReportID,
                guideAccountIDs,
                session,
            });
        }

        return reportsToDisplay;
        // Rule disabled intentionally — currentReportsToDisplay is the previous result read from a ref, not an input
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        getUpdatedReports,
        chatReports,
        derivedCurrentReportID,
        priorityMode,
        isDefaultRoomsBetaEnabled,
        transactionViolations,
        reportNameValuePairs,
        lhnReportAttributes,
        reportsDrafts,
        isOffline,
        clearCacheDummyCounter,
        currentUserLogin,
        accountID,
        conciergeReportID,
        guideAccountIDs,
        prevGuideAccountIDs,
        session,
        allPolicies,
    ]);

    // Derive a stable boolean map indicating which reports have drafts.
    const hasDraftByReportIDRef = useRef<Record<string, boolean>>({});
    const hasDraftByReportID = useMemo(() => {
        const result: Record<string, boolean> = {};
        if (reportsDrafts) {
            for (const [key, value] of Object.entries(reportsDrafts)) {
                if (value) {
                    result[key.replace(ONYXKEYS.COLLECTION.REPORT_DRAFT_COMMENT, '')] = true;
                }
            }
        }
        const prev = hasDraftByReportIDRef.current;
        const prevKeys = Object.keys(prev);
        const newKeys = Object.keys(result);
        if (prevKeys.length === newKeys.length && newKeys.every((k) => k in prev)) {
            return prev;
        }
        hasDraftByReportIDRef.current = result;
        return result;
    }, [reportsDrafts]);

    // Commit the cache after render (not inside the memo) so an abandoned render never publishes a speculative map.
    useEffect(() => {
        currentReportsToDisplayRef.current = reportsToDisplayInLHN;
    }, [reportsToDisplayInLHN]);

    const getOrderedReportIDs = useCallback(
        () => SidebarUtils.sortReportsToDisplayInLHN(reportsToDisplayInLHN, priorityMode, localeCompare, hasDraftByReportID, reportNameValuePairs, lhnReportAttributes),
        // Rule disabled intentionally - reports should be sorted only when the reportsToDisplayInLHN changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [reportsToDisplayInLHN, localeCompare, hasDraftByReportID, lhnReportAttributes],
    );

    const orderedReportIDs = useMemo(() => getOrderedReportIDs(), [getOrderedReportIDs]);

    // When a report is opened from the To-do/Unread tab (see setStickyReportID), we remember it so it
    // stays visible after viewing it removes it from the tab (e.g. it gets read). It's only set on a
    // non-All tab, so opening a chat from the All tab never makes it appear under Unread/To-do.
    const [stickyReport, setStickyReport] = useState<{reportID: string; tab: ValueOf<typeof CONST.INBOX_TAB>} | undefined>(undefined);

    // The reports for the active tab, plus the sticky report opened from it (kept visible even after it's read).
    const stickyReportID = stickyReport?.reportID;
    const stickyReportTab = stickyReport?.tab;
    const computedFilteredReportIDs = useMemo(() => {
        const baseFilteredReportIDs = SidebarUtils.filterReportsForInboxTab(orderedReportIDs, reportsToDisplayInLHN, activeTab);
        if (activeTab === CONST.INBOX_TAB.ALL || !stickyReportID || stickyReportTab !== activeTab || baseFilteredReportIDs.includes(stickyReportID)) {
            return baseFilteredReportIDs;
        }
        if (!orderedReportIDs.includes(stickyReportID)) {
            // While opening the report, reading it can briefly drop it from the LHN set entirely (before
            // navigation marks it as the focused report). Keep it at the top so the list doesn't flash empty.
            if (!chatReports?.[`${ONYXKEYS.COLLECTION.REPORT}${stickyReportID}`]) {
                return baseFilteredReportIDs;
            }
            return [stickyReportID, ...baseFilteredReportIDs];
        }
        const baseSet = new Set(baseFilteredReportIDs);
        return orderedReportIDs.filter((reportID) => baseSet.has(reportID) || reportID === stickyReportID);
    }, [orderedReportIDs, reportsToDisplayInLHN, activeTab, stickyReportTab, stickyReportID, chatReports]);
    const filteredReportIDs = useStableArrayReference(computedFilteredReportIDs);

    // Derived from the full "All" set (not the currently filtered view).
    const {counts: inboxTabCounts, hasStaleUnreadReport} = useMemo(() => SidebarUtils.getInboxTabSummary(orderedReportIDs, reportsToDisplayInLHN), [orderedReportIDs, reportsToDisplayInLHN]);

    // Held in a ref so getReportIDsForTab stays referentially stable (keeping the actions context stable) and only
    // filters when a bulk tab action actually asks for a tab's reports, rather than on every LHN update.
    const inboxTabSourcesRef = useRef({orderedReportIDs, reportsToDisplayInLHN});
    useEffect(() => {
        inboxTabSourcesRef.current = {orderedReportIDs, reportsToDisplayInLHN};
    }, [orderedReportIDs, reportsToDisplayInLHN]);
    const getReportIDsForTab = useCallback(
        (tab: ValueOf<typeof CONST.INBOX_TAB>) => SidebarUtils.filterReportsForInboxTab(inboxTabSourcesRef.current.orderedReportIDs, inboxTabSourcesRef.current.reportsToDisplayInLHN, tab),
        [],
    );

    const clearLHNCache = useCallback(() => {
        Log.info('[useSidebarOrderedReports] Clearing sidebar cache manually via debug modal');
        currentReportsToDisplayRef.current = {};
        setClearCacheDummyCounter((current) => current + 1);
    }, []);

    const setActiveTab = useCallback((tab: ValueOf<typeof CONST.INBOX_TAB>) => {
        setInboxTab(tab);

        // The sticky report is scoped to the tab it was opened from, so reset it when switching tabs.
        setStickyReport(undefined);
    }, []);

    // Called when a report is opened from the LHN. On the To-do/Unread tabs we remember it so it stays
    // visible after viewing it removes it from the tab. On the All tab we keep nothing sticky.
    const setStickyReportID = useCallback(
        (reportID: string) => {
            if (activeTab === CONST.INBOX_TAB.ALL) {
                return;
            }
            setStickyReport({reportID, tab: activeTab});
        },
        [activeTab],
    );

    const stateValue: SidebarOrderedReportsStateContextValue = useMemo(() => {
        // We need to make sure the current report is in the list of reports, but we do not want
        // to have to re-generate the list every time the currentReportID changes. To do that
        // we first generate the list as if there was no current report, then we check if
        // the current report is missing from the list, which should very rarely happen. In this
        // case we re-generate the list a 2nd time with the current report included.

        // We also execute the following logic if `shouldUseNarrowLayout` is false because this is
        // requirement for web. Consider a case, where we have report with expenses and we click on
        // any expense, a new LHN item is added in the list and is visible on web. But on mobile, we
        // just navigate to the screen with expense details, so there seems no point to execute this logic on mobile.
        // Only the "All" tab force-regenerates to surface the current report. On the To-do/Unread tabs the
        // sticky-aware filteredReportIDs already keeps the opened report visible, and re-filtering here
        // (without the sticky report) would briefly empty the list while opening it.
        if (
            activeTab === CONST.INBOX_TAB.ALL &&
            (!shouldUseNarrowLayout || filteredReportIDs.length === 0) &&
            derivedCurrentReportID &&
            derivedCurrentReportID !== '-1' &&
            filteredReportIDs.indexOf(derivedCurrentReportID) === -1
        ) {
            const updatedReportIDs = getOrderedReportIDs();
            const updatedFilteredIDs = SidebarUtils.filterReportsForInboxTab(updatedReportIDs, reportsToDisplayInLHN, activeTab);
            return {
                filteredReportIDs: arraysEqual(updatedFilteredIDs, filteredReportIDs) ? filteredReportIDs : updatedFilteredIDs,
                orderedReportIDs: updatedReportIDs,
                currentReportID: derivedCurrentReportID,
                chatTabBrickRoad: getChatTabBrickRoad(updatedReportIDs, lhnReportAttributes),
                activeTab,
                inboxTabCounts,
                hasStaleUnreadReport,
            };
        }

        return {
            filteredReportIDs,
            orderedReportIDs,
            currentReportID: derivedCurrentReportID,
            chatTabBrickRoad: getChatTabBrickRoad(orderedReportIDs, lhnReportAttributes),
            activeTab,
            inboxTabCounts,
            hasStaleUnreadReport,
        };
    }, [
        getOrderedReportIDs,
        orderedReportIDs,
        filteredReportIDs,
        derivedCurrentReportID,
        shouldUseNarrowLayout,
        lhnReportAttributes,
        activeTab,
        inboxTabCounts,
        hasStaleUnreadReport,
        reportsToDisplayInLHN,
    ]);

    const actionsValue: SidebarOrderedReportsActionsContextValue = useMemo(
        () => ({clearLHNCache, setActiveTab, setStickyReportID, getReportIDsForTab}),
        [clearLHNCache, setActiveTab, setStickyReportID, getReportIDsForTab],
    );

    return (
        <SidebarOrderedReportsStateContext.Provider value={stateValue}>
            <SidebarChatTabBrickRoadContext.Provider value={stateValue.chatTabBrickRoad}>
                <SidebarOrderedReportsActionsContext.Provider value={actionsValue}>{children}</SidebarOrderedReportsActionsContext.Provider>
            </SidebarChatTabBrickRoadContext.Provider>
        </SidebarOrderedReportsStateContext.Provider>
    );
}

function useSidebarOrderedReportsState() {
    return useContext(SidebarOrderedReportsStateContext);
}

function useChatTabBrickRoad() {
    return useContext(SidebarChatTabBrickRoadContext);
}

function useSidebarOrderedReportsActions() {
    return useContext(SidebarOrderedReportsActionsContext);
}

function useSidebarOrderedReports() {
    const state = useSidebarOrderedReportsState();
    const actions = useSidebarOrderedReportsActions();
    // Memoize the merged result: OXC's React Compiler bails on this file, so without this the returned
    // object would be a fresh reference every render on web.
    return useMemo(() => ({...state, ...actions}), [state, actions]);
}

export {SidebarOrderedReportsContextProvider, useChatTabBrickRoad, useSidebarOrderedReports, useSidebarOrderedReportsState, useSidebarOrderedReportsActions};
export type {ReportsToDisplayInLHN};
