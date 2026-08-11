# First-launch setup redesign

**Date:** 2026-08-11
**Status:** Approved

## Summary

Replace the discoverable Guided Setup top-bar route with an automatic first-launch landing flow. The flow introduces app-language selection, clearer language and translation semantics, audio setup, a progressive Transcription and Translation page, and VRChat output settings.

The setup decision is persisted by the backend configuration so it survives frontend storage resets and does not reopen for users upgrading an existing installation. Finish and Skip both permanently mark setup complete.

## Goals

- Show onboarding automatically only for a genuinely new installation.
- Treat an existing configuration during an application update as already set up.
- Persist Finish and Skip in the same durable completion state.
- Remove Guided Setup from the normal top navigation.
- Keep the existing top-bar shell and familiar navigation available while onboarding is open.
- Make the language-routing copy match the actual data flow.
- Give new users a simple engine/provider path while keeping detailed controls behind Advanced.
- Preserve the existing backend configuration fields and model/provider identifiers.
- Keep all six supported UI locales structurally complete.

## Non-goals

- Replacing the existing Settings pages or Engines & Audio workspace.
- Changing transcription, translation, or VRChat runtime behavior beyond setup selections.
- Introducing a second model catalog or a second provider-selection mechanism.
- Requiring installer-specific state or registry access from the frontend.

## Approved user flow

### Entry and shell

The normal app shell remains visible, including the top bar and its standard navigation. The `Guided Setup` navigation item is removed so onboarding is not a permanent destination in the product navigation.

After backend initialization, the app routes to setup when the persisted setup-completion value is false. Established users continue to Live. The setup page does not force users back from other pages after the initial routing decision.

### Step 1: App language

Present the existing supported UI-language list and update the persisted UI language immediately. The active locale must update the setup copy without losing the current step or selections.

### Step 2: Language

This step contains the user’s language profile:

- The language or languages the user speaks, used for microphone recognition.
- The incoming languages the user expects to hear through desktop audio.

It uses the existing selectable language list and language-profile setters. The existing maximums and slot structure remain unchanged.

### Step 3: Translation

The preferred incoming translation language is labeled:

> Your understanding language

Supporting copy:

> The language VRCNT translates incoming speech into for you.

This field maps to the existing preferred/received translation language configuration. It must not be described as the language sent with outgoing speech.

### Step 4: Audio

Retain the current microphone and desktop-audio controls:

- Automatic device selection toggles.
- Microphone host and device selectors when automatic selection is disabled.
- Desktop-audio device selector when automatic selection is disabled.

The existing device loading and unavailable states remain visible and localized.

### Step 5: Transcription and Translation

This page uses progressive disclosure. The default view is intentionally small and understandable; Advanced reveals controls that can change the outgoing and incoming pipelines independently.

#### Default view

Show:

- One speech-recognition engine selector. In default mode, its choice is applied to both outgoing/microphone and incoming/desktop-audio profiles.
- One primary translation-service selector using the existing provider catalog.
- Offline translation model choices named Fast, Balanced, Good, and Precise.

The offline choices use the existing preset catalog and identifiers:

| User label | Existing model identifier |
| --- | --- |
| Fast | `m2m100_418M-ct2-int8` |
| Balanced | `nllb-200-distilled-600M-ct2-int8` |
| Good | `nllb-200-distilled-1.3B-ct2-int8` |
| Precise | `madlad400-3b-mt-ct2-int8` |

Existing model download, readiness, and active-translation safeguards are reused. Selecting a preset must not invent a new model identifier or bypass download status.

#### Advanced view

An Advanced button expands the same page rather than navigating away.

For transcription it reveals independent Outgoing and Incoming sections. Each section can choose its own engine and, where supported, its model. Existing transcription profile send/receive APIs remain the source of truth.

When a Whisper profile uses the `tiny` model, show an inline warning that the model is primarily suitable for English and may perform poorly for other languages. The warning is informational and does not block selection.

For translation it reveals:

- Primary cloud translation service.
- Optional parallel translation service toggle and secondary provider.
- Optional offline CTranslate2 fallback toggle.
- Detailed offline model selection using the existing model names/identifiers and status controls.

The existing selected-provider array and CTranslate2 fallback setting remain the persisted representation. Provider authentication and unavailable states continue to use existing error handling.

### Step 6: VRChat

Retain the current OSC readiness indicator and Chatbox toggles for outgoing translations and received speech. The final action on this step is `Finish setup`.

### Navigation and Skip

Every step includes:

- Back when a previous step exists.
- Continue until Step 6.
- `Skip setup`.

Skip immediately marks setup complete and opens Live. Finish performs the same completion write, shows the existing completion notification, and opens Live. Neither action should make the setup page appear again on later launches.

## Persistence and update migration

Add a serialized boolean setup-completion field to the backend configuration, for example `SETUP_COMPLETED`.

During configuration loading:

1. If the config file contains the field, honor its boolean value.
2. If the field is absent but a config file already existed, treat the installation as established and set the field to true. This covers updates and legacy data migrations without showing new onboarding to existing users.
3. If no config file existed before the first load, initialize the field to false. The normal config save writes that pending state so an unfinished new-install flow can resume.
4. Always serialize the resulting field.

The existing VRCNT/VRCNT-Next data-directory migration and frozen-build local-data migration happen before this decision is evaluated, so migrated installations remain established.

Expose the field through the existing backend request/initialization route system. The frontend startup controller consumes it after initialization and chooses the initial experience route once. Finish and Skip use the normal persisted setter.

This avoids a frontend-only `localStorage` marker, which would be lost independently from user configuration and could cause updates or browser-data resets to reopen onboarding incorrectly.

## Localization

Update the guided-setup locale schema in:

- English
- Japanese
- Korean
- Thai
- Simplified Chinese
- Traditional Chinese

Add keys for the new step labels, app-language page, language split, understanding-language copy, transcription/translation default and advanced controls, Whisper warning, model availability, skip action, and completion behavior. Preserve interpolation parity across all locale files.

## Compatibility and accessibility

- Reuse standard selects, buttons, switches, and existing focus styles.
- Keep visible text for warnings and status; color alone is not sufficient.
- Keep loading and unavailable states explicit when backend catalogs are not ready.
- Ensure the setup remains usable at the project’s minimum supported desktop workspace.
- Preserve the app’s existing top-bar localization and responsive overflow behavior.

## Verification plan

### Frontend tests

- Setup route remains mounted and is selected when the completion state is false.
- Guided Setup is absent from the top navigation.
- The flow contains six steps with App language, Language, Translation, Audio, Transcription and Translation, and VRChat labels.
- Translation copy uses “Your understanding language” and incoming-translation semantics.
- Skip and Finish call the persisted completion setter and route to Live.
- Default and Advanced transcription/translation controls use the existing profile/provider/model APIs.
- Whisper `tiny` warning and Fast/Balanced/Good/Precise preset labels are present.
- All locale files contain the required key schema.

### Backend tests

- New config with no existing file initializes setup incomplete.
- Existing config without the new field migrates to setup complete.
- Explicit false remains false across save/load.
- Explicit true remains true across save/load.
- VRCNT-Next and frozen local-data migrations still count as established data.

### Build checks

- Run the focused UI tests first.
- Run the relevant Python config tests.
- Run the full UI test command and the applicable Python test subset.
- Run the production frontend build after implementation.

## Implementation boundaries

Likely implementation areas are the existing GuidedSetup component and styles, MainPage/startup routing, LiveWeaveNavigation, the config/store route registry, backend config/controller/mainloop initialization routes, six locale files, and focused regression tests. No installer or release metadata change is required because the persisted config migration distinguishes updates from genuinely new installs.
