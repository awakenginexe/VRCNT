import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("shared provider composition contains every supported provider in order", () => {
    const source = read("../../translation/Translation.jsx");

    assert.match(source, /export const CloudTranslationProviders\s*=\s*\(\)\s*=>/);
    const providers = [
        "DeepLAuthKey_Box",
        "PlamoAuthKey_Box",
        "GeminiAuthKey_Box",
        "OpenAIAuthKey_Box",
        "DeepSeekAuthKey_Box",
        "GroqAuthKey_Box",
        "OpenRouterAuthKey_Box",
        "LMStudioConnectionCheck_Box",
        "OllamaConnectionCheck_Box",
    ];
    let previous = -1;
    for (const provider of providers) {
        const position = source.indexOf(`<${provider}`);
        assert.ok(position > previous, `${provider} must be present in provider order`);
        previous = position;
    }

    for (const provider of ["deepl", "plamo", "gemini", "openai", "deepseek", "groq", "openrouter", "lmstudio", "ollama"]) {
        assert.match(source, new RegExp(`data-provider=\\"${provider}\\"`));
    }
});

test("model and provider renders cloud translation providers in the translation search pane", () => {
    const source = read("../ModelAndProvider.jsx");
    const styles = read("../ModelAndProvider.module.scss");

    assert.match(source, /import \{ CloudTranslationProviders \} from "\.\.\/translation\/Translation"/);
    assert.match(source, /data-settings-pane="translation"/);
    assert.match(source, /config_page\.model_and_provider\.cloud_translation_providers\.title/);
    assert.match(source, /<CloudTranslationProviders \/>/);
    assert.match(styles, /\.provider_section\s*\{[\s\S]*grid-column:\s*1 \/ -1;/);
    assert.match(read("../../translation/CloudTranslationProviders.module.scss"), /\.provider_grid\s*\{/);
});

test("cloud provider cards stack labels above controls", () => {
    const providerStyles = read("../../translation/CloudTranslationProviders.module.scss");
    const templateStyles = read("../../_templates/Templates.module.scss");

    assert.match(providerStyles, /\.provider_group\s*\{[^}]*?--settings-template-direction:\s*column/);
    assert.match(providerStyles, /\.provider_group\s*\{[^}]*?--settings-template-align:\s*stretch/);
    assert.match(templateStyles, /flex-direction:\s*var\(--settings-template-direction,\s*row\)/);
    assert.match(templateStyles, /align-items:\s*var\(--settings-template-align,\s*center\)/);
});

test("DeepSeek delete keeps the status-only route and shared status update", () => {
    const hook = read("../../../../../../../logics/common/useDeepSeekConfiguration.js");
    const routes = read("../../../../../../../logics/useReceiveRoutes.js");

    assert.match(hook, /asyncStdoutToPython\("\/delete\/data\/deepseek_auth_key"\)/);
    assert.match(routes, /endpoint:\s*"\/delete\/data\/deepseek_auth_key"[\s\S]*method_name:\s*"updateStatus"/);
});
