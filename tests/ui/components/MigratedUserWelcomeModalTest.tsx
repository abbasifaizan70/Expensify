import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native';

import MigratedUserWelcomeModal from '@components/MigratedUserWelcomeModal';
import OnyxListItemProvider from '@components/OnyxListItemProvider';

import ONYXKEYS from '@src/ONYXKEYS';

import type * as NativeNavigation from '@react-navigation/native';
import type {ViewProps} from 'react-native';
import type ReactNative from 'react-native';

import React from 'react';
import Onyx from 'react-native-onyx';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockRevealRouteBeforeDismissingModal = jest.fn();
const mockDismissProductTraining = jest.fn();

let beforeRemoveCallback: (() => void) | undefined;

jest.mock('@hooks/useLocalize', () => () => ({
    translate: (key: string) => key,
}));

jest.mock('@hooks/useBeforeRemove', () => (callback: () => void) => {
    beforeRemoveCallback = callback;
});

jest.mock('@react-navigation/native', () => ({
    ...((): typeof NativeNavigation => jest.requireActual('@react-navigation/native'))(),
    useFocusEffect: jest.fn(),
}));

jest.mock('@libs/Navigation/Navigation', () => ({
    goBack: (...args: unknown[]) => mockGoBack(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    revealRouteBeforeDismissingModal: (...args: unknown[]) => mockRevealRouteBeforeDismissingModal(...args),
}));

jest.mock('@libs/actions/Welcome', () => ({
    dismissProductTraining: (...args: unknown[]) => mockDismissProductTraining(...args),
}));

jest.mock('@components/ImageSVG', () => {
    const {View} = require<typeof ReactNative>('react-native');
    return (props: ViewProps) => <View {...props} />;
});

jest.mock('@components/RenderHTML', () => {
    const {View} = require<typeof ReactNative>('react-native');
    return () => <View />;
});

describe('MigratedUserWelcomeModal', () => {
    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(() => {
        mockGoBack.mockClear();
        mockNavigate.mockClear();
        mockRevealRouteBeforeDismissingModal.mockClear();
        mockDismissProductTraining.mockClear();
        beforeRemoveCallback = undefined;
    });

    function renderModal() {
        return render(
            <OnyxListItemProvider>
                <MigratedUserWelcomeModal />
            </OnyxListItemProvider>,
        );
    }

    it('closes with one reveal-then-dismiss of Spend instead of going back and then navigating', async () => {
        // Given the welcome modal is open
        renderModal();

        // When the user presses "Let's go!"
        fireEvent.press(screen.getByText('migratedUserWelcomeModal.confirmText'));

        // Then Spend is put under the modal and the modal is dismissed as one transition, so iOS never runs a second
        // root navigation while it is still dismissing the transparent modal
        await waitFor(() => expect(mockRevealRouteBeforeDismissingModal).toHaveBeenCalledTimes(1));
        expect(mockRevealRouteBeforeDismissingModal.mock.calls.at(0)?.at(0)).toEqual(expect.stringContaining('search'));
        expect(mockGoBack).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('ignores further taps on the button and the backdrop once closing has started', async () => {
        // Given the user already pressed "Let's go!" and the close has started
        renderModal();
        fireEvent.press(screen.getByText('migratedUserWelcomeModal.confirmText'));
        await waitFor(() => expect(mockRevealRouteBeforeDismissingModal).toHaveBeenCalledTimes(1));

        // When they keep tapping the button and the full-screen backdrop during the fade-out, as the FullStory session shows
        fireEvent.press(screen.getByText('migratedUserWelcomeModal.confirmText'));
        for (const closeTarget of screen.getAllByLabelText('common.close')) {
            fireEvent.press(closeTarget);
        }

        // Then no extra navigation is started while the modal is being dismissed, even after the presses have settled
        await act(async () => {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 500);
            });
        });
        expect(mockRevealRouteBeforeDismissingModal).toHaveBeenCalledTimes(1);
        expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('closes the same way when the backdrop is tapped first', () => {
        // Given the welcome modal is open
        renderModal();

        // When the user taps outside the card
        const closeTargets = screen.getAllByLabelText('common.close');
        for (const closeTarget of closeTargets) {
            fireEvent.press(closeTarget);
        }

        // Then the modal closes through the same single transition, once
        expect(mockRevealRouteBeforeDismissingModal).toHaveBeenCalledTimes(1);
        expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('still saves the dismissal when the modal leaves the navigation stack', () => {
        // Given the welcome modal is open
        renderModal();

        // When the modal route is removed (DISMISS_MODAL at the end of the reveal)
        beforeRemoveCallback?.();

        // Then the dismissal is persisted from the removal, as before
        expect(mockDismissProductTraining).toHaveBeenCalledTimes(1);
    });
});
