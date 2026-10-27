/**
 * Lists every URL the App loads an uploaded avatar from, so each cached copy of it can be found.
 */
import type {AvatarSource} from '@libs/UserAvatarUtils';

import CONST from '@src/CONST';

// Uploaded photos are also served at 128px under this suffix, which is the size `UserAvatarUtils.getSmallSizeAvatar` requests for lists.
const SMALL_SIZE_SUFFIX = '_128';

/**
 * Returns the full-size and `_128` URLs of an uploaded avatar. Bundled icons and generated letter avatars are drawn
 * locally and a local file is never cached under its URL, so those return nothing.
 */
function getAvatarSizeVariants(avatarSource: AvatarSource | undefined): string[] {
    if (typeof avatarSource !== 'string' || !/^https?:\/\//i.test(avatarSource) || avatarSource.includes(CONST.GENERATED_LETTER_AVATAR_PATH)) {
        return [];
    }

    const lastPeriodIndex = avatarSource.lastIndexOf('.');
    // A period in the host name is not an extension, and without an extension there is no place to put the size suffix.
    if (lastPeriodIndex <= avatarSource.lastIndexOf('/')) {
        return [avatarSource];
    }

    const extension = avatarSource.substring(lastPeriodIndex);
    const path = avatarSource.substring(0, lastPeriodIndex);
    const fullSizePath = path.endsWith(SMALL_SIZE_SUFFIX) ? path.substring(0, path.length - SMALL_SIZE_SUFFIX.length) : path;
    const fullSizeURL = `${fullSizePath}${extension}`;

    // Only the asset server resizes by suffix, so other hosts have a single copy.
    if (!CONST.CLOUDFRONT_DOMAIN_REGEX.test(avatarSource)) {
        return [fullSizeURL];
    }

    return [fullSizeURL, `${fullSizePath}${SMALL_SIZE_SUFFIX}${extension}`];
}

export default getAvatarSizeVariants;
