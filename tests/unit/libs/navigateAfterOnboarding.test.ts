import SidePanelActions from '@libs/actions/SidePanel';
import {setOnboardingRHPVariant} from '@libs/actions/Welcome';
import {navigateToSubmitWorkspaceAfterOnboardingWithMicrotaskQueue} from '@libs/navigateAfterOnboarding';
import Navigation from '@libs/Navigation/Navigation';
import {buildCannedSearchQuery} from '@libs/SearchQueryUtils';

import CONST from '@src/CONST';
import ROUTES from '@src/ROUTES';

jest.mock('@libs/Navigation/Navigation', () => ({
    __esModule: true,
    default: {
        dismissModal: jest.fn((options?: {afterTransition?: () => void}) => options?.afterTransition?.()),
        navigate: jest.fn(),
        setNavigationActionToMicrotaskQueue: jest.fn((callback: () => void) => callback()),
    },
}));

jest.mock('@libs/actions/SidePanel', () => ({
    __esModule: true,
    default: {openSidePanel: jest.fn()},
}));

jest.mock('@libs/actions/Welcome', () => ({
    setOnboardingRHPVariant: jest.fn(),
}));

jest.mock('@libs/actions/Modal', () => ({
    setDisableDismissOnEscape: jest.fn(),
}));

const navigationMock = jest.mocked(Navigation);

const EXPENSES_ROUTE = ROUTES.SEARCH_ROOT.getRoute({query: buildCannedSearchQuery({type: CONST.SEARCH.DATA_TYPES.EXPENSE}), searchKey: CONST.SEARCH.SEARCH_KEYS.EXPENSES});

describe('navigateToSubmitWorkspaceAfterOnboardingWithMicrotaskQueue', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('navigates to HOME without opening the side panel when policyID is missing', () => {
        // Given an onboarding user for whom no Submit workspace could be created or joined
        // When onboarding completes
        navigateToSubmitWorkspaceAfterOnboardingWithMicrotaskQueue(undefined);

        // Then the user lands on Home; without a workspace there is no #admins room to surface in the side panel
        expect(navigationMock.dismissModal).toHaveBeenCalledTimes(1);
        expect(navigationMock.navigate).toHaveBeenCalledTimes(1);
        expect(navigationMock.navigate).toHaveBeenCalledWith(ROUTES.HOME);
        expect(setOnboardingRHPVariant).not.toHaveBeenCalled();
        expect(SidePanelActions.openSidePanel).not.toHaveBeenCalled();
    });

    it.each([
        ['wide', false],
        ['narrow', true],
    ])('navigates to Spend > Expenses with the side panel closed during onboarding on a %s layout', (_layout, shouldUseNarrowLayout) => {
        // Given a "Get paid back by my employer" user who created a Submit workspace, or an invited employee who joined one
        // from the onboarding join-workspace step (both reach this helper as the onboarding flow, the default)
        // When onboarding completes
        navigateToSubmitWorkspaceAfterOnboardingWithMicrotaskQueue('test-policy-id', shouldUseNarrowLayout);

        // Then the user still lands on Spend > Expenses with #admins as the side panel's default report, but the panel is
        // not opened: onboarding never opens the side panel automatically
        expect(navigationMock.dismissModal).toHaveBeenCalledTimes(1);
        expect(navigationMock.navigate).toHaveBeenCalledTimes(1);
        expect(navigationMock.navigate).toHaveBeenCalledWith(EXPENSES_ROUTE);
        expect(setOnboardingRHPVariant).toHaveBeenCalledWith(CONST.ONBOARDING_RHP_VARIANT.RHP_ADMINS_ROOM);
        expect(SidePanelActions.openSidePanel).not.toHaveBeenCalled();
    });

    it('navigates to Spend > Expenses with the expanded side panel for an already-onboarded caller on a wide layout', () => {
        // Given an already-onboarded user creating a Submit workspace from the Submit plan welcome modal or the Submit deep link
        // When the workspace is ready
        navigateToSubmitWorkspaceAfterOnboardingWithMicrotaskQueue('test-policy-id', false, false);

        // Then the pre-existing behavior is kept: Spend > Expenses with the side panel open on the #admins room, where the
        // Submit welcome and its suggested responses are posted
        expect(navigationMock.dismissModal).toHaveBeenCalledTimes(1);
        expect(navigationMock.navigate).toHaveBeenCalledTimes(1);
        expect(navigationMock.navigate).toHaveBeenCalledWith(EXPENSES_ROUTE);
        expect(setOnboardingRHPVariant).toHaveBeenCalledWith(CONST.ONBOARDING_RHP_VARIANT.RHP_ADMINS_ROOM);
        expect(SidePanelActions.openSidePanel).toHaveBeenCalledWith(true);
    });

    it('navigates to Spend > Expenses with the collapsed side panel for an already-onboarded caller on a narrow layout', () => {
        // Given an already-onboarded user creating a Submit workspace from the Submit plan welcome modal on a narrow layout
        // When the workspace is ready
        navigateToSubmitWorkspaceAfterOnboardingWithMicrotaskQueue('test-policy-id', true, false);

        // Then the pre-existing behavior is kept for this caller too
        expect(navigationMock.dismissModal).toHaveBeenCalledTimes(1);
        expect(navigationMock.navigate).toHaveBeenCalledTimes(1);
        expect(navigationMock.navigate).toHaveBeenCalledWith(EXPENSES_ROUTE);
        expect(setOnboardingRHPVariant).toHaveBeenCalledWith(CONST.ONBOARDING_RHP_VARIANT.RHP_ADMINS_ROOM);
        expect(SidePanelActions.openSidePanel).toHaveBeenCalledWith(false);
    });
});
