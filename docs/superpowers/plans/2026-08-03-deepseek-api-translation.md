# DeepSeek API Translation Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a dedicated official DeepSeek cloud translation provider with fixed models, no-history non-thinking requests, existing provider-order fallback, and the existing VRCNT API-key workflow.

**Architecture:** Python owns all DeepSeek calls. Config, Controller, Model, Translator, and mainloop.py gain one dedicated provider; translation_deepseek.py fixes the official endpoint and model allowlist. React keeps the Translation settings layout but uses a DeepSeek-specific status/input hook, so hydration reports configuration state without returning the saved key.

**Tech Stack:** Python 3.12, existing OpenAI SDK dependency, unittest and unittest.mock, React 18, existing stdout sidecar protocol, Node built-in test runner, Vite.

## Global constraints

- Use only https://api.deepseek.com, deepseek-v4-flash, and deepseek-v4-pro. Flash is the default.
- Do not add a generic compatible-provider refactor, a custom endpoint/model field, streaming, JSON mode, tools, reasoning, or history.
- Each request has one dedicated system message and one current-text user message, stream=False, and extra_body={"thinking": {"type": "disabled"}}.
- Persist only through Config.AUTH_KEYS["DeepSeek_API"]. Add no provider-specific key-storage subsystem or dependency.
- The frontend must not receive a saved raw key during hydration. Newly entered and replacement text uses a real password input.
- Never log a key, Bearer value, Authorization header, request headers, or raw key in a status, translation, connection-test, error, fixture, or screenshot payload.
- DeepSeek failure cannot alter another provider's key, availability, cooldown, order, or fallback result.
- Automated tests mock all SDK calls. Do not call the live service, start Vite/Tauri, build CUDA, build an installer, push, merge, or modify main.

---

## Repository integration map

| Area | Existing file and symbols | Planned change |
| --- | --- | --- |
| Config | src-python/config.py: Config.AUTH_KEYS, SELECTABLE_OPENAI_MODEL_LIST, SELECTED_OPENAI_MODEL, revalidate_selected_models() | Add a narrow missing-DeepSeek schema default and fixed model state. |
| Languages | src-python/models/translation/translation_settings/languages/languages.yml: OpenAI_API and *openai_langs | Add DeepSeek_API using the same mapping. |
| Client/prompt | translation_openai.py and translation_settings/prompt/translation_openai.yml | Create a separate DeepSeekClient and translation_deepseek.yml. |
| Dispatch | translation_translator.py: _context_provider_locks, _translate_once(), translateAttempt() | Add client field, lock, direct request branch, and facade methods. |
| Controller/routes | controller.py OpenAI methods; mainloop.py OpenAI routes and run_mapping | Add DeepSeek key/status/test/model methods and routes. |
| Error protocol | errors.py: ErrorCode, ERROR_METADATA, ERROR_ENDPOINT_MAP | Add DeepSeek-safe auth/model errors. |
| Settings UI | Translation.jsx, AuthKey.jsx, _Entry.jsx, ui_config_setter.js, store.js, useReceiveRoutes.js | Add password input, non-secret status hook, model dropdown, and provider visibility. |
| Existing tests | test_translation_attempt.py, test_translation_scheduler.py, test_manual_translation_retry.py | Extend existing cooldown, lock, fallback, and stale-generation coverage. |

## Shared interfaces introduced by the work

~~~python
# src-python/models/translation/translation_deepseek.py
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODELS = ("deepseek-v4-flash", "deepseek-v4-pro")

class DeepSeekProviderError(RuntimeError):
    def __init__(self, category: str, status_code: int | None = None,
                 retry_after: int | None = None) -> None: ...

class DeepSeekClient:
    def __init__(self, root_path: str | None = None) -> None: ...
    def setAuthKey(self, api_key: str) -> bool: ...
    def testConnection(self) -> bool: ...
    def getModelList(self) -> list[str]: ...
    def setModel(self, model: str) -> bool: ...
    def updateClient(self) -> None: ...
    def translate(self, text: str, input_lang: str, output_lang: str,
                  timeout_seconds: float) -> str: ...

def redactDeepSeekDiagnostic(value: object) -> str: ...
~~~

~~~python
# translation_translator.py and model.py
Translator.authenticationDeepSeekAuthKey(auth_key: str, root_path: str | None = None) -> bool
Translator.getDeepSeekModelList() -> list[str]
Translator.setDeepSeekModel(model: str) -> bool
Translator.updateDeepSeekClient() -> None

Model.authenticationTranslatorDeepSeekAuthKey(auth_key: str) -> bool
Model.getTranslatorDeepSeekModelList() -> list[str]
Model.setTranslatorDeepSeekModel(model: str) -> bool
Model.updateTranslatorDeepSeekClient() -> None
~~~

The non-secret key-status payload is exactly:

~~~python
{"configured": bool,
 "health": "not_configured" | "configured" | "invalid_credentials" |
           "insufficient_balance" | "failed"}
~~~

## Task 1: Config schema, fixed models, and language normalization

**Files:**

- Modify: src-python/config.py: Config.AUTH_KEYS, defaults, selected-model properties, revalidate_selected_models().
- Modify: src-python/models/translation/translation_settings/languages/languages.yml.
- Create: src-python/tests/test_deepseek_config.py.

**Consumes:** Config.AUTH_KEYS, _allowed_in_populated(), loadTranslationLanguages(), and *openai_langs.

**Produces:** _auth_keys_validator(val, inst), Config.SELECTABLE_DEEPSEEK_MODEL_LIST, Config.SELECTED_DEEPSEEK_MODEL, and DeepSeek_API language mappings.

- [ ] **Step 1: Write failing tests.**

~~~python
def test_legacy_auth_keys_gain_only_the_deepseek_default(self):
    instance = object.__new__(Config)
    instance._AUTH_KEYS = {
        "DeepL_API": None, "Plamo_API": None, "Gemini_API": None,
        "OpenAI_API": "existing-openai-key", "Groq_API": None,
        "OpenRouter_API": None, "DeepSeek_API": None,
    }
    legacy = {key: value for key, value in instance._AUTH_KEYS.items()
              if key != "DeepSeek_API"}
    normalized = _auth_keys_validator(legacy, instance)
    self.assertIsNone(normalized["DeepSeek_API"])
    self.assertEqual(normalized["OpenAI_API"], "existing-openai-key")

def test_deepseek_model_config_uses_the_fixed_flash_default(self):
    self.assertEqual(
        config.SELECTABLE_DEEPSEEK_MODEL_LIST,
        ["deepseek-v4-flash", "deepseek-v4-pro"],
    )
    self.assertEqual(config.SELECTED_DEEPSEEK_MODEL, "deepseek-v4-flash")

def test_deepseek_language_map_matches_openai(self):
    mappings = loadTranslationLanguages(path=".", force=True)
    self.assertEqual(mappings["DeepSeek_API"], mappings["OpenAI_API"])
~~~

- [ ] **Step 2: Run the failing test.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_deepseek_config.py' -v
~~~

Expected: import or attribute failures for the validator, model state, and YAML mapping.

- [ ] **Step 3: Implement the minimal schema changes.**

Replace the inline AUTH_KEYS lambda with _auth_keys_validator. It accepts the current exact key set or a legacy set missing only DeepSeek_API; it merges the missing key as None and rejects unknown/missing other keys. Add "DeepSeek_API": None to defaults, the fixed list ["deepseek-v4-flash", "deepseek-v4-pro"], default selected Flash, the allowed selected-model property, and the revalidation pair. Add:

~~~yaml
DeepSeek_API:
  source: *openai_langs
  target: *openai_langs
~~~

Do not alter existing provider mappings or model lists.

- [ ] **Step 4: Verify.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_deepseek_config.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m py_compile src-python\config.py
~~~

Expected: focused tests pass and py_compile exits 0.

- [ ] **Step 5: Commit.**

~~~powershell
git add src-python/config.py src-python/models/translation/translation_settings/languages/languages.yml src-python/tests/test_deepseek_config.py
git commit -m "feat(translation): add DeepSeek provider configuration"
~~~

## Task 2: Dedicated client and no-history prompt

**Files:**

- Create: src-python/models/translation/translation_deepseek.py.
- Create: src-python/models/translation/translation_settings/prompt/translation_deepseek.yml.
- Create: src-python/tests/test_translation_deepseek.py.

**Consumes:** existing OpenAI SDK import pattern, loadTranslatePromptConfig(), and translation_lang["DeepSeek_API"].

**Produces:** DEEPSEEK_BASE_URL, DEEPSEEK_MODELS, DeepSeekProviderError, DeepSeekClient, redactDeepSeekDiagnostic().

- [ ] **Step 1: Write failing mocked-SDK tests.**

~~~python
@patch("models.translation.translation_deepseek.OpenAI")
def test_translate_uses_the_fixed_non_thinking_payload(self, OpenAI):
    completion = OpenAI.return_value.chat.completions.create
    completion.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="สวัสดี"))]
    )
    client = DeepSeekClient(root_path=".")
    client.setAuthKey("test-deepseek-key")
    self.assertTrue(client.setModel("deepseek-v4-flash"))
    client.updateClient()
    self.assertEqual(client.translate("hello", "English", "Thai", 5.0), "สวัสดี")
    request = completion.call_args.kwargs
    self.assertEqual(request["model"], "deepseek-v4-flash")
    self.assertIs(request["stream"], False)
    self.assertEqual(request["extra_body"], {"thinking": {"type": "disabled"}})
    self.assertEqual([item["role"] for item in request["messages"]],
                     ["system", "user"])
    self.assertNotIn("tools", request)
    self.assertNotIn("response_format", request)

def test_reasoning_only_or_non_string_content_is_rejected(self):
    # Fake choices with content=None and a reasoning_content property.
    # DeepSeekClient must raise DeepSeekProviderError.

def test_only_flash_and_pro_are_selectable(self):
    client = DeepSeekClient(root_path=".")
    self.assertFalse(client.setModel("deepseek-chat"))
    self.assertFalse(client.setModel("custom-model"))
~~~

Add mocked cases for missing choices/message, whitespace content, 401, 402, 429 with Retry-After, one 500 retry, one 503 retry, timeout, and network failure. Use a fake exception with status_code and response.headers; no fixture contains a realistic secret.

- [ ] **Step 2: Run the failing client tests.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_translation_deepseek.py' -v
~~~

Expected: ModuleNotFoundError for translation_deepseek.

- [ ] **Step 3: Implement the dedicated client.**

Use OpenAI(api_key=self.api_key, base_url=DEEPSEEK_BASE_URL) only. getModelList() returns the fixed two-ID list locally. testConnection() uses the current SDK health-check pattern but never replaces that fixed list. The request path is:

~~~python
response = self._client.chat.completions.create(
    model=self.model,
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": text},
    ],
    stream=False,
    extra_body={"thinking": {"type": "disabled"}},
    timeout=timeout_seconds,
)
content = response.choices[0].message.content
if not isinstance(content, str) or not content.strip():
    raise DeepSeekProviderError("malformed_response")
return content.strip()
~~~

The prompt YAML sets history.use_history false, sources [], max_messages 0, and max_chars 0. It requires only the translation while preserving URLs, format tokens, names, emoji, and line breaks; it forbids explanations, JSON, and reasoning. Retry 500, 503, and transient network failures once only when a monotonic deadline remains. Do not retry 401, 402, 429, malformed response, or timeout. Never access reasoning_content.

- [ ] **Step 4: Verify.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_translation_deepseek.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m py_compile src-python\models\translation\translation_deepseek.py
~~~

Expected: all client tests pass with no network activity.

- [ ] **Step 5: Commit.**

~~~powershell
git add src-python/models/translation/translation_deepseek.py src-python/models/translation/translation_settings/prompt/translation_deepseek.yml src-python/tests/test_translation_deepseek.py
git commit -m "feat(translation): add DeepSeek API client"
~~~

## Task 3: Translator dispatch, provider lock, fallback, and lifecycle

**Files:**

- Modify: src-python/models/translation/translation_translator.py: Translator.__init__, _context_provider_locks, _translate_once(), DeepSeek facade methods.
- Modify: src-python/model.py: DeepSeek wrappers beside the OpenAI wrapper methods.
- Modify: src-python/tests/test_translation_attempt.py, test_translation_scheduler.py, and test_manual_translation_retry.py.

**Consumes:** Task 2 client and errors, Task 1 language map, and existing translateAttempt() classification.

**Produces:** Translator.deepseek_client and DeepSeek dispatch through existing fallback/cancellation paths.

- [ ] **Step 1: Write failing dispatch/lifecycle tests.**

~~~python
def test_deepseek_uses_normalized_languages_without_context_history(self):
    client = Mock()
    client.setContextHistory.side_effect = AssertionError("history is forbidden")
    client.translate.return_value = "translated"
    self.translator.deepseek_client = client
    attempt = self._attempt(
        translator_name="DeepSeek_API",
        source_language="English",
        target_language="Japanese",
        context_history=[{"text": "previous message"}],
    )
    self.assertEqual(attempt.status, TranslationStatus.SUCCESS)
    client.translate.assert_called_once()

def test_deepseek_429_uses_the_existing_cooldown(self):
    self.translator.deepseek_client = RaisingDeepSeekClient(
        status_code=429, retry_after="12"
    )
    attempt = self._attempt(translator_name="DeepSeek_API")
    self.assertEqual(attempt.error_code, "provider_rate_limited")
    self.assertEqual(attempt.retry_after_seconds, 12)

def test_stale_deepseek_completion_is_not_published(self):
    # Use the existing blocking scheduler helper with
    # providers=("DeepSeek_API", "Google"), invalidate its generation,
    # release the fake, and assert no final callback.
~~~

Add a blocking DeepSeek fake proving same-provider calls do not overlap; a missing client produces empty-provider failure and allows the selected fallback; and disabled/invalidation during a request cannot publish stale output.

- [ ] **Step 2: Run the failing dispatcher tests.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_translation_attempt.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_translation_scheduler.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_manual_translation_retry.py' -v
~~~

Expected: DeepSeek field, lock, and dispatch branch failures.

- [ ] **Step 3: Implement direct, no-context dispatch.**

~~~python
case "DeepSeek_API":
    if self.deepseek_client is not None:
        with self._context_provider_locks[name]:
            result = self.deepseek_client.translate(
                message,
                input_lang=source,
                output_lang=target,
                timeout_seconds=timeout_seconds,
            )
~~~

Add DeepSeek_API to _context_provider_locks. Do not use _translate_context_provider() because that method calls setContextHistory(). Add Model wrappers using only translation_deepseek.DeepSeekClient. Do not modify SourcePipeline, ManualTranslationRetryCoordinator, boundedTranslationProviderSnapshot(), rotation, or global timeout/cooldown logic.

- [ ] **Step 4: Verify fallback and lifecycle behavior.**

Run the three Task 3 commands again.

Expected: the new cases pass through existing cooldown, fallback, lock, timeout, cancellation, and stale-generation behavior.

- [ ] **Step 5: Commit.**

~~~powershell
git add src-python/models/translation/translation_translator.py src-python/model.py src-python/tests/test_translation_attempt.py src-python/tests/test_translation_scheduler.py src-python/tests/test_manual_translation_retry.py
git commit -m "feat(translation): integrate DeepSeek fallback dispatch"
~~~

## Task 4: API-key lifecycle, health status, fixed models, and routes

**Files:**

- Modify: src-python/controller.py: add methods beside getOpenAIAuthKey(), setOpenAIAuthKey(), delOpenAIAuthKey(), getOpenAIModelList(), getOpenAIModel(), setOpenAIModel(), and startup check_translation_engine().
- Modify: src-python/mainloop.py: run_mapping and routes beside OpenAI routes.
- Modify: src-python/errors.py: ErrorCode, ERROR_METADATA, ERROR_ENDPOINT_MAP.
- Modify: src-python/tests/test_translation_deepseek.py and, only for route source assertions, test_dual_transcription_engine_config.py.

**Consumes:** Tasks 1–3, VRCTError.create_error_response(), Controller.updateTranslationEngineAndEngineList(), and run_mapping.

**Produces:** getDeepSeekAuthKey(), setDeepSeekAuthKey(), delDeepSeekAuthKey(), checkDeepSeekConnection(), get/set DeepSeek model methods, and DeepSeek routes.

- [ ] **Step 1: Write failing backend tests.**

~~~python
def test_key_save_replace_status_read_and_delete_never_return_the_key(self):
    controller = self._controller()
    with patch.object(model, "authenticationTranslatorDeepSeekAuthKey",
                      return_value=True):
        saved = controller.setDeepSeekAuthKey("test-deepseek-key")
    self.assertEqual(config.AUTH_KEYS["DeepSeek_API"], "test-deepseek-key")
    self.assertNotIn("test-deepseek-key", repr(saved))
    self.assertEqual(controller.getDeepSeekAuthKey()["result"], {
        "configured": True, "health": "configured",
    })
    controller.delDeepSeekAuthKey()
    self.assertIsNone(config.AUTH_KEYS["DeepSeek_API"])

def test_401_and_402_are_provider_local(self):
    # Mock DeepSeekProviderError with 401, then 402.
    # Assert the DeepSeek error code and unchanged OpenAI_API value.

def test_mainloop_registers_deepseek_routes(self):
    for endpoint in (
        "/get/data/deepseek_auth_key", "/set/data/deepseek_auth_key",
        "/delete/data/deepseek_auth_key", "/run/deepseek_connection",
        "/get/data/selectable_deepseek_model_list",
        "/get/data/selected_deepseek_model",
        "/set/data/selected_deepseek_model",
    ):
        self.assertIn(endpoint, mainloop.mapping)
~~~

- [ ] **Step 2: Run the failing backend tests.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_translation_deepseek.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_dual_transcription_engine_config.py' -v
~~~

Expected: missing Controller methods, error codes, and route keys.

- [ ] **Step 3: Implement the non-secret route contract.**

~~~python
def getDeepSeekAuthKey(self, *args, **kwargs):
    configured = isinstance(config.AUTH_KEYS["DeepSeek_API"], str) and bool(
        config.AUTH_KEYS["DeepSeek_API"].strip()
    )
    return {"status": 200, "result": {
        "configured": configured,
        "health": "configured" if configured else "not_configured",
    }}
~~~

setDeepSeekAuthKey validates only a non-empty string, authenticates through Model, persists only after success, sets DeepSeek availability, publishes status/model events, chooses Flash when selection is invalid, and calls updateTranslationEngineAndEngineList(). It does not log data or return the key. Delete clears only DeepSeek state. Test connection reads the saved key, returns a status-only event, and does not change provider order.

Add AUTH_DEEPSEEK_INVALID, AUTH_DEEPSEEK_INSUFFICIENT_BALANCE, AUTH_DEEPSEEK_FAILED, and MODEL_DEEPSEEK_INVALID with safe metadata. Map HTTP 401 and 402 to the first two. Startup checks use the fixed list and retain a saved DeepSeek key after failed health checks so the user can replace or retry it.

- [ ] **Step 4: Verify.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_translation_deepseek.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m py_compile src-python\controller.py src-python\mainloop.py src-python\errors.py src-python\model.py
~~~

Expected: status-only key hydration, save/replace/delete, model validation, test connection, and 401/402 assertions pass.

- [ ] **Step 5: Commit.**

~~~powershell
git add src-python/controller.py src-python/mainloop.py src-python/errors.py src-python/tests/test_translation_deepseek.py src-python/tests/test_dual_transcription_engine_config.py
git commit -m "feat(translation): add DeepSeek settings backend"
~~~

## Task 5: Settings UI and provider-order visibility

**Files:**

- Modify: src-ui/views/app/config_page/setting_section/setting_box/_components/_atoms/_Entry.jsx.
- Create: src-ui/views/app/config_page/setting_section/setting_box/_components/auth_key/DeepSeekAuthKey.jsx.
- Modify: src-ui/views/app/config_page/setting_section/setting_box/_templates/Templates.jsx and translation/Translation.jsx.
- Modify: src-ui/logics/configs/config_page_setter/ui_config_setter.js, src-ui/logics/store.js, src-ui/logics/useReceiveRoutes.js, src-ui/logics/ui_configs.js, and src-ui/logics/_useBackendErrorHandling.js.
- Create: src-ui/logics/common/useDeepSeekConfiguration.js and src-ui/logics/common/__tests__/deepseekProviderUI.test.js.
- Modify: locales/en.yml, th.yml, ja.yml, ko.yml, zh-Hans.yml, and zh-Hant.yml.

**Consumes:** Task 4 status/routes, useStdoutToPython().asyncStdoutToPython(), createCategoryHook("Translation"), and useLanguageSettings().updateTranslatorAvailability().

**Produces:** useDeepSeekConfiguration() with refreshStatus/saveKey/deleteKey/testConnection, DeepSeekAuthKey, and fixed model UI state.

- [ ] **Step 1: Write failing UI contract tests.**

~~~javascript
test("DeepSeek uses a password input and never hydrates a saved key", () => {
    const entry = readSource("src-ui/views/app/config_page/setting_section/setting_box/_components/_atoms/_Entry.jsx");
    const deepseek = readSource("src-ui/views/app/config_page/setting_section/setting_box/_components/auth_key/DeepSeekAuthKey.jsx");
    assert.match(entry, /type=\{props\.type \?\? "text"\}/);
    assert.match(deepseek, /type="password"/);
    assert.match(deepseek, /\/get\/data\/deepseek_auth_key/);
    assert.doesNotMatch(deepseek, /currentDeepSeekAuthKey|savedKey|auth_key_value/);
});

test("DeepSeek has fixed models, a connection test, and normal provider refresh", () => {
    const registry = readSource("src-ui/logics/configs/config_page_setter/ui_config_setter.js");
    const settings = readSource("src-ui/views/app/config_page/setting_section/setting_box/translation/Translation.jsx");
    assert.match(registry, /Base_Name: "SelectableDeepSeekModelList"/);
    assert.match(registry, /Base_Name: "SelectedDeepSeekModel"/);
    assert.match(settings, /<DeepSeekAuthKey_Box \/>/);
    assert.match(settings, /<DeepSeekModelContainer \/>/);
});
~~~

Add locale schema-parity checks for the six files and assert the status atom holds configured/health only.

- [ ] **Step 2: Run the failing UI test.**

~~~powershell
node --test src-ui/logics/common/__tests__/deepseekProviderUI.test.js
~~~

Expected: missing component, model registry, locale, and hook assertions.

- [ ] **Step 3: Implement the narrow UI changes.**

_Entry renders type={props.type ?? "text"}. DeepSeekAuthKey keeps only currently typed text in React state. Its hook requests /get/data/deepseek_auth_key status, sends a typed replacement to /set/data/deepseek_auth_key, clears the input after a successful write, and calls delete/run routes. It never uses generated get_set_delete key hydration.

Register only SelectableDeepSeekModelList and SelectedDeepSeekModel with the existing get_set generator. Use the generated useTranslation fields for the fixed dropdown; disable it while status is not configured. Add deepseek_auth_key_url = "https://platform.deepseek.com/api_keys". Add only the same translation-setting layout containers and locale schema used by existing providers. Existing useLanguageSettings continues to refresh provider availability/order; do not create a second selector.

- [ ] **Step 4: Verify.**

~~~powershell
node --test src-ui/logics/common/__tests__/deepseekProviderUI.test.js
npm run vite-build
~~~

Expected: all UI contract tests pass and Vite exits 0.

- [ ] **Step 5: Commit.**

~~~powershell
git add src-ui/views/app/config_page/setting_section/setting_box/_components/_atoms/_Entry.jsx src-ui/views/app/config_page/setting_section/setting_box/_components/auth_key/DeepSeekAuthKey.jsx src-ui/views/app/config_page/setting_section/setting_box/_templates/Templates.jsx src-ui/views/app/config_page/setting_section/setting_box/translation/Translation.jsx src-ui/logics/configs/config_page_setter/ui_config_setter.js src-ui/logics/store.js src-ui/logics/useReceiveRoutes.js src-ui/logics/ui_configs.js src-ui/logics/_useBackendErrorHandling.js src-ui/logics/common/useDeepSeekConfiguration.js src-ui/logics/common/__tests__/deepseekProviderUI.test.js locales/en.yml locales/th.yml locales/ja.yml locales/ko.yml locales/zh-Hans.yml locales/zh-Hant.yml
git commit -m "feat(translation): add DeepSeek translation settings"
~~~

## Task 6: Redaction, unavailable-provider fallback, and regression coverage

**Files:**

- Modify: src-python/models/translation/translation_deepseek.py and src-python/controller.py.
- Modify: src-python/tests/test_translation_deepseek.py, test_translation_attempt.py, and test_manual_translation_retry.py.
- Modify: src-ui/logics/common/__tests__/deepseekProviderUI.test.js.

**Consumes:** Tasks 2–5 and existing ManualTranslationRetryCoordinator/TranslationAttempt behaviors.

**Produces:** a redaction boundary and tests proving missing/disabled DeepSeek falls through without mutating another provider.

- [ ] **Step 1: Write failing security and fallback tests.**

~~~python
def test_redaction_removes_key_and_authorization_header(self):
    secret = "test-deepseek-key"
    result = redactDeepSeekDiagnostic(
        f"Authorization: Bearer {secret}; api_key={secret}"
    )
    self.assertNotIn(secret, result)

def test_missing_deepseek_falls_back_without_mutating_google(self):
    self.translator.deepseek_client = None
    # Reuse the existing retry coordinator with providers=("DeepSeek_API", "Google").
    # Assert Google succeeds and its status/order is unchanged.
~~~

~~~javascript
test("DeepSeek source never logs an incoming key or puts one in status state", () => {
    const controller = readSource("src-python/controller.py");
    const hook = readSource("src-ui/logics/common/useDeepSeekConfiguration.js");
    assert.doesNotMatch(controller, /printLog\("Set DeepSeek Auth Key",\s*data\)/);
    assert.doesNotMatch(hook, /result\.key|savedKey|auth_key_value/);
});
~~~

- [ ] **Step 2: Run the failing security tests.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_translation_deepseek.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_manual_translation_retry.py' -v
node --test src-ui/logics/common/__tests__/deepseekProviderUI.test.js
~~~

Expected: redactor/fallback assertions fail before the final hardening.

- [ ] **Step 3: Implement only the identified hardening.**

~~~python
def redactDeepSeekDiagnostic(value: object) -> str:
    text = str(value)
    text = re.sub(r"(?i)(authorization\s*:\s*bearer\s+)[^\s,;]+",
                  r"\1[REDACTED]", text)
    return re.sub(r"(?i)(api[_-]?key\s*[=:]\s*)[^\s,;]+",
                  r"\1[REDACTED]", text)
~~~

Use safe categorized DeepSeekProviderError messages in controller error paths; never attach an SDK exception or key as VRCTError data. Preserve the generic TranslationAttempt error classification so a missing client, timeout, network failure, malformed result, 429 cooldown, and exhausted 500/503 retry fall through normally.

- [ ] **Step 4: Verify.**

Run the three Task 6 commands again and also:

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_translation_attempt.py' -v
~~~

Expected: redaction, provider lock, cooldown, invalid/disabled fallback, stale completion, and unrelated-provider regression cases pass.

- [ ] **Step 5: Commit.**

~~~powershell
git add src-python/models/translation/translation_deepseek.py src-python/controller.py src-python/tests/test_translation_deepseek.py src-python/tests/test_translation_attempt.py src-python/tests/test_manual_translation_retry.py src-ui/logics/common/__tests__/deepseekProviderUI.test.js
git commit -m "test(translation): cover DeepSeek security and lifecycle"
~~~

## Task 7: Full verification and optional manual native review

**Files:** No planned source change. Modify only a DeepSeek file listed above if fresh verification identifies a specific test defect.

**Consumes:** Tasks 1–6.

**Produces:** verification evidence only.

- [ ] **Step 1: First run the Task 6 unavailable-provider test as the final red/green gate.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_manual_translation_retry.py' -v
~~~

Expected: pass only after the Task 6 fallback implementation. If it fails, fix only the proven DeepSeek integration point and commit:

~~~powershell
git add src-python/models/translation/translation_deepseek.py src-python/models/translation/translation_translator.py src-python/controller.py src-python/tests/test_manual_translation_retry.py
git commit -m "fix(translation): preserve fallback when DeepSeek is unavailable"
~~~

- [ ] **Step 2: Run fresh complete verification.**

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
$env:PYTHONIOENCODING = 'utf-8'
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_*.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m py_compile src-python\config.py src-python\controller.py src-python\errors.py src-python\mainloop.py src-python\model.py src-python\models\translation\translation_deepseek.py src-python\models\translation\translation_translator.py
node --test src-ui/logics/common/__tests__/deepseekProviderUI.test.js
npm run test:ui
npm run vite-build
git diff --check
~~~

Expected: every command exits 0 without a real DeepSeek request or a printed user key.

- [ ] **Step 3: Optional manual native review after automated verification passes.**

Use the user’s own key only in native Settings to check Save/Replace, Remove, Test connection, Flash/Pro selection, configured/not-configured state, provider-order visibility, and password masking. Do not print, screenshot, or log the key. This optional review does not authorize a CUDA build, installer, push, or merge.

## Expected implementation commits

1. feat(translation): add DeepSeek provider configuration
2. feat(translation): add DeepSeek API client
3. feat(translation): integrate DeepSeek fallback dispatch
4. feat(translation): add DeepSeek settings backend
5. feat(translation): add DeepSeek translation settings
6. test(translation): cover DeepSeek security and lifecycle
7. fix(translation): preserve fallback when DeepSeek is unavailable, only if Task 7 identifies that defect

## Final verification command set

~~~powershell
$env:PYTHONPATH = (Resolve-Path '.\src-python')
$env:PYTHONIOENCODING = 'utf-8'
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m unittest discover -s .\src-python\tests -p 'test_*.py' -v
& 'C:\Users\ANXE\Desktop\Coding\VRCNT-Next\.venv_cuda\Scripts\python.exe' -m py_compile src-python\config.py src-python\controller.py src-python\errors.py src-python\mainloop.py src-python\model.py src-python\models\translation\translation_deepseek.py src-python\models\translation\translation_translator.py
node --test src-ui/logics/common/__tests__/deepseekProviderUI.test.js
npm run test:ui
npm run vite-build
git diff --check
~~~

## Plan self-review checklist

- Every approved request, response, fallback, cancellation, key-flow, UI, and security requirement maps to Tasks 1–7.
- Existing files and symbols above were inspected; only the dedicated client, prompt, status hook, input component, and focused tests are new.
- Each implementation task starts with a concrete failing test, a command, expected failure, minimal change, verification, and an independent commit.
- The plan has no broad provider refactor, custom endpoint/model flow, live API test, installer, CUDA, push, merge, or unrelated provider migration.
- Hydration is status-only and the saved raw key cannot reach the frontend during startup or reload.
