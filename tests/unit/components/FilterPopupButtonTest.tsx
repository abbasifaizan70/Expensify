import {act, fireEvent, render, screen} from '@testing-library/react-native';

import type PopoverWithMeasuredContentProps from '@components/PopoverWithMeasuredContent/types';
import FilterPopupButton from '@components/Search/FilterDropdowns/FilterPopupButton';

import ONYXKEYS from '@src/ONYXKEYS';

import type {ReactElement} from 'react';
import type {StyleProp, ViewStyle} from 'react-native';
import type * as RNKeyboardController from 'react-native-keyboard-controller';

import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Onyx from 'react-native-onyx';

import waitForBatchedUpdates from '../../utils/waitForBatchedUpdates';

let mockIsSmallScreenWidth = true;
jest.mock('@hooks/useResponsiveLayout', () => jest.fn(() => ({isSmallScreenWidth: mockIsSmallScreenWidth, isInLandscapeMode: false})));

// The home indicator area the sheet pads itself above while the keyboard is down.
const SAFE_AREA_PADDING_BOTTOM = 34;
jest.mock('@hooks/useSafeAreaPaddings', () => jest.fn(() => ({paddingTop: 0, paddingBottom: SAFE_AREA_PADDING_BOTTOM})));

// The keyboard is closed by default. A test can open it to cover the sheet making room for it. The offset the keyboard
// controller reports is negative while the keyboard is open.
let mockKeyboardHeight = 0;
jest.mock('react-native-keyboard-controller', () => ({
    ...jest.requireActual<typeof RNKeyboardController>('react-native-keyboard-controller/jest'),
    useReanimatedKeyboardAnimation: () => ({
        height: {get: () => -mockKeyboardHeight, value: -mockKeyboardHeight},
        progress: {get: () => (mockKeyboardHeight > 0 ? 1 : 0), value: mockKeyboardHeight > 0 ? 1 : 0},
    }),
}));

jest.mock('@react-navigation/core', () => ({
    ...jest.requireActual<Record<string, unknown>>('@react-navigation/core'),
    useIsFocused: () => true,
}));

// The chip is always measurable here; the position itself does not matter to the sheet.
jest.mock('@hooks/usePopoverPosition', () => () => ({calculatePopoverPosition: () => Promise.resolve({horizontal: 0, vertical: 0, width: 0, height: 0})}));

let mockPopoverProps: PopoverWithMeasuredContentProps | undefined;
jest.mock('@components/PopoverWithMeasuredContent', () => (props: PopoverWithMeasuredContentProps) => {
    mockPopoverProps = props;
    return props.children;
});

/** The style of the wrapper the popover content is rendered in, which holds the room made for the keyboard */
function getContentWrapperStyle(): ViewStyle {
    const wrapper = mockPopoverProps?.children as ReactElement<{style: StyleProp<ViewStyle>}> | undefined;
    return StyleSheet.flatten(wrapper?.props.style) ?? {};
}

/** A fresh element each time, so a rerender is not skipped for an identical one */
const renderFilterPopupButton = () => (
    <FilterPopupButton
        renderButton={({onPress, ref}) => (
            <Pressable
                ref={ref}
                onPress={onPress}
            >
                <Text>Withdrawal ID</Text>
            </Pressable>
        )}
        PopoverComponent={() => <View testID="popover-content" />}
    />
);

/** Renders a filter chip and opens its popup, the way tapping an applied Withdrawal ID chip does. Rerendering picks up a keyboard change. */
async function renderOpenFilterPopup() {
    const {rerender} = render(renderFilterPopupButton());
    // The chip measures itself and opens the popup after a promise, so the open lands outside the press
    await act(async () => {
        fireEvent.press(screen.getByText('Withdrawal ID'));
        await waitForBatchedUpdates();
    });
    return {rerenderPopup: () => rerender(renderFilterPopupButton())};
}

describe('FilterPopupButton', () => {
    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(async () => {
        mockPopoverProps = undefined;
        mockIsSmallScreenWidth = true;
        mockKeyboardHeight = 0;
        await Onyx.clear();
        await waitForBatchedUpdates();
    });

    it('makes room for the keyboard inside the bottom sheet on a small screen', async () => {
        // Given a phone, where the chip's popup opens as a bottom sheet
        // When the popup opens and its text input brings up the keyboard
        const {rerenderPopup} = await renderOpenFilterPopup();
        mockKeyboardHeight = 300;
        rerenderPopup();

        // Then the sheet pads its content by the keyboard height itself and leaves the modal's keyboard avoidance off, so the
        // Apply button rises above the keyboard without the modal's KeyboardAvoidingView lifting the sheet short of it, as that
        // view measures itself inside the Android modal window but places the keyboard against the activity window
        expect(mockPopoverProps?.avoidKeyboard).toBe(false);
        expect(getContentWrapperStyle().paddingBottom).toBe(mockKeyboardHeight);
    });

    it('pads the bottom sheet above the home indicator while the keyboard is closed', async () => {
        // Given a phone whose keyboard is closed
        // When the chip's popup opens
        await renderOpenFilterPopup();

        // Then the sheet keeps its content above the home indicator, which the keyboard would otherwise cover
        expect(mockPopoverProps?.avoidKeyboard).toBe(false);
        expect(getContentWrapperStyle().paddingBottom).toBe(SAFE_AREA_PADDING_BOTTOM);
    });

    it('leaves keyboard avoidance to the modal for the anchored popover on a wide layout', async () => {
        // Given a wide layout, where the chip's popup is a popover anchored to the chip rather than a bottom sheet
        mockIsSmallScreenWidth = false;

        // When the popup opens with the keyboard up
        mockKeyboardHeight = 300;
        await renderOpenFilterPopup();

        // Then the popover keeps the modal's keyboard avoidance and reserves no room of its own, so wide layouts are unchanged
        expect(mockPopoverProps?.avoidKeyboard).toBe(true);
        expect(getContentWrapperStyle().paddingBottom).toBeUndefined();
    });
});
