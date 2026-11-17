# `@expensify/react-native-live-markdown` patches

### [@expensify+react-native-live-markdown+0.1.372+001+register-parser-worklet-in-insertion-effect.patch](@expensify+react-native-live-markdown+0.1.372+001+register-parser-worklet-in-insertion-effect.patch)

- Reason: `MarkdownTextInput` registered its parser worklet during render (`useMemo`) and unregistered it in an effect cleanup. React runs that cleanup without unmounting the component under StrictMode and whenever a hidden `<Activity>` disconnects effects, so the native view kept a parser id that pointed at nothing and the input silently stopped formatting markdown. The patch moves the registration into `useInsertionEffect` in a new `useParserId` hook, chooses the id in JS (one per mounted input, a fresh one on every `parser` change) and turns the native registry into a plain map. A parse for an id with no registered worklet logs a warning and returns no ranges without caching them, so the next parse picks the parser up once it is registered. It carries the `src/`, `lib/` and native (`cpp/`, `apple/`, `android/`) parts of the upstream PR.
- Depends on: `react-native+0.86.0+044+run-insertion-effect-cleanup-in-hidden-subtree.patch`. Without it Fabric skips the insertion cleanup for an input removed while its `<Activity>` is hidden, and the worklet leaks in the native registry. Formatting stays correct either way because ids are never reused.
- Upstream PR/issue: https://github.com/Expensify/react-native-live-markdown/pull/776 (on hold until the library can rely on React Native 0.88; drop this patch once the app upgrades to a release that contains it)
- E/App issue: https://github.com/Expensify/App/issues/98254
- PR introducing patch: https://github.com/Expensify/App/pull/102415

### [@expensify+react-native-live-markdown+0.1.372+002+copy-live-selection.patch](@expensify+react-native-live-markdown+0.1.372+002+copy-live-selection.patch)

- Reason: On web, `MarkdownTextInput` copies and cuts from a cached selection that is only refreshed from React's `onSelect`. React does not emit `onSelect` when a drag selection is released outside of its root (for example below the browser window), so the cache stays collapsed and Cmd+C writes an empty string while the text is still highlighted. The patch syncs the cache with the live DOM selection in `handleCopy` (which `handleCut` also calls) before the text is read. It carries the `src/` and `lib/` parts of the change.
- Upstream PR/issue: 🛑 TODO (not opened yet; the fix belongs in https://github.com/Expensify/react-native-live-markdown)
- E/App issue: https://github.com/Expensify/App/issues/107116
- PR introducing patch: 🛑 TODO
