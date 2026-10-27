import Log from '@libs/Log';

import {Image} from 'expo-image';
import RNFS from 'react-native-fs';

import type EvictCachedAvatar from './types';

import getAvatarSizeVariants from './getAvatarSizeVariants';

/**
 * The asset server keeps one URL per account for the uploaded photo and swaps the bytes behind it on every upload,
 * while expo-image keys its memory and disk caches by that URL and never revalidates it. So whenever the current
 * user's stored avatar is about to change, the copies cached under the URL being abandoned are dropped here, and the
 * next upload, which the server hands back on that same URL, is fetched instead of painted from the old bytes. Only
 * the full-size and `_128` entries of that one avatar are removed; receipts and other users' avatars stay cached.
 */
const evictCachedAvatar: EvictCachedAvatar = async (avatarSource) => {
    try {
        // A bitmap that a view released when the avatar changed earlier in the session still sits in the memory cache
        // under the old URL, so memory is cleared on every change, even when the current source is a letter avatar or a local file.
        await Image.clearMemoryCache();
        await Promise.all(
            getAvatarSizeVariants(avatarSource).map(async (url) => {
                const cachePath = await Image.getCachePathAsync(url);
                if (!cachePath) {
                    return;
                }
                await RNFS.unlink(cachePath);
            }),
        );
    } catch (error) {
        Log.warn('[evictCachedAvatar] Failed to drop the cached avatar', {avatarSource, error: error instanceof Error ? error.message : String(error)});
    }
};

export default evictCachedAvatar;
