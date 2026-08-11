# First-launch Setup Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the discoverable Guided Setup route with an update-safe first-launch onboarding flow containing six clear setup steps, persistent Finish/Skip behavior, and progressive transcription/translation controls.

**Architecture:** Persist one `SETUP_COMPLETED` boolean in the existing Python configuration. Missing state in an existing config migrates to complete; a truly new config starts incomplete. Expose that setting through the existing initialization/config route registry and let a startup controller select the setup experience once after backend initialization. Keep `GuidedSetup` as the onboarding shell, move the new Transcription and Translation controls into a focused child component, and reuse existing profile, provider, model-catalog, and download APIs.

**Tech Stack:** React 18, Jotai-backed config hooks, i18next YAML locales, Vite source-contract tests with Node’s built-in test runner, Python `unittest`, and the existing Tauri sidecar protocol.

## Global Constraints

- Work on the existing `feature/color-customization` branch.
- Keep the application version at `5.5.0` in `package.json` and the Python config.
- Remove `Guided Setup` from the top navigation while keeping the normal top-bar shell available during onboarding.
- Finish and Skip must both persist setup completion and route to Live permanently.
- Existing configurations without the new field must never open onboarding during an update.
- A new installation with no config file must remain pending until Finish or Skip.
- Keep existing language slots, transcription profile identifiers, translation provider identifiers, model identifiers, and backend safeguards.
- Use the existing six locale files and preserve key/interpolation parity.
- Add no dependencies and do not change installer behavior.
- Write each production change only after its focused failing test is observed.
- Do not add co-authors to commits.

---

## File map

### Backend persistence and routes

- Modify `src-python/config.py` to define, resolve, migrate, and serialize `SETUP_COMPLETED`.
- Modify `src-python/controller.py` to expose `getSetupCompleted` and `setSetupCompleted`.
- Modify `src-python/mainloop.py` to register setup-completion get/set endpoints.
- Create `src-python/tests/test_setup_completion.py` for new-install, update-migration, explicit-state, and route contracts.

### Frontend startup and config wiring

- Modify `src-ui/logics/configs/config_page_setter/ui_config_setter.js` to register `SetupCompleted` in an `Onboarding` category.
- Modify `src-ui/logics/configs/index.js` to export `useOnboarding`.
- Create `src-ui/views/app/_app_controllers/FirstRunSetupController.jsx` to choose the setup route once after initialization.
- Modify `src-ui/views/app/_app_controllers/index.js` and `src-ui/views/app/App.jsx` to mount the controller.
- Create `src-ui/logics/common/firstRunSetupState.js` for the pure route-decision predicate.
- Create `src-ui/logics/common/__tests__/firstRunSetupState.test.js` for that predicate.

### Navigation and onboarding UI

- Modify `src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.jsx` to remove the setup item and its special-case route handling.
- Modify `src-ui/views/app/main_page/guided_setup/GuidedSetup.jsx` to implement the six-step flow, app-language control, corrected language semantics, audio/VRChat step placement, and Finish/Skip persistence.
- Modify `src-ui/views/app/main_page/guided_setup/GuidedSetup.module.scss` for the new step layout, skip action, and expanded controls.
- Create `src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.jsx` for simple and Advanced engine/provider/model controls.
- Create `src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.module.scss` for the step’s two disclosure states and warning/status rows.
- Create `src-ui/views/app/main_page/guided_setup/transcriptionTranslationSetupUtils.js` for pure profile/provider/model option helpers.

### Tests and localization

- Modify `src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js` for the six-step and persistence contract.
- Modify `src-ui/views/app/main_page/main_section/__tests__/approvedShellNavigation.test.js` for the removed setup navigation item.
- Create `src-ui/views/app/main_page/main_section/__tests__/transcriptionTranslationSetup.test.js` for default/Advanced controls and warning behavior.
- Modify `src-ui/logics/common/__tests__/mainPageLocalization.test.js` to require the new setup keys in every locale.
- Modify `locales/en.yml`, `locales/ja.yml`, `locales/ko.yml`, `locales/th.yml`, `locales/zh-Hans.yml`, and `locales/zh-Hant.yml` with the new setup copy.

---

### Task 1: Persist setup completion with update-safe migration

**Files:**
- Create: `src-python/tests/test_setup_completion.py`
- Modify: `src-python/config.py`
- Modify: `src-python/controller.py`
- Modify: `src-python/mainloop.py`

**Interfaces:**
- Produces `_resolveSetupCompletion(config_file_exists: bool, persisted_value: object = None) -> bool` in `src-python/config.py`.
- Produces `Controller.getSetupCompleted(*args, **kwargs) -> dict` returning `{"status": 200, "result": bool}`.
- Produces `Controller.setSetupCompleted(data, *args, **kwargs) -> dict`, persisting `data is True` and returning the resulting boolean.
- Produces `/get/data/setup_completed` and `/set/data/setup_completed` backend endpoints.

- [ ] **Step 1: Write the failing migration tests**

Create a focused test module with the same `sys.path` setup used by `src-python/tests/test_vrcnt_data_migration.py`:

```python
import unittest

from config import _resolveSetupCompletion


class SetupCompletionTests(unittest.TestCase):
    def test_new_install_starts_incomplete(self):
        self.assertIs(_resolveSetupCompletion(False), False)


    def test_existing_config_without_state_migrates_to_complete(self):
        self.assertIs(_resolveSetupCompletion(True), True)


    def test_explicit_false_survives_resume(self):
        self.assertIs(_resolveSetupCompletion(True, False), False)


    def test_explicit_true_stays_complete(self):
        self.assertIs(_resolveSetupCompletion(False, True), True)
```

Add unittest methods rather than pytest-only collection so the repository’s Python test command can run the file directly. Add source-contract assertions for the controller method names and both endpoint strings after the first RED run is established.

- [ ] **Step 2: Run the migration test to verify it fails**

Run:

```powershell
python -m unittest discover -s src-python/tests -p "test_setup_completion.py" -v
```

Expected: FAIL because `_resolveSetupCompletion` and the setup route methods do not exist.

- [ ] **Step 3: Write the minimal persisted state**

In `src-python/config.py`:

1. Add `_resolveSetupCompletion` near the existing user-data migration helpers. Return an explicit boolean unchanged; when the persisted value is absent or invalid, return `bool(config_file_exists)`.
2. Add `SETUP_COMPLETED = ManagedProperty('SETUP_COMPLETED', type_=bool)` in the serialized config properties.
3. Initialize `self._SETUP_COMPLETED = False` with the other saved main-window state.
4. In `load_config`, capture whether `PATH_CONFIG` existed before reading it. After raw config data is loaded and legacy properties are applied, resolve `_SETUP_COMPLETED` with the captured existence flag and raw `SETUP_COMPLETED` value, then let the existing `saveConfigToFile()` persist the normalized field.

In `src-python/controller.py`, add:

```python
@staticmethod
def getSetupCompleted(*args, **kwargs) -> dict:
    return {"status": 200, "result": config.SETUP_COMPLETED}

def setSetupCompleted(self, data, *args, **kwargs) -> dict:
    config.SETUP_COMPLETED = data is True
    return {"status": 200, "result": config.SETUP_COMPLETED}
```

In `src-python/mainloop.py`, add the two `/get/data/setup_completed` and `/set/data/setup_completed` mappings beside the other main-window persisted settings.

- [ ] **Step 4: Run the migration test to verify it passes**

Run the same unittest command. Expected: PASS for all new-install, migration, explicit-state, and endpoint contract tests.

- [ ] **Step 5: Commit the backend state slice**

```powershell
git add src-python/config.py src-python/controller.py src-python/mainloop.py src-python/tests/test_setup_completion.py
git commit -m "feat: persist first-run setup state"
```

### Task 2: Wire setup state into frontend initialization

**Files:**
- Create: `src-ui/logics/common/firstRunSetupState.js`
- Create: `src-ui/logics/common/__tests__/firstRunSetupState.test.js`
- Modify: `src-ui/logics/configs/config_page_setter/ui_config_setter.js`
- Modify: `src-ui/logics/configs/index.js`
- Create: `src-ui/views/app/_app_controllers/FirstRunSetupController.jsx`
- Modify: `src-ui/views/app/_app_controllers/index.js`
- Modify: `src-ui/views/app/App.jsx`

**Interfaces:**
- Produces `shouldOpenFirstRunSetup({ isBackendReady: boolean, setupCompleted: boolean, alreadyDecided: boolean }) -> boolean`.
- Produces `useOnboarding()` with `currentSetupCompleted`, `updateSetupCompleted`, `getSetupCompleted`, `setSetupCompleted`, and `updateFromBackendSetupCompleted` through the existing config-hook generator.
- Produces a controller that routes to `setup` once when backend initialization reports `SetupCompleted === false`.

- [ ] **Step 1: Write the failing pure-state and wiring tests**

Test the predicate with these cases:

```js
assert.equal(shouldOpenFirstRunSetup({ isBackendReady: false, setupCompleted: false, alreadyDecided: false }), false);
assert.equal(shouldOpenFirstRunSetup({ isBackendReady: true, setupCompleted: true, alreadyDecided: false }), false);
assert.equal(shouldOpenFirstRunSetup({ isBackendReady: true, setupCompleted: false, alreadyDecided: false }), true);
assert.equal(shouldOpenFirstRunSetup({ isBackendReady: true, setupCompleted: false, alreadyDecided: true }), false);
```

Add source assertions that `SETTINGS_ARRAY` contains `Category: "Onboarding"`, `Base_Name: "SetupCompleted"`, and `base_endpoint_name: "setup_completed"`; `configs/index.js` exports `useOnboarding`; the new controller uses `updateExperienceRoute("setup")`; and `App.jsx` mounts `FirstRunSetupController`.

- [ ] **Step 2: Run the frontend wiring test to verify it fails**

Run:

```powershell
node --test src-ui/logics/common/__tests__/firstRunSetupState.test.js
```

Expected: FAIL because the predicate, setting registration, and controller do not exist.

- [ ] **Step 3: Write the minimal config wiring and one-time controller**

Add this setting entry to `SETTINGS_ARRAY`:

```js
{
    Category: "Onboarding",
    Base_Name: "SetupCompleted",
    default_value: false,
    ui_template_id: "toggle",
    logics_template_id: "get_set",
    base_endpoint_name: "setup_completed",
},
```

Export `useOnboarding = createCategoryHook("Onboarding")` from `src-ui/logics/configs/index.js`. The existing generated route list will then include the setting in initialization and route responses.

Implement `shouldOpenFirstRunSetup` exactly as the four assertions describe. In `FirstRunSetupController`, use a ref to prevent a second decision, wait for `currentIsBackendReady.data === true` and `currentSetupCompleted.state === "ok"`, close the config page, and route to `setup` only when the value is false. Mount the controller after `StartPythonController` in `App.jsx` and export it from the controller index.

- [ ] **Step 4: Run the wiring test to verify it passes**

Run the focused Node test again. Expected: PASS.

- [ ] **Step 5: Commit the frontend initialization slice**

```powershell
git add src-ui/logics/common/firstRunSetupState.js src-ui/logics/common/__tests__/firstRunSetupState.test.js src-ui/logics/configs/config_page_setter/ui_config_setter.js src-ui/logics/configs/index.js src-ui/views/app/_app_controllers/FirstRunSetupController.jsx src-ui/views/app/_app_controllers/index.js src-ui/views/app/App.jsx
git commit -m "feat: route new installs to setup"
```

### Task 3: Remove Guided Setup from permanent navigation

**Files:**
- Modify: `src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.jsx`
- Modify: `src-ui/views/app/main_page/main_section/__tests__/approvedShellNavigation.test.js`
- Modify: `src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js`

**Interfaces:**
- The navigation item list no longer contains `{ id: "setup", ... }`.
- `openItem` no longer has an `item.id === "setup"` branch.
- The setup route remains supported by `MainPage.jsx` for the startup controller.

- [ ] **Step 1: Add failing navigation assertions**

Add these assertions to the existing navigation test:

```js
assert.doesNotMatch(navigation, /id:\s*"setup"/);
assert.doesNotMatch(navigation, /item\.id === "setup"/);
```

Keep the existing assertion that `MainPage.jsx` still mounts `<GuidedSetup />` for the `setup` experience route.

- [ ] **Step 2: Run the focused navigation tests to verify the new assertions fail**

Run:

```powershell
node --test src-ui/views/app/main_page/main_section/__tests__/approvedShellNavigation.test.js src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js
```

Expected: the new absence assertions fail against the current navigation source.

- [ ] **Step 3: Remove only the permanent navigation entry and special case**

Delete the setup object from `NAVIGATION_ITEMS` and delete the setup-specific branch from `openItem`. Do not remove the `setup` branch from `MainPage.jsx` or the `<TopBar />` rendered by onboarding.

- [ ] **Step 4: Run the focused navigation tests to verify they pass**

Run the same Node test command. Expected: PASS.

- [ ] **Step 5: Commit the navigation slice**

```powershell
git add src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.jsx src-ui/views/app/main_page/main_section/__tests__/approvedShellNavigation.test.js src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js
git commit -m "refactor: remove setup from top navigation"
```

### Task 4: Build the App language, Language, and Translation steps

**Files:**
- Modify: `src-ui/views/app/main_page/guided_setup/GuidedSetup.jsx`
- Modify: `src-ui/views/app/main_page/guided_setup/GuidedSetup.module.scss`
- Modify: `src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js`

**Interfaces:**
- `SETUP_STEPS` contains exactly six entries with IDs 1 through 6 and label keys for App language, Language, Translation, Audio, Transcription and Translation, and VRChat.
- Step 1 consumes `useAppearance().currentUiLanguage` and `setUiLanguage`.
- Step 2 preserves `setSelectedYourLanguages` and `setSelectedTargetLanguages` for speaking and incoming languages.
- Step 3 uses `setSelectedYourTranslationLanguages` only for the preferred incoming translation language.

- [ ] **Step 1: Add failing six-step and semantic-copy assertions**

Extend `guidedSetup.test.js` with source assertions for:

```js
for (const key of [
    "step_app_language",
    "step_language",
    "step_translation",
    "step_audio",
    "step_transcription_translation",
    "step_vrchat",
]) assert.match(setup, new RegExp(key));

assert.match(setup, /useAppearance/);
assert.match(setup, /currentUiLanguage/);
assert.match(setup, /setUiLanguage/);
assert.match(setup, /understanding_language/);
assert.match(setup, /setSelectedYourTranslationLanguages/);
assert.match(setup, /step === 6/);
```

- [ ] **Step 2: Run the guided-setup test to verify it fails**

Run:

```powershell
node --test src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js
```

Expected: FAIL because the current flow has four steps, no app-language control, and the old routing labels.

- [ ] **Step 3: Write the minimal six-step language surface**

Change the step array to:

```js
const SETUP_STEPS = [
    { id: 1, labelKey: "main_page.guided_setup.step_app_language" },
    { id: 2, labelKey: "main_page.guided_setup.step_language" },
    { id: 3, labelKey: "main_page.guided_setup.step_translation" },
    { id: 4, labelKey: "main_page.guided_setup.step_audio" },
    { id: 5, labelKey: "main_page.guided_setup.step_transcription_translation" },
    { id: 6, labelKey: "main_page.guided_setup.step_vrchat" },
];
```

Import `useAppearance` and `ui_configs`. Render Step 1 with a `CustomModernSelect` whose options come from `ui_configs.selectable_ui_languages`, whose value is `currentUiLanguage.data`, and whose change handler calls `setUiLanguage`.

Move the existing speaking-language selector and incoming target-language selectors into Step 2. Move the preferred translation-language selector into Step 3 and label it with `understanding_language`; do not render it in Step 2. Keep target slot keys `1`, `2`, and `3` and the existing `removeTargetLanguage` behavior.

Keep all selector descriptions in the existing `LanguageSelect` component so loading and empty states stay consistent. Add layout rules for the app-language selector and the separated language/translation step bodies without changing unrelated page scaling.

- [ ] **Step 4: Run the guided-setup test to verify it passes**

Run the focused test again. Expected: PASS for the six-step structure and new setting hook contracts.

- [ ] **Step 5: Commit the language-surface slice**

```powershell
git add src-ui/views/app/main_page/guided_setup/GuidedSetup.jsx src-ui/views/app/main_page/guided_setup/GuidedSetup.module.scss src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js
git commit -m "feat: restructure setup language steps"
```

### Task 5: Move Audio and VRChat controls and persist Finish/Skip

**Files:**
- Modify: `src-ui/views/app/main_page/guided_setup/GuidedSetup.jsx`
- Modify: `src-ui/views/app/main_page/guided_setup/GuidedSetup.module.scss`
- Modify: `src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js`

**Interfaces:**
- Step 4 renders the existing microphone and desktop-audio controls.
- Step 6 renders the existing OSC status and VRChat Chatbox toggles.
- `completeSetup()` calls `setSetupCompleted(true)`, closes config, and routes to `live`.
- `skipSetup()` calls `setSetupCompleted(true)`, closes config, and routes to `live` without requiring Step 6.

- [ ] **Step 1: Add failing placement and persistence assertions**

Require the source to contain `step === 4`, `step === 6`, `setSetupCompleted(true)`, a `skipSetup` handler, and the localized skip key. Assert that the existing device and Chatbox setters remain present.

- [ ] **Step 2: Run the guided-setup test to verify it fails**

Run the focused guided-setup Node test. Expected: FAIL because audio is currently Step 3, VRChat is Step 4, and no completion setter or Skip action exists.

- [ ] **Step 3: Write the minimal placement and actions**

Rename the current audio branch to `step === 4` and the current VRChat/output branch to `step === 6`. Replace `finishSetup` with a shared action that first calls `setSetupCompleted(true)`, then closes the config page and routes to Live; retain the existing success notification only for Finish.

Add a `Skip setup` button to the footer on every step. Its click handler must call `skipSetup`, and it must not change any language, device, engine, provider, or VRChat setting. Keep Back disabled on Step 1, Continue through Step 5, and Finish on Step 6.

- [ ] **Step 4: Run the guided-setup test to verify it passes**

Run the focused test again. Expected: PASS for step placement, persistent completion, and Skip presence.

- [ ] **Step 5: Commit the action slice**

```powershell
git add src-ui/views/app/main_page/guided_setup/GuidedSetup.jsx src-ui/views/app/main_page/guided_setup/GuidedSetup.module.scss src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js
git commit -m "feat: make setup finish and skip persistent"
```

### Task 6: Add the simple Transcription and Translation step

**Files:**
- Create: `src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.jsx`
- Create: `src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.module.scss`
- Create: `src-ui/views/app/main_page/guided_setup/transcriptionTranslationSetupUtils.js`
- Create: `src-ui/views/app/main_page/main_section/__tests__/transcriptionTranslationSetup.test.js`
- Modify: `src-ui/views/app/main_page/guided_setup/GuidedSetup.jsx`

**Interfaces:**
- `getSetupEngineOptions(engineList) -> Array<{id: string, title: string}>`.
- `getSetupTranslationProviderOptions(engineList) -> Array<{id: string, title: string}>`.
- `getOfflinePresetOptions(statuses, translate) -> Array<{id: string, title: string, modelId: string}>` using `getPresetTranslationModels`.
- `applyDefaultTranscriptionEngine(engine, setSendProfile, setReceiveProfile) -> void` calls both profile setters with `{ engine }`.
- `TranscriptionTranslationStep` renders the default controls and an Advanced toggle, with Advanced details added in Task 7.

- [ ] **Step 1: Write failing helper and component-contract tests**

Test that engine/provider options normalize arrays and objects, that the four offline preset IDs come from `getPresetTranslationModels`, and that the default engine helper calls both setters:

```js
const send = [];
const receive = [];
applyDefaultTranscriptionEngine("Whisper", (patch) => send.push(patch), (patch) => receive.push(patch));
assert.deepEqual(send, [{ engine: "Whisper" }]);
assert.deepEqual(receive, [{ engine: "Whisper" }]);
```

Add source assertions for `useTranscription`, `useTranslation`, `currentSelectableTranscriptionEngineList`, `setTranscriptionProfileSend`, `setTranscriptionProfileReceive`, `currentTranslationEngines`, `setSelectedTranslationEngines`, `getPresetTranslationModels`, and all four `main_page.preset.*` labels.

- [ ] **Step 2: Run the focused engine test to verify it fails**

Run:

```powershell
node --test src-ui/views/app/main_page/main_section/__tests__/transcriptionTranslationSetup.test.js
```

Expected: FAIL because the helper and child component do not exist.

- [ ] **Step 3: Write the minimal default controls**

Implement the pure helpers with no React or backend calls. In the component, consume:

- `useTranscription()` for both source profiles, selectable engines, and model status.
- `useLanguageSettings()` for primary/secondary provider selection and fallback state.
- `useTranslation()` for CTranslate2 model status, selected model, download action, and active translation state.
- `getPresetTranslationModels` and `getTranslationModelStatus` from the existing common catalog/status utilities.

Render three default fields:

1. Speech recognition engine: use the current outgoing engine as the displayed value; when it changes, call `applyDefaultTranscriptionEngine` so outgoing and incoming profiles stay aligned.
2. Translation service: show available providers from `currentTranslationEngines.data`; preserve the current selected provider when possible and call `setSelectedTranslationEngines` with the selected ID.
3. Offline translation model: show Fast, Balanced, Good, and Precise from the existing model catalog. Use the existing selected-model setter and download/status functions; do not invent identifiers or bypass the active-translation guard.

Show a short detail that the offline model is used when Offline Translation or fallback is active. Render an Advanced button and pass the current state/setters needed by Task 7.

Mount `<TranscriptionTranslationStep />` from `GuidedSetup.jsx` when `step === 5`.

- [ ] **Step 4: Run the focused engine test to verify it passes**

Run the same Node test command. Expected: PASS for helper behavior and default-control contracts.

- [ ] **Step 5: Commit the simple-controls slice**

```powershell
git add src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.jsx src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.module.scss src-ui/views/app/main_page/guided_setup/transcriptionTranslationSetupUtils.js src-ui/views/app/main_page/main_section/__tests__/transcriptionTranslationSetup.test.js src-ui/views/app/main_page/guided_setup/GuidedSetup.jsx
git commit -m "feat: add simple transcription translation setup"
```

### Task 7: Add Advanced transcription, translation, and warning controls

**Files:**
- Modify: `src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.jsx`
- Modify: `src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.module.scss`
- Modify: `src-ui/views/app/main_page/guided_setup/transcriptionTranslationSetupUtils.js`
- Modify: `src-ui/views/app/main_page/main_section/__tests__/transcriptionTranslationSetup.test.js`

**Interfaces:**
- `isWhisperTinyProfile(profile) -> boolean` returns true only for engine `Whisper` with model `tiny`.
- `getActiveProfileModelOptions(profile, statusesByEngine) -> Array<{id: string, title: string}>` exposes the current model and downloaded/available models for the selected engine.
- Advanced controls update only the selected source profile through `setTranscriptionProfileSend` or `setTranscriptionProfileReceive`.
- Parallel provider state is represented by the existing selected-provider array; fallback state is represented by `currentCTranslate2AutoFallback`.

- [ ] **Step 1: Write failing Advanced-control tests**

Add pure assertions:

```js
assert.equal(isWhisperTinyProfile({ engine: "Whisper", models: { Whisper: "tiny" } }), true);
assert.equal(isWhisperTinyProfile({ engine: "Whisper", models: { Whisper: "small" } }), false);
assert.equal(isWhisperTinyProfile({ engine: "Google", models: { Whisper: "tiny" } }), false);
```

Add source assertions for separate outgoing/incoming profile setters, `Whisper` tiny warning logic, `setCTranslate2AutoFallback`, a secondary provider selector, and the Advanced offline-model name selector.

- [ ] **Step 2: Run the engine test to verify it fails**

Run the focused Node test. Expected: FAIL because the Advanced helpers and controls do not exist.

- [ ] **Step 3: Write the Advanced controls**

When Advanced is open, render:

- Outgoing and Incoming speech-recognition sections, each with engine and engine-specific model selectors. Use the existing profile object shape and `getActiveModel`/`getProfileControlVisibility` utilities so supported models and fields follow the backend profile contract.
- An inline warning when `isWhisperTinyProfile(profile)` is true. The warning must be text, localized, and non-blocking.
- A primary provider selector and a “Use parallel service” toggle. When enabled, reveal a secondary provider selector and keep the selected-provider array at a maximum of two unique IDs.
- An offline fallback toggle bound to `currentCTranslate2AutoFallback.data` and `setCTranslate2AutoFallback`.
- An advanced offline-model selector using every `currentCTranslate2WeightTypeStatus.data` entry, displaying `display_name` with the technical identifier available in the option subtitle.

Keep authentication/unavailable behavior delegated to existing provider/model status APIs. Do not navigate to legacy Settings from this step; Advanced expands inline.

- [ ] **Step 4: Run the engine test to verify it passes**

Run the focused Node test again. Expected: PASS for profile separation, warning predicate, parallel/fallback wiring, and model-name control contracts.

- [ ] **Step 5: Commit the Advanced-controls slice**

```powershell
git add src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.jsx src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.module.scss src-ui/views/app/main_page/guided_setup/transcriptionTranslationSetupUtils.js src-ui/views/app/main_page/main_section/__tests__/transcriptionTranslationSetup.test.js
git commit -m "feat: add advanced setup engine controls"
```

### Task 8: Localize the redesigned setup surface

**Files:**
- Modify: `locales/en.yml`
- Modify: `locales/ja.yml`
- Modify: `locales/ko.yml`
- Modify: `locales/th.yml`
- Modify: `locales/zh-Hans.yml`
- Modify: `locales/zh-Hant.yml`
- Modify: `src-ui/logics/common/__tests__/mainPageLocalization.test.js`

**Interfaces:**
- Every locale contains the same `main_page.guided_setup` key names and interpolation variables.
- The English source copy includes the exact approved semantics:
  - `understanding_language: "Your understanding language"`
  - `understanding_language_detail: "The language VRCNT translates incoming speech into for you."`
  - `skip: "Skip setup"`
  - `tiny_whisper_warning: "Whisper tiny is mainly suitable for English and may perform poorly in other languages."`

- [ ] **Step 1: Add the locale-schema test**

Add a test that reads all six locale files and asserts each contains the required keys:

```js
for (const key of [
    "step_app_language", "step_language", "step_translation", "step_audio",
    "step_transcription_translation", "step_vrchat", "app_language_title",
    "language_title", "translation_title", "understanding_language",
    "understanding_language_detail", "transcription_translation_title",
    "speech_recognition_engine", "translation_service", "offline_translation_model",
    "advanced", "outgoing", "incoming", "tiny_whisper_warning", "skip",
]) {
    assert.match(locale, new RegExp(`\\n\\s+${key}:`));
}
```

- [ ] **Step 2: Run the locale test to verify it fails**

Run the focused localization and guided-setup Node tests. Expected: FAIL because the new keys are not yet present.

```powershell
node --test src-ui/logics/common/__tests__/mainPageLocalization.test.js src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js
```

- [ ] **Step 3: Add localized copy with matching schema**

Replace the old four-step labels and misleading routing strings with the six-step labels and copy used by the new components. Add localized values for app-language instructions, speaking/incoming language instructions, understanding-language semantics, default/Advanced engine controls, Fast/Balanced/Good/Precise model labels, provider/model loading states, Whisper warning, parallel/fallback controls, VRChat step labels, Skip, Finish, and completion notification.

Keep existing common keys such as `language_unavailable`, `device_unavailable`, `osc_ready`, `osc_unavailable`, `back`, `continue`, and `finish` when they remain referenced. Remove no locale key until the focused test confirms no component references it.

- [ ] **Step 4: Run the locale test to verify it passes**

Run the focused localization and guided-setup Node tests again. Expected: PASS for all six locale schemas and approved English wording.

```powershell
node --test src-ui/logics/common/__tests__/mainPageLocalization.test.js src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js
```

- [ ] **Step 5: Commit the localization slice**

```powershell
git add locales/en.yml locales/ja.yml locales/ko.yml locales/th.yml locales/zh-Hans.yml locales/zh-Hant.yml src-ui/logics/common/__tests__/mainPageLocalization.test.js
git commit -m "feat: localize redesigned setup flow"
```

### Task 9: Run regression verification and finish the branch

**Interfaces:**
- The branch has no uncommitted implementation or test changes after verification.
- `package.json` and `src-python/config.py` both remain at version `5.5.0`.

- [ ] **Step 1: Run the focused frontend suite**

Run:

```powershell
node --test src-ui/logics/common/__tests__/firstRunSetupState.test.js src-ui/views/app/main_page/main_section/__tests__/guidedSetup.test.js src-ui/views/app/main_page/main_section/__tests__/transcriptionTranslationSetup.test.js src-ui/views/app/main_page/main_section/__tests__/approvedShellNavigation.test.js
```

Expected: PASS with no source-contract failures.

- [ ] **Step 2: Run the focused backend persistence suite**

Run:

```powershell
python -m unittest discover -s src-python/tests -p "test_setup_completion.py" -v
python -m unittest discover -s src-python/tests -p "test_vrcnt_data_migration.py" -v
```

Expected: PASS for setup migration and existing VRCNT/VRCNT-Next data migration.

- [ ] **Step 3: Run the complete UI test command**

Run:

```powershell
npm run test:ui
```

Expected: PASS for the full registered UI test set.

- [ ] **Step 4: Build the frontend and inspect version state**

Run:

```powershell
npm run vite-build
node -e "const p=require('./package.json'); if(p.version !== '5.5.0') process.exit(1)"
rg -n "self\._VERSION = \"5\.5\.0\"" src-python/config.py
git diff --check
```

Expected: Vite exits 0, both version checks show `5.5.0`, and `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Review the final diff and record the verified branch state**

Run:

```powershell
git status --short
git diff --stat 2218bc33..HEAD
git log --oneline --decorate -8
```

Confirm the diff contains no installer changes, no unrelated UI scaling changes, no generated build output, and no user-data deletion. Confirm `git status --short` is empty; all implementation slices already have their own normal commits.
