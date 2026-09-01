import {isFullDownloadRequest} from '@libs/actions/RequestConflictUtils';
import {getServerReconnectCutoff, recordFullReconnectTimeFromResponse} from '@libs/FullReconnectUtils';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {AnyOnyxUpdate} from '@src/types/onyx/Request';

import Onyx from 'react-native-onyx';

import type Middleware from './types';

/**
 * Records LAST_FULL_RECONNECT_TIME on every successful full-download (OpenApp/full-ReconnectApp)
 * response. The time is recorded from the response rather than computed when the request is
 * built, because the response can itself deliver a newer reconnect cutoff — a build-time value
 * can land below it and fire extra full reconnects right after downloading everything.
 */
const recordFullReconnectTime: Middleware = (requestResponse, request) =>
    requestResponse.then((response) => {
        if (!isFullDownloadRequest(request) || response?.jsonCode !== CONST.JSON_CODE.SUCCESS) {
            return response;
        }

        response.onyxData ??= [];
        const recordedTime = recordFullReconnectTimeFromResponse(response.onyxData as AnyOnyxUpdate[], getServerReconnectCutoff());
        // A write command's response.onyxData only lands when the sequential queue drains (QueuedOnyxUpdates),
        // while the reconnect cutoff can reach Onyx on immediate pipes (a read command's response, a Pusher
        // update). Merge the record on the immediate pipe too, so a cutoff arriving between this response and
        // that flush cannot be compared against a stale value and fire a duplicate reconnect. See #97159.
        Onyx.merge(ONYXKEYS.LAST_FULL_RECONNECT_TIME, recordedTime);
        return response;
    });

export default recordFullReconnectTime;
