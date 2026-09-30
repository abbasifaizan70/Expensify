import FullScreenLoadingIndicator from '@components/FullscreenLoadingIndicator';
import HeaderWithBackButton from '@components/HeaderWithBackButton';
import InteractiveStepSubHeader from '@components/InteractiveStepSubHeader';
import {KYCWallContext} from '@components/KYCWall/KYCWallContext';
import ScreenWrapper from '@components/ScreenWrapper';

import useLocalize from '@hooks/useLocalize';
import useOnyx from '@hooks/useOnyx';
import useSubPage from '@hooks/useSubPage';
import type {SubPageProps} from '@hooks/useSubPage/types';
import useThemeStyles from '@hooks/useThemeStyles';

import {addPersonalBankAccount, clearPersonalBankAccount} from '@libs/actions/BankAccounts';
import {setDraftValues} from '@libs/actions/FormActions';
import {continueSetup} from '@libs/actions/PaymentMethods';
import {updateCurrentStep} from '@libs/actions/Wallet';

import Navigation from '@navigation/Navigation';

import Address from '@pages/EnablePayments/Wallet/PersonalInfo/substeps/AddressStep';
import LegalName from '@pages/EnablePayments/Wallet/PersonalInfo/substeps/LegalNameStep';
import getSubstepValues from '@pages/EnablePayments/Wallet/utils/getSubstepValues';
import getWalletOwnerDetails, {hasCompleteAddress, hasCompleteLegalName} from '@pages/EnablePayments/Wallet/utils/getWalletOwnerDetails';
import useIsBankAccountAdded from '@pages/EnablePayments/Wallet/utils/useIsBankAccountAdded';

import CONST from '@src/CONST';
import type {EnablePaymentsSubPageType} from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import INPUT_IDS from '@src/types/form/WalletAdditionalDetailsForm';

import React, {useCallback, useContext} from 'react';
import {View} from 'react-native';

import SetupMethod from './SetupMethod';
import Confirmation from './substeps/ConfirmationStep';
import Plaid from './substeps/PlaidStep';

const ADD_BANK_ACCOUNT_SUB_PAGES = CONST.ENABLE_PAYMENTS.ADD_BANK_ACCOUNT_STEP.SUB_PAGE_NAMES;
const PERSONAL_INFO_STEP_KEYS = INPUT_IDS.PERSONAL_INFO_STEP;

// Legal name and address are collected before the bank account is created, so an account is never left without them.
// These are the wallet KYC pages themselves: US only (state picker, no country picker), and they save into the form KYC reads.
const plaidPages = [
    {pageName: ADD_BANK_ACCOUNT_SUB_PAGES.PLAID, component: Plaid},
    {pageName: ADD_BANK_ACCOUNT_SUB_PAGES.LEGAL_NAME, component: LegalName},
    {pageName: ADD_BANK_ACCOUNT_SUB_PAGES.ADDRESS, component: Address},
    {pageName: ADD_BANK_ACCOUNT_SUB_PAGES.CONFIRMATION, component: Confirmation},
];

const confirmationPageIndex = plaidPages.findIndex((page) => page.pageName === ADD_BANK_ACCOUNT_SUB_PAGES.CONFIRMATION);

function AddBankAccount() {
    const [plaidData] = useOnyx(ONYXKEYS.PLAID_DATA);
    const [personalBankAccount] = useOnyx(ONYXKEYS.PERSONAL_BANK_ACCOUNT);
    const [personalBankAccountDraft] = useOnyx(ONYXKEYS.FORMS.PERSONAL_BANK_ACCOUNT_FORM_DRAFT);
    const [personalPolicyID] = useOnyx(ONYXKEYS.PERSONAL_POLICY_ID);
    const [privatePersonalDetails] = useOnyx(ONYXKEYS.PRIVATE_PERSONAL_DETAILS);
    const [walletAdditionalDetails] = useOnyx(ONYXKEYS.WALLET_ADDITIONAL_DETAILS);
    const [walletAdditionalDetailsDraft] = useOnyx(ONYXKEYS.FORMS.WALLET_ADDITIONAL_DETAILS_DRAFT);
    const {translate} = useLocalize();
    const styles = useThemeStyles();
    const kycWallRef = useContext(KYCWallContext);

    const {isBankAccountAdded: isBankAccountAlreadyAdded} = useIsBankAccountAdded();

    const submit = useCallback(() => {
        // Re-submitting an already added bank account fails with a "bank account already exists" error, so skip the
        // API call and advance the wallet step instead; the URL correction in EnablePaymentsPage navigates forward.
        if (isBankAccountAlreadyAdded) {
            updateCurrentStep(CONST.WALLET.STEP.ADDITIONAL_DETAILS);
            return;
        }

        const bankAccounts = plaidData?.bankAccounts ?? [];
        const selectedPlaidBankAccount = bankAccounts.find((bankAccount) => bankAccount.plaidAccountID === personalBankAccountDraft?.plaidAccountID);

        if (selectedPlaidBankAccount) {
            const bankAccountWithToken = selectedPlaidBankAccount.plaidAccessToken
                ? selectedPlaidBankAccount
                : {
                      ...selectedPlaidBankAccount,
                      plaidAccessToken: plaidData?.plaidAccessToken ?? '',
                  };
            const ownerDetails = getWalletOwnerDetails(getSubstepValues(PERSONAL_INFO_STEP_KEYS, walletAdditionalDetailsDraft, walletAdditionalDetails), privatePersonalDetails);

            // Hand the same name and address to the KYC step, so it doesn't ask for them again
            setDraftValues(ONYXKEYS.FORMS.WALLET_ADDITIONAL_DETAILS, {
                [PERSONAL_INFO_STEP_KEYS.FIRST_NAME]: ownerDetails.legalFirstName,
                [PERSONAL_INFO_STEP_KEYS.LAST_NAME]: ownerDetails.legalLastName,
                [PERSONAL_INFO_STEP_KEYS.STREET]: ownerDetails.addressStreet,
                [PERSONAL_INFO_STEP_KEYS.CITY]: ownerDetails.addressCity,
                [PERSONAL_INFO_STEP_KEYS.STATE]: ownerDetails.addressState,
                [PERSONAL_INFO_STEP_KEYS.ZIP_CODE]: ownerDetails.addressZipCode,
            });
            addPersonalBankAccount({...bankAccountWithToken, ...ownerDetails, country: CONST.COUNTRY.US}, personalPolicyID);
        }
    }, [
        isBankAccountAlreadyAdded,
        personalBankAccountDraft?.plaidAccountID,
        plaidData?.bankAccounts,
        plaidData?.plaidAccessToken,
        personalPolicyID,
        walletAdditionalDetailsDraft,
        walletAdditionalDetails,
        privatePersonalDetails,
    ]);

    // Skip based on saved data only, not the draft, so a page isn't skipped while the user is still typing on it
    const savedOwnerDetails = getWalletOwnerDetails(getSubstepValues(PERSONAL_INFO_STEP_KEYS, undefined, walletAdditionalDetails), privatePersonalDetails);
    const skipPages: EnablePaymentsSubPageType[] = [];
    if (hasCompleteLegalName(savedOwnerDetails)) {
        skipPages.push(ADD_BANK_ACCOUNT_SUB_PAGES.LEGAL_NAME);
    }
    if (hasCompleteAddress(savedOwnerDetails)) {
        skipPages.push(ADD_BANK_ACCOUNT_SUB_PAGES.ADDRESS);
    }

    const isSetupTypeChosen = personalBankAccountDraft?.setupType === CONST.BANK_ACCOUNT.SETUP_TYPE.PLAID;

    const {CurrentPage, isEditing, pageIndex, nextPage, prevPage, moveTo, isRedirecting} = useSubPage<SubPageProps, EnablePaymentsSubPageType>({
        pages: plaidPages,
        skipPages,
        // Once the bank account is added there is nothing to redo on the Plaid sub-page, so a revisit shows only the confirmation.
        startFrom: isBankAccountAlreadyAdded ? confirmationPageIndex : 0,
        onFinished: submit,
        buildRoute: (pageName, action) =>
            ROUTES.SETTINGS_ENABLE_PAYMENTS.getRoute({
                page: CONST.ENABLE_PAYMENTS.PAGE_NAMES.ADD_BANK_ACCOUNT,
                subPage: pageName,
                action,
            }),
    });

    const exitFlow = (shouldContinue = false) => {
        const onSuccessFallbackRoute = personalBankAccount?.onSuccessFallbackRoute ?? '';

        if (shouldContinue && onSuccessFallbackRoute) {
            continueSetup(kycWallRef, onSuccessFallbackRoute);
            return;
        }
        Navigation.goBack(ROUTES.SETTINGS_WALLET);
    };

    const handleBackButtonPress = () => {
        // The bank account is already added, so the confirmation is the only visible sub-page of this step — back exits the flow.
        if (isBankAccountAlreadyAdded) {
            Navigation.goBack(ROUTES.SETTINGS_WALLET);
            return;
        }

        // Editing a page from the confirmation goes back to the confirmation
        if (isEditing) {
            moveTo(confirmationPageIndex, false);
            return;
        }

        if (!isSetupTypeChosen) {
            exitFlow();
            return;
        }

        if (pageIndex === 0) {
            // Clearing the draft clears setupType, which switches this page back to the setup method view.
            clearPersonalBankAccount();
            return;
        }
        prevPage();
    };

    if ((isSetupTypeChosen || isBankAccountAlreadyAdded) && isRedirecting) {
        return <FullScreenLoadingIndicator />;
    }

    return (
        <ScreenWrapper
            testID="AddBankAccount"
            includeSafeAreaPaddingBottom={false}
            shouldEnablePickerAvoiding={false}
            shouldShowOfflineIndicator
            shouldShowOfflineIndicatorInWideScreen
        >
            <HeaderWithBackButton
                shouldShowBackButton
                onBackButtonPress={handleBackButtonPress}
                title={translate('bankAccount.addBankAccount')}
            />
            <View style={styles.flex1}>
                {isSetupTypeChosen || isBankAccountAlreadyAdded ? (
                    <>
                        <View style={[styles.ph5, styles.mb5, styles.mt3, {height: CONST.BANK_ACCOUNT.STEPS_HEADER_HEIGHT}]}>
                            <InteractiveStepSubHeader
                                startStepIndex={0}
                                stepNames={CONST.WALLET.STEP_NAMES}
                                currentStepAccessibilityDescription={translate('bankAccount.addBankAccount')}
                            />
                        </View>
                        <CurrentPage
                            isEditing={isEditing}
                            onNext={nextPage}
                            onMove={moveTo}
                        />
                    </>
                ) : (
                    <SetupMethod />
                )}
            </View>
        </ScreenWrapper>
    );
}

export default AddBankAccount;
