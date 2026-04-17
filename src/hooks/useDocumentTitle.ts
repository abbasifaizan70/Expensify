import {useIsFocused} from '@react-navigation/native';
import {useLayoutEffect} from 'react';
import {setPageTitle} from '@libs/UnreadIndicatorUpdater/updateUnread';

/**
 * Sets the browser tab title for the currently focused screen.
 *
 * Implementation notes:
 *  - We use `useLayoutEffect` (instead of `useEffect` / `useFocusEffect`) so
 *    the title is written to the DOM *synchronously before paint*. This
 *    eliminates the 1-frame window in which the previous screen's (stale)
 *    title is still visible after a navigation event – which is what caused
 *    the tab title flicker on browser back / RHP back-button presses.
 *  - We gate on `useIsFocused` so a blurred screen that re-renders (e.g. due
 *    to an unrelated Onyx update) cannot overwrite the focused screen's
 *    title.
 *  - Empty titles are ignored. While an Onyx-derived title (e.g.
 *    `getReportName`) is still resolving it can briefly be `''`. Writing
 *    that would fall through to the `CONFIG.SITE_TITLE` fallback in
 *    `updateDocumentTitle` and flash "New Expensify" before the real title
 *    arrives on the next render.
 */
function useDocumentTitle(title: string) {
    const isFocused = useIsFocused();
    useLayoutEffect(() => {
        if (!isFocused || !title) {
            return;
        }
        setPageTitle(title);
    }, [isFocused, title]);
}

export default useDocumentTitle;
