import type {TravelCVVActionsContextType, TravelCVVStateContextType} from './types';

const defaultTravelCVVStateContextValue: TravelCVVStateContextType = {
    cvv: null,
    isLoading: false,
    validateError: {},
};

const defaultTravelCVVActionsContextValue: TravelCVVActionsContextType = {
    setCvv: () => {},
    setIsLoading: () => {},
    setValidateError: () => {},
    isReturningFromVerifyRef: {current: false},
};

export {defaultTravelCVVStateContextValue, defaultTravelCVVActionsContextValue};
