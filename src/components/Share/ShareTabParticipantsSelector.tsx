import useCurrentUserPersonalDetails from '@hooks/useCurrentUserPersonalDetails';
import useDefaultExpensePolicy from '@hooks/useDefaultExpensePolicy';
import useOnyx from '@hooks/useOnyx';

import {clearMoneyRequest} from '@libs/actions/IOU/MoneyRequest';
import {saveUnknownUserDetails} from '@libs/actions/Share';
import Navigation from '@libs/Navigation/Navigation';
import {getPolicyExpenseChat} from '@libs/ReportUtils';
import {shouldRestrictUserBillableActions} from '@libs/SubscriptionUtils';
import {cancelSpan, getSpan, startSpan} from '@libs/telemetry/activeSpans';

import MoneyRequestParticipantsSelector from '@pages/iou/request/MoneyRequestParticipantsSelector';

import {getOptimisticChatReport, saveReportDraft} from '@userActions/Report';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import {validTransactionDraftIDsSelector} from '@src/selectors/TransactionDraft';

import React, {useEffect, useRef, useState} from 'react';

type ShareTabParticipantsSelectorProps = {
    detailsPageRouteObject: typeof ROUTES.SHARE_SUBMIT_DETAILS | typeof ROUTES.SHARE_DETAILS;
};

function ShareTabParticipantsSelectorComponent({detailsPageRouteObject}: ShareTabParticipantsSelectorProps) {
    const {accountID: currentUserAccountID} = useCurrentUserPersonalDetails();
    const [draftTransactionIDs] = useOnyx(ONYXKEYS.COLLECTION.TRANSACTION_DRAFT, {selector: validTransactionDraftIDsSelector});
    const [selectedReportID, setSelectedReportID] = useState<string | number | undefined>();

    const isSubmitFlow = detailsPageRouteObject === ROUTES.SHARE_SUBMIT_DETAILS;

    const defaultExpensePolicy = useDefaultExpensePolicy();
    const [amountOwed] = useOnyx(ONYXKEYS.NVP_PRIVATE_AMOUNT_OWED);
    const [userBillingGracePeriodEnds] = useOnyx(ONYXKEYS.COLLECTION.SHARED_NVP_PRIVATE_USER_BILLING_GRACE_PERIOD_END);
    const [ownerBillingGracePeriodEnd] = useOnyx(ONYXKEYS.NVP_PRIVATE_OWNER_BILLING_GRACE_PERIOD_END);

    // Mirrors the in-product Create-expense flow (see NavigateGlobalCreateContext + shouldUseDefaultExpensePolicy):
    // auto-select the user's default group workspace, which useDefaultExpensePolicy resolves in the same priority order
    // the mainline flow uses - the domain-restricted preferred policy first, then the active policy, then the user's
    // only group workspace. Billing-restricted users are excluded so we never route them into a workspace they can no
    // longer submit to.
    const canAutoSelectDefaultPolicy =
        !!defaultExpensePolicy && !shouldRestrictUserBillableActions(defaultExpensePolicy, ownerBillingGracePeriodEnd, userBillingGracePeriodEnds, amountOwed, currentUserAccountID);

    // Skip the participant picker and go straight to confirmation for the default workspace's expense chat, matching the
    // in-product submit flow. Falls back to the picker if that policy's expense chat isn't in Onyx yet, so we never
    // navigate to an empty report.
    const lockedExpenseChatReportID = isSubmitFlow && canAutoSelectDefaultPolicy ? getPolicyExpenseChat(currentUserAccountID, defaultExpensePolicy?.id)?.reportID : undefined;

    // Synchronous one-shot guard for the auto-navigation effect. A ref (rather than the render state below) is used so
    // the guard flips immediately: clearing the draft transaction mutates draftTransactionIDs, which re-runs the effect
    // before a state update could commit, so a state-based guard would navigate twice.
    const hasAutoNavigatedRef = useRef(false);

    // Drives rendering: once the one-shot auto-navigation has run, we stop returning null and render the picker
    // underneath instead, so backing out of the details page lands on a usable screen rather than a blank Submit tab.
    const [hasAutoNavigatedToLockedReport, setHasAutoNavigatedToLockedReport] = useState(false);

    // This span belongs to the submit flow, so the share flow instance must not cancel a span it never started. For the submit flow this cancels an attempt that closes before SubmitDetailsPage mounts to end the span, so it is
    useEffect(
        () => () => {
            if (!isSubmitFlow) {
                return;
            }
            cancelSpan(CONST.TELEMETRY.SPAN_SHARE_EXTENSION_OPEN_SUBMIT_FLOW);
        },
        [isSubmitFlow],
    );

    // One-shot: auto-navigate the user straight to the default workspace's confirmation the first time the
    // auto-selected report resolves. The hasAutoNavigatedRef guard keeps this from re-running (and re-navigating) if
    // draftTransactionIDs later changes, while still keeping every captured value in the dependency array so we clear
    // the up-to-date drafts at navigation time and no dependency lint has to be suppressed.
    useEffect(() => {
        if (!lockedExpenseChatReportID || hasAutoNavigatedRef.current) {
            return;
        }
        hasAutoNavigatedRef.current = true;

        // clear the existing draft transaction from the previous flow to prevent the old data from being displayed
        clearMoneyRequest(CONST.IOU.OPTIMISTIC_TRANSACTION_ID, draftTransactionIDs);

        startSpan(CONST.TELEMETRY.SPAN_SHARE_EXTENSION_OPEN_SUBMIT_FLOW, {
            name: CONST.TELEMETRY.SPAN_SHARE_EXTENSION_OPEN_SUBMIT_FLOW,
            op: CONST.TELEMETRY.SPAN_SHARE_EXTENSION_OPEN_SUBMIT_FLOW,
            forceTransaction: true,
            attributes: {
                [CONST.TELEMETRY.ATTRIBUTE_REPORT_ID]: lockedExpenseChatReportID.toString(),
                [CONST.TELEMETRY.ATTRIBUTE_ROUTE_FROM]: Navigation.getActiveRoute() || 'unknown',
            },
        });

        // Flip the render state once the transition to the details page completes so the picker mounts underneath it,
        // giving the user a usable screen when they back out. Doing this in the afterTransition callback (rather than
        // calling setState synchronously in the effect body) avoids the react-hooks/set-state-in-effect violation.
        Navigation.navigate(detailsPageRouteObject.getRoute(lockedExpenseChatReportID.toString()), {
            afterTransition: () => setHasAutoNavigatedToLockedReport(true),
        });
    }, [lockedExpenseChatReportID, draftTransactionIDs, detailsPageRouteObject]);

    // Render null only until the auto-navigation has run, to avoid flashing the full picker while we route the
    // user to the auto-selected workspace. Afterwards we fall through to the picker so that backing out of the
    // details page shows a usable screen (still limited to the locked workspace by the option-list filter for
    // domain-restricted users) instead of a blank tab.
    if (lockedExpenseChatReportID && !hasAutoNavigatedToLockedReport) {
        return null;
    }

    return (
        <MoneyRequestParticipantsSelector
            iouType={CONST.IOU.TYPE.SUBMIT}
            initiallySelectedReportID={typeof selectedReportID === 'string' ? selectedReportID : undefined}
            onParticipantsAdded={(value) => {
                // clear the existing draft transaction from the previous flow to prevent the old data from being displayed
                clearMoneyRequest(CONST.IOU.OPTIMISTIC_TRANSACTION_ID, draftTransactionIDs);

                const participant = value.at(0);
                let reportID = participant?.reportID ?? CONST.DEFAULT_NUMBER_ID;
                const accountID = participant?.accountID;

                if (isSubmitFlow) {
                    startSpan(CONST.TELEMETRY.SPAN_SHARE_EXTENSION_OPEN_SUBMIT_FLOW, {
                        name: CONST.TELEMETRY.SPAN_SHARE_EXTENSION_OPEN_SUBMIT_FLOW,
                        op: CONST.TELEMETRY.SPAN_SHARE_EXTENSION_OPEN_SUBMIT_FLOW,
                        forceTransaction: true,
                        attributes: {
                            [CONST.TELEMETRY.ATTRIBUTE_REPORT_ID]: reportID.toString(),
                            [CONST.TELEMETRY.ATTRIBUTE_ROUTE_FROM]: Navigation.getActiveRoute() || 'unknown',
                        },
                    });
                }

                if (accountID && !reportID) {
                    saveUnknownUserDetails(participant);
                    const optimisticReport = getOptimisticChatReport(accountID, currentUserAccountID);
                    reportID = optimisticReport.reportID;

                    if (isSubmitFlow) {
                        getSpan(CONST.TELEMETRY.SPAN_SHARE_EXTENSION_OPEN_SUBMIT_FLOW)?.setAttribute(CONST.TELEMETRY.ATTRIBUTE_REPORT_ID, reportID.toString());
                    }

                    setSelectedReportID(reportID);
                    saveReportDraft(reportID, optimisticReport).then(() => {
                        Navigation.navigate(detailsPageRouteObject.getRoute(reportID.toString()));
                    });
                } else {
                    setSelectedReportID(reportID);
                    Navigation.navigate(detailsPageRouteObject.getRoute(reportID.toString()));
                }
            }}
            action="create"
        />
    );
}

export default ShareTabParticipantsSelectorComponent;
