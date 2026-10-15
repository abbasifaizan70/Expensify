import Log from '@libs/Log';
import {navigateAfterOnboardingWithMicrotaskQueue} from '@libs/navigateAfterOnboarding';
import {createDisplayName} from '@libs/PersonalDetailsUtils';
import {isPaidGroupPolicy, isPolicyAdmin} from '@libs/PolicyUtils';

import {createWorkspace, generateDefaultWorkspaceName, generatePolicyID} from '@userActions/Policy/Policy';
import {completeOnboarding} from '@userActions/Report';
import {setOnboardingAdminsChatReportID, setOnboardingPolicyID} from '@userActions/Welcome';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {OnboardingPurpose, Policy} from '@src/types/onyx';

import type {OnyxCollection} from 'react-native-onyx';

import {useCallback, useMemo} from 'react';

import useDelegateAccountID from './useDelegateAccountID';
import useOnboardingWorkspaceCreationState from './useOnboardingWorkspaceCreationState';
import useOnyx from './useOnyx';
import usePermissions from './usePermissions';

/**
 * Hook that provides a function to auto-create a workspace for Track (PERSONAL_SPEND)
 * users during onboarding and complete the onboarding flow.
 *
 * Shared by BaseOnboardingPersonalDetails and BaseOnboardingPurpose.
 */
function useAutoCreateTrackWorkspace() {
    const {
        onboardingPolicyID,
        onboardingAdminsChatReportID,
        introSelected,
        isSelfTourViewed,
        currentUserEmail,
        currentUserAccountID,
        localCurrencyCode,
        activePolicy,
        translate,
        formatPhoneNumber,
        isRestrictedPolicyCreation,
        hasActiveAdminPolicies,
        hasOwnedPaidPolicy,
        onboardingMessages,
        lastWorkspaceNumber,
        shouldUseNarrowLayout,
    } = useOnboardingWorkspaceCreationState();
    const [onboardingPersonalTrackGoal] = useOnyx(ONYXKEYS.ONBOARDING_PERSONAL_TRACK_GOAL);

    const paidGroupPolicySelector = useMemo(
        () => (policies: OnyxCollection<Policy>) => Object.values(policies ?? {}).some((policy) => isPaidGroupPolicy(policy) && isPolicyAdmin(policy, currentUserEmail)),
        [currentUserEmail],
    );
    const [hasPaidGroupAdminPolicy] = useOnyx(ONYXKEYS.COLLECTION.POLICY, {selector: paidGroupPolicySelector});

    const [conciergeChatReportID = ''] = useOnyx(ONYXKEYS.CONCIERGE_REPORT_ID);
    const [conciergeChat] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${conciergeChatReportID}`);
    const [selfDMReportID] = useOnyx(ONYXKEYS.SELF_DM_REPORT_ID);
    const [selfDMReport] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${selfDMReportID}`);
    const [onboardingValues] = useOnyx(ONYXKEYS.NVP_ONBOARDING);
    const [reportNameValuePairs] = useOnyx(ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS);
    const {isBetaEnabled} = usePermissions();
    const delegateAccountID = useDelegateAccountID();

    const mergedAccountConciergeReportID = !onboardingValues?.shouldRedirectToClassicAfterMerge && onboardingValues?.shouldValidate ? conciergeChatReportID : undefined;

    const autoCreateTrackWorkspace = useCallback(
        async (firstName: string, lastName: string, onboardingPurposeSelected: OnboardingPurpose, personalTrackGoalOverride?: string) => {
            const shouldCreateWorkspace = !isRestrictedPolicyCreation && !onboardingPolicyID && !hasPaidGroupAdminPolicy;
            const displayName = createDisplayName(currentUserEmail, {firstName, lastName}, formatPhoneNumber);
            // Callers that set the goal in the same tick must pass it explicitly, because the Onyx value read above is still stale here.
            const personalTrackGoal = personalTrackGoalOverride ?? onboardingPersonalTrackGoal;

            const engagementChoice =
                onboardingPurposeSelected === CONST.ONBOARDING_CHOICES.TRACK_PERSONAL ? CONST.ONBOARDING_CHOICES.TRACK_PERSONAL : CONST.ONBOARDING_CHOICES.TRACK_WORKSPACE;

            const {adminsChatReportID: newAdminsChatReportID, policyID: newPolicyID} = shouldCreateWorkspace
                ? createWorkspace({
                      policyOwner: undefined,
                      makeMeAdmin: true,
                      policyName: generateDefaultWorkspaceName(currentUserEmail, displayName, lastWorkspaceNumber, translate),
                      policyID: generatePolicyID(),
                      engagementChoice,
                      currency: localCurrencyCode,
                      file: undefined,
                      shouldAddOnboardingTasks: false,
                      introSelected,
                      activePolicy,
                      conciergeChat,
                      currentUserAccountIDParam: currentUserAccountID,
                      currentUserEmailParam: currentUserEmail,
                      shouldAddGuideWelcomeMessage: false,
                      onboardingPurposeSelected,
                      isSelfTourViewed,
                      hasActiveAdminPolicies,
                      hasOwnedPaidPolicy,
                      personalTrackGoal: onboardingPurposeSelected === CONST.ONBOARDING_CHOICES.TRACK_PERSONAL && !!personalTrackGoal ? personalTrackGoal : undefined,
                      delegateAccountID,
                  })
                : {adminsChatReportID: onboardingAdminsChatReportID, policyID: onboardingPolicyID};

            // Track users land on Home with the side panel closed (Home's Getting started section onboards them), so the
            // CompleteGuidedSetup response no longer needs to be awaited for its RHP variant.
            try {
                await completeOnboarding({
                    engagementChoice,
                    onboardingMessage: onboardingMessages[engagementChoice],
                    firstName,
                    lastName,
                    adminsChatReportID: newAdminsChatReportID,
                    onboardingPolicyID: newPolicyID,
                    personalTrackGoal: onboardingPurposeSelected === CONST.ONBOARDING_CHOICES.TRACK_PERSONAL && !!personalTrackGoal ? personalTrackGoal : undefined,
                    introSelected,
                    isSelfTourViewed,
                    conciergeChat,
                    selfDMReport,
                    currentUserAccountID,
                    delegateAccountID,
                });
            } catch (error) {
                Log.warn('[useAutoCreateTrackWorkspace] Error completing onboarding', {error});
            } finally {
                setOnboardingAdminsChatReportID();
                setOnboardingPolicyID();

                navigateAfterOnboardingWithMicrotaskQueue(
                    shouldUseNarrowLayout,
                    isBetaEnabled(CONST.BETAS.DEFAULT_ROOMS),
                    conciergeChatReportID,
                    reportNameValuePairs,
                    newPolicyID,
                    mergedAccountConciergeReportID,
                    false,
                );
            }
        },
        [
            currentUserEmail,
            currentUserAccountID,
            lastWorkspaceNumber,
            translate,
            formatPhoneNumber,
            isRestrictedPolicyCreation,
            onboardingPolicyID,
            hasPaidGroupAdminPolicy,
            onboardingAdminsChatReportID,
            onboardingPersonalTrackGoal,
            localCurrencyCode,
            introSelected,
            activePolicy,
            isSelfTourViewed,
            onboardingMessages,
            hasActiveAdminPolicies,
            hasOwnedPaidPolicy,
            shouldUseNarrowLayout,
            isBetaEnabled,
            conciergeChatReportID,
            reportNameValuePairs,
            mergedAccountConciergeReportID,
            conciergeChat,
            selfDMReport,
            delegateAccountID,
        ],
    );

    return autoCreateTrackWorkspace;
}

export default useAutoCreateTrackWorkspace;
