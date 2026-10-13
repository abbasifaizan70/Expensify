import {act, render, screen} from '@testing-library/react-native';

import type {NavigationContainerRef, ParamListBase} from '@react-navigation/native';

import {NavigationContainer, StackActions} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import React from 'react';
import {Text} from 'react-native';

// Jest resolves the `.native` variant of the monitor, which never reports a browser gesture. This suite is about the
// browser behaviour, so load the web implementation that the patch ships. The package's `exports` map hides the file, hence the relative path.
jest.mock('../../node_modules/@react-navigation/stack/lib/module/utils/edgeDragGestureMonitor', () =>
    jest.requireActual<Record<string, unknown>>('../../node_modules/@react-navigation/stack/lib/module/utils/edgeDragGestureMonitor.js'),
);

const Stack = createStackNavigator<ParamListBase>();

function FirstScreen() {
    return <Text>First screen</Text>;
}

function SecondScreen() {
    return <Text>Second screen</Text>;
}

/**
 * Fires the `popstate` a browser dispatches after its own swipe-back / swipe-forward animation.
 * Safari 18 and Chrome 118 mark it with `hasUAVisualTransition`; jsdom's `PopStateEvent` has no such getter, so define it on the instance.
 */
function dispatchPopState(hasUAVisualTransition: boolean) {
    const event = new PopStateEvent('popstate');
    Object.defineProperty(event, 'hasUAVisualTransition', {value: hasUAVisualTransition});
    window.dispatchEvent(event);
}

// A card that is closing is still mounted, but hidden from accessibility, so the queries must include hidden elements.
const includeHidden = {includeHiddenElements: true};

function renderStackWithTwoScreens() {
    const navigationRef = React.createRef<NavigationContainerRef<ParamListBase>>();
    render(
        <NavigationContainer
            ref={navigationRef}
            initialState={{
                index: 1,
                routes: [{name: 'First'}, {name: 'Second'}],
            }}
        >
            <Stack.Navigator screenOptions={{headerShown: false, animation: 'slide_from_right'}}>
                <Stack.Screen
                    name="First"
                    component={FirstScreen}
                />
                <Stack.Screen
                    name="Second"
                    component={SecondScreen}
                />
            </Stack.Navigator>
        </NavigationContainer>,
    );
    return navigationRef;
}

/**
 * On web, react-navigation's `popstate` listener resets the navigation state synchronously inside the event dispatch,
 * so the pop is issued right after the event, in the same task.
 */
function popDuringPopState(navigationRef: React.RefObject<NavigationContainerRef<ParamListBase> | null>, hasUAVisualTransition: boolean) {
    act(() => {
        dispatchPopState(hasUAVisualTransition);
        navigationRef.current?.dispatch(StackActions.pop());
    });
}

describe('Stack transitions after a browser-animated history navigation', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
    });

    it('drops the dismissed screen in the same commit when the browser already animated the navigation', () => {
        // Given a stack with two animated screens
        const navigationRef = renderStackWithTwoScreens();
        expect(screen.getByText('Second screen', includeHidden)).toBeOnTheScreen();

        // When the browser finishes its own swipe-back animation and fires the popstate that pops the top screen
        popDuringPopState(navigationRef, true);

        // Then the dismissed screen is gone right away, so the first frame the browser reveals already shows the destination
        expect(screen.queryByText('Second screen', includeHidden)).not.toBeOnTheScreen();
        expect(screen.getByText('First screen', includeHidden)).toBeOnTheScreen();
    });

    it('keeps animating pops that the browser did not animate', () => {
        // Given a stack with two animated screens
        const navigationRef = renderStackWithTwoScreens();

        // When a popstate without a browser transition (e.g. the toolbar back button) pops the top screen
        popDuringPopState(navigationRef, false);

        // Then the dismissed screen stays mounted while its close animation plays
        expect(screen.getByText('Second screen', includeHidden)).toBeOnTheScreen();

        // And it is removed once the animation finishes
        act(() => {
            jest.advanceTimersByTime(2000);
        });
        expect(screen.queryByText('Second screen', includeHidden)).not.toBeOnTheScreen();
    });

    it('only affects the navigation that followed the browser transition', () => {
        // Given a browser-animated popstate that is fully handled, so its task is over
        const navigationRef = renderStackWithTwoScreens();
        act(() => {
            dispatchPopState(true);
            jest.advanceTimersByTime(0);
        });

        // When a later pop happens in the app
        act(() => {
            navigationRef.current?.dispatch(StackActions.pop());
        });

        // Then it still animates, as the flag was only alive for the popstate's own task
        expect(screen.getByText('Second screen', includeHidden)).toBeOnTheScreen();
    });
});
