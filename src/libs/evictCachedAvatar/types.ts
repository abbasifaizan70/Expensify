import type {AvatarSource} from '@libs/UserAvatarUtils';

/** Drops the copies of the current user's avatar that the image cache holds under `avatarSource`, ahead of the bytes behind that URL changing. */
type EvictCachedAvatar = (avatarSource: AvatarSource | undefined) => Promise<void>;

export default EvictCachedAvatar;
