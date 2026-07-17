import Button from '@components/Button';

import {useMemoizedLazyIllustrations} from '@hooks/useLazyAsset';
import useLocalize from '@hooks/useLocalize';
import useThemeStyles from '@hooks/useThemeStyles';

import variables from '@styles/variables';

import type {StyleProp, TextStyle, ViewStyle} from 'react-native';

import React from 'react';
import {View} from 'react-native';

import BlockingView from './BlockingView';
import ForceFullScreenView from './ForceFullScreenView';

type FullPageErrorViewProps = {
    /** TestID for test */
    testID?: string;

    /** Child elements */
    children?: React.ReactNode;

    /** If true, child components are replaced with a blocking "error page" view */
    shouldShow?: boolean;

    /** The title text to be displayed */
    title?: string;

    /** The subtitle text to be displayed */
    subtitle?: string;

    /** Whether we should force the full page view */
    shouldForceFullScreen?: boolean;

    /** The style of the subtitle message */
    subtitleStyle?: StyleProp<TextStyle>;

    containerStyle?: StyleProp<ViewStyle>;

    /** Callback invoked when the user presses the retry button. When omitted, no retry button is shown. */
    onRetry?: () => void;
};

function FullPageErrorView({
    testID,
    children = null,
    shouldShow = false,
    title = '',
    subtitle = '',
    shouldForceFullScreen = false,
    subtitleStyle,
    containerStyle,
    onRetry,
}: FullPageErrorViewProps) {
    const styles = useThemeStyles();
    const {translate} = useLocalize();
    const illustrations = useMemoizedLazyIllustrations(['BrokenMagnifyingGlass']);

    if (shouldShow) {
        return (
            <ForceFullScreenView shouldForceFullScreen={shouldForceFullScreen}>
                <View
                    style={[styles.flex1, styles.searchBlockingErrorViewContainer]}
                    testID={testID}
                >
                    <BlockingView
                        icon={illustrations.BrokenMagnifyingGlass}
                        iconWidth={variables.errorPageIconWidth}
                        iconHeight={variables.errorPageIconHeight}
                        title={title}
                        subtitle={subtitle}
                        subtitleStyle={subtitleStyle}
                        containerStyle={containerStyle}
                        footer={
                            onRetry ? (
                                <Button
                                    success
                                    text={translate('errorPage.retry')}
                                    onPress={onRetry}
                                />
                            ) : undefined
                        }
                    />
                </View>
            </ForceFullScreenView>
        );
    }

    return children;
}

export default FullPageErrorView;
