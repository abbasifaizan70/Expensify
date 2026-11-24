# `react-dom` patches

### [react-dom+19.2.3+001+reset-select-mousedown-on-document-mouseup.patch](react-dom+19.2.3+001+reset-select-mousedown-on-document-mouseup.patch)

- Reason:

    ```
    React's SelectEventPlugin stops emitting `onSelect` while its internal `mouseDown` flag is set, and the flag is only
    cleared by a `mouseup`, `contextmenu` or `dragend` that reaches a React root. When a drag selection is released outside
    of the root (for example below the browser window), the `mouseup` goes to `<html>` and `onSelect` stops firing until
    the next click inside the app. The composer caches its selection from `onSelect`, so Cmd+C / Cmd+X then write an empty
    string and Shift+Enter / paste act on the old caret. The patch also listens for `mouseup` on the document (next to the
    existing `selectionchange` listener) so the flag is reset. It patches the `react-dom-client` and `react-dom-profiling` builds.
    ```

- Upstream PR/issue: https://github.com/facebook/react/issues/26165 (closed as not planned; upstream PR 🛑 TODO)
- E/App issue: https://github.com/Expensify/App/issues/107116
- PR introducing patch: 🛑 TODO
