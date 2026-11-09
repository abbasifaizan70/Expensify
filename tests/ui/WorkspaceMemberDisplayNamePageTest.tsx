import {act, render} from '@testing-library/react-native';

import FormProvider from '@components/Form/FormProvider';
import PersonalDetailsByLoginProvider from '@components/PersonalDetailsByLoginProvider';

import Navigation from '@libs/Navigation/Navigation';
import {generateAccountID} from '@libs/UserUtils';

import WorkspaceMemberDisplayNamePage from '@pages/workspace/members/WorkspaceMemberDisplayNamePage';

import {updatePolicyMemberDisplayName} from '@userActions/Policy/Member';

import ONYXKEYS from '@src/ONYXKEYS';
import SCREENS from '@src/SCREENS';
import type {PersonalDetails, PersonalDetailsList, Policy} from '@src/types/onyx';

import type React from 'react';
import type {PropsWithChildren} from 'react';

import Onyx from 'react-native-onyx';

import createMock from '../utils/createMock';
import waitForBatchedUpdatesWithAct from '../utils/waitForBatchedUpdatesWithAct';

jest.mock('@components/Form/FormProvider', () => jest.fn(() => null));
jest.mock('@components/FullscreenLoadingIndicator', () => jest.fn(() => null));
jest.mock('@components/Header/composed/HeaderWithBackButtonAndTitle', () => jest.fn(() => null));
jest.mock('@components/ScreenWrapper', () => jest.fn(({children}: PropsWithChildren) => children));
jest.mock('@hooks/useDynamicBackPath', () => jest.fn(() => 'workspaces/policy123/members/1'));
jest.mock('@hooks/useLocalize', () => jest.fn(() => ({translate: (key: string) => key, formatPhoneNumber: (value: string) => value})));
jest.mock('@hooks/useThemeStyles', () => jest.fn(() => new Proxy({}, {get: () => ({})})));
jest.mock('@libs/Navigation/Navigation', () => ({goBack: jest.fn()}));
jest.mock('@userActions/Policy/Member', () => ({updatePolicyMemberDisplayName: jest.fn()}));
jest.mock('@pages/workspace/AccessOrNotFoundWrapper', () => ({
    __esModule: true,
    default: ({children, shouldBeBlocked}: PropsWithChildren<{shouldBeBlocked: boolean}>) => (shouldBeBlocked ? null : children),
}));

type MockFormProviderProps = {
    onSubmit: (values: {firstName: string; lastName: string}) => void;
};

describe('WorkspaceMemberDisplayNamePage', () => {
    const policyID = 'policy123';
    const invitedEmail = 'invited@example.com';
    const realAccountID = 5555;
    const namedEmail = 'named@example.com';
    const namedAccountID = 6666;
    const policy = createMock<Policy>({
        id: policyID,
        employeeList: {
            [invitedEmail]: {email: invitedEmail},
            [namedEmail]: {email: namedEmail},
        },
    });
    const mockedFormProvider = jest.mocked(FormProvider);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrows props captured from the mocked FormProvider
    const getFormProps = () => mockedFormProvider.mock.lastCall?.[0] as MockFormProviderProps | undefined;

    const renderPage = async (routeAccountID: number, personalDetails: PersonalDetailsList) => {
        await act(async () => {
            await Onyx.set(ONYXKEYS.PERSONAL_DETAILS_LIST, personalDetails);
        });
        const props = createMock<React.ComponentProps<typeof WorkspaceMemberDisplayNamePage>>({
            route: {name: SCREENS.WORKSPACE.DYNAMIC_MEMBER_DISPLAY_NAME, params: {policyID, accountID: String(routeAccountID)}},
        });
        render(
            <PersonalDetailsByLoginProvider>
                <WorkspaceMemberDisplayNamePage {...props} />
            </PersonalDetailsByLoginProvider>,
        );
        await waitForBatchedUpdatesWithAct();
    };

    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        await act(async () => {
            await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${policyID}`, policy);
        });
    });

    afterEach(async () => {
        await act(async () => {
            await Onyx.clear();
        });
    });

    it('opens the editor and saves to the real entry when the route holds the stale optimistic accountID of an invited member', async () => {
        // Given Member details was opened while the invite was in flight, so the route still holds the login-derived optimistic
        // accountID, and the backend has since returned the invited member under their real accountID
        await renderPage(generateAccountID(invitedEmail), {[realAccountID]: createMock<PersonalDetails>({accountID: realAccountID, login: invitedEmail})});

        // Then the editor is shown instead of the not found page
        expect(mockedFormProvider).toHaveBeenCalled();

        // When the admin saves a name
        act(() => {
            getFormProps()?.onSubmit({firstName: ' Jane ', lastName: 'Doe '});
        });

        // Then the name is written to the member's real personal details entry, which Member details reads by login
        expect(updatePolicyMemberDisplayName).toHaveBeenCalledWith(policyID, 'Jane', 'Doe', expect.any(Function), expect.objectContaining({accountID: realAccountID, email: invitedEmail}));
        expect(Navigation.goBack).toHaveBeenCalled();
    });

    it('opens the editor when the invited member has no personal details at all', async () => {
        // Given the members list routed with an accountID generated from the login because the member's personal details never loaded
        const generatedAccountID = generateAccountID(invitedEmail);
        await renderPage(generatedAccountID, {});

        // Then the editor is shown and saving targets the generated accountID the members list also uses
        expect(mockedFormProvider).toHaveBeenCalled();
        act(() => {
            getFormProps()?.onSubmit({firstName: 'Jane', lastName: 'Doe'});
        });
        expect(updatePolicyMemberDisplayName).toHaveBeenCalledWith(
            policyID,
            'Jane',
            'Doe',
            expect.any(Function),
            expect.objectContaining({accountID: generatedAccountID, email: invitedEmail}),
        );
    });

    it('opens the editor for a member whose route accountID resolves directly', async () => {
        // Given a member without a name, opened through their real accountID
        await renderPage(realAccountID, {[realAccountID]: createMock<PersonalDetails>({accountID: realAccountID, login: invitedEmail})});

        // Then the editor is shown and saving targets that accountID
        expect(mockedFormProvider).toHaveBeenCalled();
        act(() => {
            getFormProps()?.onSubmit({firstName: 'Jane', lastName: 'Doe'});
        });
        expect(updatePolicyMemberDisplayName).toHaveBeenCalledWith(policyID, 'Jane', 'Doe', expect.any(Function), expect.objectContaining({accountID: realAccountID, email: invitedEmail}));
    });

    it('stays blocked when the member resolved from a stale accountID already has a name', async () => {
        // Given the route holds a stale optimistic accountID for a member whose real entry already has a name
        await renderPage(generateAccountID(namedEmail), {[namedAccountID]: createMock<PersonalDetails>({accountID: namedAccountID, login: namedEmail, firstName: 'Named'})});

        // Then the editor stays blocked, since admins can only set a name that the member hasn't set
        expect(mockedFormProvider).not.toHaveBeenCalled();
    });

    it('stays blocked when the accountID does not belong to a workspace member', async () => {
        // Given an accountID that matches neither a personal details entry nor a login in the workspace
        await renderPage(generateAccountID('stranger@example.com'), {});

        // Then the editor is not shown
        expect(mockedFormProvider).not.toHaveBeenCalled();
    });
});
