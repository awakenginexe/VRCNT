# VRCNT 5.2.0 Whisper Thai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Thai-only Whisper speech engine with six explicit-download-only Thai models, independent profile model selection, offline-safe Thai Small compatibility handling, localized UI support, tests, and the 5.2.0 CUDA build.

**Architecture:** Extend the existing transcription engine/profile model with a `Whisper Thai` provider slot while preserving normal Whisper and all legacy migrations. Reuse the existing Whisper runtime manager, storage root, download lifecycle, status routes, and UI model-card components; isolate Thai catalog validation and forced-language behavior from normal Whisper. Keep recommendations and startup downloads normal-Whisper-only.

**Tech Stack:** Python 3, faster-whisper 1.2.1, CTranslate2 4.6.0, Hugging Face Hub 0.32.2, unittest, React 18, Jotai/i18next, Vite, Tauri/CUDA build scripts.

## Global Constraints

- Persist the engine identity exactly as `Whisper Thai`.
- Use the six approved model IDs and visible names from the approved design.
- Store Thai models at `weights/whisper/<model-id>`; do not create a second weight root.
- Thai runtime inference must always pass `language="th"`; no detection, fallback, or engine switching.
- Thai language UI is Thai-only and locked while Thai is active; saved normal/other language settings must not be overwritten.
- Thai selected models are independent from normal Whisper selected models in both send and receive profiles.
- Reuse normal Whisper CPU/GPU and compute behavior; do not create duplicate Thai hardware settings.
- Thai model downloads are explicit-only; selecting Thai must not cause any automatic download.
- Keep Thai Advanced-only and exclude every Thai model from Fast, Balanced, Best Accuracy, and hardware recommendations.
- Keep normal Whisper validation and behavior unchanged.
- Do not add Transformers or PyTorch inference.
- Thai Small may be downloaded for compatibility/load testing; do not automatically download the other large Thai models.
- Do not launch VRCNT, use a microphone, record/play audio, control desktop applications, push, merge, tag, or release.
- Run the final CUDA build only after automated tests and model compatibility verification.

---

### Task 1: Establish design and model-catalog contracts

**Files:**
- Modify: `src-python/models/transcription/transcription_profile.py`
- Modify: `src-python/config.py`
- Modify: `src-python/controller.py`
- Create/modify: `src-python/models/transcription/transcription_whisper_thai.py`
- Test: `src-python/tests/test_transcription_profiles.py`
- Test: `src-python/tests/test_dual_transcription_engine_config.py`

**Interfaces:**
- `TRANSCRIPTION_ENGINES` includes `Whisper Thai`.
- The profile model map contains `Whisper Thai` independently of `Whisper`.
- The Thai catalog exports stable IDs, display metadata, repository metadata, and the Thai default.
- Legacy configuration normalization adds a Thai model value without changing saved normal Whisper values.

- [ ] **Step 1: Write failing profile/catalog tests**

Add tests asserting that a normalized profile retains literal normal and Thai selections simultaneously, that an old profile missing the Thai slot receives the approved default, and that the selectable engine/model descriptors expose six Thai models with the approved names and the Experimental qualifier.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```powershell
& C:\Users\ANXE\Desktop\Coding\VRCNT\.venv\Scripts\python.exe -m unittest src-python.tests.test_transcription_profiles src-python.tests.test_dual_transcription_engine_config
```

Expected result: failure because `Whisper Thai` and its model slot/catalog are absent.

- [ ] **Step 3: Implement the catalog and profile normalization**

Add a focused Thai catalog module and extend profile defaults, selectable model maps, effective-profile identity, legacy migration, controller accessors, and compatibility mirrors. Use the approved IDs exactly. Do not alter the normal Whisper model list.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the same unittest command and confirm zero failures.

- [ ] **Step 5: Commit the catalog/profile milestone**

```powershell
git add src-python/models/transcription/transcription_profile.py src-python/models/transcription/transcription_whisper_thai.py src-python/config.py src-python/controller.py src-python/tests/test_transcription_profiles.py src-python/tests/test_dual_transcription_engine_config.py
git commit -m "feat: add Whisper Thai profile catalog"
```

### Task 2: Add isolated Thai model validation/download metadata

**Files:**
- Modify: `src-python/models/transcription/transcription_whisper.py`
- Create/modify: `src-python/models/transcription/transcription_whisper_thai.py`
- Modify: `src-python/model.py`
- Modify: `src-python/controller.py`
- Modify: `src-python/mainloop.py`
- Test: `src-python/tests/test_whisper_runtime.py`
- Test: new `src-python/tests/test_whisper_thai_models.py`

**Interfaces:**
- `checkWhisperThaiWeight(root, model_id)` validates each Thai model according to its catalog metadata.
- `downloadWhisperThaiWeight(root, model_id, callback, end_callback)` downloads only the explicitly requested Thai model.
- Normal `checkWhisperWeight` remains strict and unchanged for normal Whisper.
- Thai status/download routes use the existing progress/error lifecycle with Thai-specific payload identifiers.

- [ ] **Step 1: Write failing validation/download contract tests**

Use temporary directories and catalog fixtures to assert that normal validation still rejects a missing tokenizer, Thai models with complete files are accepted, incomplete Thai model directories are rejected, unknown Thai IDs are refused, and the Thai download function requests only one selected repository rather than starting any startup batch.

- [ ] **Step 2: Run the new tests and verify the expected failure**

Run:

```powershell
& C:\Users\ANXE\Desktop\Coding\VRCNT\.venv\Scripts\python.exe -m unittest src-python.tests.test_whisper_thai_models
```

Expected result: failure because the Thai catalog/checker/downloader/routes do not exist.

- [ ] **Step 3: Implement Thai validation and explicit download handling**

Keep normal Whisper code paths untouched. Add Thai repository metadata, required-file policies, safe temporary-file downloads, explicit Thai status/progress/error callbacks, controller endpoints, and model helper methods. For Thai Small, implement a self-contained tokenizer path only after the authorized compatibility check in Task 6 proves the source tokenizer is compatible.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the new test module plus `src-python.tests.test_whisper_runtime` and confirm zero failures.

- [ ] **Step 5: Commit the Thai model-management milestone**

```powershell
git add src-python/models/transcription/transcription_whisper.py src-python/models/transcription/transcription_whisper_thai.py src-python/model.py src-python/controller.py src-python/mainloop.py src-python/tests/test_whisper_runtime.py src-python/tests/test_whisper_thai_models.py
git commit -m "feat: add explicit Whisper Thai model management"
```

### Task 3: Add Thai-only runtime language routing

**Files:**
- Modify: `src-python/models/transcription/transcription_language_policy.py`
- Modify: `src-python/models/transcription/transcription_languages.py`
- Modify: `src-python/models/transcription/transcription_transcriber.py`
- Modify: `src-python/model.py`
- Test: `src-python/tests/test_transcription_language_policy.py`
- Test: `src-python/tests/test_transcription_transcriber_pipeline.py`

**Interfaces:**
- Thai runtime language capability exposes one Thai-only slot.
- `AudioTranscriber` has an explicit Thai branch that invokes the existing Whisper lease with `language="th"`.
- Normal Whisper continues to use its existing restricted-language/detection path.

- [ ] **Step 1: Write failing Thai-language tests**

Add tests proving Thai returns exactly one Thai runtime slot, rejects/locks non-Thai language choices at the policy boundary, calls the Whisper lease with `language="th"` without restricted detection, and leaves normal Whisper's multi-language path unchanged.

- [ ] **Step 2: Run focused tests and verify the expected failure**

```powershell
& C:\Users\ANXE\Desktop\Coding\VRCNT\.venv\Scripts\python.exe -m unittest src-python.tests.test_transcription_language_policy src-python.tests.test_transcription_transcriber_pipeline
```

Expected result: failure because the Thai capability and transcriber branch are absent.

- [ ] **Step 3: Implement forced Thai routing**

Add the Thai capability and language-code mapping, route both microphone and received sources through the Thai model lease, force `language="th"`, skip detection/fallback, and map the result back to Thai. Preserve the saved language profile data when engines switch.

- [ ] **Step 4: Run focused backend tests and verify they pass**

Run the same command and confirm zero failures, then run the complete Python transcription test group.

- [ ] **Step 5: Commit the runtime-language milestone**

```powershell
git add src-python/models/transcription/transcription_language_policy.py src-python/models/transcription/transcription_languages.py src-python/models/transcription/transcription_transcriber.py src-python/model.py src-python/tests/test_transcription_language_policy.py src-python/tests/test_transcription_transcriber_pipeline.py
git commit -m "feat: force Thai language for Whisper Thai"
```

### Task 4: Add backend profile lifecycle and no-auto-download behavior

**Files:**
- Modify: `src-python/controller.py`
- Modify: `src-python/mainloop.py`
- Modify: `src-python/model.py`
- Test: `src-python/tests/test_dual_transcription_engine_config.py`
- Test: relevant controller/startup tests under `src-python/tests/`

**Interfaces:**
- Both microphone and received profiles acquire the selected Thai model independently.
- A Thai-selected startup never starts a normal or Thai download.
- Switching engine/profile preserves both selected model values.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests using the existing controller/model seams to assert that Thai profile changes publish/restart the correct source, that `models.Whisper` and `models["Whisper Thai"]` survive engine switches, and that startup download selection returns no download target while Thai is active.

- [ ] **Step 2: Run the tests and verify the expected failure**

Run the focused controller/profile suite and confirm failures identify missing Thai lifecycle behavior.

- [ ] **Step 3: Implement profile/runtime/download lifecycle**

Extend controller profile setters, status collection, startup selection, model lease acquisition, and route registration. Keep normal Whisper automatic startup behavior only for an active normal Whisper profile. Never auto-download any Thai model.

- [ ] **Step 4: Run focused backend regression tests**

Run the profile, config, runtime, language policy, and transcriber test modules. Confirm all pass.

- [ ] **Step 5: Commit the lifecycle milestone**

```powershell
git add src-python/controller.py src-python/mainloop.py src-python/model.py src-python/tests
git commit -m "feat: preserve Thai profiles and explicit startup behavior"
```

### Task 5: Add legacy/modern UI, language lock, and localization

**Files:**
- Modify: `src-ui/views/app/main_page/sidebar_section/language_settings/transcription_engine_label/transcription_engine_selector/TranscriptionEngineSelector.jsx`
- Modify: `src-ui/views/app/main_page/sidebar_section/language_settings/transcription_engine_label/TranscriptionEngineLabel.jsx`
- Modify: `src-ui/views/app/main_page/sidebar_section/language_settings/transcriptionRuntimeUtils.js`
- Modify: `src-ui/views/app/config_page/setting_section/setting_box/transcription/Transcription.jsx`
- Modify: `src-ui/views/app/main_page/models/ModelsHub.jsx`
- Modify: `src-ui/views/app/main_page/engines/EnginesWorkspace.jsx`
- Modify: `src-ui/views/app/main_page/engines/engineModelUtils.js`
- Modify: `src-ui/views/app/main_page/engines/transcriptionProfileUi.js`
- Modify: `src-ui/logics/configs/config_page_setter/ui_config_setter.js`
- Modify: `src-ui/logics/configs/config_page_setter/useSettingsLogics.js`
- Modify: `src-ui/logics/ui_configs.js`
- Modify: `src-ui/logics/useReceiveRoutes.js`
- Modify: `locales/en.yml`, `locales/th.yml`, `locales/ja.yml`, `locales/ko.yml`, `locales/zh-Hans.yml`, `locales/zh-Hant.yml`
- Test: existing frontend transcription/model/localization suites under `src-ui/**/__tests__/`

**Interfaces:**
- The engine selector displays `Whisper Thai`.
- Thai active language controls show Thai only and are disabled.
- Legacy and modern model selectors expose all six approved names and statuses.
- Thai models are Advanced-only and never enter recommendation presets.

- [ ] **Step 1: Write failing UI tests**

Add behavior tests for the Thai engine option, Thai model/status map, profile control visibility, Thai-only language lock, independent normal/Thai active-model labels, six advanced rows, and visible Experimental text. Add locale-key parity assertions for all six locale files.

- [ ] **Step 2: Run the UI tests and verify the expected failure**

```powershell
npm --prefix C:\Users\ANXE\Desktop\Coding\VRCNT run test:ui
```

Expected result: failures because the Thai engine/model/UI contracts are absent. If the worktree has no local `node_modules`, use the existing workspace Node installation or create a nontracked junction to the approved root dependency directory; do not alter package dependencies.

- [ ] **Step 3: Implement the UI and locale changes**

Reuse existing model download containers and profile-backed selectors. Add Thai labels and metadata, Thai-specific status/download endpoints, language-lock rendering, model selection preservation, and Advanced-only grouping. Keep normal Whisper recommendation arrays and automatic hardware logic unchanged.

- [ ] **Step 4: Run focused UI and locale tests**

Run the frontend test command and the locale/model/profile test files individually. Confirm zero failures and no missing translation keys.

- [ ] **Step 5: Commit the UI milestone**

```powershell
git add src-ui locales
git commit -m "feat: add Whisper Thai UI and localization"
```

### Task 6: Validate and assemble Thai Small through the authorized runtime path

**Files:**
- Modify only if evidence requires it: `src-python/models/transcription/transcription_whisper_thai.py`
- Test: new `src-python/tests/test_whisper_thai_tokenizer_compatibility.py`
- External validation cache: nontracked model files under the worktree/application weight directory

**Interfaces:**
- The compatibility test compares authoritative source tokenizer data with CT2 model metadata and current faster-whisper token handling.
- The actual VRCNT faster-whisper loader initializes the assembled Thai Small model without network tokenizer fallback.

- [ ] **Step 1: Add failing tokenizer-compatibility tests**

Write deterministic tests for token lookup and special-token IDs using downloaded source/CT2 metadata fixtures. Assert the exact presence and ID consistency of `<|th|>`, `<|transcribe|>`, `<|translate|>`, `<|notimestamps|>`, timestamp boundaries, and multilingual language-token assumptions.

- [ ] **Step 2: Run the tests and verify the expected failure**

Run the compatibility test before assembling the model; it must fail because the Thai Small local directory is not yet self-contained.

- [ ] **Step 3: Download only Thai Small and authoritative metadata**

Use the pinned `.venv` environment and Hugging Face APIs/downloads for `Thaweewat/whisper-th-small-ct2` plus `biodatlab/whisper-th-small-combined`. Do not download Medium, Large V2, Large V3, Distilled Large V3, or mort666 Large V3 unless a concrete blocker requires one.

- [ ] **Step 4: Implement the evidence-based self-contained assembly**

Copy only compatible runtime files into `weights/whisper/thai-thonburian-small`, retaining the CT2 `config.json`, `model.bin`, and `vocabulary.json`, and adding source tokenizer/preprocessor files only when the compatibility comparison proves they match the CT2 model's expected vocabulary and special-token IDs.

- [ ] **Step 5: Run compatibility tests and the real faster-whisper load test**

Initialize the model through the same `getWhisperModel` path used by VRCNT with `local_files_only=True`. Report exact outcome. If no repository-local audio fixture exists, do not fabricate audio; model initialization alone is the verified result.

- [ ] **Step 6: Commit only source/test changes, not large downloaded weights**

```powershell
git add src-python/models/transcription/transcription_whisper_thai.py src-python/tests/test_whisper_thai_tokenizer_compatibility.py
git commit -m "test: validate Thai Small tokenizer compatibility"
```

### Task 7: Version, regression verification, and final CUDA build

**Files:**
- Modify: `package.json`
- Modify: generated/version targets through `utils/update_version.py`
- Modify: only any release metadata updated by the existing version script
- Test: all existing backend/frontend tests

**Interfaces:**
- The project version is 5.2.0 using the existing update mechanism.
- The final CUDA build completes without changing dependency pins.

- [ ] **Step 1: Run the complete automated test suites before versioning**

Run the complete Python test suite with the pinned environment, the complete UI test command, locale/parity tests, and `git diff --check`. Fix regressions with new failing tests before implementation changes.

- [ ] **Step 2: Update the version using the existing mechanism**

Set `package.json` to `5.2.0`, then run `npm run update-version` from the feature worktree. Review every generated diff and ensure only intended version/release metadata changed.

- [ ] **Step 3: Run the final CUDA build**

```powershell
npm run build-cuda
```

Allow the existing build script to perform its normal clean/update/build sequence. Do not launch the application. Record exit status and preserve artifacts for manual testing.

- [ ] **Step 4: Verify final requirements and worktree state**

Check the six-model catalog, Thai-only UI/backend behavior, independent normal/Thai model persistence, explicit-only Thai downloads, recommendation exclusion, locale parity, model-load evidence, version 5.2.0, build exit status, `git diff --check`, and `git status`.

- [ ] **Step 5: Create the final implementation commit**

```powershell
git add .
git commit -m "feat: add Whisper Thai transcription engine"
```

Do not push, merge, tag, release, or create a pull request.
