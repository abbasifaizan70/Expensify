import getAvatarSizeVariants from '@libs/evictCachedAvatar/getAvatarSizeVariants';
import evictCachedAvatar from '@libs/evictCachedAvatar/index.native';
import Log from '@libs/Log';

import CONST from '@src/CONST';

import {Image} from 'expo-image';
import RNFS from 'react-native-fs';

jest.mock('expo-image', () => ({
    Image: {
        clearMemoryCache: jest.fn(() => Promise.resolve(true)),
        getCachePathAsync: jest.fn(() => Promise.resolve(null)),
    },
}));

jest.mock('@libs/Log', () => ({
    __esModule: true,
    default: {
        warn: jest.fn(),
    },
}));

// The asset server hands every upload of an account back on this same URL, and lists load the `_128` copy of it
const AVATAR_URL = 'https://d1wpcgnaa73g0y.cloudfront.net/5195303cce3daabe8d8898a4c573ee40b8bff88da2b309019fbb01082245c18a.jpeg';
const SMALL_AVATAR_URL = 'https://d1wpcgnaa73g0y.cloudfront.net/5195303cce3daabe8d8898a4c573ee40b8bff88da2b309019fbb01082245c18a_128.jpeg';
const LETTER_AVATAR_URL = `https://d2k5nsl2zxldvw.cloudfront.net${CONST.GENERATED_LETTER_AVATAR_PATH}J-S-7.png`;
const LOCAL_FILE_URI = 'file:///data/user/0/com.expensify.chat/cache/ImageManipulator/cropped.jpg';

const mockClearMemoryCache = jest.mocked(Image.clearMemoryCache);
const mockGetCachePathAsync = jest.mocked(Image.getCachePathAsync);
const mockUnlink = jest.mocked(RNFS.unlink);
const mockLogWarn = jest.mocked(Log.warn);

describe('getAvatarSizeVariants', () => {
    it('returns the full-size and _128 URLs of an uploaded avatar', () => {
        expect(getAvatarSizeVariants(AVATAR_URL)).toEqual([AVATAR_URL, SMALL_AVATAR_URL]);
    });

    it('returns both sizes when given the _128 URL', () => {
        expect(getAvatarSizeVariants(SMALL_AVATAR_URL)).toEqual([AVATAR_URL, SMALL_AVATAR_URL]);
    });

    it('returns a single copy for a host that does not resize by suffix', () => {
        expect(getAvatarSizeVariants('https://example.com/photos/me.png')).toEqual(['https://example.com/photos/me.png']);
    });

    it('does not insert a size suffix into a URL without a file extension', () => {
        expect(getAvatarSizeVariants('https://d1wpcgnaa73g0y.cloudfront.net/avatar')).toEqual(['https://d1wpcgnaa73g0y.cloudfront.net/avatar']);
    });

    it('returns nothing for a generated letter avatar, a local file, or no avatar', () => {
        expect(getAvatarSizeVariants(LETTER_AVATAR_URL)).toEqual([]);
        expect(getAvatarSizeVariants(LOCAL_FILE_URI)).toEqual([]);
        expect(getAvatarSizeVariants(undefined)).toEqual([]);
        expect(getAvatarSizeVariants('')).toEqual([]);
    });
});

describe('evictCachedAvatar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('clears the memory cache and deletes the cached files of both sizes of an uploaded avatar', async () => {
        mockGetCachePathAsync.mockImplementation((cacheKey) => Promise.resolve(`/cache/image_manager_disk_cache/${cacheKey.endsWith('_128.jpeg') ? 'small' : 'full'}.0`));

        await evictCachedAvatar(AVATAR_URL);

        expect(mockClearMemoryCache).toHaveBeenCalledTimes(1);
        expect(mockGetCachePathAsync).toHaveBeenCalledWith(AVATAR_URL);
        expect(mockGetCachePathAsync).toHaveBeenCalledWith(SMALL_AVATAR_URL);
        expect(mockUnlink).toHaveBeenCalledTimes(2);
        expect(mockUnlink).toHaveBeenCalledWith('/cache/image_manager_disk_cache/full.0');
        expect(mockUnlink).toHaveBeenCalledWith('/cache/image_manager_disk_cache/small.0');
    });

    it('leaves the disk alone for a size that is not cached', async () => {
        mockGetCachePathAsync.mockImplementation((cacheKey) => Promise.resolve(cacheKey === AVATAR_URL ? '/cache/image_manager_disk_cache/full.0' : null));

        await evictCachedAvatar(AVATAR_URL);

        expect(mockUnlink).toHaveBeenCalledTimes(1);
        expect(mockUnlink).toHaveBeenCalledWith('/cache/image_manager_disk_cache/full.0');
    });

    it('still clears the memory cache when the current avatar is a letter avatar or a local file', async () => {
        await evictCachedAvatar(LETTER_AVATAR_URL);
        await evictCachedAvatar(LOCAL_FILE_URI);
        await evictCachedAvatar(undefined);

        expect(mockClearMemoryCache).toHaveBeenCalledTimes(3);
        expect(mockGetCachePathAsync).not.toHaveBeenCalled();
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('logs instead of throwing when a cached file cannot be deleted', async () => {
        mockGetCachePathAsync.mockResolvedValue('/cache/image_manager_disk_cache/full.0');
        mockUnlink.mockRejectedValueOnce(new Error('ENOENT'));

        await expect(evictCachedAvatar(AVATAR_URL)).resolves.toBeUndefined();

        expect(mockLogWarn).toHaveBeenCalledWith('[evictCachedAvatar] Failed to drop the cached avatar', {avatarSource: AVATAR_URL, error: 'ENOENT'});
    });
});
