import {act, render, screen} from '@testing-library/react-native';

import ImageWithLoading from '@components/ImageWithLoading';

import type ReactNative from 'react-native';

import React from 'react';

const FULL_RES_URI = 'https://example.com/receipt.1024.jpg';
const PREVIEW_URI = 'https://example.com/receipt.320.jpg';
const THUMBNAIL_FALLBACK_TIMEOUT_MS = 8000;

jest.mock('@hooks/useNetwork', () => jest.fn(() => ({isOffline: false})));
jest.mock('@hooks/useThemeStyles', () => jest.fn(() => new Proxy({}, {get: () => ({})})));

jest.mock('@components/AttachmentOfflineIndicator', () => () => null);

jest.mock('@components/LoadingIndicator', () => {
    const ReactLocal = jest.requireActual<typeof React>('react');
    const RN = jest.requireActual<typeof ReactNative>('react-native');
    return function MockLoadingIndicator() {
        return ReactLocal.createElement(RN.View, {testID: 'loading-indicator'});
    };
});

jest.mock('@components/Image', () => {
    const ReactLocal = jest.requireActual<typeof React>('react');
    const RN = jest.requireActual<typeof ReactNative>('react-native');
    return function MockImage(props: {source?: {uri?: string}}) {
        return ReactLocal.createElement(RN.View, {
            ...props,
            testID: `image-${props.source?.uri}`,
        });
    };
});

function renderImage(previewUri?: string) {
    return render(
        <ImageWithLoading
            source={{uri: FULL_RES_URI}}
            previewUri={previewUri}
            isAuthTokenRequired={false}
        />,
    );
}

function isVoidFunction(value: unknown): value is () => void {
    return typeof value === 'function';
}

function callImageHandler(uri: string, handlerName: 'onLoadStart' | 'onError' | 'waitForSession') {
    const handler: unknown = screen.getByTestId(`image-${uri}`).props[handlerName];
    if (!isVoidFunction(handler)) {
        throw new Error(`Expected ${handlerName} to be a function`);
    }
    act(() => {
        handler();
    });
}

function startLoading() {
    callImageHandler(FULL_RES_URI, 'onLoadStart');
    act(() => jest.advanceTimersByTime(200));
}

describe('ImageWithLoading', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        act(() => jest.runOnlyPendingTimers());
        jest.useRealTimers();
    });

    it('stops showing the loading indicator when the preview errors', () => {
        renderImage(PREVIEW_URI);
        startLoading();

        expect(screen.getByTestId('loading-indicator')).toBeTruthy();

        callImageHandler(PREVIEW_URI, 'onError');

        expect(screen.queryByTestId('loading-indicator')).toBeNull();
    });

    it('stops showing the loading indicator when an image never settles', () => {
        renderImage();
        startLoading();

        expect(screen.getByTestId('loading-indicator')).toBeTruthy();

        act(() => jest.advanceTimersByTime(THUMBNAIL_FALLBACK_TIMEOUT_MS - 201));
        expect(screen.getByTestId('loading-indicator')).toBeTruthy();

        act(() => jest.advanceTimersByTime(1));
        expect(screen.queryByTestId('loading-indicator')).toBeNull();
    });

    it('starts a fresh timeout when waiting for a new session', () => {
        renderImage();
        startLoading();
        act(() => jest.advanceTimersByTime(THUMBNAIL_FALLBACK_TIMEOUT_MS - 200));

        expect(screen.queryByTestId('loading-indicator')).toBeNull();

        callImageHandler(FULL_RES_URI, 'waitForSession');

        expect(screen.getByTestId('loading-indicator')).toBeTruthy();

        act(() => jest.advanceTimersByTime(THUMBNAIL_FALLBACK_TIMEOUT_MS - 1));
        expect(screen.getByTestId('loading-indicator')).toBeTruthy();

        act(() => jest.advanceTimersByTime(1));
        expect(screen.queryByTestId('loading-indicator')).toBeNull();
    });
});
