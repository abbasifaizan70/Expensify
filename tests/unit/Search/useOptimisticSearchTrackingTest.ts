import {act, renderHook} from '@testing-library/react-native';

import useOptimisticSearchTracking from '@components/Search/hooks/useOptimisticSearchTracking';
import type {SearchQueryJSON} from '@components/Search/types';

import {flushDeferredWrite, getOptimisticWatchKey, hasDeferredWrite, registerDeferredWrite, reserveDeferredWriteChannel, resetForTesting} from '@libs/deferredLayoutWrite';
import {buildSearchQueryJSON} from '@libs/SearchQueryUtils';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Transaction} from '@src/types/onyx';
import type SearchResults from '@src/types/onyx/SearchResults';

import type {OnyxCollection} from 'react-native-onyx';

const SEARCH_KEY = CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH;

const CREATED_TRANSACTION_ID = 'created-1';
const CREATED_TRANSACTION_KEY = `${ONYXKEYS.COLLECTION.TRANSACTION}${CREATED_TRANSACTION_ID}` as const;

const MATCHING_TRANSACTION_ID = 'matching-2';
const MATCHING_TRANSACTION_KEY = `${ONYXKEYS.COLLECTION.TRANSACTION}${MATCHING_TRANSACTION_ID}` as const;

function makeQueryJSON(merchant: string): SearchQueryJSON {
    const queryJSON = buildSearchQueryJSON(`type:expense merchant:${merchant}`);
    if (!queryJSON) {
        throw new Error('Failed to build test query');
    }
    return queryJSON;
}

function makeTransaction(transactionID: string, merchant: string): Transaction {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return {transactionID, merchant, reportID: 'report-1', amount: 100, currency: 'USD'} as Transaction;
}

/** A settled server snapshot for `queryJSON` whose only match is `MATCHING_TRANSACTION_ID`. */
function makeSearchResults(queryJSON: SearchQueryJSON): SearchResults {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return {
        data: {
            [MATCHING_TRANSACTION_KEY]: makeTransaction(MATCHING_TRANSACTION_ID, 'MerchantB'),
        },
        search: {
            hash: queryJSON.hash,
            type: queryJSON.type,
            sortBy: queryJSON.sortBy,
            sortOrder: queryJSON.sortOrder,
            isLoading: false,
            hasMoreResults: false,
            state: CONST.SEARCH.SNAPSHOT_STATE.LOADED,
        },
    } as unknown as SearchResults;
}

const transactions: OnyxCollection<Transaction> = {
    [CREATED_TRANSACTION_KEY]: makeTransaction(CREATED_TRANSACTION_ID, 'MerchantA'),
    [MATCHING_TRANSACTION_KEY]: makeTransaction(MATCHING_TRANSACTION_ID, 'MerchantB'),
};

function renderTracking(merchant: string) {
    const queryJSON = makeQueryJSON(merchant);
    const searchResults = makeSearchResults(queryJSON);
    const hookResult = renderHook(
        (props: {transactions: OnyxCollection<Transaction>}) => useOptimisticSearchTracking({searchResults, queryJSON, transactions: props.transactions, reportActions: undefined}),
        {initialProps: {transactions}},
    );
    return {...hookResult, searchResults};
}

describe('useOptimisticSearchTracking', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        // The lazy watch-key resolution commits its state through requestAnimationFrame, which the React Native
        // jest preset backs with a real timer. Route it through the faked setTimeout so tests can advance it.
        jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            return setTimeout(() => callback(performance.now()), 16) as unknown as number;
        });
        jest.spyOn(global, 'cancelAnimationFrame').mockImplementation((id: number) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
        });
        resetForTesting();
    });

    afterEach(() => {
        resetForTesting();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    describe('watch key seeding on mount', () => {
        it('does not inject the last created expense into a later, unrelated query (#99450)', () => {
            // Create an expense while Search is already on screen: the layout flush lands before the real write
            // registers, so the channel is consumed immediately and the watch key is parked in `flushedWatchKeys`.
            reserveDeferredWriteChannel(SEARCH_KEY);
            flushDeferredWrite(SEARCH_KEY);
            registerDeferredWrite(SEARCH_KEY, jest.fn(), {optimisticWatchKey: CREATED_TRANSACTION_KEY});

            // Preconditions of the bug: no write is pending anymore, yet the parked key still resolves.
            expect(hasDeferredWrite(SEARCH_KEY)).toBe(false);
            expect(getOptimisticWatchKey(SEARCH_KEY)).toBe(CREATED_TRANSACTION_KEY);

            // The user now searches for a different merchant: a new query hash mounts a fresh tracking instance.
            const {result, searchResults} = renderTracking('MerchantB');

            expect(result.current.trackingState.optimisticWatchKey).toBeUndefined();
            expect(result.current.hasPendingWriteOnMountRef.current.optimisticWatchKey).toBeUndefined();
            expect(result.current.showPendingExpensePlaceholder).toBe(false);
            expect(result.current.searchDataWithOptimisticTransaction).toBe(searchResults.data);
            expect(result.current.searchDataWithOptimisticTransaction).not.toHaveProperty(CREATED_TRANSACTION_KEY);
        });

        it('still injects the created expense when a write is pending on mount', () => {
            // Register-before-mount ordering: the channel is live and carries the watch key when Search mounts.
            registerDeferredWrite(SEARCH_KEY, jest.fn(), {optimisticWatchKey: CREATED_TRANSACTION_KEY});
            expect(hasDeferredWrite(SEARCH_KEY)).toBe(true);

            const {result} = renderTracking('MerchantA');

            expect(result.current.trackingState.optimisticWatchKey).toBe(CREATED_TRANSACTION_KEY);
            expect(result.current.showPendingExpensePlaceholder).toBe(true);
            expect(result.current.searchDataWithOptimisticTransaction).toHaveProperty(CREATED_TRANSACTION_KEY);
            expect(result.current.searchDataWithOptimisticTransaction).toHaveProperty(MATCHING_TRANSACTION_KEY);
        });

        it('resolves a key parked after mount when the mount owns the pending write', () => {
            // Reserve-before-mount ordering (the case `flushedWatchKeys` exists for): the channel is reserved when
            // Search mounts, then the layout flush requests the flush before the real write registers.
            reserveDeferredWriteChannel(SEARCH_KEY);

            const {result, rerender} = renderTracking('MerchantA');

            expect(result.current.hasPendingWriteOnMountRef.current.hasPendingWriteOnMount).toBe(true);
            expect(result.current.trackingState.optimisticWatchKey).toBeUndefined();

            flushDeferredWrite(SEARCH_KEY);
            registerDeferredWrite(SEARCH_KEY, jest.fn(), {optimisticWatchKey: CREATED_TRANSACTION_KEY});
            expect(hasDeferredWrite(SEARCH_KEY)).toBe(false);

            // The optimistic write lands in Onyx; the lifecycle effect re-runs and lazily resolves the parked key.
            act(() => {
                rerender({transactions: {...transactions}});
            });
            act(() => {
                jest.advanceTimersByTime(16);
            });

            expect(result.current.trackingState.optimisticWatchKey).toBe(CREATED_TRANSACTION_KEY);
            expect(result.current.searchDataWithOptimisticTransaction).toHaveProperty(CREATED_TRANSACTION_KEY);
        });
    });
});
