# DeepSeek API Translation Provider — Approved Design

**Status:** approved design; implementation has not started.  
**Date:** 2026-08-03  
**Repository baseline:** local `main` at `08d63ad65c7a90063ee646838afcae51d22cf424`  
**Feature branch:** `feature/deepseek-api-translation`

## 1. Scope and invariants

VRCNT will add one dedicated, user-supplied-key DeepSeek translation provider to the existing Python-owned cloud-translation architecture. It will call only the official OpenAI-compatible DeepSeek API at `https://api.deepseek.com`; it will not use OpenRouter, a proxy, arbitrary compatible endpoints, or custom model IDs.

The only selectable models are:

- `deepseek-v4-flash`, the default and normal translation model;
- `deepseek-v4-pro`, an explicit quality-focused option.

Normal DeepSeek translation is non-streaming Chat Completions with thinking explicitly disabled. It sends the current text, a dedicated translation system prompt, and normalized source and target language names only. It never sends prior conversation history automatically, tools, JSON-output instructions, or a `user_id`. It consumes only the final message `content`; it never reads, returns, persists, logs, or forwards `reasoning_content`.

DeepSeek is a single provider in the current configured provider order. A missing credential, connection failure, or DeepSeek-specific error can never disable or reorder another provider. Existing source/target language normalization, per-generation scheduling, fallback, cancellation, and stale-result suppression remain authoritative.

## 2. Existing architecture integration points

The React settings UI communicates with the Python backend through `src-python/mainloop.py` routes. `src-python/controller.py` owns setting mutations, provider authentication, model selection, and the current provider-status updates. `src-python/model.py` is the thin controller-facing facade. `src-python/models/translation/translation_translator.py` owns provider dispatch, attempt classification, cooldowns, and the shared context-provider locking pattern.

`SourcePipeline` and the manual retry coordinator snapshot selected providers and translation context for each generation. They suppress callbacks from invalidated generations, and existing scheduler tests document that a running provider call cannot be force-killed safely. DeepSeek therefore receives a bounded HTTP timeout and participates in the existing invalidation behavior: an overdue or stale completion may finish at the transport layer but must never update the UI, overlay, history, or output pipeline.

`translation_settings/languages/languages.yml` is the provider-specific display-language to API-language normalization source. The feature adds a `DeepSeek_API` mapping with the same canonical language values supported by the existing OpenAI-style translation flow. It is a first-class mapping, not a UI-side alias, so `Translator.getLanguageCode()` continues to be the only conversion path.

Rust/Tauri remains responsible for packaging and launching the Python sidecar; it does not make DeepSeek HTTP requests. No frontend network request is made to DeepSeek.

## 3. Dedicated client

`translation_deepseek.py` will define a narrowly scoped `DeepSeekClient`. It will use the already present Python OpenAI SDK with a fixed base URL and a hard-coded two-model allowlist. It will expose only the responsibilities needed by the translation dispatcher:

- accept the saved key through the existing provider configuration boundary;
- validate a requested model against the fixed allowlist;
- perform an explicit connection test using the official API without revealing the key;
- create one non-streaming chat-completions request for a translation;
- translate response and transport failures into typed provider errors; and
- return a trimmed, non-empty final-content string or a typed failure.

The request has exactly one system message and one user message. It sets `stream=False` and `extra_body={"thinking": {"type": "disabled"}}`. It does not set `response_format`, `tools`, `tool_choice`, a custom endpoint, or an arbitrary model ID. It treats a missing choice, non-string content, empty/whitespace content, malformed response, or a finish reason that cannot yield usable final text as a provider failure.

The client must not use `reasoning_content` for output or for subsequent turns. A client test will fail if production code accesses that field.

## 4. Dedicated translation prompt

`translation_deepseek.yml` will be separate from the existing OpenAI-family prompt files. Its system prompt will state the source and target languages, require only the translation, and require preservation of meaningful formatting, URLs, placeholders, names, emoji, and line breaks when appropriate. It will explicitly prohibit explanations, labels, quotes added solely as framing, chain-of-thought, and JSON.

Its history configuration is permanently disabled for v1 (`use_history: false`, zero sources, zero message and character limits). The dispatcher may still pass the normal empty context value through its standard call shape, but the DeepSeek client will not render or send it. This preserves pipeline compatibility while ensuring that no prior chat, microphone, or speaker text reaches DeepSeek by default.

## 5. API-key configuration and persistence

DeepSeek follows VRCNT's established user-supplied cloud-provider key flow. A user pastes a key into Settings, saves or replaces it, may test it, and then enables DeepSeek or places it in the existing provider order. The key is persisted through the existing `Config.AUTH_KEYS` configuration mechanism with the new `DeepSeek_API` entry; this feature adds no provider-specific storage subsystem or dependency.

The `AUTH_KEYS` default schema adds `"DeepSeek_API": None`. Its exact-key validation/load path receives a narrow safe schema migration: a legacy saved `AUTH_KEYS` object missing only `DeepSeek_API` is normalized by adding the default `None`; it preserves all existing provider values. There is no key migration because DeepSeek is new. `SELECTED_DEEPSEEK_MODEL` defaults to `"deepseek-v4-flash"` and accepts only the two fixed official IDs.

The existing startup/provider-authentication path reads the saved DeepSeek key from configuration and authenticates it using the dedicated client. A missing key leaves DeepSeek unavailable for provider selection and lets the normal fallback flow continue. An invalid or insufficient-balance result is provider-specific runtime health state; it neither deletes another provider's key nor changes another provider's availability.

## 6. Backend, frontend, and settings contract

The backend follows the existing provider get/set/delete/model route convention and adds separate routes for:

- getting, saving, replacing, and removing the DeepSeek API key through the normal provider configuration channel;
- configuration/health status, returning only `not_configured`, `configured`, `invalid_credentials`, `insufficient_balance`, or a transient failure status;
- testing the saved key; and
- reading and selecting one of the two fixed model IDs.

The key getter is limited to the existing Settings hydration/edit flow; translation results, provider-status messages, connection-test results, and diagnostic events never contain the key. The save route persists the user-entered key through `Config.AUTH_KEYS["DeepSeek_API"]`. The controller must not follow existing provider methods that log an incoming key or echo it in a non-key response.

The Translation settings section adds a DeepSeek block without redesigning the page: provider documentation link, real password-type input, Save/Replace action, Remove action, Test connection action, configured status, error status, and a disabled-until-configured two-item model dropdown. When the existing key getter hydrates the field, `type="password"` masks it visually; the UI never shows the full key as plain text and never uses an edit cover over a plaintext input.

The connection test is explicit and does not change selected-provider order, overwrite the credential, or enable another provider. A successful test marks the current DeepSeek credential usable for the process. Failure states are visible and actionable but do not block settings navigation or unrelated translators.

## 7. Provider selection, request flow, and fallback

When DeepSeek appears in the configured order, `Translator._translate_once()` dispatches it to the dedicated client. It is added to the existing provider lock table so a shared client cannot mix concurrent request state. Since the dedicated client ignores context history, the lock protects client lifecycle rather than conversation state.

For each scheduled attempt:

1. The pipeline snapshots provider order and language/context data as it does today.
2. If no readable credential is available, DeepSeek is skipped as unavailable and the existing fallback selection continues.
3. The dispatcher converts display languages through `DeepSeek_API` language mappings and issues the bounded non-streaming request.
4. A successful non-empty final content produces the normal success attempt.
5. Any DeepSeek failure becomes a typed attempt outcome and lets the current scheduler use its configured fallback provider or local fallback.
6. Generation invalidation suppresses all stale completion callbacks; no provider call can resurrect an old translation.

This feature does not change how many providers the scheduler attempts, how other provider orders are persisted, or how free/local fallback is selected.

## 8. Failure, retry, timeout, cooldown, and cancellation policy

| Condition | DeepSeek result | Scheduler effect |
| --- | --- | --- |
| No saved key | unavailable/not configured | Skip DeepSeek; continue normal fallback. |
| HTTP 401 | invalid credentials | Mark DeepSeek invalid for this attempt; continue fallback; never delete another provider. |
| HTTP 402 | insufficient balance | Report the provider-specific balance state; continue fallback. |
| HTTP 429 | rate-limited error with parsed Retry-After when supplied | Use `Translator`'s existing cooldown mechanism; continue fallback. |
| HTTP 500 or 503, or transient network failure | transient provider error | Retry once only when the existing attempt deadline still permits it; otherwise continue fallback. |
| Timeout | provider timeout | Use the existing timeout quarantine/cooldown behavior and continue fallback. |
| Malformed, empty, or unusable final response | provider error | Continue fallback. |

The retry is one additional request at most, with a short bounded delay and no retry for 401, 402, 429, malformed responses, or cancellation/invalidation. Both client HTTP timeout and retry budget are bounded by the existing provider-attempt deadline; retry must never create an unbounded waiting path. DeepSeek errors are namespaced to DeepSeek and cannot mutate unrelated provider statuses or cooldowns.

## 9. Privacy, redaction, and diagnostics

The only user text sent to DeepSeek is the current translation request plus the source and target language prompt values. No previous conversation, transcript history, tool output, local file content, machine identifier, or personal `user_id` is sent.

Credential values and authorization material are confidential at every boundary. A redaction helper will sanitize exception text, request metadata, headers, and diagnostic payloads before `printLog`, `errorLogging`, controller responses, or frontend notifications receive them. It must redact Bearer values, API-key-shaped strings, and authorization headers. Tests will assert that a known test key never appears in a log event, exception response, UI screenshot/fixture, or provider-status payload. The key is persisted only through the existing API-key configuration mechanism.

Translation diagnostics may name the provider, model, non-secret error category, retry/cooldown duration, and request duration. They must not contain request headers, response reasoning, raw request text beyond the application's existing safe diagnostic policy, or any credential value.

## 10. Test strategy

Focused automated coverage will include:

- config migration from configurations whose `AUTH_KEYS` object has no `DeepSeek_API` entry, fixed-model validation, key persistence, and preservation of existing provider settings;
- dedicated-client payload construction: official base URL, fixed models, `stream=False`, thinking disabled, no history, no tools, no JSON mode, and final-content-only extraction;
- missing, empty, malformed, reasoning-only, 401, 402, 429, 500, 503, timeout, and one-retry failure paths;
- scheduler dispatch, provider lock, cooldown, fallback, stale-generation suppression, and cancellation behavior;
- controller and route contracts proving keys are excluded from logs, errors, translation results, provider-status messages, and connection-test results;
- frontend password input, masked normal display, Save/Replace, Remove, Test connection, configured/error statuses, and fixed model choices; and
- regression coverage that Google, Bing, Gemini, OpenAI, local translation, source/target normalization, and existing fallback behavior remain unaffected.

All API and key-configuration tests are hermetic: mocked OpenAI responses, deterministic clock/retry controls, and isolated test configuration. They make no DeepSeek network call and use no real key.

## 11. Explicit non-goals

- Refactoring existing OpenAI-compatible providers into a generic abstraction.
- Migrating existing provider secrets away from the current config mechanism.
- Arbitrary endpoint URLs, model IDs, OpenRouter routing, or a VRCNT proxy.
- Streaming, partial translation rendering, JSON output, tool/function calls, Responses API usage, or reasoning display.
- Automatic or opt-in conversation-history transmission in this feature.
- New provider-order semantics, global retry redesign, Tauri/Rust translation HTTP, or a broad Settings UI redesign.

## 12. Specification self-review

This specification contains no placeholders or deferred product choices. It fixes the official endpoint and two allowed model IDs, uses VRCNT's existing `AUTH_KEYS` persistence path, defines the error-to-fallback behavior, and explicitly excludes related provider refactoring or a broader security migration. The DeepSeek UI uses a real password input and the implementation redacts secrets from logs and non-key responses without changing the lifecycle of existing API-key providers.
