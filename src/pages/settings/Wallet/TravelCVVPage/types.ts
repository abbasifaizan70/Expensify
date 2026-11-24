import type {Errors} from '@src/types/onyx/OnyxCommon';

type TravelCVVStateContextType = {
    cvv: string | null;
    isLoading: boolean;
    validateError: Errors;
};

type TravelCVVActionsContextType = {
    setCvv: React.Dispatch<React.SetStateAction<string | null>>;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setValidateError: React.Dispatch<React.SetStateAction<Errors>>;

    /**
     * Set by the verify page right before it goes back to the Travel CVV page. When the Travel CVV
     * page was not under the verify page (e.g. the verify URL was refreshed or deep-linked), going back
     * mounts a brand-new Travel CVV page, and this flag stops it from auto-opening verification again.
     * Cleared when the Travel CVV page unmounts.
     */
    isReturningFromVerifyRef: React.RefObject<boolean>;
};

export type {TravelCVVStateContextType, TravelCVVActionsContextType};
