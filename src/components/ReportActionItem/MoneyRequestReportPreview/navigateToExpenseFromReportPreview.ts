import type {OnyxEntry} from 'react-native-onyx';
import {createTransactionThreadReport, setOptimisticTransactionThread} from '@libs/actions/Report';
import {setActiveTransactionIDs} from '@libs/actions/TransactionThreadNavigation';
import Navigation from '@libs/Navigation/Navigation';
import setNavigationActionToMicrotaskQueue from '@libs/Navigation/helpers/setNavigationActionToMicrotaskQueue';
import {getIOUActionForReportID} from '@libs/ReportActionsUtils';
import {startSpan} from '@libs/telemetry/activeSpans';
import CONST from '@src/CONST';
import ROUTES from '@src/ROUTES';
import type {Beta, IntroSelected, Report, ReportAction, Transaction} from '@src/types/onyx';

type NavigateToExpenseFromReportPreviewParams = {
    transaction: Transaction;
    iouReport: OnyxEntry<Report>;
    siblingTransactionIDs: string[];
    isSmallScreenWidth: boolean;
    introSelected: OnyxEntry<IntroSelected>;
    currentUserLogin: string;
    currentUserAccountID: number;
    betas: OnyxEntry<Beta[]>;
};

function navigateToExpenseFromReportPreview({
    transaction,
    iouReport,
    siblingTransactionIDs,
    isSmallScreenWidth,
    introSelected,
    currentUserLogin,
    currentUserAccountID,
    betas,
}: NavigateToExpenseFromReportPreviewParams) {
    const iouReportID = iouReport?.reportID;
    if (!iouReportID) {
        return;
    }

    const iouAction = getIOUActionForReportID(transaction.reportID, transaction.transactionID);
    const activeRoute = Navigation.getActiveRoute();
    let transactionThreadReportID = iouAction?.childReportID;

    if (!transactionThreadReportID) {
        const transactionThreadReport = createTransactionThreadReport({
            introSelected,
            currentUserLogin,
            currentUserAccountID,
            betas,
            iouReport,
            iouReportAction: iouAction as ReportAction,
            transaction,
        });
        transactionThreadReportID = transactionThreadReport?.reportID;
    } else {
        setOptimisticTransactionThread(transactionThreadReportID, iouReportID, iouAction?.reportActionID, iouReport?.policyID);
    }

    if (!transactionThreadReportID) {
        return;
    }

    startSpan(`${CONST.TELEMETRY.SPAN_OPEN_REPORT}_${transactionThreadReportID}`, {
        name: 'MoneyRequestReportPreviewExpense',
        op: CONST.TELEMETRY.SPAN_OPEN_REPORT,
    });

    if (isSmallScreenWidth) {
        const reportRoute = ROUTES.REPORT_WITH_ID.getRoute(iouReportID, undefined, undefined, activeRoute);
        Navigation.navigate(reportRoute);
        setNavigationActionToMicrotaskQueue(() => {
            Navigation.navigate(ROUTES.REPORT_WITH_ID.getRoute(transactionThreadReportID, undefined, undefined, reportRoute));
        });
        return;
    }

    setActiveTransactionIDs(siblingTransactionIDs).then(() => {
        Navigation.navigate(ROUTES.REPORT_WITH_ID.getRoute(transactionThreadReportID, undefined, undefined, activeRoute));
    });
}

export default navigateToExpenseFromReportPreview;
