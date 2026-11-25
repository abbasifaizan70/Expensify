/**
 * Android reserves a row for its tab bar below the screen and the web KeyboardAvoidingView ignores the offset, so the
 * keyboard covers no footer padding there.
 */
function useTabRootFooterKeyboardOffset(): number {
    return 0;
}

export default useTabRootFooterKeyboardOffset;
