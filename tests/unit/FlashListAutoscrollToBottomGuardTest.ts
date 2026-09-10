import {renderHook} from '@testing-library/react-native';

import {useBoundDetection} from '@shopify/flash-list/dist/recyclerview/hooks/useBoundDetection';

/**
 * Regression coverage for patch `@shopify+flash-list+2.3.0+017+fix-autoscroll-to-bottom-overriding-scroll-to-index`
 * (backport of https://github.com/Shopify/flash-list/pull/2290).
 *
 * `useBoundDetection` latches `pendingAutoscrollToBottom` when the viewport sits at the physical end of the content and
 * consumes that latch on the next data / content-size change by calling `scrollToEnd()`. While a programmatic
 * `scrollToIndex` owns the offset (FlashList disables offset projection for the whole scroll), that `scrollToEnd()` must
 * not fire, otherwise it drags the list away from the index the caller asked for. On the App's inverted chat lists the
 * physical end is the oldest-message side, which is exactly how a sent message ended up off-screen (issue #99559).
 */

type ScrollViewStub = {scrollToEnd: jest.Mock};

type ManagerStubOptions = {
    windowHeight: number;
    contentHeight: number;
    scrollOffset: number;
    autoscrollToBottomThreshold?: number;
};

// Mirrors the RecyclerViewManager surface `useBoundDetection` reads. Kept mutable so a test can move the offset or
// toggle offset projection between renders exactly like the real manager does.
function createManagerStub({windowHeight, contentHeight, scrollOffset, autoscrollToBottomThreshold = 0}: ManagerStubOptions) {
    const state = {
        offset: scrollOffset,
        contentHeight,
        isOffsetProjectionEnabled: true,
        data: [{id: 1}, {id: 2}, {id: 3}],
    };
    const manager = {
        get props() {
            return {
                data: state.data,
                maintainVisibleContentPosition: {autoscrollToBottomThreshold, animateAutoScrollToBottom: false},
            };
        },
        get isOffsetProjectionEnabled() {
            return state.isOffsetProjectionEnabled;
        },
        ignoreScrollEvents: false,
        firstItemOffset: 0,
        hasLayout: () => true,
        getIsFirstLayoutComplete: () => true,
        getWindowSize: () => ({width: 360, height: windowHeight}),
        getChildContainerDimensions: () => ({width: 360, height: state.contentHeight}),
        getAbsoluteLastScrollOffset: () => state.offset,
    };
    return {manager, state};
}

function renderBoundDetection(manager: ReturnType<typeof createManagerStub>['manager'], scrollView: ScrollViewStub) {
    const scrollViewRef = {current: scrollView};
    // The hook only reads manager / ref identity, so a stable wrapper is enough to drive re-renders.
    return renderHook(() => useBoundDetection(manager as never, scrollViewRef as never));
}

describe('FlashList useBoundDetection – autoscroll-to-bottom vs programmatic scrollToIndex', () => {
    const WINDOW_HEIGHT = 720;
    const CONTENT_HEIGHT = 2720;
    const OFFSET_AT_PHYSICAL_END = CONTENT_HEIGHT - WINDOW_HEIGHT;

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function armLatchAtPhysicalEnd() {
        const scrollView: ScrollViewStub = {scrollToEnd: jest.fn()};
        const {manager, state} = createManagerStub({windowHeight: WINDOW_HEIGHT, contentHeight: CONTENT_HEIGHT, scrollOffset: OFFSET_AT_PHYSICAL_END});
        const hook = renderBoundDetection(manager, scrollView);
        // The mount effect already ran a check with nothing pending; the user is parked at the physical end
        // (the visual top of an inverted chat), so the next scroll event latches the autoscroll flag.
        hook.result.current.checkBounds();
        return {scrollView, manager, state, hook};
    }

    it('does not call scrollToEnd while a programmatic scroll owns the offset', () => {
        const {scrollView, state, hook} = armLatchAtPhysicalEnd();

        // scrollToIndex({index: 0}) starts: FlashList disables offset projection for the whole scroll
        state.isOffsetProjectionEnabled = false;
        state.offset = 0;

        // The sent message arrives as a data change while that scroll is in flight
        state.data = [{id: 0}, ...state.data];
        hook.rerender(undefined);
        jest.runAllTimers();

        // Then the latched autoscroll must not override the explicit scroll target
        expect(scrollView.scrollToEnd).not.toHaveBeenCalled();
    });

    it('still calls scrollToEnd when nothing owns the offset (ordinary bottom-stick is unchanged)', () => {
        const {scrollView, state, hook} = armLatchAtPhysicalEnd();

        // A data change with no programmatic scroll in flight
        state.data = [{id: 0}, ...state.data];
        hook.rerender(undefined);
        jest.runAllTimers();

        expect(scrollView.scrollToEnd).toHaveBeenCalledTimes(1);
        expect(scrollView.scrollToEnd).toHaveBeenCalledWith({animated: false});
    });

    it('does not fire a frame that was queued before the programmatic scroll started', () => {
        const {scrollView, state, hook} = armLatchAtPhysicalEnd();

        // The data-change effect queues scrollToEnd for the next frame…
        state.data = [{id: 0}, ...state.data];
        hook.rerender(undefined);

        // …and scrollToIndex begins before that frame fires
        state.isOffsetProjectionEnabled = false;
        state.offset = 0;
        jest.runAllTimers();

        expect(scrollView.scrollToEnd).not.toHaveBeenCalled();
    });

    it('drops the latch once a bounds check runs at the new offset, so nothing fires after the scroll settles', () => {
        const {scrollView, state, hook} = armLatchAtPhysicalEnd();

        state.isOffsetProjectionEnabled = false;
        state.offset = 0;
        state.data = [{id: 0}, ...state.data];
        hook.rerender(undefined);
        jest.runAllTimers();
        expect(scrollView.scrollToEnd).not.toHaveBeenCalled();

        // The landed scroll reports its offset and the scroll settles (projection re-enabled)
        hook.result.current.checkBounds();
        state.isOffsetProjectionEnabled = true;

        // A later content change (e.g. the server confirming the optimistic action) must not yank the list
        state.contentHeight += 36;
        hook.rerender(undefined);
        jest.runAllTimers();

        expect(scrollView.scrollToEnd).not.toHaveBeenCalled();
    });
});
