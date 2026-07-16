import useConfirmModal from '@hooks/useConfirmModal';
import useCurrentUserPersonalDetails from '@hooks/useCurrentUserPersonalDetails';
import useDebouncedState from '@hooks/useDebouncedState';
import {useMemoizedLazyExpensifyIcons} from '@hooks/useLazyAsset';
import useLocalize from '@hooks/useLocalize';
import useNetwork from '@hooks/useNetwork';
import useOnyx from '@hooks/useOnyx';
import useTheme from '@hooks/useTheme';
import useThemeStyles from '@hooks/useThemeStyles';
import useWindowDimensions from '@hooks/useWindowDimensions';

import {clearDelegatorErrors, connect, disconnect} from '@libs/actions/Delegate';
import {close} from '@libs/actions/Modal';
import {getLatestError} from '@libs/ErrorUtils';
import {getGpsPoints, stopGpsTrip} from '@libs/GPSDraftDetailsUtils';
import {sortAlphabetically} from '@libs/OptionsListUtils';
import {getPersonalDetailByEmail} from '@libs/PersonalDetailsUtils';
import tokenizedSearch from '@libs/tokenizedSearch';

import TextWithEmojiFragment from '@pages/inbox/report/comment/TextWithEmojiFragment';

import variables from '@styles/variables';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import {isTrackingSelector} from '@src/selectors/GPSDraftDetails';
import type {PersonalDetails} from '@src/types/onyx';
import type {Errors} from '@src/types/onyx/OnyxCommon';

import {accountIDSelector} from '@selectors/Session';
import {Str} from 'expensify-common';
import React, {useRef, useState} from 'react';
import {View} from 'react-native';

import type {ListItem} from './SelectionList/types';

import Avatar from './Avatar';
import Badge from './Badge';
import Icon from './Icon';
import {ModalActions} from './Modal/Global/ModalContext';
import PopoverWithMeasuredContent from './PopoverWithMeasuredContent';
import {PressableWithFeedback} from './Pressable';
import {useProductTrainingContext} from './ProductTrainingContext';
import SelectionList from './SelectionList';
import SingleSelectWithAvatarListItem from './SelectionList/ListItem/SingleSelectWithAvatarListItem';
import Text from './Text';
import Tooltip from './Tooltip';
import EducationalTooltip from './Tooltip/EducationalTooltip';

type SwitcherListItem = ListItem & {
    /** Called when the row is selected */
    onSelected?: () => void;
};

type AccountSwitcherProps = {
    /* Whether the screen is focused. Used to hide the product training tooltip */
    isScreenFocused: boolean;
};

function AccountSwitcher({isScreenFocused}: AccountSwitcherProps) {
    const icons = useMemoizedLazyExpensifyIcons(['CaretUpDown', 'Checkmark']);
    const currentUserPersonalDetails = useCurrentUserPersonalDetails();
    const styles = useThemeStyles();
    const theme = useTheme();
    const {localeCompare, translate, formatPhoneNumber} = useLocalize();
    const {isOffline} = useNetwork();
    const [account] = useOnyx(ONYXKEYS.ACCOUNT);
    const [accountID] = useOnyx(ONYXKEYS.SESSION, {selector: accountIDSelector});
    const [isDebugModeEnabled] = useOnyx(ONYXKEYS.IS_DEBUG_MODE_ENABLED);
    const [credentials] = useOnyx(ONYXKEYS.CREDENTIALS);
    const [stashedCredentials = CONST.EMPTY_OBJECT] = useOnyx(ONYXKEYS.STASHED_CREDENTIALS);
    const [isTrackingGPS = false] = useOnyx(ONYXKEYS.GPS_DRAFT_DETAILS, {selector: isTrackingSelector});
    const [session] = useOnyx(ONYXKEYS.SESSION);
    const [stashedSession] = useOnyx(ONYXKEYS.STASHED_SESSION);
    const [activePolicyID] = useOnyx(ONYXKEYS.NVP_ACTIVE_POLICY_ID);
    const [gpsDraftDetails] = useOnyx(ONYXKEYS.GPS_DRAFT_DETAILS);

    const buttonRef = useRef<HTMLDivElement>(null);
    const {windowHeight} = useWindowDimensions();

    const [shouldShowDelegatorMenu, setShouldShowDelegatorMenu] = useState(false);
    const [searchValue, debouncedSearchValue, setSearchValue] = useDebouncedState('');
    const delegators = account?.delegatedAccess?.delegators ?? [];

    const isActingAsDelegate = !!account?.delegatedAccess?.delegate;
    const canSwitchAccounts = delegators.length > 0 || isActingAsDelegate;
    const displayName = currentUserPersonalDetails?.displayName ?? '';
    const doesDisplayNameContainEmojis = new RegExp(CONST.REGEX.EMOJIS, CONST.REGEX.EMOJIS.flags.concat('g')).test(displayName);

    const {shouldShowProductTrainingTooltip, renderProductTrainingTooltip, hideProductTrainingTooltip} = useProductTrainingContext(
        CONST.PRODUCT_TRAINING_TOOLTIP_NAMES.ACCOUNT_SWITCHER,
        isScreenFocused && canSwitchAccounts,
    );

    const {showConfirmModal} = useConfirmModal();

    const showOfflineModal = () => {
        showConfirmModal({
            title: translate('common.youAppearToBeOffline'),
            prompt: translate('common.offlinePrompt'),
            confirmText: translate('common.buttonConfirm'),
            shouldShowCancelButton: false,
        });
    };

    const showGpsInProgressModal = async (switchAccount: () => ReturnType<typeof connect | typeof disconnect>) => {
        const result = await showConfirmModal({
            title: translate('gps.switchAccountWarningTripInProgress.title'),
            prompt: translate('gps.switchAccountWarningTripInProgress.prompt'),
            confirmText: translate('gps.switchAccountWarningTripInProgress.confirm'),
            cancelText: translate('common.cancel'),
        });

        if (result.action !== ModalActions.CONFIRM) {
            return;
        }

        await stopGpsTrip(false, getGpsPoints(gpsDraftDetails), true);

        switchAccount();
    };

    const onPressSwitcher = () => {
        hideProductTrainingTooltip();
        setShouldShowDelegatorMenu(!shouldShowDelegatorMenu);
    };

    const TooltipToRender = shouldShowProductTrainingTooltip ? EducationalTooltip : Tooltip;
    const tooltipProps = shouldShowProductTrainingTooltip
        ? {
              shouldRender: shouldShowProductTrainingTooltip,
              renderTooltipContent: renderProductTrainingTooltip,
              anchorAlignment: {
                  horizontal: CONST.MODAL.ANCHOR_ORIGIN_HORIZONTAL.LEFT,
                  vertical: CONST.MODAL.ANCHOR_ORIGIN_VERTICAL.TOP,
              },
              shiftVertical: variables.accountSwitcherTooltipShiftVertical,
              shiftHorizontal: variables.accountSwitcherTooltipShiftHorizontal,
              wrapperStyle: styles.productTrainingTooltipWrapper,
              onTooltipPress: onPressSwitcher,
          }
        : {
              text: translate('delegate.copilotAccess'),
              shiftVertical: 8,
              shiftHorizontal: 8,
              anchorAlignment: {horizontal: CONST.MODAL.ANCHOR_ORIGIN_HORIZONTAL.LEFT, vertical: CONST.MODAL.ANCHOR_ORIGIN_VERTICAL.BOTTOM},
              shouldRender: canSwitchAccounts,
          };

    // Show the search input once the copilot count reaches the standard threshold, matching the rest of the app
    const shouldShowSearchInput = !isActingAsDelegate && delegators.length >= CONST.STANDARD_LIST_ITEM_LIMIT;

    const createBaseListItem = (personalDetails: PersonalDetails | undefined, errors?: Errors, additionalProps: Partial<SwitcherListItem> = {}): SwitcherListItem => {
        const login = personalDetails?.login ?? '';
        return {
            text: formatPhoneNumber(personalDetails?.displayName ?? login),
            alternateText: Str.removeSMSDomain(login),
            keyForList: login || String(personalDetails?.accountID ?? CONST.DEFAULT_NUMBER_ID),
            login,
            accountID: personalDetails?.accountID ?? CONST.DEFAULT_NUMBER_ID,
            icons: [
                {
                    source: personalDetails?.avatar ?? '',
                    name: personalDetails?.displayName ?? login,
                    type: CONST.ICON_TYPE_AVATAR,
                    id: personalDetails?.accountID,
                    fallbackIcon: personalDetails?.fallbackIcon,
                },
            ],
            errors,
            ...additionalProps,
        };
    };

    const getSwitcherItems = (): SwitcherListItem[] => {
        const currentUserItem = createBaseListItem(currentUserPersonalDetails, undefined, {isSelected: true});

        if (isActingAsDelegate) {
            const delegateEmail = account?.delegatedAccess?.delegate ?? '';

            // Avoid duplicating the current user in the list when switching accounts
            if (delegateEmail === currentUserPersonalDetails.login) {
                return [currentUserItem];
            }

            const delegatePersonalDetails = getPersonalDetailByEmail(delegateEmail);
            const error = getLatestError(account?.delegatedAccess?.errorFields?.disconnect);

            return [
                createBaseListItem(delegatePersonalDetails ?? ({login: delegateEmail} as PersonalDetails), error, {
                    onSelected: () => {
                        if (isOffline) {
                            close(showOfflineModal);
                            return;
                        }

                        if (isTrackingGPS) {
                            close(() => showGpsInProgressModal(() => disconnect({stashedCredentials, stashedSession})));
                            return;
                        }

                        disconnect({stashedCredentials, stashedSession});
                    },
                }),
                currentUserItem,
            ];
        }

        const delegatorItems: SwitcherListItem[] = sortAlphabetically(
            delegators
                .filter(({email}) => email !== currentUserPersonalDetails.login)
                .map(({email, role}) => {
                    const errorFields = account?.delegatedAccess?.errorFields ?? {};
                    const error = getLatestError(errorFields?.connect?.[email]);
                    const personalDetails = getPersonalDetailByEmail(email);
                    // Fall back to the delegator's email so the row stays labeled (and searchable) even before personal details load
                    return createBaseListItem(personalDetails ?? ({login: email} as PersonalDetails), error, {
                        rightElement: <Badge text={translate('delegate.role', {role})} />,
                        onSelected: () => {
                            if (isOffline) {
                                close(showOfflineModal);
                                return;
                            }
                            if (isTrackingGPS) {
                                close(() => showGpsInProgressModal(() => connect({email, delegatedAccess: account?.delegatedAccess, credentials, session, activePolicyID})));
                                return;
                            }
                            connect({email, delegatedAccess: account?.delegatedAccess, credentials, session, activePolicyID});
                        },
                    });
                }),
            'text',
            localeCompare,
        );

        // Filter only the delegator rows so the current-user row stays pinned at the top
        const filteredDelegatorItems = shouldShowSearchInput ? tokenizedSearch(delegatorItems, debouncedSearchValue, (item) => [item.text ?? '', item.alternateText ?? '']) : delegatorItems;

        return [currentUserItem, ...filteredDelegatorItems];
    };

    const switcherItems = getSwitcherItems();
    const headerMessage = shouldShowSearchInput && !!debouncedSearchValue.trim() && switcherItems.length === 1 ? translate('common.noResultsFound') : undefined;

    const hideDelegatorMenu = () => {
        setShouldShowDelegatorMenu(false);
        setSearchValue('');
        clearDelegatorErrors({delegatedAccess: account?.delegatedAccess});
    };

    return (
        <>
            <TooltipToRender {...tooltipProps}>
                <PressableWithFeedback
                    accessible
                    accessibilityLabel={`${translate('common.profile')}, ${displayName}, ${Str.removeSMSDomain(currentUserPersonalDetails?.login ?? '')}`}
                    onPress={onPressSwitcher}
                    ref={buttonRef}
                    interactive={canSwitchAccounts}
                    pressDimmingValue={canSwitchAccounts ? undefined : 1}
                    wrapperStyle={[styles.flexGrow1, styles.flex1, styles.mnw0, styles.justifyContentCenter]}
                    sentryLabel={CONST.SENTRY_LABEL.ACCOUNT_SWITCHER.SHOW_ACCOUNTS}
                >
                    <View style={[styles.flexRow, styles.gap3, styles.alignItemsCenter]}>
                        <Avatar
                            type={CONST.ICON_TYPE_AVATAR}
                            size={CONST.AVATAR_SIZE.DEFAULT}
                            avatarID={currentUserPersonalDetails?.accountID}
                            source={currentUserPersonalDetails?.avatar}
                            fallbackIcon={currentUserPersonalDetails.fallbackIcon}
                        />
                        <View style={[styles.flex1, styles.flexShrink1, styles.flexBasis0, styles.justifyContentCenter, styles.gap1]}>
                            <View style={[styles.flexRow, styles.gap1]}>
                                {doesDisplayNameContainEmojis ? (
                                    <Text numberOfLines={1}>
                                        <TextWithEmojiFragment
                                            message={displayName}
                                            style={[styles.textBold, styles.textLarge, styles.flexShrink1, styles.lineHeightXLarge]}
                                        />
                                    </Text>
                                ) : (
                                    <Text
                                        numberOfLines={1}
                                        style={[styles.textBold, styles.textLarge, styles.flexShrink1, styles.lineHeightXLarge]}
                                    >
                                        {formatPhoneNumber(displayName)}
                                    </Text>
                                )}
                                {!!canSwitchAccounts && (
                                    <View style={styles.justifyContentCenter}>
                                        <Icon
                                            fill={theme.icon}
                                            src={icons.CaretUpDown}
                                            height={variables.iconSizeSmall}
                                            width={variables.iconSizeSmall}
                                        />
                                    </View>
                                )}
                            </View>
                            <Text
                                numberOfLines={1}
                                style={[styles.colorMuted, styles.fontSizeLabel]}
                            >
                                {Str.removeSMSDomain(currentUserPersonalDetails?.login ?? '')}
                            </Text>
                            {!!isDebugModeEnabled && (
                                <Text
                                    style={[styles.textLabelSupporting, styles.mt1, styles.w100]}
                                    numberOfLines={1}
                                >
                                    AccountID: {accountID}
                                </Text>
                            )}
                        </View>
                    </View>
                </PressableWithFeedback>
            </TooltipToRender>

            {!!canSwitchAccounts && (
                <PopoverWithMeasuredContent
                    isVisible={shouldShowDelegatorMenu}
                    onClose={hideDelegatorMenu}
                    anchorRef={buttonRef}
                    anchorPosition={CONST.POPOVER_ACCOUNT_SWITCHER_POSITION}
                    anchorAlignment={{
                        horizontal: CONST.MODAL.ANCHOR_ORIGIN_HORIZONTAL.LEFT,
                        vertical: CONST.MODAL.ANCHOR_ORIGIN_VERTICAL.TOP,
                    }}
                    popoverDimensions={{width: CONST.POPOVER_DROPDOWN_WIDTH, height: Math.min(windowHeight / 2, CONST.POPOVER_DROPDOWN_MAX_HEIGHT)}}
                    shouldSwitchPositionIfOverflow
                    shouldEnableNewFocusManagement
                >
                    <View
                        style={[
                            shouldShowSearchInput ? {height: Math.min(windowHeight / 2, CONST.POPOVER_DROPDOWN_MAX_HEIGHT)} : {maxHeight: windowHeight / 2},
                            styles.flexColumn,
                            {width: CONST.POPOVER_DROPDOWN_WIDTH},
                            styles.mw100,
                        ]}
                    >
                        <Text style={[styles.createMenuHeaderText, styles.ph5, styles.pv3]}>{translate('delegate.switchAccount')}</Text>
                        <SelectionList
                            data={switcherItems}
                            ListItem={SingleSelectWithAvatarListItem}
                            onSelectRow={(item) => {
                                hideDelegatorMenu();
                                item.onSelected?.();
                            }}
                            shouldShowTextInput={shouldShowSearchInput}
                            textInputOptions={{
                                value: searchValue,
                                label: translate('workspace.people.findMember'),
                                onChangeText: setSearchValue,
                                headerMessage,
                            }}
                            shouldSingleExecuteRowSelect
                            addBottomSafeAreaPadding
                        />
                    </View>
                </PopoverWithMeasuredContent>
            )}
        </>
    );
}

export default AccountSwitcher;
