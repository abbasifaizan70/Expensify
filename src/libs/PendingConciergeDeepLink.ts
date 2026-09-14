import {registerSessionCleanupCallback} from './SessionCleanup';

/**
 * Carries a `/concierge` deep link across the onboarding gap, in memory.
 *
 * A deep link opened by a signed-out user is captured before sign-up, and `openReportFromDeepLink` deliberately
 * drops links captured before onboarding finished so they can't flash the "Not here" page once
 * `navigateAfterOnboarding` picks the real destination (#91437). `navigateAfterOnboarding` has no way of knowing
 * the user asked for Concierge, so for a fresh sign-up that intent is lost and the account lands on Home (#99940).
 *
 * `openReportFromDeepLink` records the intent as soon as it captures the onboarding flag — not where it drops the
 * link, which by then is unreachable: the drop only runs once onboarding completes, and at that moment the
 * onboarding screen is still focused, so an earlier guard returns first and the subscription has already been
 * disconnected. `navigateAfterOnboarding`, which already owns the post-onboarding destination, consumes it exactly
 * once. The flag is module-level rather than an Onyx key because it describes a single in-flight navigation, not
 * account state: there is nothing to persist, migrate, or replay as a stale destination in a later session.
 */
let hasPendingConciergeDeepLink = false;

/** Records that a signed-out user asked for Concierge before they had onboarded. */
function setPendingConciergeDeepLink() {
    hasPendingConciergeDeepLink = true;
}

/** Returns whether a Concierge deep link is pending, clearing it so the intent is honored exactly once. */
function consumePendingConciergeDeepLink(): boolean {
    const isPending = hasPendingConciergeDeepLink;
    hasPendingConciergeDeepLink = false;
    return isPending;
}

/** Drops an unconsumed intent so it can't leak into the next account signed in to this session. */
function clearPendingConciergeDeepLink() {
    hasPendingConciergeDeepLink = false;
}

registerSessionCleanupCallback(clearPendingConciergeDeepLink);

export {setPendingConciergeDeepLink, consumePendingConciergeDeepLink, clearPendingConciergeDeepLink};
