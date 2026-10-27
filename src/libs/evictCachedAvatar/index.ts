import type EvictCachedAvatar from './types';

// The browser owns the image cache on web and revalidates the avatar URL with the asset server, which serves uploaded
// photos with `max-age=0, must-revalidate`, so a replaced photo is fetched again there without any help.
const evictCachedAvatar: EvictCachedAvatar = () => Promise.resolve();

export default evictCachedAvatar;
