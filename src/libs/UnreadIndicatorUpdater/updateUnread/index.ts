/**
 * Web browsers have a tab title and favicon which can be updated to show there are unread comments
 */
import CONFIG from '@src/CONFIG';
import type UpdateUnread from './types';

let unreadTotalCount = 0;
let currentPageTitle = '';
let lastWrittenTitle = '';
let lastWrittenFaviconHref = '';
let titleUpdateTimeout: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Empty-title write guard (fixes tab-title flicker on browser/RHP back nav)
// ============================================================================
// React Navigation's `createMemoryHistory.go()` runs a Chrome-specific
// workaround after every `history.go()` (i.e. every back/forward navigation):
//
//   const {title} = window.document;
//   window.document.title = '';
//   window.document.title = title;
//
// See: @react-navigation/native – createMemoryHistory.js (look for the
// "There seems to be a bug in Chrome regarding updating the title" comment).
//
// Although both writes are synchronous, Chrome paints between them – which
// produces a visible "new → blank → new" flash when the user presses back
// (whether via the RHP `<` button or the browser back button).
//
// Our app never has a legitimate reason to render an empty tab title: every
// route provides one through `useDocumentTitle`, and when no page title is
// set we fall back to `CONFIG.SITE_TITLE` inside `updateDocumentTitle`. So we
// install a one-time property trap that no-ops empty-string writes at the
// DOM level. This safely neutralises the library workaround without patching
// `node_modules`.
/* eslint-disable @typescript-eslint/unbound-method, no-console */
const TITLE_GUARD_VERSION = 2;
(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        console.log('[TitleGuard] skipped - no window/document');
        return;
    }
    type TitleDescriptor = {get: (this: Document) => string; set: (this: Document, value: string) => void};
    type GuardedWindow = {
        titleGuardVersion?: number;
        titleGuardNativeGetter?: (this: Document) => string;
        titleGuardNativeSetter?: (this: Document, value: string) => void;
        titleGuardDroppedCount?: number;
    };
    const guardedWindow = window as unknown as GuardedWindow;

    // Already on the current version – keep the installed trap as-is.
    if (guardedWindow.titleGuardVersion === TITLE_GUARD_VERSION) {
        console.log('[TitleGuard] already installed at version', TITLE_GUARD_VERSION);
        return;
    }

    // Recover the native getter/setter. We cache them on window so subsequent
    // re-installs (e.g. via HMR) don't accidentally wrap a previously
    // installed trap as their "native" implementation.
    let getter = guardedWindow.titleGuardNativeGetter;
    let setter = guardedWindow.titleGuardNativeSetter;
    if (!getter || !setter) {
        let descriptor: PropertyDescriptor | undefined;
        let current: unknown = Object.getPrototypeOf(document);
        while (current && !descriptor) {
            descriptor = Object.getOwnPropertyDescriptor(current as Record<string, unknown>, 'title');
            current = Object.getPrototypeOf(current);
        }
        const typed = descriptor as TitleDescriptor | undefined;
        if (!typed?.get || !typed?.set) {
            console.log('[TitleGuard] could not find native title descriptor');
            return;
        }
        getter = typed.get;
        setter = typed.set;
        guardedWindow.titleGuardNativeGetter = getter;
        guardedWindow.titleGuardNativeSetter = setter;
        console.log('[TitleGuard] extracted native getter/setter');
    }

    const nativeGetter = getter;
    const nativeSetter = setter;
    guardedWindow.titleGuardDroppedCount = 0;
    Object.defineProperty(document, 'title', {
        configurable: true,
        get() {
            return nativeGetter.call(document);
        },
        set(value: string) {
            // Drop empty writes – see comment above.
            if (value === '') {
                guardedWindow.titleGuardDroppedCount = (guardedWindow.titleGuardDroppedCount ?? 0) + 1;
                console.log(`[TitleGuard] dropped empty write #${guardedWindow.titleGuardDroppedCount}`);
                return;
            }
            console.log('[TitleGuard] allowed write:', JSON.stringify(value));
            nativeSetter.call(document, value);
        },
    });
    guardedWindow.titleGuardVersion = TITLE_GUARD_VERSION;
    console.log(`[TitleGuard v${  TITLE_GUARD_VERSION  }] installed successfully`);
})();
/* eslint-enable @typescript-eslint/unbound-method, no-console */

/**
 * Set the current page-specific title (called by the `useDocumentTitle` hook).
 *
 * Writes are debounced by 16ms (one frame) to allow navigation transitions to
 * settle. This prevents intermediate title changes from screens that are
 * animating in/out from being visible to the user.
 */
function setPageTitle(title: string) {
    if (title === currentPageTitle) {
        return;
    }
    currentPageTitle = title;
    
    // Cancel any pending update and schedule a new one.
    if (titleUpdateTimeout !== null) {
        clearTimeout(titleUpdateTimeout);
    }
    titleUpdateTimeout = setTimeout(() => {
        updateDocumentTitle();
        titleUpdateTimeout = null;
    }, 16);
}

/**
 * Update `document.title` and the favicon.
 *
 * We write synchronously (no `setTimeout`) and without the legacy
 * `document.title = ''` intermediate assignment. The old dance existed to work
 * around a Chrome back-navigation title bug, but in practice it added a window
 * where a stale `currentPageTitle` (read when the timer fired) could race with
 * React Navigation's focus updates – which caused the tab title to flicker
 * through the previous page's value after pressing back.
 *
 * We also dedupe writes by comparing against the last value we wrote, so the
 * debounced `updateUnread` call that React Navigation triggers on every state
 * change can't cause extra DOM churn when nothing actually changed.
 */
function updateDocumentTitle() {
    const hasUnread = unreadTotalCount !== 0;
    const baseTitle = currentPageTitle || CONFIG.SITE_TITLE;
    const nextTitle = hasUnread ? `(${unreadTotalCount}) ${baseTitle}` : baseTitle;

    if (lastWrittenTitle !== nextTitle) {
        document.title = nextTitle;
        lastWrittenTitle = nextTitle;
    }

    const favicon = document.getElementById('favicon');
    if (favicon instanceof HTMLLinkElement) {
        const nextFaviconHref = hasUnread ? CONFIG.FAVICON.UNREAD : CONFIG.FAVICON.DEFAULT;
        if (lastWrittenFaviconHref !== nextFaviconHref) {
            favicon.href = nextFaviconHref;
            lastWrittenFaviconHref = nextFaviconHref;
        }
    }
}

/**
 * Set the page title on web
 */
const updateUnread: UpdateUnread = (totalCount) => {
    if (totalCount === unreadTotalCount) {
        return;
    }
    unreadTotalCount = totalCount;
    updateDocumentTitle();
};

export default updateUnread;
export {setPageTitle};
