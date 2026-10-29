import {render} from '@testing-library/react-native';

import BankInfo from '@pages/ReimbursementAccount/NonUSD/BankInfo/BankInfo';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {CorpayFields} from '@src/types/onyx';

import React from 'react';

const POLICY_ID = 'policy-1';

const mockGetCorpayBankAccountFields = jest.fn();
const mockOnReconnect: {current: (() => void) | undefined} = {current: undefined};
const mockOnyxValues: {current: Record<string, unknown>} = {current: {}};

jest.mock('@hooks/useOnyx', () => jest.fn((key: string) => [mockOnyxValues.current[key]]));
jest.mock('@hooks/useLocalize', () => jest.fn(() => ({translate: (key: string) => key})));
jest.mock('@hooks/useNetwork', () =>
    jest.fn((options?: {onReconnect?: () => void}) => {
        mockOnReconnect.current = options?.onReconnect;
        return {isOffline: false};
    }),
);
jest.mock('@hooks/useSubPage', () =>
    jest.fn(() => ({
        CurrentPage: () => null,
        isEditing: false,
        currentPageName: 'confirmation',
        pageIndex: 2,
        nextPage: jest.fn(),
        prevPage: jest.fn(),
        moveTo: jest.fn(),
        isRedirecting: false,
    })),
);
jest.mock('@userActions/BankAccounts', () => ({
    getCorpayBankAccountFields: (...args: unknown[]) => mockGetCorpayBankAccountFields(...args),
    createCorpayBankAccount: jest.fn(),
    clearReimbursementAccountBankCreation: jest.fn(),
}));
jest.mock('@userActions/FormActions', () => ({clearErrors: jest.fn()}));
jest.mock('@libs/Navigation/Navigation', () => ({navigate: jest.fn(), goBack: jest.fn()}));
jest.mock('@pages/ErrorPage/NotFoundPage', () => {
    const MockReact = require('react') as typeof React;
    const {Text: MockText} = require('react-native') as typeof import('react-native');
    return () => MockReact.createElement(MockText, {testID: 'not-found'});
});
jest.mock('@components/FullscreenLoadingIndicator', () => {
    const MockReact = require('react') as typeof React;
    const {Text: MockText} = require('react-native') as typeof import('react-native');
    return () => MockReact.createElement(MockText, {testID: 'loading'});
});
jest.mock('@components/InteractiveStepWrapper', () => {
    const MockReact = require('react') as typeof React;
    const {Text: MockText} = require('react-native') as typeof import('react-native');
    return ({children}: {children: React.ReactNode}) => MockReact.createElement(MockText, {testID: 'bank-info-step'}, children);
});

function buildCorpayFields(overrides: Partial<CorpayFields>): Partial<CorpayFields> {
    return {
        bankCountry: 'GB',
        bankCurrency: 'GBP',
        formFields: [{id: 'accountNumber', label: 'Account number', isRequired: true, isRequiredInValueSet: false, errorMessage: '', regEx: '', validationRules: []}],
        isLoading: false,
        isSuccess: true,
        ...overrides,
    };
}

function renderBankInfo(corpayFields: Partial<CorpayFields> | undefined, country = 'GB', currency = 'GBP') {
    mockOnyxValues.current = {
        [ONYXKEYS.REIMBURSEMENT_ACCOUNT]: {achData: {country}},
        [ONYXKEYS.FORMS.REIMBURSEMENT_ACCOUNT_FORM_DRAFT]: {country},
        [ONYXKEYS.CORPAY_FIELDS]: corpayFields,
        [`${ONYXKEYS.COLLECTION.POLICY}${POLICY_ID}`]: {outputCurrency: currency},
    };

    return render(
        <BankInfo
            onSubmit={jest.fn()}
            onBackButtonPress={jest.fn()}
            policyID={POLICY_ID}
        />,
    );
}

describe('NonUSD BankInfo', () => {
    beforeEach(() => {
        mockGetCorpayBankAccountFields.mockClear();
        mockOnReconnect.current = undefined;
    });

    it('does not refetch the Corpay fields on reconnect when the loaded fields already match the country and currency', () => {
        renderBankInfo(buildCorpayFields({}));
        mockGetCorpayBankAccountFields.mockClear();

        mockOnReconnect.current?.();

        expect(mockGetCorpayBankAccountFields).not.toHaveBeenCalled();
    });

    it('refetches the Corpay fields on reconnect when the loaded fields are for another currency', () => {
        renderBankInfo(buildCorpayFields({bankCurrency: 'PLN', bankCountry: 'PL'}));
        mockGetCorpayBankAccountFields.mockClear();

        mockOnReconnect.current?.();

        expect(mockGetCorpayBankAccountFields).toHaveBeenCalledWith('GB', 'GBP');
    });

    it('refetches the Corpay fields on reconnect when the EUR country does not match the loaded one', () => {
        renderBankInfo(buildCorpayFields({bankCurrency: CONST.CURRENCY.EUR, bankCountry: 'FR'}), 'DE', CONST.CURRENCY.EUR);
        mockGetCorpayBankAccountFields.mockClear();

        mockOnReconnect.current?.();

        expect(mockGetCorpayBankAccountFields).toHaveBeenCalledWith('DE', CONST.CURRENCY.EUR);
    });

    it('keeps the step up when a fetch fails but the loaded fields still match the country and currency', () => {
        const {queryByTestId} = renderBankInfo(buildCorpayFields({isSuccess: false}));

        expect(queryByTestId('not-found')).toBeNull();
        expect(queryByTestId('bank-info-step')).not.toBeNull();
    });

    it('shows the not found page when a fetch fails and there are no fields to show', () => {
        const {queryByTestId} = renderBankInfo({isLoading: false, isSuccess: false});

        expect(queryByTestId('not-found')).not.toBeNull();
    });
});
