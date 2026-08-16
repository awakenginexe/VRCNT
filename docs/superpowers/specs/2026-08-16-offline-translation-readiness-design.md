# Offline Translation Readiness and Compute Device Design

## Goal

Make CTranslate2 become selectable immediately after an explicitly downloaded
model has been verified, without requiring an application restart. Restore the
CPU/GPU processing-device and compute-type controls on both the Translation
Models page and the legacy Model & Provider settings surface. Bump the
application version to `5.7.0` while keeping the existing release-version
parity contract intact.

## Context and current behavior

The application already has the required local CTranslate2 state and device
settings:

- The backend tracks the selected CTranslate2 weight type, weight/tokenizer
  validity, translation-engine availability, selected compute device, and
  selected compute type.
- The frontend already has the reusable `ComputeDevice` control and the
  backend routes for reading and changing the selected device and compute
  type.
- A model download reports its model-row completion through
  `/run/downloaded_ctranslate2_weight`, but it does not republish the
  translation-engine availability map.
- The availability map is recomputed during startup, which is why a restart
  currently makes a newly downloaded model usable.
- The current Model & Provider `TranslationModels` component does not render
  the existing compute-device control. The older Translation settings box has
  a duplicate/local instance, so the two relevant surfaces are not backed by
  one shared presentation path.

The readiness rule remains strict: the selected model is ready only when both
its CTranslate2 weights and tokenizer pass the existing validity checks. A
downloaded non-selected model must not silently activate Offline Translation or
change the selected model.

## Requirements

1. After an explicit download completes, refresh the selected-model readiness
   and publish the current translation-engine list in the same running
   process.
2. Selecting a downloaded model must refresh and publish readiness immediately;
   selecting an uninstalled or invalid model must leave CTranslate2
   unavailable until that selected model becomes valid.
3. Failed or incomplete weight/tokenizer verification must keep CTranslate2
   unavailable and must not enable Offline Translation.
4. Preserve the existing local-only activation policy. No new network request
   may be introduced by a readiness refresh, model selection, or device
   selection.
5. Render CPU/GPU device selection and CTranslate2 compute-type selection on
   both the Translation Models page and Model & Provider. Both surfaces must
   use the existing backend-backed settings and the existing localized labels.
6. Keep the current activation guard: changing the selected model or compute
   settings while translation is active must retain existing behavior.
7. Set all release-version sources maintained by the repository's version
   updater to `5.7.0`, including package metadata, Tauri metadata, Python
   configuration, frontend software-version state, release documentation, and
   lockfile entries covered by the existing release-version test.

## Design

### Backend readiness publication

Add a controller-level helper responsible for refreshing the availability of
the currently selected CTranslate2 model. It will check the selected weight
type with the existing weight and tokenizer validators, derive one boolean
readiness result, update the existing CTranslate2 weight-status and
translation-engine status values, and refresh the in-memory readiness cache
when present.

The helper will be called at the two state transitions that currently leave
stale availability:

- after the download completion callback has verified the downloaded model;
- after `setCtranslate2WeightType` changes the selected model.

After either transition, the controller will call the existing
`updateTranslationEngineAndEngineList` broadcaster. That keeps the current
frontend route contract: `/run/translation_engines` and
`/run/selected_translation_engines` deliver the new availability without a
restart or a frontend-only polling/refetch workaround.

The download callback will continue to report the model-row completion status
and error status as it does today. The readiness refresh is additive and will
run against the selected model, so downloading a different model cannot
unexpectedly enable the currently selected Offline Translation engine.

The existing activation-time readiness guard remains authoritative. The new
publication path only keeps the UI and engine list current; it does not bypass
the weight/tokenizer checks used before loading an Offline Translation model.

### Shared compute-device UI

Create a small CTranslate2-specific wrapper around the existing `ComputeDevice`
component. The wrapper will read the current device list, selected device,
selected compute type, and their setters from `useTranslation`, then render
the localized translation compute-device label.

Render this wrapper inside the shared `TranslationModels` component. Since that
component is used by both the Translation Models page and the Model & Provider
settings box, both surfaces receive the same control and stay synchronized
through the existing settings state. The older Translation settings box will
reuse the same wrapper instead of maintaining a second field mapping.

The device control will keep the existing backend semantics:

- CPU and available CUDA devices come from
  `selectable_translation_compute_device_list`;
- the compute-type choices come from the selected device's supported
  CTranslate2 compute types;
- device changes continue to reset compute type to the backend's `auto`
  default through the existing setter;
- no new device detection or download behavior is introduced.

The control will appear with the model settings before the model cards, so the
processing choice is visible wherever the user chooses an Offline Translation
model. Existing model-card layout, selection rules, progress reporting, and
localized strings remain unchanged.

### Version update

Set the canonical package version to `5.7.0`, run the repository's existing
version propagation script, and update any remaining tracked release-facing
documentation or frontend version constants required by the release-version
contract. The release-version test will be used to detect drift. This task
does not create a release, tag, push, or installer artifact.

## Error handling and compatibility

- If either selected-model validator returns false, readiness is false.
- If verification raises or the completion path reports an error, the engine
  remains unavailable and the existing error route is preserved.
- If the selected model is changed to one that is not downloaded, the backend
  publishes the unavailable state immediately rather than waiting for a
  restart.
- Existing engine-selection persistence is preserved; the engine may remain
  selected in state while unavailable, but activation remains blocked by the
  normal readiness guard.
- Internal model and engine identifiers remain unchanged. User-facing labels
  continue to use localized strings.
- Cloud translation providers and non-CTranslate2 model flows are out of
  scope.

## Verification

Add regression coverage before production changes for:

1. selected-model readiness publication after a model selection change;
2. download completion triggering the same availability publication;
3. compute-device settings being rendered by the shared Translation Models
   surface and reused by the legacy Translation settings surface;
4. version parity at `5.7.0`.

Run the focused Python tests with the repository virtual environment, the
complete UI test suite, and the release-version test. Review the final diff
and working tree for unrelated changes. After verification, run
`npm run dev-cuda` and leave the development application running for manual
testing. The development launch is an explicit user-requested test step and
is not treated as release validation.
