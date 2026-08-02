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

- accept a credential only from the credential-store boundary;
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

## 5. Credential storage and configuration

### Credential-store abstraction

The feature introduces a small injected Python interface, for example `CredentialStore`, with write, read, delete, availability, and opaque-reference operations. Its first production implementation is Windows Credential Manager, reached through the Windows credential API without a plaintext fallback. Tests use an in-memory fake store injected into the client/controller composition path; they never read or write the real Windows Credential Manager.

A newly entered key is written under an opaque VRCNT DeepSeek credential target. The config stores only that opaque reference and non-secret state. The raw key is never put in `Config.AUTH_KEYS`, `config.json`, provider selections, model lists, response payloads, test fixtures, screenshots, or logs.

If Credential Manager is unavailable, disabled, or rejects an operation, the controller returns a clear credential-store-unavailable state. DeepSeek remains unconfigured and unavailable for provider selection. It must not fall back to plaintext config storage, environment variables, or an alternative key store.

### Non-secret config schema and migration

DeepSeek does not extend the existing `AUTH_KEYS` dictionary, whose exact-key validation would otherwise make legacy config loading brittle. It adds separate non-secret settings with defaults:

- `DEEPSEEK_CREDENTIAL_REFERENCE = None`
- `SELECTED_DEEPSEEK_MODEL = "deepseek-v4-flash"`
- runtime-only configured/health/provider-availability status derived from the credential store and the last operation.

The persisted credential reference is opaque and contains no API-key material. The existing selected-provider-order setting may contain `DeepSeek_API` only when its credential is configured and the provider is available. The safe migration accepts absent DeepSeek fields in existing configurations, applies the defaults without treating the absence as corruption, and never attempts to migrate any old raw secret because none exists.

On startup, the controller reads the opaque reference through the credential store. A successful read enables DeepSeek for normal provider selection; a missing, unreadable, or unavailable reference leaves it unconfigured and leaves other providers unchanged. The startup path does not return the recovered key to the frontend.

## 6. Backend, frontend, and settings contract

The backend provides separate routes for:

- configuration/health status, returning only `not_configured`, `configured`, `invalid_credentials`, `insufficient_balance`, `unavailable`, or a transient failure status;
- saving or replacing a newly submitted key, returning status only;
- removing the saved credential and disabling DeepSeek;
- testing the saved credential; and
- reading and selecting one of the two fixed model IDs.

The save route accepts a key once over the existing local frontend-to-sidecar channel, writes it immediately to Credential Manager, and returns no secret. Get/status routes never return a saved key. The controller must not follow existing provider methods that log an incoming key or echo it in `result` data.

The Translation settings section adds a DeepSeek block without redesigning the page: provider documentation link, password-type empty input, Save/Replace action, Remove action, Test connection action, configured status, error status, and a disabled-until-configured two-item model dropdown. Hydration always shows an empty input; the stored secret is never used as its value. The component uses a real `type="password"` input rather than an edit cover over a plaintext input.

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
| No credential, unreadable reference, or unavailable Credential Manager | unavailable/not configured | Skip DeepSeek; continue normal fallback. |
| HTTP 401 | invalid credentials | Mark DeepSeek invalid for this attempt; continue fallback; never delete another provider. |
| HTTP 402 | insufficient balance | Report the provider-specific balance state; continue fallback. |
| HTTP 429 | rate-limited error with parsed Retry-After when supplied | Use `Translator`'s existing cooldown mechanism; continue fallback. |
| HTTP 500 or 503, or transient network failure | transient provider error | Retry once only when the existing attempt deadline still permits it; otherwise continue fallback. |
| Timeout | provider timeout | Use the existing timeout quarantine/cooldown behavior and continue fallback. |
| Malformed, empty, or unusable final response | provider error | Continue fallback. |

The retry is one additional request at most, with a short bounded delay and no retry for 401, 402, 429, malformed responses, or cancellation/invalidation. Both client HTTP timeout and retry budget are bounded by the existing provider-attempt deadline; retry must never create an unbounded waiting path. DeepSeek errors are namespaced to DeepSeek and cannot mutate unrelated provider statuses or cooldowns.

## 9. Privacy, redaction, and diagnostics

The only user text sent to DeepSeek is the current translation request plus the source and target language prompt values. No previous conversation, transcript history, tool output, local file content, machine identifier, or personal `user_id` is sent.

Credential values and authorization material are confidential at every boundary. A redaction helper will sanitize exception text, request metadata, headers, credential-store errors, and diagnostic payloads before `printLog`, `errorLogging`, controller responses, or frontend notifications receive them. It must redact Bearer values, API-key-shaped strings, raw credential-store blobs, and authorization headers. Tests will assert that a known test key never appears in a log event, exception response, UI state, or persisted JSON.

Translation diagnostics may name the provider, model, non-secret error category, retry/cooldown duration, and request duration. They must not contain request headers, response reasoning, raw request text beyond the application's existing safe diagnostic policy, or any credential value.

## 10. Test strategy

Focused automated coverage will include:

- credential-store fake behavior, unavailable-store handling, opaque-reference persistence, no real Credential Manager access, and no plaintext config key;
- config migration from configurations with no DeepSeek fields, fixed-model validation, and preservation of existing provider settings;
- dedicated-client payload construction: official base URL, fixed models, `stream=False`, thinking disabled, no history, no tools, no JSON mode, and final-content-only extraction;
- missing, empty, malformed, reasoning-only, 401, 402, 429, 500, 503, timeout, and one-retry failure paths;
- scheduler dispatch, provider lock, cooldown, fallback, stale-generation suppression, and cancellation behavior;
- controller and route contracts proving saved keys are never returned, logged, or serialized;
- frontend password input, empty hydration, Save/Replace, Remove, Test connection, configured/error statuses, fixed model choices, and no secret rendered after save; and
- regression coverage that Google, Bing, Gemini, OpenAI, local translation, source/target normalization, and existing fallback behavior remain unaffected.

All API and credential tests are hermetic: mocked OpenAI responses, deterministic clock/retry controls, and injected credential stores. They make no DeepSeek network call and use no real key.

## 11. Explicit non-goals

- Refactoring existing OpenAI-compatible providers into a generic abstraction.
- Migrating existing provider secrets away from the current config mechanism.
- Arbitrary endpoint URLs, model IDs, OpenRouter routing, or a VRCNT proxy.
- Streaming, partial translation rendering, JSON output, tool/function calls, Responses API usage, or reasoning display.
- Automatic or opt-in conversation-history transmission in this feature.
- New provider-order semantics, global retry redesign, Tauri/Rust translation HTTP, or a broad Settings UI redesign.

## 12. Specification self-review

This specification contains no placeholders or deferred product choices. It fixes the official endpoint and two allowed model IDs, separates the key from plaintext config, defines the error-to-fallback behavior, and explicitly excludes related provider refactoring. Its only implementation prerequisite is Windows Credential Manager availability; failure is intentionally a visible unconfigured state rather than a silent security downgrade.
