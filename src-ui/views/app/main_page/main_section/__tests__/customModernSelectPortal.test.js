import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

class MiniEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.bubbles = options.bubbles ?? true;
        this.cancelable = options.cancelable ?? true;
        this.key = options.key;
        this.code = options.code;
        this.button = options.button ?? 0;
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
        if (remaining.length > 0) {
            this._listeners.set(type, remaining);
        } else {
            this._listeners.delete(type);
        }
    }

    listenerCount(type) {
        return this._listeners.get(type)?.length || 0;
    }

    listenerRecords(type) {
        return [...(this._listeners.get(type) || [])];
    }

    dispatchEvent(event) {
        if (!event || !event.type) throw new TypeError("event must have a type");

        const path = [];
        let current = this;
        while (current) {
            path.push(current);
            current = current.parentNode || null;
        }

        event.target = this;
        event.defaultPrevented = false;
        event.cancelBubble = false;
        event.composedPath = () => [...path];

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

        for (let index = path.length - 1; index > 0; index -= 1) {
            if (!invoke(path[index], true, 1)) return !event.defaultPrevented;
        }

        invoke(this, true, 2);
        if (!event.immediatePropagationStopped) invoke(this, false, 2);

        if (event.bubbles !== false && !event.cancelBubble) {
            for (let index = 1; index < path.length; index += 1) {
                if (!invoke(path[index], false, 3)) break;
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

    get firstChild() {
        return this.childNodes[0] || null;
    }

    get lastChild() {
        return this.childNodes[this.childNodes.length - 1] || null;
    }

    get nextSibling() {
        if (!this.parentNode?.childNodes) return null;
        const index = this.parentNode.childNodes.indexOf(this);
        return index >= 0 ? this.parentNode.childNodes[index + 1] || null : null;
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
        if (index < 0) {
            this.childNodes.push(node);
        } else {
            this.childNodes.splice(index, 0, node);
        }
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
        if (baseSelector.startsWith(".") && !this.className.split(/\s+/).includes(baseSelector.slice(1))) return false;
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

    blur() {
        if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
        this.dispatchEvent(new MiniEvent("blur", { bubbles: false }));
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
        this.innerWidth = 1024;
        this.innerHeight = 768;
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
                if (!descriptor) {
                    delete globalThis[name];
                } else {
                    Object.defineProperty(globalThis, name, descriptor);
                }
            }
        },
    };
};

const dom = installMiniDom();
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../../../../../");
const componentModulePath = "/src-ui/views/common_components/custom_select/CustomModernSelect.jsx";
const virtualCssModulePrefix = "\0custom-modern-select-css:";
const cssModulePlugin = {
    name: "custom-modern-select-test-css-module",
    enforce: "pre",
    resolveId(source, importer) {
        if (!importer || !source.endsWith(".module.scss")) return undefined;
        const resolvedPath = path.resolve(path.dirname(importer), source);
        return `${virtualCssModulePrefix}${resolvedPath.slice(0, -".module.scss".length)}`;
    },
    load(id) {
        if (!id.startsWith(virtualCssModulePrefix)) return undefined;
        return `
            const styles = new Proxy({}, { get: (_, name) => String(name) });
            export default styles;
        `;
    },
};

let ReactRuntime;
let act;
let createRoot;
let CustomModernSelect;
let viteServer;

const options = [
    { id: "first", title: "First option" },
    { id: "second", title: "Second option" },
    { id: "disabled", title: "Disabled option", disabled: true },
];

before(async () => {
    ReactRuntime = await import("react");
    ({ act } = ReactRuntime);
    ({ createRoot } = await import("react-dom/client"));
    viteServer = await createServer({
        root: repositoryRoot,
        appType: "custom",
        logLevel: "error",
        optimizeDeps: { noDiscovery: true },
        plugins: [cssModulePlugin],
        server: { middlewareMode: true, hmr: false },
    });
    ({ CustomModernSelect } = await viteServer.ssrLoadModule(componentModulePath));
});

after(async () => {
    await viteServer?.close();
    dom.restore();
});

const renderSelect = async ({ value = "first", onChange = () => {} } = {}) => {
    const container = dom.document.createElement("div");
    dom.document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(ReactRuntime.createElement(CustomModernSelect, {
            id: "runtime-select",
            label: "Engine",
            value,
            options,
            onChange,
        }));
    });

    const trigger = dom.document.getElementById("runtime-select-button");
    assert.ok(trigger, "the real CustomModernSelect trigger must render");
    trigger.setBoundingClientRect({
        top: 100,
        bottom: 140,
        left: 80,
        right: 320,
        width: 240,
        height: 40,
    });

    return { container, root, trigger };
};

const unmountSelect = async ({ container, root }) => {
    await act(async () => root.unmount());
    container.remove();
};

const dispatch = async (target, event) => {
    await act(async () => {
        target.dispatchEvent(event);
    });
};

const click = (target) => dispatch(target, new MiniEvent("click"));
const mousedown = (target) => dispatch(target, new MiniEvent("mousedown"));
const keydown = (target, key) => dispatch(target, new MiniEvent("keydown", { key }));

const listbox = () => dom.document.getElementById("runtime-select-listbox");

test("renders the real open listbox through document.body with fixed geometry and accessibility state", async () => {
    const rendered = await renderSelect();
    try {
        await click(rendered.trigger);

        const openListbox = listbox();
        assert.ok(openListbox, "opening the real component must render a listbox");
        assert.equal(openListbox.parentNode, dom.document.body);
        assert.equal(openListbox.getAttribute("role"), "listbox");
        assert.equal(openListbox.style.position, "fixed");
        assert.notEqual(openListbox.style.top, undefined);
        assert.notEqual(openListbox.style.left, undefined);
        assert.notEqual(openListbox.style.width, undefined);
        assert.ok(["above", "below"].includes(openListbox.getAttribute("data-placement")));
        assert.equal(rendered.trigger.getAttribute("aria-haspopup"), "listbox");
        assert.equal(rendered.trigger.getAttribute("aria-expanded"), "true");
        assert.equal(rendered.trigger.getAttribute("aria-controls"), openListbox.id);
        assert.equal(openListbox.querySelectorAll('[role="option"]').length, options.length);
        assert.equal(openListbox.querySelector('[role="option"]').getAttribute("aria-selected"), "true");
        assert.equal(
            openListbox.querySelectorAll('[aria-disabled="true"]').length,
            1,
        );
    } finally {
        await unmountSelect(rendered);
    }
});

test("keeps the real portaled listbox open for inside events and closes it for outside events", async () => {
    const rendered = await renderSelect();
    const outside = dom.document.createElement("div");
    dom.document.body.appendChild(outside);
    try {
        await click(rendered.trigger);
        const openListbox = listbox();
        assert.ok(openListbox);

        await mousedown(openListbox);
        await click(openListbox);
        assert.equal(listbox(), openListbox, "events inside the body portal must not close it");

        await mousedown(outside);
        assert.equal(listbox(), null, "events outside both component regions must close it");
        assert.equal(rendered.trigger.getAttribute("aria-expanded"), "false");
    } finally {
        outside.remove();
        await unmountSelect(rendered);
    }
});

test("preserves real keyboard navigation, selection, Escape, Tab, and focus return", async () => {
    const changes = [];
    const rendered = await renderSelect({ onChange: (value) => changes.push(value) });
    try {
        rendered.trigger.focus();
        await keydown(rendered.trigger, "ArrowDown");
        let openListbox = listbox();
        assert.ok(openListbox);
        assert.equal(openListbox.getAttribute("aria-activedescendant"), "runtime-select-option-0");

        await keydown(rendered.trigger, "ArrowDown");
        openListbox = listbox();
        assert.equal(openListbox.getAttribute("aria-activedescendant"), "runtime-select-option-1");
        assert.equal(openListbox.querySelector('[role="option"][aria-selected="true"]').id, "runtime-select-option-0");

        await keydown(rendered.trigger, "ArrowUp");
        assert.equal(listbox().getAttribute("aria-activedescendant"), "runtime-select-option-0");
        await keydown(rendered.trigger, "ArrowDown");

        await keydown(rendered.trigger, "Enter");
        assert.deepEqual(changes, ["second"]);
        assert.equal(listbox(), null);
        assert.equal(dom.document.activeElement, rendered.trigger, "selection must return focus to the trigger");

        await keydown(rendered.trigger, " ");
        assert.ok(listbox(), "Space must open the real listbox");
        await keydown(rendered.trigger, "Tab");
        assert.equal(listbox(), null, "Tab must close an open listbox");

        await keydown(rendered.trigger, "Enter");
        assert.ok(listbox());
        await keydown(rendered.trigger, "Escape");
        assert.equal(listbox(), null, "Escape must close an open listbox");
        assert.equal(dom.document.activeElement, rendered.trigger, "Escape must return focus to the trigger");
    } finally {
        await unmountSelect(rendered);
    }
});

test("observes real resize and capture-phase scroll updates, then removes position listeners on close", async () => {
    const rendered = await renderSelect();
    try {
        await click(rendered.trigger);
        let openListbox = listbox();
        assert.ok(openListbox);
        assert.equal(dom.window.listenerCount("resize"), 1);
        assert.equal(dom.window.listenerCount("scroll"), 1);
        assert.equal(dom.window.listenerRecords("scroll")[0].capture, true);

        const initialTop = openListbox.style.top;
        rendered.trigger.setBoundingClientRect({ top: 500, bottom: 540 });
        await dispatch(dom.window, new MiniEvent("resize", { bubbles: false }));
        openListbox = listbox();
        assert.notEqual(openListbox.style.top, initialTop, "resize must update fixed panel geometry");

        const resizedTop = openListbox.style.top;
        rendered.trigger.setBoundingClientRect({ top: 200, bottom: 240 });
        await dispatch(dom.window, new MiniEvent("scroll", { bubbles: false }));
        openListbox = listbox();
        assert.notEqual(openListbox.style.top, resizedTop, "capture-phase scroll must update fixed panel geometry");

        await keydown(rendered.trigger, "Escape");
        assert.equal(dom.window.listenerCount("resize"), 0);
        assert.equal(dom.window.listenerCount("scroll"), 0);

        await click(rendered.trigger);
        assert.equal(dom.window.listenerCount("resize"), 1);
    } finally {
        await unmountSelect(rendered);
        assert.equal(dom.window.listenerCount("resize"), 0);
        assert.equal(dom.window.listenerCount("scroll"), 0);
    }
});
