import {emojiNameTable} from '@assets/emojis';
import type {Emoji} from '@assets/emojis/types';

import PressableWithFeedback from '@components/Pressable/PressableWithFeedback';
import ActionableItemButtons from '@components/ReportActionItem/ActionableItemButtons';
import Text from '@components/Text';

import useCurrentUserPersonalDetails from '@hooks/useCurrentUserPersonalDetails';
import useLocalize from '@hooks/useLocalize';
import useOnyx from '@hooks/useOnyx';
import useStyleUtils from '@hooks/useStyleUtils';
import useThemeStyles from '@hooks/useThemeStyles';

import {getPreferredEmojiCode, hasAccountIDEmojiReacted} from '@libs/EmojiUtils';

import {toggleEmojiReaction} from '@userActions/EmojiReactions';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {ReportAction} from '@src/types/onyx';

import React, {useEffect, useState} from 'react';

/** How long the "Thanks for the feedback!" acknowledgement stays on screen after a 👍 */
const THANKS_MESSAGE_DURATION_MS = 3000;

const THUMBS_UP_EMOJI: Emoji = emojiNameTable[CONST.EMOJI_REACTION_NAME.THUMBS_UP];
const THUMBS_DOWN_EMOJI: Emoji = emojiNameTable[CONST.EMOJI_REACTION_NAME.THUMBS_DOWN];

type ConciergeFeedbackPromptProps = {
    /** The Concierge report action the prompt is rendered under */
    action: ReportAction;

    /** Report ID for the current report */
    reportID: string | undefined;
};

function ConciergeFeedbackPrompt({action, reportID}: ConciergeFeedbackPromptProps) {
    const styles = useThemeStyles();
    const StyleUtils = useStyleUtils();
    const {translate} = useLocalize();
    const {accountID: currentUserAccountID} = useCurrentUserPersonalDetails();

    const [preferredSkinTone = CONST.EMOJI_DEFAULT_SKIN_TONE] = useOnyx(ONYXKEYS.PREFERRED_EMOJI_SKIN_TONE);
    const [emojiReactions] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS_REACTIONS}${action.reportActionID}`);
    const [reportActions] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`);

    const [shouldShowThanks, setShouldShowThanks] = useState(false);

    useEffect(() => {
        if (!shouldShowThanks) {
            return;
        }

        const timeoutID = setTimeout(() => setShouldShowThanks(false), THANKS_MESSAGE_DURATION_MS);
        return () => clearTimeout(timeoutID);
    }, [shouldShowThanks]);

    /**
     * A reaction can be stored under either the legacy name key or the canonical hex key, so both are
     * checked here the same way toggleEmojiReaction does when it decides which entry to remove.
     */
    const hasReactedWith = (emoji: Emoji) => {
        const nameEntry = emojiReactions?.[emoji.name];
        const hexEntry = emoji.hexcode ? emojiReactions?.[emoji.hexcode] : undefined;

        return (!!nameEntry && hasAccountIDEmojiReacted(currentUserAccountID, nameEntry.users)) || (!!hexEntry && hasAccountIDEmojiReacted(currentUserAccountID, hexEntry.users));
    };

    const react = (emoji: Emoji, shouldThank: boolean) => {
        toggleEmojiReaction(reportID, action, emoji, emojiReactions, preferredSkinTone, currentUserAccountID, reportActions);

        if (!shouldThank) {
            return;
        }

        setShouldShowThanks(true);
    };

    if (shouldShowThanks) {
        return (
            <ActionableItemButtons
                layout="horizontal"
                style={[styles.alignItemsCenter, styles.gap1]}
            >
                <Text style={[styles.textSupporting, styles.userSelectNone]}>{translate('conciergeFeedback.thanks')}</Text>
            </ActionableItemButtons>
        );
    }

    // Once the user has reacted with either thumb the prompt is done - the reaction itself is the
    // persisted state, so nothing extra needs to be stored to keep it hidden across reloads.
    if (hasReactedWith(THUMBS_UP_EMOJI) || hasReactedWith(THUMBS_DOWN_EMOJI)) {
        return null;
    }

    return (
        <ActionableItemButtons
            layout="horizontal"
            style={[styles.alignItemsCenter, styles.gap1]}
        >
            <Text style={[styles.textSupporting, styles.userSelectNone]}>{translate('conciergeFeedback.prompt')}</Text>
            <PressableWithFeedback
                onPress={() => react(THUMBS_UP_EMOJI, true)}
                style={styles.conciergeFeedbackButton}
                hoverStyle={styles.conciergeFeedbackButtonHovered}
                pressStyle={styles.conciergeFeedbackButtonHovered}
                hoverDimmingValue={1}
                role={CONST.ROLE.BUTTON}
                accessibilityLabel={translate('conciergeFeedback.thumbsUp')}
                sentryLabel={CONST.SENTRY_LABEL.CONCIERGE_FEEDBACK.THUMBS_UP}
                dataSet={{[CONST.SELECTION_SCRAPER_HIDDEN_ELEMENT]: true}}
            >
                <Text style={[styles.emojiReactionBubbleText, StyleUtils.getEmojiReactionBubbleTextStyle(), styles.userSelectNone]}>
                    {getPreferredEmojiCode(THUMBS_UP_EMOJI, preferredSkinTone)}
                </Text>
            </PressableWithFeedback>
            <PressableWithFeedback
                onPress={() => react(THUMBS_DOWN_EMOJI, false)}
                style={styles.conciergeFeedbackButton}
                hoverStyle={styles.conciergeFeedbackButtonHovered}
                pressStyle={styles.conciergeFeedbackButtonHovered}
                hoverDimmingValue={1}
                role={CONST.ROLE.BUTTON}
                accessibilityLabel={translate('conciergeFeedback.thumbsDown')}
                sentryLabel={CONST.SENTRY_LABEL.CONCIERGE_FEEDBACK.THUMBS_DOWN}
                dataSet={{[CONST.SELECTION_SCRAPER_HIDDEN_ELEMENT]: true}}
            >
                <Text style={[styles.emojiReactionBubbleText, StyleUtils.getEmojiReactionBubbleTextStyle(), styles.userSelectNone]}>
                    {getPreferredEmojiCode(THUMBS_DOWN_EMOJI, preferredSkinTone)}
                </Text>
            </PressableWithFeedback>
        </ActionableItemButtons>
    );
}

export default ConciergeFeedbackPrompt;
