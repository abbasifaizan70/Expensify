import {handleDismissModalAction} from '@libs/Navigation/AppNavigator/createRootStackNavigator/GetStateForActionHandlers';

import NAVIGATORS from '@src/NAVIGATORS';

import type {ParamListBase, RouterConfigOptions, StackNavigationState} from '@react-navigation/native';

import {StackRouter} from '@react-navigation/native';

const routeNames = [NAVIGATORS.TAB_NAVIGATOR, NAVIGATORS.MIGRATED_USER_MODAL_NAVIGATOR, NAVIGATORS.SUBMIT_PLAN_MODAL_NAVIGATOR];

const configOptions: RouterConfigOptions = {
    routeNames,
    routeParamList: {},
    routeGetIdList: {},
};

function makeState(topRouteName: string): StackNavigationState<ParamListBase> {
    return {
        key: 'root',
        index: 1,
        routeNames,
        routes: [
            {key: 'tab', name: NAVIGATORS.TAB_NAVIGATOR},
            {key: 'modal', name: topRouteName},
        ],
        type: 'stack',
        stale: false,
        preloadedRoutes: [],
    };
}

describe('handleDismissModalAction', () => {
    const stackRouter = StackRouter({});

    it('dismisses the migrated user welcome modal navigator', () => {
        // Given the migrated user welcome modal is on top of the root stack
        const state = makeState(NAVIGATORS.MIGRATED_USER_MODAL_NAVIGATOR);

        // When DISMISS_MODAL runs, as it does at the end of revealRouteBeforeDismissingModal
        const result = handleDismissModalAction(state, configOptions, stackRouter);

        // Then the modal is popped instead of the action being dropped as "no modal stack to dismiss"
        expect(result?.routes.map((route) => route.name)).toEqual([NAVIGATORS.TAB_NAVIGATOR]);
    });

    it('keeps dismissing the sibling submit plan modal navigator', () => {
        // Given the submit plan welcome modal, which already supported DISMISS_MODAL, is on top
        const state = makeState(NAVIGATORS.SUBMIT_PLAN_MODAL_NAVIGATOR);

        // When DISMISS_MODAL runs
        const result = handleDismissModalAction(state, configOptions, stackRouter);

        // Then it is popped the same way
        expect(result?.routes.map((route) => route.name)).toEqual([NAVIGATORS.TAB_NAVIGATOR]);
    });
});
