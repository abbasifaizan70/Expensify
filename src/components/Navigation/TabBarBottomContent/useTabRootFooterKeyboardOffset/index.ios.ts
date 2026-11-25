import useTabBarCoveredHeight from '@components/Navigation/TabBarBottomContent/useTabBarCoveredHeight';

import useSafeAreaPaddings from '@hooks/useSafeAreaPaddings';

/**
 * A tab root footer pads past the translucent UITabBar and the home indicator inset under it. Once the keyboard is up it
 * covers that whole band, but the KeyboardAvoidingView only leaves the bottom safe area padding under it, so the rest of
 * the footer padding shows as a blank band above the keyboard. This offset makes the KeyboardAvoidingView leave the whole
 * band under the keyboard instead, so the footer sits on it without its layout changing while the keyboard animates.
 */
function useTabRootFooterKeyboardOffset(): number {
    const tabBarCoveredHeight = useTabBarCoveredHeight();
    const {paddingBottom: safeAreaPaddingBottom} = useSafeAreaPaddings(true);

    if (tabBarCoveredHeight <= safeAreaPaddingBottom) {
        return 0;
    }

    // The KeyboardAvoidingView already offsets the bottom safe area padding, so only the remainder is added here.
    return safeAreaPaddingBottom - tabBarCoveredHeight;
}

export default useTabRootFooterKeyboardOffset;
