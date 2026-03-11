import {Str} from 'expensify-common';
import React from 'react';
import {View} from 'react-native';
import {useMemoizedLazyExpensifyIcons} from '@hooks/useLazyAsset';
import useLocalize from '@hooks/useLocalize';
import usePersonalDetailsByEmail from '@hooks/usePersonalDetailsByEmail';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import useTheme from '@hooks/useTheme';
import useThemeStyles from '@hooks/useThemeStyles';
import {sortAlphabetically} from '@libs/OptionsListUtils';
import {getApprovalLimitDescription} from '@libs/WorkflowUtils';
import CONST from '@src/CONST';
import type ApprovalWorkflow from '@src/types/onyx/ApprovalWorkflow';
import Avatar from './Avatar';
import Icon from './Icon';
import MenuItem from './MenuItem';
import PressableWithoutFeedback from './Pressable/PressableWithoutFeedback';
import Text from './Text';
import Tooltip from './Tooltip';

type ApprovalWorkflowSectionProps = {
    /** Single workflow displayed in this component */
    approvalWorkflow: ApprovalWorkflow;

    /** A function that is called when the section is pressed */
    onPress: () => void;

    /** Currency used for formatting approval limits */
    currency?: string;
};

type UserPill = {
    email: string;
    displayName: string;
};

const MAX_VISIBLE_PILLS = 8;

function ApprovalWorkflowSection({approvalWorkflow, onPress, currency = CONST.CURRENCY.USD}: ApprovalWorkflowSectionProps) {
    const icons = useMemoizedLazyExpensifyIcons(['ArrowRight', 'Lightbulb', 'Users', 'UserCheck']);
    const styles = useThemeStyles();
    const theme = useTheme();
    const {translate, toLocaleOrdinal, localeCompare} = useLocalize();
    const {shouldUseNarrowLayout} = useResponsiveLayout();
    const personalDetailsByEmail = usePersonalDetailsByEmail();

    const approverTitle = (index: number) =>
        approvalWorkflow.approvers.length > 1 ? `${toLocaleOrdinal(index + 1, true)} ${translate('workflowsPage.approver').toLowerCase()}` : `${translate('workflowsPage.approver')}`;

    const members = approvalWorkflow.isDefault
        ? translate('workspace.common.everyone')
        : sortAlphabetically(approvalWorkflow.members, 'displayName', localeCompare)
              .map((m) => Str.removeSMSDomain(m.displayName))
              .join(', ');

    const renderUserPills = (users: UserPill[]) => {
        const visibleUsers = users.slice(0, MAX_VISIBLE_PILLS);
        const hiddenUsers = users.slice(MAX_VISIBLE_PILLS);
        const hiddenUsersTooltip = hiddenUsers.map(({displayName}) => Str.removeSMSDomain(displayName)).join(', ');

        return (
            <View style={[styles.flexRow, styles.flexWrap, styles.mt1]}>
                {visibleUsers.map((user) => {
                    const cleanDisplayName = Str.removeSMSDomain(user.displayName);
                    const personalDetail = personalDetailsByEmail?.[user.email];

                    return (
                        <View
                            key={user.email}
                            style={styles.workflowUserPill}
                        >
                            <Avatar
                                size={CONST.AVATAR_SIZE.SMALL}
                                source={personalDetail?.avatar}
                                name={cleanDisplayName}
                                type={CONST.ICON_TYPE_AVATAR}
                                avatarID={personalDetail?.accountID}
                            />
                            <Text
                                style={[styles.textLabelSupporting, styles.ml2, styles.flexShrink1, styles.workflowUserPillText]}
                                numberOfLines={1}
                            >
                                {cleanDisplayName}
                            </Text>
                        </View>
                    );
                })}
                {hiddenUsers.length > 0 && (
                    <Tooltip text={hiddenUsersTooltip}>
                        <PressableWithoutFeedback
                            accessibilityRole="button"
                            style={styles.workflowUserPill}
                            onPress={onPress}
                            accessibilityLabel={`${hiddenUsers.length} ${translate('common.more')}`}
                        >
                            <Text style={[styles.textLabelSupporting, styles.textStrong]}>{`+${hiddenUsers.length} ${translate('common.more').toLowerCase()}`}</Text>
                        </PressableWithoutFeedback>
                    </Tooltip>
                )}
            </View>
        );
    };
    return (
        <PressableWithoutFeedback
            accessibilityRole="button"
            sentryLabel={CONST.SENTRY_LABEL.WORKSPACE.APPROVAL_WORKFLOW_SECTION}
            style={[styles.border, shouldUseNarrowLayout ? styles.p3 : styles.p4, styles.flexRow, styles.justifyContentBetween, styles.mt6, styles.mbn3]}
            onPress={onPress}
            accessibilityLabel={translate('workflowsPage.accessibilityLabel', {
                members,
                approvers: approvalWorkflow?.approvers.map((approver) => Str.removeSMSDomain(approver?.displayName ?? '')).join(', '),
            })}
        >
            <View style={[styles.flex1]}>
                {approvalWorkflow.isDefault && (
                    <View style={[styles.flexRow, styles.mb4, styles.alignItemsCenter, styles.pb1, styles.pt1]}>
                        <Icon
                            src={icons.Lightbulb}
                            fill={theme.icon}
                            additionalStyles={styles.mr2}
                            small
                        />
                        <Text
                            style={[styles.textLabelSupportingNormal]}
                            suppressHighlighting
                        >
                            {translate('workflowsPage.addApprovalTip')}
                        </Text>
                    </View>
                )}
                <MenuItem
                    title={translate('workflowsExpensesFromPage.title')}
                    style={styles.p0}
                    titleStyle={styles.textLabelSupportingNormal}
                    shouldBeAccessible={false}
                    tabIndex={-1}
                    icon={icons.Users}
                    iconHeight={20}
                    iconWidth={20}
                    iconFill={theme.icon}
                    onPress={onPress}
                    shouldRemoveBackground
                    sentryLabel={CONST.SENTRY_LABEL.WORKSPACE.WORKFLOWS.APPROVAL_SECTION_EXPENSES_FROM}
                    titleComponent={approvalWorkflow.isDefault ? <Text style={[styles.textNormalThemeText, styles.lineHeightXLarge, styles.mt1]}>{members}</Text> : renderUserPills(approvalWorkflow.members)}
                />

                {approvalWorkflow.approvers.map((approver, index) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <View key={`approver-${approver.email}-${index}`}>
                        <View style={styles.workflowApprovalVerticalLine} />
                        <MenuItem
                            title={approverTitle(index)}
                            style={styles.p0}
                            titleStyle={styles.textLabelSupportingNormal}
                            icon={icons.UserCheck}
                            shouldBeAccessible={false}
                            tabIndex={-1}
                            iconHeight={20}
                            iconWidth={20}
                            iconFill={theme.icon}
                            onPress={onPress}
                            shouldRemoveBackground
                            helperText={getApprovalLimitDescription({approver, currency, translate, personalDetailsByEmail})}
                            helperTextStyle={styles.workflowApprovalLimitText}
                            sentryLabel={CONST.SENTRY_LABEL.WORKSPACE.WORKFLOWS.APPROVAL_SECTION_APPROVER}
                            titleComponent={renderUserPills([{displayName: approver.displayName, email: approver.email}])}
                        />
                    </View>
                ))}
            </View>
            <Icon
                src={icons.ArrowRight}
                fill={theme.icon}
                additionalStyles={[styles.alignSelfCenter]}
            />
        </PressableWithoutFeedback>
    );
}

export default ApprovalWorkflowSection;
