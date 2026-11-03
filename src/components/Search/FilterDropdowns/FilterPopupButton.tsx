import PopoverWithMeasuredContent from '@components/PopoverWithMeasuredContent';
import withViewportOffsetTop from '@components/withViewportOffsetTop';

import useOnyx from '@hooks/useOnyx';
import usePopoverPosition from '@hooks/usePopoverPosition';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import useSafeAreaPaddings from '@hooks/useSafeAreaPaddings';
import useStyleUtils from '@hooks/useStyleUtils';
import useThemeStyles from '@hooks/useThemeStyles';
import useWindowDimensions from '@hooks/useWindowDimensions';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type AnchorAlignment from '@src/types/utils/AnchorAlignment';
import KeyboardUtils from '@src/utils/keyboard';

import type {ComponentRef, ReactNode, RefObject} from 'react';
import type {StyleProp, ViewStyle} from 'react-native';

import {useIsFocused} from '@react-navigation/core';
import {willAlertModalBecomeVisibleSelector} from '@selectors/Modal';
import React, {useRef, useState} from 'react';
import {View} from 'react-native';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';

type PopoverComponentProps = {
    isExpanded: boolean;
    closeOverlay: () => void;
    setPopoverWidth?: (width: number | undefined) => void;
};

type ButtonComponentProps = {
    onPress: () => void;
    ref: RefObject<ComponentRef<typeof View> | null>;
    isExpanded: boolean;
};

type FilterPopupButtonProps = {
    viewportOffsetTop: number;
    wrapperStyle?: StyleProp<ViewStyle>;
    popoverWidth?: number;
    popoverAnchorAlignment?: AnchorAlignment;
    PopoverComponent: (props: PopoverComponentProps) => ReactNode;
    renderButton: (props: ButtonComponentProps) => ReactNode;

    /** Called instead of opening the popover when device is in landscape mode */
    onLandscapePress?: () => void;

    /** Called once the popover has finished opening */
    onModalShow?: () => void;
};

const ANCHOR_ORIGIN = {
    horizontal: CONST.MODAL.ANCHOR_ORIGIN_HORIZONTAL.LEFT,
    vertical: CONST.MODAL.ANCHOR_ORIGIN_VERTICAL.TOP,
};

function FilterPopupButton({
    viewportOffsetTop,
    popoverWidth,
    wrapperStyle,
    popoverAnchorAlignment: popoverAnchorAlignmentProp,
    PopoverComponent,
    renderButton,
    onLandscapePress,
    onModalShow,
}: FilterPopupButtonProps) {
    // We need to use isSmallScreenWidth instead of shouldUseNarrowLayout to distinguish RHP and narrow layout
    // eslint-disable-next-line rulesdir/prefer-shouldUseNarrowLayout-instead-of-isSmallScreenWidth
    const {isSmallScreenWidth, isInLandscapeMode} = useResponsiveLayout();
    const isFocused = useIsFocused();
    const styles = useThemeStyles();
    const {paddingBottom: safeAreaPaddingBottom} = useSafeAreaPaddings(true);
    // On a small screen the popover is a bottom sheet. It makes its own room for the keyboard, in step with the keyboard's
    // animation, the way the selection list sheets do, instead of leaving that to the modal: the modal's avoidance is a
    // padding KeyboardAvoidingView at its root, and on Android it measures its frame inside the modal's Dialog window but
    // places the keyboard against the activity window. Where the Dialog is inset under the status bar (the HybridApp below
    // Android 15) the lift comes up short by the status bar and leaves the Apply button under the keyboard. The keyboard's
    // height is the same in both windows, so a sheet padded by it cannot come up short.
    const shouldPadForKeyboard = isSmallScreenWidth;
    // The keyboard's offset is negative while it is open. It covers the home indicator, so the sheet pads for whichever is
    // taller. The offline indicator is drawn on the page behind the sheet, so no room is kept for one.
    const {height: keyboardOffset} = useReanimatedKeyboardAnimation();
    const keyboardRoomStyle = useAnimatedStyle(() => ({paddingBottom: Math.max(safeAreaPaddingBottom, -keyboardOffset.get())}));
    const StyleUtils = useStyleUtils();
    const {windowHeight} = useWindowDimensions();
    const triggerRef = useRef<ComponentRef<typeof View> | null>(null);
    const anchorRef = useRef<ComponentRef<typeof View> | null>(null);
    const [isOverlayVisible, setIsOverlayVisible] = useState(false);
    // Defer mounting the (potentially heavy) popover content until the dropdown is first opened, then keep it
    // mounted so the close animation and reopening stay instant. The content is otherwise mounted eagerly on
    // screen focus even while hidden, which runs each filter selector's expensive option-building on page load.
    const [hasEverExpanded, setHasEverExpanded] = useState(false);
    const [customPopoverWidth, setCustomPopoverWidth] = useState<number | undefined>(undefined);
    const {calculatePopoverPosition} = usePopoverPosition();

    const [popoverTriggerPosition, setPopoverTriggerPosition] = useState({
        horizontal: 0,
        vertical: 0,
    });

    const [willAlertModalBecomeVisible] = useOnyx(ONYXKEYS.MODAL, {selector: willAlertModalBecomeVisibleSelector});

    const popoverAnchorAlignment = popoverAnchorAlignmentProp ?? ANCHOR_ORIGIN;

    const toggleOverlay = () => {
        setIsOverlayVisible((previousValue) => {
            if (!previousValue && willAlertModalBecomeVisible) {
                return false;
            }

            return !previousValue;
        });
    };

    const calculatePopoverPositionAndToggleOverlay = () => {
        // Dismiss the keyboard before opening the popover. On Android, if a search input is still focused, the
        // keyboard stays up. The bottom-docked sheet then reserves keyboard-height padding, so it renders
        // mid-screen instead of at the bottom. dismissKeyboardAndExecute waits for
        // keyboardDidHide on Android before running the callback; on other platforms it runs immediately.
        KeyboardUtils.dismissKeyboardAndExecute(() => {
            calculatePopoverPosition(anchorRef, popoverAnchorAlignment).then((position) => {
                setPopoverTriggerPosition({...position, vertical: position.vertical});
                // Latch in the same batch as the open (and only when it will actually open, mirroring toggleOverlay's
                // alert-modal guard) so the deferred subtree mounts together with the popover becoming visible.
                if (!isOverlayVisible && !willAlertModalBecomeVisible) {
                    setHasEverExpanded(true);
                }
                toggleOverlay();
            });
        });
    };

    const actualPopoverWidth = customPopoverWidth ?? popoverWidth ?? CONST.POPOVER_DROPDOWN_WIDTH;
    const containerStyles = isSmallScreenWidth ? styles.w100 : {width: actualPopoverWidth};

    const popoverContent = PopoverComponent({closeOverlay: toggleOverlay, isExpanded: isOverlayVisible, setPopoverWidth: setCustomPopoverWidth});

    return (
        <View
            ref={anchorRef}
            style={wrapperStyle}
        >
            {/* Dropdown Trigger */}
            {renderButton({ref: triggerRef, onPress: isInLandscapeMode && onLandscapePress ? onLandscapePress : calculatePopoverPositionAndToggleOverlay, isExpanded: isOverlayVisible})}
            {/* Dropdown overlay. Gated on hasEverExpanded so the (potentially heavy) content subtree isn't mounted
                until the dropdown is first opened — PopoverWithMeasuredContentBase mounts children even while hidden. */}
            {isFocused && hasEverExpanded && (
                <PopoverWithMeasuredContent
                    anchorRef={triggerRef}
                    avoidKeyboard={!shouldPadForKeyboard}
                    isVisible={isOverlayVisible}
                    onClose={toggleOverlay}
                    onModalShow={onModalShow}
                    anchorPosition={popoverTriggerPosition}
                    anchorAlignment={popoverAnchorAlignment}
                    restoreFocusType={CONST.MODAL.RESTORE_FOCUS_TYPE.DELETE}
                    shouldEnableNewFocusManagement
                    shouldMeasureAnchorPositionFromTop={false}
                    outerStyle={{...StyleUtils.getOuterModalStyle(windowHeight, viewportOffsetTop), ...containerStyles}}
                    // This must be false because we dont want the modal to close if we open the RHP for selections
                    // such as date years
                    shouldCloseWhenBrowserNavigationChanged={false}
                    innerContainerStyle={{...containerStyles, ...styles.p0}}
                    popoverDimensions={{
                        width: actualPopoverWidth,
                        height: CONST.POPOVER_DROPDOWN_MIN_HEIGHT,
                    }}
                    shouldSkipRemeasurement
                    shouldDisplayBelowModals
                    shouldWrapModalChildrenInScrollViewIfBottomDockedInLandscapeMode={false}
                    enableEdgeToEdgeBottomSafeAreaPadding
                >
                    <Animated.View style={[containerStyles, shouldPadForKeyboard && keyboardRoomStyle]}>{popoverContent}</Animated.View>
                </PopoverWithMeasuredContent>
            )}
        </View>
    );
}

export type {PopoverComponentProps, ButtonComponentProps, FilterPopupButtonProps};
export default withViewportOffsetTop(FilterPopupButton);
