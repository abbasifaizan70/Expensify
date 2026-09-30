import {getCurrentAddress, getStreetLines} from '@libs/PersonalDetailsUtils';

import CONST from '@src/CONST';
import type {PersonalInfoStepProps} from '@src/types/form/WalletAdditionalDetailsForm';
import type {PrivatePersonalDetails} from '@src/types/onyx';

import type {OnyxEntry} from 'react-native-onyx';

type OwnerDetailsKey = 'legalFirstName' | 'legalLastName' | 'addressStreet' | 'addressCity' | 'addressState' | 'addressZipCode';

/** Owner name and address, in the keys both `addPersonalBankAccount` and the wallet KYC form use */
type WalletOwnerDetails = Record<OwnerDetailsKey, string> & {
    /** Second street line; only a saved profile address can have one, the wallet form has a single street field */
    addressStreet2: string;
};

type WalletOwnerValues = Partial<Record<keyof PersonalInfoStepProps, string | undefined>>;

function hasCompleteLegalName(details: WalletOwnerValues): boolean {
    return !!details.legalFirstName?.trim() && !!details.legalLastName?.trim();
}

function hasCompleteAddress(details: WalletOwnerValues): boolean {
    return !!details.addressStreet?.trim() && !!details.addressCity?.trim() && !!details.addressState?.trim() && !!details.addressZipCode?.trim();
}

function getProfileOwnerDetails(privatePersonalDetails: OnyxEntry<PrivatePersonalDetails>): WalletOwnerDetails {
    const currentAddress = getCurrentAddress(privatePersonalDetails);
    // The wallet is US only, so a saved address in another country can't be used for it
    const usAddress = currentAddress?.country === CONST.COUNTRY.US ? currentAddress : undefined;
    const [street1, street2] = getStreetLines(usAddress?.street);

    return {
        legalFirstName: privatePersonalDetails?.legalFirstName ?? '',
        legalLastName: privatePersonalDetails?.legalLastName ?? '',
        addressStreet: street1 ?? '',
        addressStreet2: street2 ?? usAddress?.street2 ?? usAddress?.addressLine2 ?? '',
        addressCity: usAddress?.city ?? '',
        addressState: usAddress?.state ?? '',
        addressZipCode: usAddress?.zip ?? '',
    };
}

/**
 * Returns the owner's legal name and address for the wallet flow.
 * Values from the wallet (KYC draft or saved wallet details) win. The saved profile fills in whatever the wallet doesn't have yet.
 * The name and the address are each taken as a whole from one source, so we never mix, for example, the street from one source with the city from another.
 */
function getWalletOwnerDetails(walletValues: WalletOwnerValues | undefined, privatePersonalDetails: OnyxEntry<PrivatePersonalDetails>): WalletOwnerDetails {
    const walletDetails: WalletOwnerDetails = {
        legalFirstName: walletValues?.legalFirstName ?? '',
        legalLastName: walletValues?.legalLastName ?? '',
        addressStreet: walletValues?.addressStreet ?? '',
        addressStreet2: '',
        addressCity: walletValues?.addressCity ?? '',
        addressState: walletValues?.addressState ?? '',
        addressZipCode: walletValues?.addressZipCode ?? '',
    };
    const profileDetails = getProfileOwnerDetails(privatePersonalDetails);

    const nameSource = hasCompleteLegalName(walletDetails) || !hasCompleteLegalName(profileDetails) ? walletDetails : profileDetails;
    const addressSource = hasCompleteAddress(walletDetails) || !hasCompleteAddress(profileDetails) ? walletDetails : profileDetails;

    return {
        legalFirstName: nameSource.legalFirstName,
        legalLastName: nameSource.legalLastName,
        addressStreet: addressSource.addressStreet,
        addressStreet2: addressSource.addressStreet2,
        addressCity: addressSource.addressCity,
        addressState: addressSource.addressState,
        addressZipCode: addressSource.addressZipCode,
    };
}

export default getWalletOwnerDetails;
export {hasCompleteAddress, hasCompleteLegalName};
export type {WalletOwnerDetails};
