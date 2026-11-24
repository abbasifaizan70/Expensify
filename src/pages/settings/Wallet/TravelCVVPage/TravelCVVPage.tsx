import FullPageOfflineBlockingView from '@components/BlockingViews/FullPageOfflineBlockingView';
import Button from '@components/Button';
import ButtonDisabledWhenOffline from '@components/Button/composed/ButtonDisabledWhenOffline';
import HeaderWithBackButton from '@components/HeaderWithBackButton';
import {useLockedAccountActions, useLockedAccountState} from '@components/LockedAccountModalProvider';
import ScreenWrapper from '@components/ScreenWrapper';
import ScrollView from '@components/ScrollView';
import Text from '@components/Text';

import {useMemoizedLazyExpensifyIcons} from '@hooks/useLazyAsset';
import useLocalize from '@hooks/useLocalize';
import useNetwork from '@hooks/useNetwork';
import useOnyx from '@hooks/useOnyx';
import useThemeStyles from '@hooks/useThemeStyles';
import useThrottledButtonState from '@hooks/useThrottledButtonState';

import Clipboard from '@libs/Clipboard';
import deferNavigate from '@libs/Navigation/deferNavigate';
import Navigation from '@libs/Navigation/Navigation';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import SCREENS from '@src/SCREENS';

import {useNavigationState} from '@react-navigation/native';
import React, {useEffect, useRef} from 'react';
import {View} from 'react-native';

import {useTravelCVVActions, useTravelCVVState} from './TravelCVVContextProvider';

/**
 * TravelCVVPage - Displays the Travel CVV reveal interface.
 * Shows a description of the travel card and allows users to reveal the CVV.
 * CVV is stored only in React Context state and never persisted in Onyx.
 */
function TravelCVVPage() {
    const styles = useThemeStyles();
    const [isCopyButtonActive, setCopyButtonInactive] = useThrottledButtonState();
    const {isOffline} = useNetwork();
    const {translate} = useLocalize();
    const icons = useMemoizedLazyExpensifyIcons(['Copy', 'Checkmark']);

    const [account] = useOnyx(ONYXKEYS.ACCOUNT);
    const {isAccountLocked} = useLockedAccountState();
    const {showLockedAccountModal} = useLockedAccountActions();

    // Get CVV from context - shared with TravelCVVVerifyAccountPage
    const {cvv} = useTravelCVVState();
    const {setCvv, isReturningFromVerifyRef} = useTravelCVVActions();
    const hasRevealedCVV = !!cvv;

    const CVV_LENGTH = cvv?.length ?? 3;
    const MASKED_CVV = '•'.repeat(CVV_LENGTH);
    const cvvDigits = (cvv ?? MASKED_CVV).split('');

    // Clear CVV when the page unmounts (e.g. backdrop close) so it doesn't
    // remain visible the next time the page is opened. Also clear the "returning
    // from verify" flag so the next fresh visit auto-opens verification again.
    useEffect(
        () => () => {
            setCvv(null);
            isReturningFromVerifyRef.current = false;
        },
        [setCvv, isReturningFromVerifyRef],
    );

    const isSignedInAsDelegate = !!account?.delegatedAccess?.delegate || false;
    const isVerifyAccountInStack = useNavigationState((state) => state.routes.some((route) => route.name === SCREENS.SETTINGS.WALLET.TRAVEL_CVV_VERIFY_ACCOUNT));

    // Auto-navigate to the validateCode screen on first mount so the user
    // doesn't have to click "Reveal Details" manually.
    const hasAutoNavigatedRef = useRef(false);
    useEffect(() => {
        if (hasAutoNavigatedRef.current) {
            return;
        }
        // If the verify-account (validateCode) screen is already in the navigation
        // stack, the user has previously visited it during this mount cycle (e.g.
        // they completed or cancelled the validateCode flow and returned here).
        // Skip auto-navigation so we don't push a duplicate screen.
        if (isVerifyAccountInStack) {
            hasAutoNavigatedRef.current = true;
            return;
        }
        // The user just came back from the verify page, but this page was not under it
        // (e.g. the verify URL was refreshed), so this is a new instance. Don't send them back.
        if (isReturningFromVerifyRef.current) {
            hasAutoNavigatedRef.current = true;
            return;
        }
        // Permanent conditions — set the ref so we never retry auto-navigation.
        // If CVV is already revealed there's no reason to navigate to the validate
        // code screen, and delegates are not allowed to request one. Unlike the
        // transient guards below (offline / locked), these won't change during
        // this mount, so we mark the ref to stop future effect re-runs.
        if (cvv || isSignedInAsDelegate) {
            hasAutoNavigatedRef.current = true;
            return;
        }
        // Transient conditions — we intentionally do NOT set hasAutoNavigatedRef here.
        // isOffline and isAccountLocked can change at any time (e.g. the user regains
        // connectivity or the account is unlocked). By leaving the ref unset, the
        // effect will re-run and auto-navigate once the blocking condition clears,
        // rather than permanently giving up and forcing the user to tap "Reveal Details".
        if (isOffline || isAccountLocked) {
            return;
        }
        hasAutoNavigatedRef.current = true;
        // This effect runs in the same commit that opens the RHP, before the RHP's nested
        // navigators have registered their state with the root. Navigating now would build a
        // new RHP holding only the verify page and drop this page from the stack, so Back would
        // REPLACE in a fresh Travel CVV page that auto-opens verify again. A microtask runs after
        // every effect of this commit, so verify is pushed on top of this page instead.
        deferNavigate(() => Navigation.navigate(ROUTES.SETTINGS_WALLET_TRAVEL_CVV_VERIFY_ACCOUNT));
    }, [cvv, isSignedInAsDelegate, isOffline, isAccountLocked, isVerifyAccountInStack, isReturningFromVerifyRef]);

    const handleRevealDetailsPress = () => {
        if (isAccountLocked) {
            showLockedAccountModal();
            return;
        }

        // Navigate to the verify account page
        Navigation.navigate(ROUTES.SETTINGS_WALLET_TRAVEL_CVV_VERIFY_ACCOUNT);
    };

    let actionButton: React.ReactNode = null;
    if (hasRevealedCVV) {
        actionButton = (
            <Button
                sentryLabel={CONST.SENTRY_LABEL.EXPENSIFY_CARD_PAGE.TRAVEL_CVV_COPY}
                onPress={() => {
                    Clipboard.setString(cvv);
                    setCopyButtonInactive();
                }}
                style={[styles.mt10, styles.alignSelfCenter]}
            >
                <Button.Icon src={isCopyButtonActive ? icons.Copy : icons.Checkmark} />
                <Button.Text>{isCopyButtonActive ? translate('cardPage.cardDetails.copyCvv') : translate('common.copied')}</Button.Text>
            </Button>
        );
    } else if (!cvv && !isSignedInAsDelegate) {
        actionButton = (
            <ButtonDisabledWhenOffline
                sentryLabel={CONST.SENTRY_LABEL.EXPENSIFY_CARD_PAGE.TRAVEL_CVV_REVEAL}
                onPress={handleRevealDetailsPress}
                style={[styles.mt10, styles.alignSelfCenter]}
                variant={CONST.BUTTON_VARIANT.SUCCESS}
            >
                <Button.Text>{translate('cardPage.cardDetails.revealDetails')}</Button.Text>
            </ButtonDisabledWhenOffline>
        );
    }

    return (
        <ScreenWrapper
            testID="TravelCVVPage"
            shouldShowOfflineIndicatorInWideScreen
        >
            <HeaderWithBackButton
                title={translate('walletPage.travelCVV.title')}
                shouldShowBackButton
            />
            <FullPageOfflineBlockingView>
                <ScrollView contentContainerStyle={[styles.ph5]}>
                    <View style={[styles.mt5, styles.mb8]}>
                        <Text style={[styles.textNormal, styles.textSupporting]}>{translate('walletPage.travelCVV.description')}</Text>
                    </View>

                    <View style={[styles.mt0Half, styles.flexRow, styles.justifyContentCenter, styles.gap1]}>
                        {cvvDigits.map((digit, index) => (
                            <View
                                // eslint-disable-next-line react/no-array-index-key -- CVV digits are a fixed-length display-only array that is never reordered
                                key={`cvv-${digit}-${index}`}
                                style={[styles.alignItemsCenter, styles.justifyContentCenter, styles.travelCVVDigitBox]}
                            >
                                <Text
                                    fsClass={CONST.FULLSTORY.CLASS.MASK}
                                    style={[styles.textXLargeThemeText]}
                                >
                                    {digit}
                                </Text>
                            </View>
                        ))}
                    </View>

                    {actionButton}
                </ScrollView>
            </FullPageOfflineBlockingView>
        </ScreenWrapper>
    );
}

export default TravelCVVPage;
