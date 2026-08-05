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
import mergeRefs from '@libs/mergeRefs';

import variables from '@styles/variables';

import {emojiPickerRef, showEmojiPicker} from '@userActions/EmojiPickerAction';
import {callFunctionIfActionIsAllowed} from '@userActions/Session';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {ReportActionReactions} from '@src/types/onyx';
import {getEmptyObject} from '@src/types/utils/EmptyObject';

import React, {useCallback, useRef, useState} from 'react';
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
    // receives keyboard focus. Gate the arrow-key manager on the row actually holding focus so that hovering
    // a message with the mouse can't hijack arrow keys elsewhere on the page (e.g. the composer's text
    // cursor) - it only becomes active once the user has tabbed into one of this row's own buttons.
    const [isRowFocused, setIsRowFocused] = useState(false);

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
        isActive: isRowFocused,
    });

    // Hooks must be called an unconditional, fixed number of times, so each item gets its own useSyncFocus
    // call rather than looping over quickReactionRefs.
    useSyncFocus(firstQuickReactionRef, focusedIndex === 0);
    useSyncFocus(secondQuickReactionRef, focusedIndex === 1);
    useSyncFocus(thirdQuickReactionRef, focusedIndex === 2);
    useSyncFocus(addReactionFocusRef, focusedIndex === quickReactions.length);

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
                    onFocus={() => {
                        setIsRowFocused(true);
                        setFocusedIndex(index);
                    }}
                    onBlur={() => setIsRowFocused(false)}
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
                onFocus={() => {
                    setIsRowFocused(true);
                    setFocusedIndex(quickReactions.length);
                }}
                onBlur={() => setIsRowFocused(false)}
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
