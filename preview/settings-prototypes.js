import {
    configurableControlCount,
    settingsControlCount,
    settingsSections,
} from "/src-ui/views/app/config_page/prototypes/settingsPrototypeData.js";

const variants = [
    {
        id: "navigator",
        number: "01",
        name: "Navigator",
        blurb: "Familiar sidebar, clearer groups, fastest to learn.",
    },
    {
        id: "workbench",
        number: "02",
        name: "Workbench",
        blurb: "Compact rail and overview for power users.",
    },
    {
        id: "focus",
        number: "03",
        name: "Focus",
        blurb: "Search-first, calm, and friendly at smaller sizes.",
    },
];

let currentVariant = "navigator";
let activeSection = "device";
let searchQuery = "";

const root = document.querySelector("#prototype-root");

const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const iconForSection = {
    device: "DV",
    appearance: "AP",
    translation: "TR",
    transcription: "ST",
    vr: "VR",
    others: "OT",
    hotkeys: "HK",
    advanced: "NW",
    credit: "CR",
    about: "IN",
};

const controlMarkup = (control) => {
    const value = escapeHtml(control.value);

    if (control.type === "toggle") {
        return `
            <button class="mock-toggle" type="button" aria-label="${escapeHtml(control.label)}" aria-pressed="${control.value}">
                <span></span>
            </button>
        `;
    }

    if (control.type === "range") {
        return `
            <div class="mock-range">
                <span class="range-track"><span></span></span>
                <output>${value}</output>
            </div>
        `;
    }

    if (control.type === "secret") {
        return `
            <button class="mock-field secret-field" type="button">
                <span>••••••••••••</span>
                <span class="field-action">Edit</span>
            </button>
        `;
    }

    if (control.type === "segmented") {
        return `
            <button class="mock-field segmented-field" type="button">
                <span>${value}</span>
                <span class="field-action">Change</span>
            </button>
        `;
    }

    const buttonTypes = new Set(["download", "status", "danger", "action", "link", "hotkey"]);
    if (buttonTypes.has(control.type)) {
        return `
            <button class="mock-field ${control.type}-field" type="button">
                <span>${value}</span>
                <span class="field-action">${control.type === "hotkey" ? "Record" : "›"}</span>
            </button>
        `;
    }

    return `
        <button class="mock-field" type="button">
            <span>${value}</span>
            <span class="field-action">${control.type === "select" ? "⌄" : "Edit"}</span>
        </button>
    `;
};

const settingRowMarkup = (control) => `
    <div class="setting-row" data-search="${escapeHtml(control.label.toLowerCase())}">
        <div class="setting-copy">
            <span class="setting-label">${escapeHtml(control.label)}</span>
            <span class="setting-kind">${escapeHtml(control.type)}</span>
        </div>
        <div class="setting-control">${controlMarkup(control)}</div>
    </div>
`;

const groupMarkup = (group) => {
    const visibleControls = searchQuery
        ? group.controls.filter((control) => control.label.toLowerCase().includes(searchQuery))
        : group.controls;

    if (!visibleControls.length) return "";

    return `
        <section class="setting-group">
            <div class="group-heading">
                <h2>${escapeHtml(group.title)}</h2>
                <span>${visibleControls.length}</span>
            </div>
            <div class="setting-list">
                ${visibleControls.map(settingRowMarkup).join("")}
            </div>
        </section>
    `;
};

const sectionMatchesSearch = (section) => {
    if (!searchQuery) return true;
    return section.label.toLowerCase().includes(searchQuery)
        || section.description.toLowerCase().includes(searchQuery)
        || section.groups.some((group) => group.title.toLowerCase().includes(searchQuery)
            || group.controls.some((control) => control.label.toLowerCase().includes(searchQuery)));
};

const sectionMarkup = (section, expanded = false) => {
    const groups = section.groups.map(groupMarkup).join("");
    if (!groups && !section.label.toLowerCase().includes(searchQuery)) return "";

    return `
        <article class="settings-section ${expanded ? "expanded-section" : ""}" id="section-${section.id}">
            <header class="section-heading">
                <div>
                    <span class="section-eyebrow">${escapeHtml(section.eyebrow)}</span>
                    <h1>${escapeHtml(section.label)}</h1>
                    <p>${escapeHtml(section.description)}</p>
                </div>
                <span class="section-code">${iconForSection[section.id]}</span>
            </header>
            <div class="groups-grid">${groups}</div>
        </article>
    `;
};

const variantSwitcherMarkup = () => `
    <section class="prototype-switcher" aria-label="Prototype choices">
        <div class="switcher-intro">
            <span class="prototype-kicker">Settings redesign study</span>
            <h1>Choose a direction</h1>
            <p>Every option is present in all three prototypes. Controls are visual only.</p>
        </div>
        <div class="variant-tabs">
            ${variants.map((variant) => `
                <button
                    class="variant-tab ${variant.id === currentVariant ? "is-active" : ""}"
                    type="button"
                    data-variant="${variant.id}"
                >
                    <span class="variant-number">${variant.number}</span>
                    <span>
                        <strong>${variant.name}</strong>
                        <small>${variant.blurb}</small>
                    </span>
                </button>
            `).join("")}
        </div>
    </section>
`;

const appHeaderMarkup = () => `
    <header class="app-header">
        <div class="brand">
            <span class="brand-mark">V</span>
            <span><strong>VRCNT-NEXT</strong><small>Settings prototype</small></span>
        </div>
        <div class="coverage">
            <span class="coverage-dot"></span>
            10 sections · ${configurableControlCount} settings · ${settingsControlCount} total rows
        </div>
        <button class="close-button" type="button" title="Close prototype" aria-label="Close prototype">×</button>
    </header>
`;

const searchMarkup = (placeholder = "Search all settings") => `
    <label class="settings-search">
        <span>⌕</span>
        <input type="search" value="${escapeHtml(searchQuery)}" placeholder="${placeholder}" aria-label="${placeholder}" />
        <kbd>Ctrl K</kbd>
    </label>
`;

const navItemsMarkup = (compact = false) => settingsSections.map((section) => `
    <button
        type="button"
        class="section-nav-item ${section.id === activeSection ? "is-active" : ""}"
        data-section="${section.id}"
        title="${escapeHtml(section.label)}"
    >
        <span class="nav-code">${iconForSection[section.id]}</span>
        ${compact ? "" : `<span>${escapeHtml(section.label)}</span>`}
        ${compact ? "" : "<span class=\"nav-arrow\">›</span>"}
    </button>
`).join("");

const navigatorMarkup = () => {
    const active = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
    const visibleSections = searchQuery ? settingsSections.filter(sectionMatchesSearch) : [active];
    return `
        <div class="prototype-app navigator">
            ${appHeaderMarkup()}
            <aside class="navigator-sidebar">
                <div class="sidebar-title"><span>Settings</span><small>Prototype 01</small></div>
                ${searchMarkup("Search settings")}
                <nav>${navItemsMarkup()}</nav>
                <div class="sidebar-footer"><span>Changes save automatically</span><small>Prototype only</small></div>
            </aside>
            <main class="settings-canvas">
                <div class="canvas-toolbar">
                    <span>${searchQuery ? `Search / ${visibleSections.length} sections` : `${escapeHtml(active.eyebrow)} / ${escapeHtml(active.label)}`}</span>
                    <button type="button">Reset section</button>
                </div>
                ${visibleSections.map((section) => sectionMarkup(section, searchQuery)).join("")
                    || "<div class=\"empty-state\"><strong>No settings found</strong><span>Try a broader search.</span></div>"}
            </main>
        </div>
    `;
};

const workbenchMarkup = () => {
    const active = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
    const visibleSections = searchQuery ? settingsSections.filter(sectionMatchesSearch) : [active];
    return `
        <div class="prototype-app workbench">
            ${appHeaderMarkup()}
            <aside class="icon-rail">
                <span class="rail-label">SET</span>
                <nav>${navItemsMarkup(true)}</nav>
            </aside>
            <aside class="outline-panel">
                <div class="sidebar-title"><span>${escapeHtml(active.label)}</span><small>${escapeHtml(active.eyebrow)}</small></div>
                ${searchMarkup("Find an option")}
                <p class="outline-description">${escapeHtml(active.description)}</p>
                <div class="outline-groups">
                    ${active.groups.map((group, index) => `
                        <button type="button" data-group="${index}">
                            <span>${String(index + 1).padStart(2, "0")}</span>
                            ${escapeHtml(group.title)}
                            <small>${group.controls.length}</small>
                        </button>
                    `).join("")}
                </div>
                <div class="outline-note">All changes apply immediately.</div>
            </aside>
            <main class="settings-canvas">
                <div class="canvas-toolbar">
                    <span>${searchQuery ? `Search / ${visibleSections.length} sections` : "Settings workbench"}</span>
                    <div><button type="button">Export</button><button type="button">Reset section</button></div>
                </div>
                ${visibleSections.map((section) => sectionMarkup(section, searchQuery)).join("")
                    || "<div class=\"empty-state\"><strong>No settings found</strong><span>Try a broader search.</span></div>"}
            </main>
        </div>
    `;
};

const focusMarkup = () => {
    const matchingSections = settingsSections.filter(sectionMatchesSearch);
    const active = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
    const visibleSections = searchQuery ? matchingSections : [active];

    return `
        <div class="prototype-app focus">
            ${appHeaderMarkup()}
            <main class="focus-canvas">
                <header class="focus-header">
                    <div><span>Settings</span><small>Prototype 03 · Focus</small></div>
                    ${searchMarkup("Search every setting")}
                    <button type="button">Reset</button>
                </header>
                <nav class="category-strip">${navItemsMarkup()}</nav>
                <div class="focus-content ${searchQuery ? "search-results" : ""}">
                    <aside class="focus-context">
                        <span>${searchQuery ? "Search results" : escapeHtml(active.eyebrow)}</span>
                        <strong>${searchQuery ? `${matchingSections.length} sections` : escapeHtml(active.label)}</strong>
                        <p>${searchQuery ? `Showing matches for “${escapeHtml(searchQuery)}”.` : escapeHtml(active.description)}</p>
                        <small>${configurableControlCount} settings are available across VRCNT.</small>
                    </aside>
                    <div class="focus-sections">
                        ${visibleSections.map((section) => sectionMarkup(section, searchQuery)).join("")
                            || "<div class=\"empty-state\"><strong>No settings found</strong><span>Try a broader search.</span></div>"}
                    </div>
                </div>
            </main>
        </div>
    `;
};

const render = () => {
    const currentMarkup = currentVariant === "navigator"
        ? navigatorMarkup()
        : currentVariant === "workbench"
            ? workbenchMarkup()
            : focusMarkup();

    root.innerHTML = `${variantSwitcherMarkup()}${currentMarkup}`;
    bindEvents();
};

const bindEvents = () => {
    document.querySelectorAll("[data-variant]").forEach((button) => {
        button.addEventListener("click", () => {
            currentVariant = button.dataset.variant;
            searchQuery = "";
            render();
        });
    });

    document.querySelectorAll("[data-section]").forEach((button) => {
        button.addEventListener("click", () => {
            activeSection = button.dataset.section;
            searchQuery = "";
            render();
        });
    });

    document.querySelectorAll(".settings-search input").forEach((input) => {
        input.addEventListener("input", (event) => {
            searchQuery = event.target.value.trim().toLowerCase();
            render();
            const replacement = document.querySelector(".settings-search input");
            replacement?.focus();
            replacement?.setSelectionRange(replacement.value.length, replacement.value.length);
        });
    });

    document.querySelectorAll(".outline-groups button").forEach((button) => {
        button.addEventListener("click", () => {
            const group = document.querySelectorAll(".setting-group")[Number(button.dataset.group)];
            group?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
};

render();
