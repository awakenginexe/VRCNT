# VRCNT approved UX integration plan

## Scope and design approval

The approved handoff at `C:\Users\ANXE\Desktop\VRCNT-UI-Handoff` is the
design and interaction authority for this work. Its prototype will not be
imported, copied, or run by production code. This plan ports the approved
information architecture and visual system into the existing React/Tauri
application while preserving the Python sidecar, persisted settings, Jotai
stores, localization, and existing advanced controls.

Base branch: `main` at `e10f9cef84818d6b837f56bcf4167ea5c7186c58`
Implementation branch: `ui/codex-ux-integration`
Worktree: `C:\Users\ANXE\Desktop\Coding\VRCNT-Next-Worktrees\ui-codex-ux-integration`

## Production architecture confirmed before editing

| Production concern | Existing source of truth | Integration rule |
| --- | --- | --- |
| App startup and readiness | `StartPythonController.jsx`, `useReceiveRoutes.js`, `src-python/mainloop.py` | Keep the sidecar protocol and startup state intact; no UI may assume backend readiness before `/run/initialization_complete`. |
| Main-function state | `useMainFunction.js`, `Atom_TranslationStatus`, `Atom_TranscriptionSendStatus`, `Atom_TranscriptionReceiveStatus` | All Start/Stop and individual control actions use the real enable/disable endpoints and retain pending/error recovery. |
| Languages | `useLanguageSettings.js`, `LanguageSelector.jsx` | Reuse persisted profile slots and the existing searchable language dialog. |
| Conversation records | `useMessage.js`, `messageLogUtils.js`, `MessageContainer.jsx` | Render real logs, progressive translation events, retry controls, and manual text input; do not seed a production timeline. |
| Resource telemetry | `useResourceUsage.js`, backend `collect_resource_usage` | Show only backend metrics or an honest unavailable state; retain real GPU selection. |
| Model downloads | dynamic `useTranscription()` settings and backend download routes | Model cards invoke the existing selection/download/progress state; no simulated progress. |
| Audio devices | dynamic `useDevice()` settings | Wizard and engines pages call the current persisted device selectors. |
| VR overlay | dynamic `useVr()` settings plus backend overlay image generation | Keep the actual small/large VR overlay configuration and its validation. |
| Desktop overlay | `DesktopOverlayApp.jsx`, `desktopOverlayWindow.js` | Extract shared persisted settings/preview behavior rather than building a visual-only preview. |
| Notifications | `SnackbarController.jsx`, `useNotificationStatus.js` | Preserve the notification store, add approved bottom-left presentation and safe manual dismissal. |
| Localization | six YAML files under `locales/` | All new visible copy uses locale keys with parity coverage. |

## Prototype-to-production mapping

| Handoff component | Production target | Real state/hooks |
| --- | --- | --- |
| `App` top navigation | `LiveWeaveNavigation.jsx`, `MainPage.jsx`, `Atom_ExperienceRoute` | `useStore_ExperienceRoute`, `useIsOpenedConfigPage`, selected legacy settings tab |
| `LiveTab` function switches | `LiveControlRail.jsx`, `SessionPrimaryAction.jsx`, existing `MainFunctionSwitch.jsx` | `useMainFunction`, `useIsBackendReady` |
| `LiveTab` language cards | `LiveControlRail.jsx` and existing `LanguageProfileGroup`/selector controls | `useLanguageSettings`, `useTranscription` |
| `LiveTab` timeline/input | existing `MessageContainer.jsx`, `LogBox.jsx`, row `MessageContainer.jsx` | `useMessage`, progressive message log state |
| `LiveTab` telemetry/GPU popover/privacy | `ResourceMonitor.jsx`, `GpuMonitorMenu.jsx`, `useStreamerPrivacy.js` | `useResourceUsage`, persisted local preference |
| `LiveTab` latency diagnostics | `PipelineStatus.jsx` in a collapsed advanced disclosure | `usePipelineStatus` |
| `SetupTab` | new `setup/GuidedSetup.jsx` | `useLanguageSettings`, `useDevice`, `useOthers`, `useIsOscAvailable` |
| `EnginesTab` | new `engines/EnginesWorkspace.jsx` | new per-source transcription settings, `useTranslation`, `useLanguageSettings` |
| `ModelHubTab`/download modal | new `models/ModelsHub.jsx`, existing confirmation/progress settings flow | `useTranscription`, `useTranslation`, real download status atoms |
| `OverlayStudioTab` | new `overlay_studio/OverlayStudio.jsx`, shared `DesktopOverlayPreview.jsx` | `useVr`, desktop-overlay persisted settings/window bridge, `useMessage` |
| `HistoryTab` | new `history/HistoryPage.jsx` | `useMessage`, `useOpenFolder` |
| `SettingsTab` | new `settings/SettingsHub.jsx` | `useAppearance`, `useOthers`, `useAdvancedSettings`, performance/privacy stores |
| `ToastContainer` | `SnackbarController.jsx` and its styles | `useNotificationStatus` |

## Shared implementation boundaries

- New UI files live under `src-ui/views/app/main_page/`; they use existing
  aliases and components and do not import anything from the handoff.
- The existing `ConfigPage` remains reachable from Settings as the detailed
  Advanced/Diagnostics surface. Existing specialist controls are retained,
  not removed.
- `MainPage` becomes the route host. The shared top bar remains fixed while
  route content changes below it; the legacy settings dialog remains modal
  only when explicitly opened.
- New `Atom_ExperienceRoute` is ephemeral UI route state. Persisted user
  settings stay in the current Python config or desktop-overlay storage.
- The browser-only preview values currently embedded in `store.js` will be
  removed from runtime initialization. Browser development will render the
  same honest empty/unavailable states as Tauri until a backend supplies data.
- Vite cache output will be configured inside the UI worktree, never inside
  the shared `node_modules` junction.

## State migration for separate source engines

The handoff requires outgoing microphone and incoming desktop-audio engine
controls. Current production has one global `SELECTED_TRANSCRIPTION_ENGINE`
and one global transcription compute device/type, so separate controls would
otherwise be deceptive.

Milestone 4 will add the smallest compatible source-specific extension:

1. Add persisted outgoing/incoming engine and compute device/type properties
   in `src-python/config.py` alongside the legacy global properties.
2. On config load, when the new properties are absent, initialize both source
   settings from the persisted legacy global engine/device/type and save the
   resulting migrated configuration. The legacy properties remain readable.
3. Add paired `/get/data` and `/set/data` controller routes in
   `src-python/mainloop.py`/`controller.py`; existing legacy endpoints set both
   source values for backwards compatibility.
4. Pass source-specific engine/device/type into microphone and speaker
   transcriber construction and Whisper runtime lease acquisition in
   `src-python/model.py`. Source language capability checks use the matching
   engine.
5. Preserve the current safe coordinated restart lock and pending/error
   protocol. A source setting is applied only after the backend reports the
   accepted configuration; no UI silently substitutes a slower model.
6. Add dynamic UI setting metadata and route coverage so the Jotai config
   hooks remain generated consistently.

## Responsive and accessibility contract

- 1920×1080: fixed 290px Live control rail, full conversation workspace,
  compact top telemetry.
- 1366×768: reduced gaps and chip padding; telemetry wraps cleanly; no
  desktop-sized vertical control stack consumes the conversation area.
- 1280×720: control rail becomes compact/sticky, conversation remains the
  scroll owner, all primary actions and navigation remain visible/reachable.
- Keyboard: semantic buttons/switches, `aria-current`, explicit labels,
  focus-visible rings, Escape dismissal where a dialog/disclosure warrants it.
- Motion: retain global Performance Mode and `prefers-reduced-motion` cutoffs;
  new motion uses existing variables only.
- Notifications: bottom-left, close button contained inside the toast,
  hover-paused timers, and persistent critical errors.

## Milestones, files, tests, and commit boundaries

### Milestone 1 — Application shell and navigation

**Create**

- `src-ui/views/app/main_page/main_section/__tests__/approvedShellNavigation.test.js`

**Modify**

- `src-ui/logics/store.js`
- `src-ui/views/app/config_page/ConfigPage.jsx`
- `src-ui/views/app/config_page/topbar/Topbar.jsx`
- `src-ui/views/app/_index_css/variables.css`
- `src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.jsx`
- `src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.module.scss`
- `locales/en.yml`, `locales/ja.yml`, `locales/ko.yml`, `locales/th.yml`, `locales/zh-Hans.yml`, `locales/zh-Hant.yml`
- `vite.config.js`

**Implementation**

- Introduce the seven approved routes: Live, Guided Setup, Speech Engines,
  Models, Overlay Studio, History, and Settings; show the current route with
  `aria-current`.
- Keep all legacy settings destinations reachable through the Settings hub and
  its Advanced action. Do not remove `ConfigPage`.
- Establish the matte-black/glass shell, VRCNT wordmark, compact desktop
  overlay action, responsive nav behavior, and safe Vite cache location.
- Remove imported browser-preview message/telemetry data from runtime state.

**Test-first gate**

1. Add the shell/navigation structural and no-runtime-mock assertions.
2. Run the focused test and record its failure before changing production UI.
3. Implement, then rerun the focused test, `npm run test:ui`, and
   `npm run vite-build`.
4. Build/use an isolated sidecar if required, launch the actual Tauri app,
   capture 1920×1080, 1366×768, and 1280×720 screenshots, inspect logs, then
   commit `feat(ui): integrate approved shell navigation`.

**Rollback boundary**: one commit; reverting it restores the existing main
workspace and settings modal without touching backend configuration.

### Milestone 2 — Production Live page

**Create**

- `src-ui/views/app/main_page/main_section/live_control_rail/LiveControlRail.jsx`
- `src-ui/views/app/main_page/main_section/live_control_rail/LiveControlRail.module.scss`
- `src-ui/views/app/main_page/main_section/live_control_rail/SessionPrimaryAction.jsx`
- `src-ui/views/app/main_page/main_section/live_control_rail/SessionPrimaryAction.module.scss`
- `src-ui/logics/common/useStreamerPrivacy.js`
- `src-ui/views/app/main_page/main_section/__tests__/approvedLivePage.test.js`

**Modify**

- `src-ui/logics/common/index.js`
- `src-ui/views/app/main_page/main_section/live_language_bar/LiveLanguageBar.jsx`
- `src-ui/views/app/main_page/main_section/live_language_bar/LiveLanguageBar.module.scss`
- `src-ui/views/app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.jsx`
- `src-ui/views/app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.module.scss`
- `src-ui/views/app/main_page/main_section/resource_monitor/ResourceMonitor.jsx`
- `src-ui/views/app/main_page/main_section/resource_monitor/ResourceMonitor.module.scss`
- `src-ui/views/app/main_page/main_section/resource_monitor/GpuMonitorMenu.jsx`
- `src-ui/views/app/main_page/main_section/pipeline_status/PipelineStatus.jsx`
- `src-ui/views/app/main_page/main_section/pipeline_status/PipelineStatus.module.scss`
- `src-ui/views/app/main_page/main_section/message_container/MessageContainer.jsx`
- `src-ui/views/app/main_page/main_section/message_container/MessageContainer.module.scss`
- `src-ui/views/app/main_page/main_section/message_container/log_box/message_container/MessageContainer.jsx`
- `src-ui/views/app/main_page/main_section/message_container/log_box/message_container/MessageContainer.module.scss`
- `src-ui/views/app/main_page/main_section/__tests__/liveWorkspaceRedesign.test.js`
- `locales/en.yml`, `locales/ja.yml`, `locales/ko.yml`, `locales/th.yml`, `locales/zh-Hans.yml`, `locales/zh-Hant.yml`

**Implementation**

- Add the approved 290px control rail with colored Speaking, Listening, and
  Translating controls that retain current individual real toggles plus a
  primary real Start/Stop session action. Pending/backend-unavailable states
  remain non-interactive and visible.
- Use persisted language profile selectors/cards and real provider controls.
- Make translations first in the conversation hierarchy, original speech
  secondary, while retaining progressive status, retry, sent/received
  semantics, text entry, and OSC/chatbox path.
- Compact real resource telemetry and a real GPU selector; privacy mode hides
  hardware names without inventing names or values. Do not display latency
  until actual pipeline data exists.
- Put diagnostics behind an accessible collapsed-by-default disclosure.

**Test-first gate and commit**: focused tests first, then the full UI suite,
Vite build, real Tauri screenshots/log/startup smoke; commit
`feat(ui): connect approved live workspace`.

**Rollback boundary**: UI/store-only commit. Existing backend endpoints and
message schema remain unchanged.

### Milestone 3 — Guided Setup

**Create**

- `src-ui/views/app/main_page/setup/GuidedSetup.jsx`
- `src-ui/views/app/main_page/setup/GuidedSetup.module.scss`
- `src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js`

**Modify**

- `src-ui/views/app/main_page/MainPage.jsx`
- `src-ui/views/app/main_page/MainPage.module.scss`
- locale files listed in Milestone 2

**Implementation**

- Deliver the approved compact stepper for speaking language, translation
  target, microphone, desktop audio, and VRChat output. It uses the existing
  searchable language dialog and `useDevice`/`useOthers` setters directly.
- Show saved configuration as the initial state; Next/Back never reset data.
- If OSC availability cannot be verified by the current backend, show the
  truthful availability state and retain the real output toggle rather than
  adding a decorative test action.

**Test-first gate and commit**: assert persisted hook usage and setup route
semantics; run focused/full/UI build/Tauri/screenshots; commit
`feat(ui): add guided setup flow`.

**Rollback boundary**: new route files plus route switch only; configuration
protocol is unchanged.

### Milestone 4 — Engines and Models

**Create**

- `src-ui/views/app/main_page/engines/EnginesWorkspace.jsx`
- `src-ui/views/app/main_page/engines/EnginesWorkspace.module.scss`
- `src-ui/views/app/main_page/models/ModelsHub.jsx`
- `src-ui/views/app/main_page/models/ModelsHub.module.scss`
- `src-ui/views/app/main_page/main_section/__tests__/enginesAndModels.test.js`
- `src-python/tests/test_dual_transcription_engine_config.py`

**Modify**

- `src-python/config.py`
- `src-python/controller.py`
- `src-python/mainloop.py`
- `src-python/model.py`
- `src-ui/logics/configs/config_page_setter/ui_config_setter.js`
- `src-ui/logics/useReceiveRoutes.js`
- `src-ui/views/app/config_page/setting_section/setting_box/transcription/Transcription.jsx`
- `src-ui/views/app/main_page/MainPage.jsx`
- `src-ui/views/app/main_page/MainPage.module.scss`
- locale files listed in Milestone 2

**Implementation**

- Add real paired outgoing/incoming engines and compute settings with the
  migration described above; preserve legacy fields/endpoints.
- Display the approved beginner choices: Automatic — Recommended, Fast,
  Balanced, and Best accuracy. Automatic is an explained recommendation based
  on actual selected device/model availability; it never silently chooses an
  uninstalled or potentially unsuitable model.
- Bind model cards to actual engine/model state, active selection, downloads,
  progress, errors, device selection, and CTranslate2 fallback. Underlying
  provider keys, decoding, model lists, and specialist tuning remain in
  Advanced settings.
- Do not fabricate separate source state if a backend operation cannot accept
  it; the implementation adds the required backward-compatible backend state
  first.

**Test-first gate and commit**: migration/config/model source tests fail first;
then run relevant Python tests plus focused/full UI, Vite, Tauri/screenshots;
commit `feat(engines): add source-aware engine and model controls`.

**Rollback boundary**: a single backend/UI migration commit. Older config files
remain accepted; reverting source code leaves legacy global values readable.

### Milestone 5 — Overlay Studio

**Create**

- `src-ui/views/app/main_page/overlay_studio/OverlayStudio.jsx`
- `src-ui/views/app/main_page/overlay_studio/OverlayStudio.module.scss`
- `src-ui/views/app/desktop_overlay/DesktopOverlayPreview.jsx`
- `src-ui/views/app/desktop_overlay/DesktopOverlayPreview.module.scss`
- `src-ui/logics/common/desktopOverlaySettings.js`
- `src-ui/logics/common/__tests__/desktopOverlaySettings.test.js`
- `src-ui/views/app/main_page/main_section/__tests__/overlayStudio.test.js`

**Modify**

- `src-ui/views/app/desktop_overlay/DesktopOverlayApp.jsx`
- `src-ui/views/app/desktop_overlay/DesktopOverlayApp.module.scss`
- `src-ui/views/app/desktop_overlay/DesktopOverlayBridge.jsx`
- `src-ui/logics/common/desktopOverlayWindow.js`
- `src-ui/logics/common/index.js`
- `src-ui/views/app/main_page/MainPage.jsx`
- `src-ui/views/app/main_page/MainPage.module.scss`
- `src-ui/views/app/config_page/setting_section/setting_box/vr/Vr.jsx`
- `src-ui/logics/ui_configs.js`
- locale files listed in Milestone 2

**Implementation**

- Extract common desktop-overlay settings/payload handling so the Studio and
  actual overlay use one persisted representation.
- Provide real message-driven desktop and VR previews, not static sample text.
- Bind theme/accent, opacity, scale, translation-only, small/large VR mode,
  tracker, and reset controls to real settings. Synchronize selected accent
  values across desktop and VR settings.
- Persist valid desktop geometry; enforce the current minimum size constraints;
  wire Reset Size and Fit to Content to the actual desktop overlay window via
  a safe message bridge. Auto size is only offered where an actual computed
  size can be applied.

**Test-first gate and commit**: test storage migration/geometry validation,
actual preview data path, and control routing; run required verification; commit
`feat(overlay): add production overlay studio`.

**Rollback boundary**: compatible overlay storage defaults and the pre-existing
VR settings remain usable if the commit is reverted.

### Milestone 6 — Notifications, accessibility, and responsive polish

**Create**

- `src-ui/views/app/others/snackbar_controller/__tests__/approvedNotifications.test.js`
- `src-ui/views/app/main_page/main_section/__tests__/responsiveApprovedShell.test.js`

**Modify**

- `src-ui/views/app/others/snackbar_controller/SnackbarController.jsx`
- `src-ui/views/app/others/snackbar_controller/SnackbarController.module.scss`
- `src-ui/views/app/others/snackbar_controller/ReactToastifyOverrideClass.scss`
- all route/page styles introduced in Milestones 1–5 as needed
- `src-ui/views/app/_index_css/root.css`
- locale files listed in Milestone 2

**Implementation**

- Move notifications to bottom-left and use a contained, labelled close
button. Preserve manual dismiss, hover pause, persistent critical errors, and
the notification store.
- Add the approved green→amber→red lifetime indicator using CSS without
altering true duration semantics.
- Audit focus rings, labels, semantic states, reduced motion, and 1280×720
layout so critical content does not become an oversized vertical stack.

**Test-first gate and commit**: test toast bounds/pause/persistence and
responsive selectors before style changes; run all mandated checks and capture
real Tauri screenshots; commit `fix(ui): polish notifications and responsive accessibility`.

**Rollback boundary**: presentational and accessibility-only changes.

### Milestone 7 — README and hardware/performance communication

**Create**

- `src-ui/logics/common/__tests__/readmeHardwareGuidance.test.js`

**Modify**

- `README.md`

**Implementation**

- Add the required CPU/NVIDIA statement prominently and explain local runtime
dependencies, package size, model downloads, RAM/VRAM, CPU latency, and cloud
engine internet requirements in ordinary-user language.

**Test-first gate and commit**: add the wording contract test, then run
focused/full UI checks and Vite build; launch and screenshot the current Tauri
app as the milestone gate requires; commit `docs: clarify VRCNT hardware and model requirements`.

**Rollback boundary**: documentation-only commit.

### Milestone 8 — Full regression verification and CUDA build

**Create**

- no production source files unless a verification failure has a traced root
  cause and its fix is covered by a new failing regression test.

**Verify**

1. Run `npm run test:ui` and `npm run vite-build`.
2. Run the relevant Python suite, including all new configuration/migration
   tests, and practical Rust tests with `CARGO_TARGET_DIR` set only for that
   invocation.
3. Search production source (excluding tests and the handoff/reference trees)
   for `mock`, `fake`, `demo`, `placeholder`, `TODO`, and `not implemented`;
   review and report every intentional result.
4. Launch the worktree's real Tauri application and exercise navigation,
   session toggles, language/device changes, models, Overlay Studio,
   notification dismissal, settings persistence after restart, and all three
   target layouts. Capture final screenshots at 1920×1080, 1366×768, and
   1280×720.
5. Run the final command exactly with
   `CARGO_TARGET_DIR=C:\Users\ANXE\Desktop\Coding\VRCNT-Next\src-tauri\target`
   set only for the command: `npm run build-cuda`.
6. Wait for completion; verify exit code, CUDA sidecar existence/nonzero size,
   Vite/Rust/Tauri success, installer/executable timestamp/nonzero size, launch
   the built executable, and verify successful startup/navigation.
7. Copy only final distributables—not the Cargo target cache—into
   `release-output\ui-codex-ux-integration\` inside this worktree.

**Commit boundary**: commit only a traced verification fix after it has its own
failing-first regression test; otherwise no code commit is created for a clean
verification pass.

## Startup compatibility risks and mitigations

| Risk | Mitigation |
| --- | --- |
| UI mounts before the sidecar signals ready | Primary controls use existing `useIsBackendReady`; default UI shows loading/disabled state rather than fake telemetry. |
| New source-engine values collide with legacy config | Config-load migration seeds both source values from the global value; legacy endpoints synchronize both values. |
| Model/device change restarts a live pipeline | Keep the controller restart lock, backend error settlement, and current source-generation safety checks. |
| Desktop overlay settings break a separate window | Use version-tolerant defaults and local-storage migration; communicate through the existing channel and validate geometry. |
| Shared environments are mutated by Vite | Configure a cache directory in the isolated worktree; do not install or update dependencies. |
| Native sidecar is absent in a fresh worktree | Produce it only through the existing CUDA build toolchain in the UI worktree; never junction `src-tauri/bin` or `src-tauri/target`. |

## Verification evidence to retain for final report

- main/UI worktree paths, base SHA, final SHA, branch, and exact junctions;
- per-milestone commit SHA and message;
- focused test failure and success, full UI suite and Vite output for each
  milestone;
- Python/Rust test output and source audit results;
- actual Tauri screenshots at all required sizes, app/log startup evidence,
  and final CUDA build duration;
- final sidecar, executable, and installer paths with timestamps and sizes;
- explicit confirmation that main source files were untouched and nothing was
  pushed, merged, rebased, reset, or published.
