import {getAccountHolderFieldsMap, getFieldsMap, getInitialPersonalDetailsValues, getInitialSubstep, testValidation} from '@pages/settings/Wallet/InternationalDepositAccount/utils';

import CONST from '@src/CONST';
import type {InternationalBankAccountForm} from '@src/types/form';
import type {CorpayFields, CorpayFormField, PrivatePersonalDetails} from '@src/types/onyx';
import type {CorpayFieldsMap} from '@src/types/onyx/CorpayFields';

function buildField(id: string, isRequired: boolean): CorpayFormField {
    return {
        id,
        label: id,
        isRequired,
        isRequiredInValueSet: false,
        errorMessage: '',
        regEx: '',
        validationRules: [],
    };
}

/** A Corpay response where the address fields are marked optional (the shape that lets an address-less account through) */
function buildCorpayFields(formFields: CorpayFormField[]): CorpayFields {
    return {
        bankCountry: 'GB',
        bankCurrency: 'GBP',
        classification: 'Individual',
        destinationCountry: 'GB',
        paymentMethods: [],
        preferredMethod: '',
        formFields,
        isLoading: false,
        isSuccess: true,
    };
}

const optionalAddressFields: CorpayFormField[] = [
    buildField('accountHolderName', true),
    buildField('accountHolderAddress1', false),
    buildField('accountHolderAddress2', false),
    buildField('accountHolderCity', false),
    buildField('accountHolderPostal', false),
    buildField('accountHolderCountry', false),
    buildField('accountHolderPhoneNumber', false),
    buildField('accountNumber', true),
];

const privatePersonalDetailsWithoutAddress: PrivatePersonalDetails = {
    legalFirstName: 'Jane',
    legalLastName: 'Doe',
    addresses: [],
};

const privatePersonalDetailsWithAddress: PrivatePersonalDetails = {
    legalFirstName: 'Jane',
    legalLastName: 'Doe',
    addresses: [{street: '1 Main St', city: 'London', state: '', zip: 'SW1A 1AA', country: 'GB', current: true}],
};

describe('InternationalDepositAccount utils', () => {
    describe('getAccountHolderFieldsMap', () => {
        it('forces the address fields to be required and leaves other fields untouched', () => {
            const raw: CorpayFieldsMap = {
                accountHolderName: buildField('accountHolderName', false),
                accountHolderAddress1: buildField('accountHolderAddress1', false),
                accountHolderCity: buildField('accountHolderCity', false),
                accountHolderRegion: buildField('accountHolderRegion', false),
                accountHolderPostal: buildField('accountHolderPostal', false),
                accountHolderCountry: buildField('accountHolderCountry', false),
                accountHolderPhoneNumber: buildField('accountHolderPhoneNumber', false),
            };

            const result = getAccountHolderFieldsMap(raw);

            for (const key of CONST.CORPAY_FIELDS.REQUIRED_ACCOUNT_HOLDER_ADDRESS_KEYS) {
                expect(result[key].isRequired).toBe(true);
            }
            expect(result.accountHolderName.isRequired).toBe(false);
            expect(result.accountHolderPhoneNumber.isRequired).toBe(false);
        });

        it('keeps the second address line optional', () => {
            const result = getAccountHolderFieldsMap({accountHolderAddress2: buildField('accountHolderAddress2', false)});
            expect(result.accountHolderAddress2.isRequired).toBe(false);
        });

        it('does not fabricate fields Corpay did not return and does not mutate the source map', () => {
            const raw: CorpayFieldsMap = {accountHolderName: buildField('accountHolderName', true), accountHolderAddress1: buildField('accountHolderAddress1', false)};
            const result = getAccountHolderFieldsMap(raw);

            expect(Object.keys(result)).toEqual(['accountHolderName', 'accountHolderAddress1']);
            expect(raw.accountHolderAddress1.isRequired).toBe(false);
            expect(getAccountHolderFieldsMap(undefined)).toEqual({});
        });
    });

    describe('getFieldsMap', () => {
        it('applies the address requirement to the account holder page while leaving the other pages as Corpay returned them', () => {
            const fieldsMap = getFieldsMap(buildCorpayFields(optionalAddressFields));
            const accountHolderFields = fieldsMap[CONST.CORPAY_FIELDS.PAGE_NAME.ACCOUNT_HOLDER_DETAILS];

            expect(accountHolderFields.accountHolderAddress1.isRequired).toBe(true);
            expect(accountHolderFields.accountHolderCity.isRequired).toBe(true);
            expect(accountHolderFields.accountHolderPostal.isRequired).toBe(true);
            expect(accountHolderFields.accountHolderCountry.isRequired).toBe(true);
            expect(accountHolderFields.accountHolderAddress2.isRequired).toBe(false);
            expect(accountHolderFields.accountHolderPhoneNumber.isRequired).toBe(false);
            expect(fieldsMap[CONST.CORPAY_FIELDS.PAGE_NAME.ACCOUNT_DETAILS].accountNumber.isRequired).toBe(true);
        });
    });

    describe('account holder step skip decision', () => {
        it('does not skip the step for a user without an address even though Corpay marked the address optional', () => {
            const fieldsMap = getFieldsMap(buildCorpayFields(optionalAddressFields));
            const values = getInitialPersonalDetailsValues(privatePersonalDetailsWithoutAddress);

            expect(testValidation(values, fieldsMap[CONST.CORPAY_FIELDS.PAGE_NAME.ACCOUNT_HOLDER_DETAILS])).toBe(false);
        });

        it('still skips the step for a user whose profile already holds a complete address', () => {
            const fieldsMap = getFieldsMap(buildCorpayFields(optionalAddressFields));
            const values = getInitialPersonalDetailsValues(privatePersonalDetailsWithAddress);

            expect(testValidation(values, fieldsMap[CONST.CORPAY_FIELDS.PAGE_NAME.ACCOUNT_HOLDER_DETAILS])).toBe(true);
        });

        it('lands a resumed flow on the account holder step instead of confirmation when the address is missing', () => {
            const fieldsMap = getFieldsMap(buildCorpayFields(optionalAddressFields));
            const values = {
                ...getInitialPersonalDetailsValues(privatePersonalDetailsWithoutAddress),
                bankCountry: 'GB',
                bankCurrency: 'GBP',
                accountNumber: '55555555',
            } as InternationalBankAccountForm;

            expect(getInitialSubstep(values, fieldsMap)).toBe(CONST.CORPAY_FIELDS.INDEXES.MAPPING.ACCOUNT_HOLDER_INFORMATION);
        });
    });
});
