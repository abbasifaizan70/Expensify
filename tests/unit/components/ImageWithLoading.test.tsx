import {act, render, screen} from '@testing-library/react-native';

import ImageWithLoading from '@components/ImageWithLoading';

import type ReactNative from 'react-native';

import React from 'react';

const FULL_RES_URI = 'https://example.com/receipt.1024.jpg';
const PREVIEW_URI = 'https://example.com/receipt.320.jpg';
const CACHE_PROBE_DELAY_MS = 200;

type ImageLoadEvent = {nativeEvent: {width: number; height: number}};
const LOAD_EVENT: ImageLoadEvent = {nativeEvent: {width: 100, height: 100}};

jest.mock('@hooks/useNetwork', () => jest.fn(() => ({isOffline: false})));
// Every style resolves to a marker object so the test can assert which named styles were applied.
jest.mock('@hooks/useThemeStyles', () => jest.fn(() => new Proxy({}, {get: (_target: unknown, key: string) => ({mockStyle: key})})));

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

function renderImage(previewUri?: string, onError?: () => void) {
    return render(
        <ImageWithLoading
            source={{uri: FULL_RES_URI}}
            previewUri={previewUri}
            onError={onError}
            isAuthTokenRequired={false}
        />,
    );
}

function callImageHandler(uri: string, handlerName: 'onLoadStart' | 'onError' | 'onLoad' | 'waitForSession', event?: ImageLoadEvent) {
    const handler: unknown = screen.getByTestId(`image-${uri}`).props[handlerName];
    if (typeof handler !== 'function') {
        throw new Error(`Expected ${handlerName} to be a function`);
    }
    act(() => {
        (handler as (imageEvent?: ImageLoadEvent) => void)(event);
    });
}

function hasStyle(uri: string, styleName: string) {
    const style: unknown = screen.getByTestId(`image-${uri}`).props.style;
    return JSON.stringify(style ?? null).includes(`"mockStyle":"${styleName}"`);
}

describe('ImageWithLoading', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        act(() => jest.runOnlyPendingTimers());
        jest.useRealTimers();
    });

    it('shows the low-res preview semi-transparent while the full-resolution image loads, then replaces it', () => {
        renderImage(PREVIEW_URI);

        callImageHandler(FULL_RES_URI, 'onLoadStart');

        expect(screen.getByTestId(`image-${PREVIEW_URI}`)).toBeTruthy();
        expect(hasStyle(PREVIEW_URI, 'opacitySemiTransparent')).toBe(true);
        expect(screen.getByTestId('loading-indicator')).toBeTruthy();

        callImageHandler(FULL_RES_URI, 'onLoad', LOAD_EVENT);

        expect(screen.queryByTestId(`image-${PREVIEW_URI}`)).toBeNull();
        expect(screen.queryByTestId('loading-indicator')).toBeNull();
    });

    it('hides the loading indicator and reports the failure when the full-resolution image errors', () => {
        const onError = jest.fn();
        renderImage(PREVIEW_URI, onError);

        callImageHandler(FULL_RES_URI, 'onLoadStart');
        expect(screen.getByTestId('loading-indicator')).toBeTruthy();

        callImageHandler(FULL_RES_URI, 'onError');

        expect(onError).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('loading-indicator')).toBeNull();
    });

    it('waits for the cache probe before showing the indicator when there is no preview', () => {
        renderImage();

        callImageHandler(FULL_RES_URI, 'onLoadStart');
        expect(screen.queryByTestId('loading-indicator')).toBeNull();

        act(() => jest.advanceTimersByTime(CACHE_PROBE_DELAY_MS));
        expect(screen.getByTestId('loading-indicator')).toBeTruthy();

        callImageHandler(FULL_RES_URI, 'onLoad', LOAD_EVENT);
        expect(screen.queryByTestId('loading-indicator')).toBeNull();
    });

    it('replays the transition when the image waits for a new session', () => {
        renderImage(PREVIEW_URI);

        callImageHandler(FULL_RES_URI, 'onLoadStart');
        callImageHandler(FULL_RES_URI, 'onLoad', LOAD_EVENT);
        expect(screen.queryByTestId('loading-indicator')).toBeNull();

        callImageHandler(FULL_RES_URI, 'waitForSession');

        expect(screen.getByTestId(`image-${PREVIEW_URI}`)).toBeTruthy();
        expect(hasStyle(PREVIEW_URI, 'opacitySemiTransparent')).toBe(true);
        expect(screen.getByTestId('loading-indicator')).toBeTruthy();
    });
});
