import type {Emoji} from '@assets/emojis/types';

import BaseMiniContextMenuItem from '@components/BaseMiniContextMenuItem';
import Icon from '@components/Icon';
import Text from '@components/Text';

import useArrowKeyFocusManager from '@hooks/useArrowKeyFocusManager';
import {useMemoizedLazyExpensifyIcons} from '@hooks/useLazyAsset';
import useLocalize from '@hooks/useLocalize';
import useOnyx from '@hooks/useOnyx';
import useStyleUtils from '@hooks/useStyleUtils';
import useSyncFocus from '@hooks/useSyncFocus';
import useThemeStyles from '@hooks/useThemeStyles';

import {getLocalizedEmojiName, getPreferredEmojiCode} from '@libs/EmojiUtils';
import getButtonState from '@libs/getButtonState';
import getHadTabNavigation from '@libs/hadTabNavigation';
import mergeRefs from '@libs/mergeRefs';

import variables from '@styles/variables';

import {emojiPickerRef, showEmojiPicker} from '@userActions/EmojiPickerAction';
import {callFunctionIfActionIsAllowed} from '@userActions/Session';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {ReportActionReactions} from '@src/types/onyx';
import {getEmptyObject} from '@src/types/utils/EmptyObject';

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View} from 'react-native';

import type {BaseQuickEmojiReactionsProps} from './QuickEmojiReactions/types';

type MiniQuickEmojiReactionsProps = BaseQuickEmojiReactionsProps & {
    /**
     * Will be called when the user closed the emoji picker
     * without selecting an emoji.
     */
    onEmojiPickerClosed?: () => void;
};

/**
 * Shows the four common quick reactions and a
 * emoji picker icon button. This is used for the mini
 * context menu which we just show on web, when hovering
 * a message.
 */
function MiniQuickEmojiReactions({reportAction, reportActionID, onEmojiSelected, onPressOpenPicker = () => {}, onEmojiPickerClosed = () => {}}: MiniQuickEmojiReactionsProps) {
    const icons = useMemoizedLazyExpensifyIcons(['AddReaction']);
    const styles = useThemeStyles();
    const StyleUtils = useStyleUtils();
    const ref = useRef<View>(null);
    const {translate, preferredLocale} = useLocalize();
    const [preferredSkinTone = CONST.EMOJI_DEFAULT_SKIN_TONE] = useOnyx(ONYXKEYS.PREFERRED_EMOJI_SKIN_TONE);
    const [emojiReactions = getEmptyObject<ReportActionReactions>()] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS_REACTIONS}${reportActionID}`);

    const quickReactions = CONST.QUICK_REACTIONS.slice(0, 3);

    // This row mounts as soon as a report action is merely hovered (see ReportActionItem), not when it
    // receives keyboard focus, and a mouse click can land DOM focus on a button too - BaseMiniContextMenuItem
    // only calls preventDefault() on mousedown while the composer is focused, and the pressable is
    // tabIndex={0} on web. So the arrow-key manager is gated on both: a button in this row holds focus, and
    // that focus arrived from the keyboard. Without the first condition, merely resting the mouse on a message
    // would hijack arrow keys app-wide (including the composer's text cursor); without the second, a plain
    // mouse click on a reaction would start arrow navigation across the row.
    const [isRowFocused, setIsRowFocused] = useState(false);
    const [isKeyboardModality, setIsKeyboardModality] = useState(false);

    // Refs used to move real DOM focus onto the focused item, kept separate from `ref` above (the existing
    // popover anchor for the full emoji picker on the "add reaction" button) since a single ref can only
    // track one consumer.
    const firstQuickReactionRef = useRef<View>(null);
    const secondQuickReactionRef = useRef<View>(null);
    const thirdQuickReactionRef = useRef<View>(null);
    const addReactionFocusRef = useRef<View>(null);
    const quickReactionRefs = [firstQuickReactionRef, secondQuickReactionRef, thirdQuickReactionRef];

    // Roving arrow-key focus across the 3 quick reactions (indexes 0-2) plus the "add reaction" button (index
    // 3), the same pairing (useArrowKeyFocusManager + useSyncFocus) used elsewhere in the app for this pattern.
    const [focusedIndex, setFocusedIndex] = useArrowKeyFocusManager({
        initialFocusedIndex: -1,
        maxIndex: quickReactions.length,
        allowHorizontalArrowKeys: true,
        isActive: isRowFocused && isKeyboardModality,
    });

    // Hooks must be called an unconditional, fixed number of times, so each item gets its own useSyncFocus
    // call rather than looping over quickReactionRefs.
    useSyncFocus(firstQuickReactionRef, focusedIndex === 0);
    useSyncFocus(secondQuickReactionRef, focusedIndex === 1);
    useSyncFocus(thirdQuickReactionRef, focusedIndex === 2);
    useSyncFocus(addReactionFocusRef, focusedIndex === quickReactions.length);

    const onItemFocus = useCallback(
        (index: number) => {
            // hadTabNavigation's pointerdown/mousedown listeners are registered on document in the capture
            // phase, so for a mouse click the flag is already false by the time this focus event fires.
            // Focus that arrived from a click therefore never arms the arrow keys.
            const isKeyboard = getHadTabNavigation();
            setIsKeyboardModality(isKeyboard);
            setIsRowFocused(true);
            if (isKeyboard) {
                setFocusedIndex(index);
            }
        },
        [setFocusedIndex],
    );

    const onItemBlur = useCallback(() => setIsRowFocused(false), []);

    // Clicking a button that is already keyboard-focused fires no new focus event, so onItemFocus alone would
    // never see the modality flip. Disarm on pointerdown while the row is armed.
    useEffect(() => {
        if (!isRowFocused || !isKeyboardModality || typeof document === 'undefined') {
            return;
        }
        const disarm = () => setIsKeyboardModality(false);
        document.addEventListener('pointerdown', disarm, true);
        return () => document.removeEventListener('pointerdown', disarm, true);
    }, [isRowFocused, isKeyboardModality]);

    const selectEmojiWithReaction = useCallback(
        (emoji: Emoji, skinTone: number) => {
            onEmojiSelected(emoji, emojiReactions, skinTone);
        },
        [onEmojiSelected, emojiReactions],
    );

    const openEmojiPicker = () => {
        onPressOpenPicker();
        showEmojiPicker({
            onModalHide: onEmojiPickerClosed,
            onEmojiSelected: (_emojiCode, emojiObject, skinTone) => {
                selectEmojiWithReaction(emojiObject, skinTone);
            },
            emojiPopoverAnchor: ref,
            id: reportAction.reportActionID,
        });
    };

    return (
        <View style={styles.flexRow}>
            {quickReactions.map((emoji: Emoji, index: number) => (
                <BaseMiniContextMenuItem
                    key={emoji.name}
                    ref={quickReactionRefs[index]}
                    isDelayButtonStateComplete={false}
                    tooltipText={`:${getLocalizedEmojiName(emoji.name, preferredLocale)}:`}
                    onPress={callFunctionIfActionIsAllowed(() => onEmojiSelected(emoji, emojiReactions, preferredSkinTone))}
                    onFocus={() => onItemFocus(index)}
                    onBlur={onItemBlur}
                    sentryLabel={CONST.SENTRY_LABEL.MINI_CONTEXT_MENU.QUICK_REACTION}
                >
                    <Text
                        style={[styles.miniQuickEmojiReactionText, styles.userSelectNone]}
                        dataSet={{[CONST.SELECTION_SCRAPER_HIDDEN_ELEMENT]: true}}
                    >
                        {getPreferredEmojiCode(emoji, preferredSkinTone)}
                    </Text>
                </BaseMiniContextMenuItem>
            ))}
            <BaseMiniContextMenuItem
                ref={mergeRefs(ref, addReactionFocusRef)}
                onPress={callFunctionIfActionIsAllowed(() => {
                    if (!emojiPickerRef.current?.isEmojiPickerVisible) {
                        openEmojiPicker();
                    } else {
                        emojiPickerRef.current?.hideEmojiPicker();
                    }
                })}
                onFocus={() => onItemFocus(quickReactions.length)}
                onBlur={onItemBlur}
                isDelayButtonStateComplete={false}
                tooltipText={translate('emojiReactions.addReactionTooltip')}
                sentryLabel={CONST.SENTRY_LABEL.MINI_CONTEXT_MENU.EMOJI_PICKER_BUTTON}
            >
                {({hovered, pressed}) => (
                    <Icon
                        width={variables.iconSizeMedium}
                        height={variables.iconSizeMedium}
                        src={icons.AddReaction}
                        fill={StyleUtils.getIconFillColor(getButtonState(hovered, pressed, false))}
                    />
                )}
            </BaseMiniContextMenuItem>
        </View>
    );
}

export default MiniQuickEmojiReactions;
