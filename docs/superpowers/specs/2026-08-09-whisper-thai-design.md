# VRCNT 5.2.0 Whisper Thai Design

**Status:** Approved for implementation on 2026-08-09.

## Goal

Add Whisper Thai as a separate, Thai-only transcription engine in VRCNT 5.2.0. It must reuse VRCNT's existing faster-whisper/CTranslate2 runtime, retain an independent Thai model selection for microphone and received-audio profiles, remain Advanced-only, and require explicit user downloads.

## Approved model catalog

The persisted engine identity is `Whisper Thai`. Model IDs are globally unique and stored under the existing `weights/whisper/<model-id>` root:

| ID | User-facing name | Repository | Family/source |
| --- | --- | --- | --- |
| `thai-thonburian-small` | Thonburian Thai Small (Experimental) | `Thaweewat/whisper-th-small-ct2` | BioDataLab / Thonburian Whisper; source `biodatlab/whisper-th-small-combined` |
| `thai-thonburian-medium` | Thonburian Thai Medium | `Vinxscribe/biodatlab-whisper-th-medium-faster` | BioDataLab / Thonburian Whisper; source `biodatlab/whisper-th-medium-combined` |
| `thai-thonburian-large-v2` | Thonburian Thai Large V2 | `mort666/faster-whisper-large-v2-th` | BioDataLab / Thonburian Whisper; source `biodatlab/whisper-th-large-combined` |
| `thai-thonburian-large-v3-int8` | Thonburian Thai Large V3 INT8 | `Avocaduu14/whisper-th-large-v3-ct2` | BioDataLab / Thonburian Whisper; source `biodatlab/whisper-th-large-v3-combined` |
| `thai-thonburian-distilled-large-v3` | Thonburian Thai Distilled Large V3 | `pariya47/distill-whisper-th-large-v3-ct2` | BioDataLab / Thonburian Whisper; source `biodatlab/distill-whisper-th-large-v3` |
| `thai-mort666-large-v3-fp16` | mort666 Thai Large V3 FP16 | `mort666/whisper-large-v3-th-f16-faster` | mort666 Thai Whisper fine-tune; source `mort666/whisper-large-v3-th-fp16` |

Only the packaged Thai Small CT2 model carries the visible `(Experimental)` qualifier. Converter/hosting accounts are not presented as the underlying fine-tune authors.

## Profile and runtime design

`Whisper Thai` is added to the selectable transcription engines and to the per-profile model map. Each send/receive profile stores both `models.Whisper` and `models["Whisper Thai"]`, so switching engines never overwrites either selection. Existing normal Whisper profile data is migrated unchanged, with a validated Thai default added for older configurations.

Thai uses the existing Whisper device and compute settings; no second hardware-selection system is introduced. The shared Whisper decoding profile and runtime preference behavior remain in place. The runtime branch is explicit: Thai acquires its selected Thai model, calls faster-whisper with `language="th"`, and never calls multilingual language detection or engine fallback. Normal Whisper retains its current code path.

The existing `WhisperRuntimeManager`, `WhisperRuntimeKey`, model leasing, inference serialization, unload behavior, error mapping, and both source directions are reused. Unique Thai model IDs prevent runtime/storage collisions in the existing Whisper root.

## Thai language UX

When `Whisper Thai` is active, the language UI presents Thai only and disables language changes. The user's saved normal Whisper and other-engine language profiles are not overwritten. Switching back restores the previously saved normal behavior. The backend independently enforces `language="th"` so UI state cannot cause detection, fallback, or an engine switch.

The Thai engine has a one-language runtime capability. Existing multilingual language settings remain persisted separately and are not destructively normalized when the engine changes.

## Model loading and Thai Small compatibility

The existing checker must remain strict for normal Whisper. Thai model validation is isolated behind a Thai catalog/loader policy. The first Thai Small repository lacks `tokenizer.json`, so it must not be accepted as complete while relying on faster-whisper's network fallback.

Phase B is authorized to download only Thai Small for compatibility validation. The implementation will compare the authoritative source tokenizer from `biodatlab/whisper-th-small-combined` against the CT2 model's vocabulary/config and the current faster-whisper tokenizer behavior. Compatibility checks cover vocabulary size, token IDs, `<|th|>`, `<|transcribe|>`, `<|translate|>`, `<|notimestamps|>`, timestamp ranges, beginning-of-transcript tokens, multilingual assumptions, and model vocabulary/config metadata.

If compatible, the explicit Thai Small download produces a self-contained local model directory containing only the runtime-required CT2 and tokenizer/preprocessor files. If compatibility cannot be established, Thai Small remains isolated and visibly experimental; normal Whisper and the other Thai models are not weakened or made network-dependent.

No Transformers or PyTorch inference is added. No larger Thai model binaries are downloaded during development unless a specific implementation blocker requires one.

## Download and startup behavior

Thai model downloads are explicit-only from legacy Settings and modern Speech Models. Selecting Thai never downloads a Thai model, a normal Whisper model, or a recommendation. Normal Whisper retains its current startup behavior only when normal Whisper itself is active.

Thai download progress, completion, error, installed-state, and selected-state handling use the existing Whisper flow with Thai-specific model identifiers and status data. The modern model hub adds `Whisper Thai · Advanced models`; Thai models are excluded from Fast, Balanced, Best Accuracy, and hardware recommendations.

## UI and localization

Legacy Settings → Model & Provider adds the separate engine and switches to a six-model Thai selector while active. Modern Speech Models displays the same six rows, friendly names, family/source metadata where supported, and the visible Experimental qualifier.

All six locale files retain key parity. New engine/model labels and Thai-only language-lock text are localized with English fallbacks consistent with the existing i18n system.

## Versioning and verification

After implementation and verification, the existing version mechanism updates the project to 5.2.0. The final CUDA build is run only after focused tests, full automated tests, Thai Small load validation, localization checks, and regression checks pass. No push, merge, tag, release, GUI launch, microphone access, or desktop control is permitted.
