# Issue #258: first settings/date interaction batch

## Baseline and scope

- Source baseline: main `12c456aa29e6a6542a6e8f9a8b27d164d23181fc` (#271), verified through the read-only GitHub commit API on 2026-10-25.
- Isolated repository: `/Users/adlin/Documents/Codex/2026-10-25/task-3/DietDigiDose`; branch `fix/258-android-settings-date`.
- Read repository `AGENTS.md`, root layout, Screen keyboard boundaries, global tokens, existing settings, date component/callers and tests. Repository `.agents` does not exist; `/Users/adlin/.agents/skills` is empty.
- Baseline code: seven reminder TextInputs; three settings Modals without `onRequestClose`; SmartDateInput height 52 with one-line value; inventory entry overrides height to 46. Brand Switch and date theme support already existed.
- No Android APK/device baseline or before/after screenshots available. The current UI inventory has no project preview or Android simulator. Per task restriction, no localhost server/listener was started, no alternate port/route attempted, and no escalation requested. Earlier task's EPERM restriction remains in force.

## Changes and choices

- Reuse SmartDateInput for the seven reminder times: Android native time picker, 24-hour display and HH:mm values; Web native `input[type=time]` with valid-time conversion. Time changes remain draft edits until existing save actions; brand Switch behavior and colors remain.
- Use wrapping field columns (140-point basis), readable labels, minimum rather than fixed input heights, wrapping native text, and explicit accessible field names. Remove inventory's fixed-height override and tiny batch-date label override. Unknown/estimated date evidence and inventory business rules are unchanged.
- Keep the existing native picker without an extra native modal wrapper. Cancel never emits a date; synchronous guards reject repeated open/confirm, stale picker callbacks and disabled/unmounted results. Calendar output format remains YYYY-MM-DD for existing callers.
- A settings-local Modal layout reuses RN Modal, KeyboardAvoidingView, ScrollView, safe-area insets and existing theme classes. Back, backdrop and explicit cancel share close handlers. Destructive verification is cleared on cancel; in-flight writes lock closing. Hot calorie controls have token-sized touch targets. Keyboard dismissal is explicit on closing/saving; content can scroll.
- Reminder reads have a loading/error/retry state. Invalid times and calorie input errors are inline. The calorie range remains 1000–5000; an invalid numeric suffix is no longer silently truncated. Synchronous per-operation locks and page/session ownership guard save/read races. Locks survive blur/re-entry until completion; a re-entered reminder form rereads when an old write settles. Successful reminder writes finish scheduling only for the still-current account.
- No dependency, environment/signing configuration, comments keyboard (#17), phone-binding implementation (#270), notification business rules, backend or unrelated page changes.

## Verification on Node 22.23.2

Existing dependencies copied into this workspace from the prior task, after confirming identical pnpm lockfiles. No installation performed. Commands run from `client` unless otherwise noted; PATH uses `/Users/adlin/Documents/Code/Dietdigidose-local/node-v22.23.2-darwin-arm64/bin`.

| Check | Result |
| --- | --- |
| `jest --runInBand` | PASS: 116 suites, 802 tests |
| `tsc --noEmit` | PASS |
| `eslint ./ --quiet` | PASS |
| `CI=1 EXPO_OFFLINE=1 expo export --platform web` | PASS; static export only, no APK |
| Root `node scripts/check-module-boundaries.mjs` | PASS |
| `git diff --check` | PASS |
| Client Web budget, using existing `quality/build-budgets.json` limits | PASS: total 6,159,371 / 6,500,000 bytes; JS 4,351,156 / 4,500,000; largest JS 1,234,918 / 4,100,000 |

Regression coverage includes native picker open/dismiss/confirm/repeat/stale/disabled/unmount and date formatting; light/dark theme properties; Web valid/invalid/clear/recovery; growing layout properties; calorie reread/cancel/back/validation/failure/retry/double-write/late read and save/blur-re-entry locks; reminder draft/save/failure/double-write/re-entry reread; deletion verification cancellation; keyboard/scroll configuration. Full suite also includes Screen, post-detail keyboard, PhoneBindingSettings, AccountSmsVerification and existing inventory evidence tests.

Logs outside the tracked repository: `../client-tests.log`, `../client-tsc.log`, `../client-eslint.log`, `../web-export.log`, `../architecture.log`.

## Limits and review handoff

- Component mocks verify callback/state contracts and layout properties, not real Android rendering, native focus, accessibility traversal, contrast, keyboard overlap, system font scaling or safe-area positioning. Android native theme rendering (including forced app theme versus system theme) remains unverified.
- Same-device light/dark/large-font screenshots, actual hardware back/native cancel interactions, landscape/keyboard/safe-area touch checks and browser visual regression remain pending. Web export and native-input component tests are not browser/Android visual evidence.
- No iOS build/device test, APK build, backend/admin builds or server integration tests run; those implementations are unchanged. Full-repository build budget script requires unrelated server/admin build outputs, so only the affected client budget was checked.
- Initial `git fetch origin main` failed with `Could not resolve host: github.com`. No retry/escalation was used; the read-only connector verified main and the complete commit already existed in the local clone.
- Independent review is coordinated by the parent thread against this frozen local commit; review findings and any external supplemental tests must be integrated before treating the batch as fully accepted. No push, PR, merge, deployment, Issue edits, real SMS, paid API calls or real device data operations were performed.
