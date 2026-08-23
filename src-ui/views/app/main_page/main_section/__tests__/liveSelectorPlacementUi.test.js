import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

class MiniEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.bubbles = options.bubbles ?? true;
        this.cancelable = options.cancelable ?? true;
        this.key = options.key;
        this.defaultPrevented = false;
        this.cancelBubble = false;
        this.immediatePropagationStopped = false;
        this.target = null;
        this.currentTarget = null;
        this.eventPhase = 0;
    }

    preventDefault() {
        if (this.cancelable) this.defaultPrevented = true;
    }

    stopPropagation() {
        this.cancelBubble = true;
    }

    stopImmediatePropagation() {
        this.immediatePropagationStopped = true;
        this.cancelBubble = true;
    }

    initEvent(type, bubbles = false, cancelable = false) {
        this.type = type;
        this.bubbles = bubbles;
        this.cancelable = cancelable;
    }
}

class MiniStyle {
    setProperty(name, value) {
        this[name] = String(value);
    }

    getPropertyValue(name) {
        return this[name] ?? "";
    }

    removeProperty(name) {
        delete this[name];
    }
}

class MiniEventTarget {
    constructor() {
        this._listeners = new Map();
    }

    addEventListener(type, callback, options = false) {
        if (typeof callback !== "function") return;
        const capture = options === true || options?.capture === true;
        const listeners = this._listeners.get(type) || [];
        if (!listeners.some((listener) => listener.callback === callback && listener.capture === capture)) {
            listeners.push({ callback, capture });
            this._listeners.set(type, listeners);
        }
    }

    removeEventListener(type, callback, options = false) {
        const capture = options === true || options?.capture === true;
        const listeners = this._listeners.get(type);
        if (!listeners) return;
        const remaining = listeners.filter(
            (listener) => listener.callback !== callback || listener.capture !== capture,
        );
        if (remaining.length > 0) this._listeners.set(type, remaining);
        else this._listeners.delete(type);
    }

    dispatchEvent(event) {
        if (!event?.type) throw new TypeError("event must have a type");

        const eventPath = [];
        let current = this;
        while (current) {
            eventPath.push(current);
            current = current.parentNode || null;
        }

        event.target = this;
        event.defaultPrevented = false;
        event.cancelBubble = false;
        event.composedPath = () => [...eventPath];

        const invoke = (target, capture, phase) => {
            event.currentTarget = target;
            event.eventPhase = phase;
            const listeners = target._listeners?.get(event.type) || [];
            for (const listener of [...listeners]) {
                if (listener.capture !== capture) continue;
                listener.callback.call(target, event);
                if (event.immediatePropagationStopped) return false;
            }
            return !event.cancelBubble;
        };

        for (let index = eventPath.length - 1; index > 0; index -= 1) {
            if (!invoke(eventPath[index], true, 1)) return !event.defaultPrevented;
        }
        invoke(this, true, 2);
        if (!event.immediatePropagationStopped) invoke(this, false, 2);

        if (event.bubbles !== false && !event.cancelBubble) {
            for (let index = 1; index < eventPath.length; index += 1) {
                if (!invoke(eventPath[index], false, 3)) break;
            }
        }

        return !event.defaultPrevented;
    }
}

MiniEventTarget.ELEMENT_NODE = 1;
MiniEventTarget.TEXT_NODE = 3;
MiniEventTarget.DOCUMENT_NODE = 9;
MiniEventTarget.DOCUMENT_FRAGMENT_NODE = 11;

class MiniTextNode extends MiniEventTarget {
    constructor(text, ownerDocument) {
        super();
        this.nodeType = 3;
        this.nodeName = "#text";
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
        this.textContent = String(text);
    }
}

class MiniDocumentFragment extends MiniEventTarget {
    constructor(ownerDocument) {
        super();
        this.nodeType = 11;
        this.nodeName = "#document-fragment";
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
        this.childNodes = [];
    }
}

class MiniElement extends MiniEventTarget {
    constructor(tagName, ownerDocument) {
        super();
        this.nodeType = 1;
        this.nodeName = tagName.toUpperCase();
        this.tagName = this.nodeName;
        this.namespaceURI = "http://www.w3.org/1999/xhtml";
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
        this.childNodes = [];
        this.attributes = new Map();
        this.style = new MiniStyle();
        this.className = "";
        this.id = "";
        this.value = "";
        this.type = "";
        this.checked = false;
        this.disabled = false;
        this.tabIndex = 0;
        this._rect = {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            width: 0,
            height: 0,
        };
    }

    get children() {
        return this.childNodes.filter((node) => node.nodeType === 1);
    }

    appendChild(node) {
        if (node.nodeType === 11) {
            for (const child of [...node.childNodes]) this.appendChild(child);
            return node;
        }
        if (node.parentNode) node.parentNode.removeChild(node);
        node.parentNode = this;
        this.childNodes.push(node);
        return node;
    }

    insertBefore(node, referenceNode) {
        if (node.nodeType === 11) {
            for (const child of [...node.childNodes]) this.insertBefore(child, referenceNode);
            return node;
        }
        if (node.parentNode) node.parentNode.removeChild(node);
        node.parentNode = this;
        const index = this.childNodes.indexOf(referenceNode);
        if (index < 0) this.childNodes.push(node);
        else this.childNodes.splice(index, 0, node);
        return node;
    }

    removeChild(node) {
        const index = this.childNodes.indexOf(node);
        if (index < 0) throw new Error("node is not a child");
        this.childNodes.splice(index, 1);
        node.parentNode = null;
        return node;
    }

    remove() {
        this.parentNode?.removeChild(this);
    }

    contains(node) {
        if (node === this) return true;
        return this.childNodes.some((child) => child === node || child.contains?.(node));
    }

    setAttribute(name, value) {
        const stringValue = String(value);
        this.attributes.set(name, stringValue);
        if (name === "id") this.id = stringValue;
        if (name === "class") this.className = stringValue;
        if (name === "tabindex") this.tabIndex = Number(value);
        if (name === "disabled") this.disabled = true;
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    removeAttribute(name) {
        this.attributes.delete(name);
        if (name === "disabled") this.disabled = false;
    }

    get textContent() {
        return this.childNodes.map((child) => child.textContent || "").join("");
    }

    set textContent(value) {
        this.childNodes = [];
        if (value !== "" && value !== null && value !== undefined) {
            this.appendChild(new MiniTextNode(value, this.ownerDocument));
        }
    }

    matches(selector) {
        const attributeMatches = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
        const baseSelector = selector.replace(/\[[^\]]+\]/g, "");
        if (baseSelector.startsWith("#") && this.id !== baseSelector.slice(1)) return false;
        if (baseSelector.startsWith(".") && !this.className.split(/\s+/).includes(baseSelector.slice(1))) {
            return false;
        }
        if (baseSelector && !baseSelector.startsWith("#") && !baseSelector.startsWith(".") && (
            this.tagName.toLowerCase() !== baseSelector.toLowerCase()
        )) return false;
        return attributeMatches.every((attributeMatch) => (
            this.hasAttribute(attributeMatch[1]) && (
                attributeMatch[2] === undefined || this.getAttribute(attributeMatch[1]) === attributeMatch[2]
            )
        ));
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = (node) => {
            for (const child of node.childNodes || []) {
                if (child.nodeType === 1) {
                    if (child.matches(selector)) matches.push(child);
                    visit(child);
                }
            }
        };
        visit(this);
        return matches;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    focus() {
        if (this.disabled) return;
        this.ownerDocument.activeElement = this;
        this.dispatchEvent(new MiniEvent("focus", { bubbles: false }));
    }

    setBoundingClientRect(rect) {
        this._rect = { ...this._rect, ...rect };
    }

    getBoundingClientRect() {
        return { ...this._rect };
    }

    scrollIntoView() {}
}

class MiniDocument extends MiniEventTarget {
    constructor() {
        super();
        this.nodeType = 9;
        this.nodeName = "#document";
        this.ownerDocument = this;
        this.parentNode = null;
        this.documentElement = new MiniElement("html", this);
        this.body = new MiniElement("body", this);
        this.documentElement.parentNode = this;
        this.documentElement.appendChild(this.body);
        this.activeElement = this.body;
        this.defaultView = null;
    }

    createElement(tagName) {
        return new MiniElement(tagName, this);
    }

    createElementNS(namespaceURI, tagName) {
        const element = new MiniElement(tagName, this);
        element.namespaceURI = namespaceURI;
        return element;
    }

    createTextNode(text) {
        return new MiniTextNode(text, this);
    }

    createDocumentFragment() {
        return new MiniDocumentFragment(this);
    }

    createEvent() {
        return new MiniEvent("event");
    }

    getElementById(id) {
        if (this.documentElement.id === id) return this.documentElement;
        return this.documentElement.querySelector(`#${id}`);
    }

    querySelector(selector) {
        return this.documentElement.matches(selector)
            ? this.documentElement
            : this.documentElement.querySelector(selector);
    }

    querySelectorAll(selector) {
        const matches = [];
        if (this.documentElement.matches(selector)) matches.push(this.documentElement);
        return matches.concat(this.documentElement.querySelectorAll(selector));
    }

    hasFocus() {
        return true;
    }
}

class MiniWindow extends MiniEventTarget {
    constructor(document) {
        super();
        this.document = document;
        this.innerWidth = 900;
        this.innerHeight = 700;
        this.navigator = { userAgent: "mini-dom" };
        this.location = { href: "http://localhost/" };
        this.parent = this;
        this.self = this;
        this.top = this;
        this.window = this;
        this.HTMLElement = MiniElement;
        this.Element = MiniElement;
        this.Node = MiniEventTarget;
        this.Text = MiniTextNode;
        this.SVGElement = MiniElement;
        this.HTMLIFrameElement = class MiniHTMLIFrameElement extends MiniElement {};
    }

    getComputedStyle() {
        return {};
    }

    requestAnimationFrame(callback) {
        return setTimeout(() => callback(Date.now()), 0);
    }

    cancelAnimationFrame(handle) {
        clearTimeout(handle);
    }
}

const installMiniDom = () => {
    const previous = new Map();
    const document = new MiniDocument();
    const window = new MiniWindow(document);
    document.defaultView = window;
    const globals = {
        window,
        document,
        navigator: window.navigator,
        HTMLElement: MiniElement,
        Element: MiniElement,
        Node: MiniEventTarget,
        Text: MiniTextNode,
        SVGElement: MiniElement,
        HTMLIFrameElement: window.HTMLIFrameElement,
        Event: MiniEvent,
        MouseEvent: MiniEvent,
        KeyboardEvent: MiniEvent,
        IS_REACT_ACT_ENVIRONMENT: true,
    };

    for (const [name, value] of Object.entries(globals)) {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, {
            value,
            configurable: true,
            enumerable: true,
            writable: true,
        });
    }

    return {
        document,
        window,
        restore() {
            for (const [name, descriptor] of previous) {
                if (!descriptor) delete globalThis[name];
                else Object.defineProperty(globalThis, name, descriptor);
            }
        },
    };
};

const dom = installMiniDom();
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../../../../../");
const cssModulePrefix = "\0live-selector-placement-css:";
const stubPrefix = "\0live-selector-placement-stub:";
const cssModulePlugin = {
    name: "live-selector-placement-test-modules",
    enforce: "pre",
    resolveId(source, importer) {
        if (source === "@useI18n" || source === "@utils" || source === "@store"
            || source === "@logics_configs" || source === "@logics_common"
            || source === "@logics_common/transcriptionEngineMetadata.js"
            || source === "@logics_common/transcriptionEngineIconSources.js"
            || source === "@logics_common/bingLanguageSupport.js"
            || source === "@logics_common/translationProviderMetadata.js"
            || source === "@logics_common/translationProviderIconSources.js"
            || source === "@logics_main") {
            return `${stubPrefix}${source}`;
        }
        if (importer && source.endsWith(".svg")) {
            return `${stubPrefix}asset:${path.resolve(path.dirname(importer), source)}`;
        }
        if (!importer || !source.endsWith(".module.scss")) return undefined;
        const resolvedPath = path.resolve(path.dirname(importer), source);
        return `${cssModulePrefix}${resolvedPath.slice(0, -".module.scss".length)}`;
    },
    load(id) {
        if (id.startsWith(cssModulePrefix)) {
            return `const styles = new Proxy({}, { get: (_, name) => String(name) }); export default styles;`;
        }
        if (id.startsWith(`${stubPrefix}asset:`)) {
            return `export default 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';`;
        }
        if (!id.startsWith(stubPrefix)) return undefined;
        const source = id.slice(stubPrefix.length);
        const modules = {
            "@useI18n": `export const useI18n = () => ({ t: (key) => key });`,
            "@utils": `export const chunkArray = (items, size) => {
                const chunks = [];
                for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
                return chunks;
            };`,
            "@store": `const state = () => globalThis.__livePlacementStore;
                export const useStore_IsOpenedTranscriptionEngineSelector = () => ({
                    currentIsOpenedTranscriptionEngineSelector: { data: state().engineOpen === true },
                    updateIsOpenedTranscriptionEngineSelector: (value) => {
                        state().engineOpen = value;
                        state().engineClose.push(value);
                    },
                });
                export const useStore_IsOpenedTranslatorSelector = () => ({
                    currentIsOpenedTranslatorSelector: { data: state().translatorOpen === true },
                    updateIsOpenedTranslatorSelector: (value) => {
                        state().translatorOpen = value;
                        state().translatorClose.push(value);
                    },
                });
                export const useStore_SelectedConfigTabId = () => ({
                    updateSelectedConfigTabId: (value) => state().configTabs.push(value),
                });`,
            "@logics_configs": `const state = () => globalThis.__livePlacementStore;
                export const useTranscription = () => ({
                    currentTranscriptionProfileSend: { data: { engine: "Whisper", models: { Whisper: "base" } } },
                    currentTranscriptionProfileReceive: { data: { engine: "Google", models: {} } },
                    currentSelectableTranscriptionComputeDeviceList: { data: {
                        cpu: { device: "cpu", compute_types: ["auto"] },
                    } },
                    currentSelectedTranscriptionComputeDeviceSend: { data: { device: "cpu" } },
                    setSelectedTranscriptionComputeDeviceSend: () => {},
                    currentSelectedTranscriptionComputeDeviceReceive: { data: { device: "cpu" } },
                    setSelectedTranscriptionComputeDeviceReceive: () => {},
                    currentSelectedTranscriptionComputeTypeSend: { data: "auto" },
                    setSelectedTranscriptionComputeTypeSend: () => {},
                    currentSelectedTranscriptionComputeTypeReceive: { data: "auto" },
                    setSelectedTranscriptionComputeTypeReceive: () => {},
                    setSelectedTranscriptionEngine: (value) => state().engineSelections.push(["all", value]),
                    setSelectedTranscriptionEngineSend: (value) => state().engineSelections.push(["speaking", value]),
                    setSelectedTranscriptionEngineReceive: (value) => state().engineSelections.push(["listening", value]),
                    currentUseSplitGroqApiKey: { data: false },
                    currentGroqWhisperAuthKey: { data: "" },
                });
                export const useTranslation = () => ({ currentGroqAuthKey: { data: "configured" } });`,
            "@logics_common": `const state = () => globalThis.__livePlacementStore;
                export const useIsOpenedConfigPage = () => ({ setIsOpenedConfigPage: (value) => state().configPage.push(value) });
                export const useNotificationStatus = () => ({ showNotification_Warning: () => {} });`,
            "@logics_common/transcriptionEngineMetadata.js": `export const getTranscriptionEngineMetadata = (engine) => ({
                type: ["Google", "Whisper Cloud"].includes(engine) ? "cloud" : "local",
                icon: engine === "Google" ? "google" : engine === "Whisper Cloud" ? "groq" : "local",
            });`,
            "@logics_common/transcriptionEngineIconSources.js": `export const getTranscriptionEngineIconSource = () => "data:image/svg+xml,<svg/>";`,
            "@logics_common/bingLanguageSupport.js": `export const getUnsupportedBingLanguageSlots = () => [];
                export const formatBingUnsupportedLanguages = () => "";`,
            "@logics_common/translationProviderMetadata.js": `export const getTranslationProviderIcon = () => "local";`,
            "@logics_common/translationProviderIconSources.js": `export const getTranslationProviderIconSource = () => "data:image/svg+xml,<svg/>";`,
            "@logics_main": `const state = () => globalThis.__livePlacementStore;
                export const useLanguageSettings = () => ({
                    currentSelectedPresetTabNumber: { data: 0 },
                    currentTranslationEngines: { data: [
                        { id: "Google", label: "Google", is_available: true, is_default: true },
                        { id: "CTranslate2", label: "CTranslate2", is_available: true, is_default: false },
                    ] },
            currentSelectedTranslationEngines: { data: state().selectedTranslations ?? [["Google"]] },
                    setSelectedTranslationEngines: (value) => state().translationSelections.push(value),
                    currentCTranslate2AutoFallback: { data: false, state: "ok" },
                    getCTranslate2AutoFallback: () => state().fallbackReads.push(true),
                    setCTranslate2AutoFallback: (value) => state().fallbackWrites.push(value),
                    currentSelectableLanguageList: { data: [] },
                    getCurrentYourLanguages: () => [],
                    getCurrentTargetLanguages: () => [],
                });`,
        };
        return modules[source];
    },
};

const engineSelectorPath = "/src-ui/views/app/main_page/sidebar_section/language_settings/"
    + "transcription_engine_label/transcription_engine_selector/TranscriptionEngineSelector.jsx";
const translatorSelectorPath = "/src-ui/views/app/main_page/sidebar_section/language_settings/"
    + "translator_selector_open_button/translator_selector/TranslatorSelector.jsx";
const engineLabelPath = "/src-ui/views/app/main_page/sidebar_section/language_settings/"
    + "transcription_engine_label/TranscriptionEngineLabel.jsx";
const translatorButtonPath = "/src-ui/views/app/main_page/sidebar_section/language_settings/"
    + "translator_selector_open_button/TranslatorSelectorOpenButton.jsx";
const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

let ReactRuntime;
let act;
let createRoot;
let TranscriptionEngineSelector;
let TranslatorSelector;
let TranscriptionEngineLabel;
let TranslatorSelectorOpenButton;
let viteServer;

before(async () => {
    ReactRuntime = await import("react");
    ({ act } = ReactRuntime);
    ({ createRoot } = await import("react-dom/client"));
    viteServer = await createServer({
        configFile: false,
        root: repositoryRoot,
        appType: "custom",
        logLevel: "error",
        optimizeDeps: { noDiscovery: true },
        plugins: [cssModulePlugin, react()],
        server: { middlewareMode: true, hmr: false },
    });
    ({ TranscriptionEngineSelector } = await viteServer.ssrLoadModule(engineSelectorPath));
    ({ TranslatorSelector } = await viteServer.ssrLoadModule(translatorSelectorPath));
    ({ TranscriptionEngineLabel } = await viteServer.ssrLoadModule(engineLabelPath));
    ({ TranslatorSelectorOpenButton } = await viteServer.ssrLoadModule(translatorButtonPath));
});

after(async () => {
    await viteServer?.close();
    dom.restore();
});

const resetStore = () => {
    globalThis.__livePlacementStore = {
        engineOpen: false,
        translatorOpen: false,
        engineClose: [],
        translatorClose: [],
        engineSelections: [],
        translationSelections: [],
        selectedTranslations: [["Google"]],
        configTabs: [],
        configPage: [],
        fallbackReads: [],
        fallbackWrites: [],
    };
    return globalThis.__livePlacementStore;
};

const renderSelector = async (Component, props, anchorRect) => {
    const container = dom.document.createElement("div");
    dom.document.body.appendChild(container);
    const anchor = dom.document.createElement("button");
    anchor.setAttribute("type", "button");
    anchor.setBoundingClientRect(anchorRect);
    container.appendChild(anchor);
    const anchorRef = { current: anchor };
    const root = createRoot(container);

    await act(async () => {
        root.render(ReactRuntime.createElement(Component, {
            ...props,
            anchorRef: props.placement === "live" ? anchorRef : undefined,
        }));
    });

    return { container, root, anchor, anchorRef };
};

const renderComponent = async (Component, props = {}) => {
    const container = dom.document.createElement("div");
    dom.document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(ReactRuntime.createElement(Component, props));
    });

    return { container, root };
};

const unmountSelector = async ({ container, root }) => {
    await act(async () => root.unmount());
    container.remove();
};

const dispatch = async (target, event) => {
    await act(async () => target.dispatchEvent(event));
};

const click = (target) => dispatch(target, new MiniEvent("click"));
const livePanel = () => dom.document.querySelector('[data-placement="live"]');
const listenerCount = (target, type) => target._listeners.get(type)?.length ?? 0;
const numberStyle = (element, property) => Number.parseFloat(element.style[property]);
const buttonWithText = (element, text) => element.querySelectorAll("button")
    .find((button) => button.textContent.includes(text));

const engineProps = {
    selected_id: "Whisper",
    role: "speaking",
    placement: "live",
};

const translatorProps = {
    selected_ids: ["Google"],
    translation_engines: [
        { id: "Google", label: "Google", is_available: true, is_default: true },
        { id: "CTranslate2", label: "CTranslate2", is_available: true, is_default: false },
    ],
    is_selected_same_language: false,
    placement: "live",
};

test("wires stable live anchors into both selector families while leaving settings inline", () => {
    const engineLabel = readSource(
        "../../sidebar_section/language_settings/transcription_engine_label/TranscriptionEngineLabel.jsx",
    );
    const translatorButton = readSource(
        "../../sidebar_section/language_settings/translator_selector_open_button/TranslatorSelectorOpenButton.jsx",
    );
    const engineSelector = readSource(
        "../../sidebar_section/language_settings/transcription_engine_label/"
        + "transcription_engine_selector/TranscriptionEngineSelector.jsx",
    );
    const translatorSelector = readSource(
        "../../sidebar_section/language_settings/translator_selector_open_button/"
        + "translator_selector/TranslatorSelector.jsx",
    );

    assert.match(engineLabel, /const speakingButtonRef\s*=\s*useRef\(null\)/);
    assert.match(engineLabel, /const listeningButtonRef\s*=\s*useRef\(null\)/);
    assert.match(engineLabel, /const anchorRef = role\.id === "speaking"[\s\S]*speakingButtonRef[\s\S]*listeningButtonRef/);
    assert.match(engineLabel, /ref=\{anchorRef\}/);
    assert.match(engineLabel, /anchorRef=\{anchorRef\}[\s\S]*placement="live"/);
    assert.match(translatorButton, /const translatorButtonRef\s*=\s*useRef\(null\)/);
    assert.match(translatorButton, /ref=\{translatorButtonRef\}/);
    assert.match(translatorButton, /<TranslatorSelector[\s\S]*anchorRef=\{variant === "live_compact" \? translatorButtonRef : undefined\}/);
    assert.match(engineSelector, /createPortal/);
    assert.match(engineSelector, /useFloatingPanelPosition/);
    assert.match(engineSelector, /anchorRef/);
    assert.match(engineSelector, /verticalAlignment:\s*["']anchor-end["']/);
    assert.match(translatorSelector, /createPortal/);
    assert.match(translatorSelector, /useFloatingPanelPosition/);
    assert.match(translatorSelector, /anchorRef/);
    assert.match(translatorSelector, /verticalAlignment:\s*["']anchor-end["']/);

    const engineStyles = readSource(
        "../../sidebar_section/language_settings/transcription_engine_label/"
        + "transcription_engine_selector/TranscriptionEngineSelector.module.scss",
    );
    const translatorStyles = readSource(
        "../../sidebar_section/language_settings/translator_selector_open_button/"
        + "translator_selector/TranslatorSelector.module.scss",
    );
    const getLiveStyleBlock = (styles) => {
        const start = styles.indexOf('.container[data-placement="live"]');
        assert.notEqual(start, -1, "each selector stylesheet must define a live block");
        let depth = 0;
        let end = start;
        for (; end < styles.length; end += 1) {
            if (styles[end] === "{") depth += 1;
            if (styles[end] === "}") {
                depth -= 1;
                if (depth === 0) {
                    end += 1;
                    break;
                }
            }
        }
        return styles.slice(start, end);
    };

    for (const styles of [engineStyles, translatorStyles]) {
        const liveStyles = getLiveStyleBlock(styles);
        const hasDeclaration = (property, value) => liveStyles
            .split(/\r?\n/)
            .some((line) => new RegExp(`^\\s*${property}\\s*:\\s*${value}(?:\\s|;|$)`).test(line));
        assert.equal(hasDeclaration("left", "0"), false);
        assert.equal(hasDeclaration("right", "0"), false);
        assert.equal(hasDeclaration("width", "100%"), false);
    }
});

test("runtime parent components pass the matching live anchor refs and keep settings inline", async () => {
    const renderRole = async (roleIndex, expectedLeft, expectedSelection) => {
        resetStore();
        const rendered = await renderComponent(TranscriptionEngineLabel, {
            variant: "live_compact",
        });
        try {
            const roleButtons = rendered.container.querySelectorAll("button");
            assert.equal(roleButtons.length, 2, "live label must render Speaking and Listening anchors");
            roleButtons[0].setBoundingClientRect({
                top: 100,
                bottom: 144,
                left: 80,
                right: 180,
                width: 100,
                height: 44,
            });
            roleButtons[1].setBoundingClientRect({
                top: 300,
                bottom: 344,
                left: 300,
                right: 400,
                width: 100,
                height: 44,
            });

            await click(roleButtons[roleIndex]);
            const panel = livePanel();
            assert.ok(panel, "the selected live role must render its selector");
            assert.equal(panel.parentNode, dom.document.body);
            assert.equal(numberStyle(panel, "left"), expectedLeft);

            await click(buttonWithText(panel, "Whisper"));
            assert.deepEqual(globalThis.__livePlacementStore.engineSelections, [expectedSelection]);
            assert.equal(dom.document.activeElement === roleButtons[roleIndex], true);
        } finally {
            await unmountSelector(rendered);
        }
    };

    await renderRole(0, 192, ["speaking", "Whisper Cloud"]);
    await renderRole(1, 412, ["listening", "Whisper Cloud"]);

    resetStore();
    globalThis.__livePlacementStore.translatorOpen = true;
    const liveTranslator = await renderComponent(TranslatorSelectorOpenButton, {
        variant: "live_compact",
    });
    try {
        const translatorButton = liveTranslator.container.querySelector("button");
        translatorButton.setBoundingClientRect({
            top: 220,
            bottom: 264,
            left: 120,
            right: 240,
            width: 120,
            height: 44,
        });
        await dispatch(dom.window, new MiniEvent("resize", { bubbles: false }));
        const panel = livePanel();
        assert.ok(panel, "the live translator selector must render from its parent");
        assert.equal(panel.parentNode, dom.document.body);
        assert.equal(numberStyle(panel, "left"), 252);
    } finally {
        await unmountSelector(liveTranslator);
    }

    resetStore();
    globalThis.__livePlacementStore.translatorOpen = true;
    const settingsTranslator = await renderComponent(TranslatorSelectorOpenButton, {
        variant: "settings",
    });
    try {
        const panel = settingsTranslator.container.querySelector('[data-placement="settings"]');
        assert.ok(panel, "the settings translator selector must still render");
        assert.equal(panel.parentNode !== dom.document.body, true);
        assert.notEqual(panel.style.position, "fixed");
    } finally {
        await unmountSelector(settingsTranslator);
    }
});

test("translator summary renders an icon for every selected translator", async () => {
    resetStore();
    globalThis.__livePlacementStore.selectedTranslations = [["Google", "CTranslate2"]];
    const rendered = await renderComponent(TranslatorSelectorOpenButton, {
        variant: "settings",
    });
    try {
        assert.equal(rendered.container.querySelectorAll("img").length, 2);
    } finally {
        await unmountSelector(rendered);
    }
});

test("Speaking and Listening labels render the selected transcription engine icon", async () => {
    resetStore();
    const rendered = await renderComponent(TranscriptionEngineLabel, {
        variant: "live_compact",
    });
    try {
        assert.equal(rendered.container.querySelectorAll("img").length, 2);
    } finally {
        await unmountSelector(rendered);
    }
});

test("real live engine selector portals to body, clamps on the right, and keeps selection close callbacks", async () => {
    resetStore();
    const rendered = await renderSelector(TranscriptionEngineSelector, engineProps, {
        top: 120,
        bottom: 164,
        left: 80,
        right: 180,
        width: 100,
        height: 44,
    });
    try {
        const panel = livePanel();
        assert.ok(panel, "the real live engine panel must render");
        assert.equal(panel.parentNode, dom.document.body);
        assert.equal(panel.style.position, "fixed");
        assert.equal(panel.getAttribute("data-horizontal-placement"), "right");
        assert.equal(numberStyle(panel, "left"), 192);
        assert.ok(numberStyle(panel, "maxHeight") > 0);
        assert.equal(panel.querySelectorAll("button").length, 8);
                assert.ok(buttonWithText(panel, "Bing"));

        const cloudOption = buttonWithText(panel, "Whisper");
        assert.ok(cloudOption, "the live engine option must remain a real button");
        assert.equal(cloudOption.getAttribute("type"), "button");
        rendered.anchor.focus();
        await click(cloudOption);
        assert.deepEqual(globalThis.__livePlacementStore.engineSelections, [["speaking", "Whisper Cloud"]]);
        assert.deepEqual(globalThis.__livePlacementStore.engineClose, [false]);
        assert.equal(dom.document.activeElement === rendered.anchor, true);
    } finally {
        await unmountSelector(rendered);
    }
});

test("both live selector families align their panel bottom to a near-bottom anchor", async () => {
    const cases = [
        [TranscriptionEngineSelector, engineProps],
        [TranslatorSelector, translatorProps],
    ];

    for (const [Component, props] of cases) {
        resetStore();
        const rendered = await renderSelector(Component, props, {
            top: 500,
            bottom: 544,
            left: 80,
            right: 180,
            width: 100,
            height: 44,
        });
        try {
            const panel = livePanel();
            assert.ok(panel, "the live selector must render its portaled panel");
            assert.equal(numberStyle(panel, "top"), 184);
            assert.equal(numberStyle(panel, "maxHeight"), 528);
            assert.equal(panel.getAttribute("data-vertical-placement"), "anchor-end");
        } finally {
            await unmountSelector(rendered);
        }
    }
});

test("real live engine lifecycle contains panel interactions, closes on Escape, restores focus, and cleans listeners", async () => {
    resetStore();
    const rendered = await renderSelector(TranscriptionEngineSelector, engineProps, {
        top: 120,
        bottom: 164,
        left: 80,
        right: 180,
        width: 100,
        height: 44,
    });
    try {
        const panel = livePanel();
        assert.equal(listenerCount(dom.document, "keydown"), 1);
        assert.equal(listenerCount(dom.document, "pointerdown"), 1);
        assert.equal(listenerCount(dom.document, "click"), 1);

        await click(panel.querySelector("div"));
        assert.deepEqual(globalThis.__livePlacementStore.engineClose, []);

        rendered.anchor.focus();
        await dispatch(dom.document, new MiniEvent("keydown", {
            key: "Escape",
            bubbles: false,
        }));
        assert.deepEqual(globalThis.__livePlacementStore.engineClose, [false]);
        assert.equal(dom.document.activeElement === rendered.anchor, true);
    } finally {
        await unmountSelector(rendered);
    }
    assert.equal(listenerCount(dom.document, "keydown"), 0);
    assert.equal(listenerCount(dom.document, "pointerdown"), 0);
    assert.equal(listenerCount(dom.document, "click"), 0);
});

test("real live engine closes on outside pointer interaction and restores its anchor focus", async () => {
    resetStore();
    const rendered = await renderSelector(TranscriptionEngineSelector, engineProps, {
        top: 120,
        bottom: 164,
        left: 80,
        right: 180,
        width: 100,
        height: 44,
    });
    const outside = dom.document.createElement("div");
    dom.document.body.appendChild(outside);
    try {
        rendered.anchor.focus();
        await dispatch(outside, new MiniEvent("pointerdown"));
        assert.deepEqual(globalThis.__livePlacementStore.engineClose, [false]);
        assert.equal(dom.document.activeElement === rendered.anchor, true);
    } finally {
        outside.remove();
        await unmountSelector(rendered);
    }
});

test("real live panels prefer the right side, fall back left, and clamp to viewport padding", async () => {
    resetStore();
    const previousWidth = dom.window.innerWidth;
    const rendered = await renderSelector(TranscriptionEngineSelector, engineProps, {
        top: 120,
        bottom: 164,
        left: 760,
        right: 860,
        width: 100,
        height: 44,
    });
    try {
        let panel = livePanel();
        assert.equal(panel.getAttribute("data-horizontal-placement"), "left");
        assert.equal(numberStyle(panel, "left"), 348);

        dom.window.innerWidth = 320;
        rendered.anchor.setBoundingClientRect({ left: 0, right: 40, width: 40 });
        await dispatch(dom.window, new MiniEvent("resize", { bubbles: false }));
        panel = livePanel();
        assert.equal(panel.getAttribute("data-horizontal-placement"), "left");
        assert.equal(numberStyle(panel, "left"), 16);
        assert.ok(
            numberStyle(panel, "left") + numberStyle(panel, "width") <= 304,
            "the clamped panel must stay inside the 16px viewport padding",
        );
    } finally {
        dom.window.innerWidth = previousWidth;
        await unmountSelector(rendered);
    }
});

test("real live translator selector portals to body and keeps selection close callbacks", async () => {
    resetStore();
    const rendered = await renderSelector(TranslatorSelector, translatorProps, {
        top: 220,
        bottom: 264,
        left: 120,
        right: 240,
        width: 120,
        height: 44,
    });
    try {
        const panel = livePanel();
        assert.ok(panel, "the real live translator panel must render");
        assert.equal(panel.parentNode, dom.document.body);
        assert.equal(panel.style.position, "fixed");
        assert.equal(panel.getAttribute("data-horizontal-placement"), "right");
        assert.ok(buttonWithText(panel, "CTranslate2"));

        rendered.anchor.focus();
        await click(buttonWithText(panel, "CTranslate2"));
        assert.deepEqual(globalThis.__livePlacementStore.translationSelections, ["CTranslate2"]);
        assert.deepEqual(globalThis.__livePlacementStore.translatorClose, [false]);
        assert.equal(dom.document.activeElement === rendered.anchor, true);
    } finally {
        await unmountSelector(rendered);
    }
});

test("real live translator lifecycle contains the portaled panel, closes on outside click, restores focus, and cleans listeners", async () => {
    resetStore();
    const rendered = await renderSelector(TranslatorSelector, translatorProps, {
        top: 220,
        bottom: 264,
        left: 120,
        right: 240,
        width: 120,
        height: 44,
    });
    const outside = dom.document.createElement("div");
    dom.document.body.appendChild(outside);
    try {
        const panel = livePanel();
        assert.equal(listenerCount(dom.document, "keydown"), 1);
        assert.equal(listenerCount(dom.document, "pointerdown"), 1);
        assert.equal(listenerCount(dom.document, "click"), 1);

        await click(panel.querySelector("div"));
        assert.deepEqual(globalThis.__livePlacementStore.translatorClose, []);

        rendered.anchor.focus();
        await dispatch(outside, new MiniEvent("click"));
        assert.deepEqual(globalThis.__livePlacementStore.translatorClose, [false]);
        assert.equal(dom.document.activeElement === rendered.anchor, true);
    } finally {
        outside.remove();
        await unmountSelector(rendered);
    }
    assert.equal(listenerCount(dom.document, "keydown"), 0);
    assert.equal(listenerCount(dom.document, "pointerdown"), 0);
    assert.equal(listenerCount(dom.document, "click"), 0);
});

test("real live translator closes on Escape and restores its anchor focus", async () => {
    resetStore();
    const rendered = await renderSelector(TranslatorSelector, translatorProps, {
        top: 220,
        bottom: 264,
        left: 120,
        right: 240,
        width: 120,
        height: 44,
    });
    try {
        rendered.anchor.focus();
        await dispatch(dom.document, new MiniEvent("keydown", {
            key: "Escape",
            bubbles: false,
        }));
        assert.deepEqual(globalThis.__livePlacementStore.translatorClose, [false]);
        assert.equal(dom.document.activeElement === rendered.anchor, true);
    } finally {
        await unmountSelector(rendered);
    }
});

test("settings selector placement remains inline instead of portaled", async () => {
    resetStore();
    const rendered = await renderSelector(TranscriptionEngineSelector, {
        selected_id: "Whisper",
        role: "all",
        placement: "settings",
    }, {
        top: 80,
        bottom: 124,
        left: 30,
        right: 130,
        width: 100,
        height: 44,
    });
    try {
        const panel = rendered.container.querySelector('[data-placement="settings"]');
        assert.ok(panel, "the settings selector must still render");
        assert.equal(panel.parentNode, rendered.container);
        assert.notEqual(panel.style.position, "fixed");
        const outside = dom.document.createElement("div");
        dom.document.body.appendChild(outside);
        await dispatch(outside, new MiniEvent("click"));
        outside.remove();
        assert.deepEqual(globalThis.__livePlacementStore.engineClose, []);
    } finally {
        await unmountSelector(rendered);
    }
});
