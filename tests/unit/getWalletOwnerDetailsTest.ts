import getWalletOwnerDetails, {hasCompleteAddress, hasCompleteLegalName} from '@pages/EnablePayments/Wallet/utils/getWalletOwnerDetails';

import CONST from '@src/CONST';
import type {PrivatePersonalDetails} from '@src/types/onyx';

const US_PROFILE: PrivatePersonalDetails = {
    legalFirstName: 'Profile',
    legalLastName: 'Owner',
    addresses: [{street: '1 Profile St\nApt 2', city: 'Austin', state: 'TX', zip: '78701', country: CONST.COUNTRY.US, current: true}],
};

const COMPLETE_WALLET_VALUES = {
    legalFirstName: 'Wallet',
    legalLastName: 'Owner',
    addressStreet: '9 Wallet Ave',
    addressCity: 'New York',
    addressState: 'NY',
    addressZipCode: '10001',
};

describe('getWalletOwnerDetails', () => {
    it('prefers the wallet values over the saved profile', () => {
        // Given complete wallet values (what the user typed in the wallet flow) and a different saved profile
        // When we build the owner details
        const details = getWalletOwnerDetails(COMPLETE_WALLET_VALUES, US_PROFILE);

        // Then the wallet values win, because they are what the user just entered for this bank account
        expect(details).toEqual({...COMPLETE_WALLET_VALUES, addressStreet2: ''});
    });

    it('falls back to the saved US profile when the wallet has nothing yet', () => {
        // Given no wallet values and a complete saved US profile
        // When we build the owner details
        const details = getWalletOwnerDetails(undefined, US_PROFILE);

        // Then the profile name and address are used, with the second street line kept, so skipped pages still send the data
        expect(details).toEqual({
            legalFirstName: 'Profile',
            legalLastName: 'Owner',
            addressStreet: '1 Profile St',
            addressStreet2: 'Apt 2',
            addressCity: 'Austin',
            addressState: 'TX',
            addressZipCode: '78701',
        });
    });

    it('takes the name and the address each from one source', () => {
        // Given the wallet has a complete name but only part of an address, and the profile has a complete address
        const walletValues = {legalFirstName: 'Wallet', legalLastName: 'Owner', addressStreet: '9 Wallet Ave'};

        // When we build the owner details
        const details = getWalletOwnerDetails(walletValues, US_PROFILE);

        // Then the name comes from the wallet and the whole address from the profile, never a mix of the two addresses
        expect(details.legalFirstName).toBe('Wallet');
        expect(details.addressStreet).toBe('1 Profile St');
        expect(details.addressCity).toBe('Austin');
    });

    it('ignores a saved address outside the US', () => {
        // Given the only saved address is in the UK
        const profile: PrivatePersonalDetails = {
            ...US_PROFILE,
            addresses: [{street: '1 High St', city: 'London', state: '', zip: 'SW1A 1AA', country: CONST.COUNTRY.GB, current: true}],
        };

        // When we build the owner details
        const details = getWalletOwnerDetails(undefined, profile);

        // Then no address is used, because the wallet is US only and the user must enter a US address
        expect(hasCompleteAddress(details)).toBe(false);
        expect(details.addressStreet).toBe('');
        expect(hasCompleteLegalName(details)).toBe(true);
    });
});

describe('hasCompleteLegalName / hasCompleteAddress', () => {
    it('needs every field', () => {
        // Given a name without a last name and an address without a zip code
        // When we check them
        // Then neither counts as complete, so the page is still shown
        expect(hasCompleteLegalName({legalFirstName: 'A', legalLastName: ' '})).toBe(false);
        expect(hasCompleteAddress({addressStreet: '1 St', addressCity: 'Austin', addressState: 'TX', addressZipCode: ''})).toBe(false);

        // And complete values count as complete, so the page is skipped
        expect(hasCompleteLegalName(COMPLETE_WALLET_VALUES)).toBe(true);
        expect(hasCompleteAddress(COMPLETE_WALLET_VALUES)).toBe(true);
    });
});
