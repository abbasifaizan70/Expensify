import Log from '@libs/Log';

import CONST from '@src/CONST';

import type {ImageSource} from 'expo-image';

import {useEffect, useState} from 'react';

const clearAuthImagesCache = async () => {
    if (!('caches' in window)) {
        return;
    }

    try {
        await caches.delete(CONST.CACHE_NAME.AUTH_IMAGES);
    } catch (error) {
        Log.alert('[AuthImageCache] Error clearing auth image cache:', {message: (error as Error).message});
    }
};

function useCachedImageSource(source: ImageSource | undefined): ImageSource | null | undefined {
    const uri = typeof source === 'object' ? source.uri : undefined;
    const hasHeaders = typeof source === 'object' && !!source.headers;
    // `Image` rebuilds the `headers` object on every render (see `getImageSource`), so a new object arrives here even
    // when the request is unchanged. Tracking the header *values* keeps the effect below tied to what actually decides
    // the request, instead of restarting it on every re-render of the parent.
    const headersKey = typeof source === 'object' && source.headers ? JSON.stringify(source.headers) : undefined;
    const [cachedUri, setCachedUri] = useState<string | null>(null);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setCachedUri(null);
        setHasError(false);

        if (!hasHeaders || !uri) {
            return;
        }

        let revoked = false;
        let objectURL: string | undefined;

        (async () => {
            try {
                const cache = await caches.open(CONST.CACHE_NAME.AUTH_IMAGES);
                const cachedResponse = await cache.match(uri);

                if (cachedResponse) {
                    const blob = await cachedResponse.blob();
                    objectURL = URL.createObjectURL(blob);
                    if (!revoked) {
                        setCachedUri(objectURL);
                    } else {
                        URL.revokeObjectURL(objectURL);
                    }
                    return;
                }

                const response = await fetch(uri, {headers: source.headers});

                if (!response.ok) {
                    if (!revoked) {
                        setHasError(true);
                    }
                    return;
                }

                // Store in cache before consuming
                await cache.put(uri, response.clone());

                const blob = await response.blob();
                objectURL = URL.createObjectURL(blob);
                if (!revoked) {
                    setCachedUri(objectURL);
                } else {
                    URL.revokeObjectURL(objectURL);
                }
            } catch (error) {
                if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                    await clearAuthImagesCache();
                }
                if (!revoked) {
                    setHasError(true);
                }
            }
        })();

        return () => {
            revoked = true;
            if (objectURL) {
                URL.revokeObjectURL(objectURL);
            }
        };
        // `source.headers` is read above but deliberately left out of the dependencies: it is a fresh object on every
        // render, and restarting this effect resets `cachedUri` to `null` and lets the cleanup abandon the in-flight
        // fetch, so a blob URL is never produced. expo-image is then handed `null` forever and can emit neither
        // `onLoad` nor `onError` — which is what leaves a receipt on an endless spinner. `headersKey` covers every
        // header change that matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uri, hasHeaders, headersKey]);

    // Images without headers are cached natively by the browser,
    // so pass them through as-is — no Cache API needed
    if (!hasHeaders) {
        return source;
    }

    // If caching failed, fall back to the original source so expo-image
    // handles it normally (including error reporting via onError)
    if (hasError) {
        return source;
    }

    // Cache fetch is still in progress — return null so expo-image doesn't
    // render the image with headers (which would bypass our cache)
    if (!cachedUri) {
        return null;
    }

    return {uri: cachedUri};
}

export default useCachedImageSource;
export {clearAuthImagesCache};
