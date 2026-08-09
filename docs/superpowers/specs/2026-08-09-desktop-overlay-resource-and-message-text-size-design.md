# Desktop Overlay Resource Hardening and Independent Message Text Size

## Context

This design is based on the latest local `main` checkout at commit
`011fa502fd61ef8184c9d4940f3a85eb1626e28d`, fetched from `origin/main` before
investigation. The working tree was clean and `HEAD` matched `origin/main`.

The Desktop Overlay currently has three coupled costs:

1. Its compatibility polling path parses the storage payload every 600 ms and
   unconditionally passes the resulting object to React state. JSON parsing
   creates a new object even when the displayed data is unchanged.
2. The managed-font effect depends on the complete payload object. Every
   payload identity change creates a new managed-font runtime and listener.
   Runtime-level activation caching therefore does not survive the effect
   recreation, while cleanup removes the listener but not the registered
   `FontFace` instances.
3. The bridge serializes the complete global message-log array, even though
   Desktop Overlay rendering uses at most the latest three logs.

The current main message-log view also maps the complete global history. That
is a separate long-session risk and is not changed by this Desktop-specific
design because other features may rely on the complete history.

Deterministic measurements from the current code support the first three
findings:

- 1,000 identical payload reads produced 1,000 new object identities.
- Synthetic histories of 1,000, 5,000, and 10,000 logs produced approximately
  0.32 MB, 1.64 MB, and 3.28 MB JSON payloads. One hundred repeated parses of
  the 10,000-log payload took approximately 1.22 seconds in the local Node
  runtime.
- A synthetic 10,000-log payload produced 30,001 language-profile candidates
  in the current full-history scan. A three-log payload produced ten.
- Reusing one managed-font runtime for 1,000 identical activations resulted in
  one asset resolution and one registered face. Recreating the runtime 1,000
  times resulted in 1,000 resolutions and 1,000 registered faces in a fake
  `FontFaceSet`.

The reported full-computer freeze has not been reproduced in a live WebView2
session. The implementation therefore targets the objectively demonstrated
redundant and unbounded Desktop work and will report the WebView2/system-level
reproduction status separately.

## Goals

- Keep the Desktop Overlay compatibility fallback while making unchanged
  updates inexpensive and non-rendering.
- Bound Desktop-specific transport and font-profile work to the history the
  Desktop Overlay can display.
- Make managed-font activation idempotent for the full overlay lifetime and
  clean up runtime-owned faces on close.
- Add an independent Desktop message-text scale whose default preserves the
  current appearance and whose CSS scope excludes overlay chrome.
- Add independent VR small-overlay and large-overlay message-text scales.
  Scale message fonts, wrapping, image height, and ruby metrics without
  changing SteamVR overlay scale or message-type/time chrome.
- Preserve full global message history, old settings, legacy storage migration,
  translations-only mode, expanded mode, Fit to Content, font-family behavior,
  and existing overlay geometry.

## Non-goals

- Removing or replacing the BroadcastChannel/storage compatibility mechanism.
- Truncating the global application MessageLogs atom.
- Reworking the main message-log UI into a virtualized list.
- Coupling the Desktop WebView renderer to the Python VR renderer.
- Changing SteamVR transforms, overlay placement, or overall UI scaling.
- Claiming that the original full-system freeze is reproduced when it is not.

## Design

### 1. Desktop payload boundary and change-aware delivery

Introduce a Desktop payload history limit of three logs, matching expanded
Desktop rendering. Apply the limit in both `createDesktopOverlayPayload` and
the read/normalization path so newly written payloads are compact and legacy
payloads are bounded when first read. Keep the complete `currentMessageLogs`
array in application state and pass only `messageLogs.slice(-3)` through the
Desktop boundary.

The payload's displayed-data signature will cover message logs, statuses,
language, and font family while excluding `updatedAt`. Desktop Overlay state
updates will retain the previous object when the signature is unchanged. This
prevents identical BroadcastChannel events and polling results from rerunning
rendering and font-profile work solely because JSON parsing or a timestamp
created a new object.

The fallback interval remains active for environments where channel delivery
is unavailable. Its storage reader will retain the last raw storage value and
avoid JSON parsing when the raw value has not changed. BroadcastChannel cleanup
continues to close the channel. Storage migration behavior remains in the
existing migration helpers.

The bounded payload means `getDesktopOverlayLanguageProfiles` scans at most
three logs. No global history data is discarded.

### 2. Managed font runtime lifetime

Desktop Overlay will create one managed-font runtime for the lifetime of one
mounted overlay. The runtime will be reused as language profiles change. The
activation effect will depend on a stable profile signature, not the complete
payload object, and the download-progress listener will be registered once per
runtime.

`createManagedFontRuntime` will gain disposal semantics that:

- mark the runtime disposed;
- prevent an in-flight activation from adding a face after disposal;
- remove every face registered by that runtime from `document.fonts`;
- clear activation and face caches; and
- leave a fresh runtime able to activate the pack when the overlay is opened
  again.

The runtime will continue to deduplicate pack activation within its lifetime,
and failed activation will remain retryable. Cleanup will be safe when the
Tauri listener promise resolves after component unmount.

### 3. Desktop Message Text Size

Add `messageTextScale` to Desktop Overlay settings. Its normalized default is
`100`, with a `40`–`200` range and a `10`-point UI step, matching the existing
message-log scaling convention. Missing values normalize to `100`; invalid
values clamp to the safe range.

`createDesktopOverlayStyle` will publish a dedicated message-text CSS variable.
Only message-content classes use it: original text, translated text, and any
Desktop transliteration/ruby text that exists in the current renderer. Header,
status, controls, settings labels, panel dimensions, and the overall panel
scale remain on their existing styles. The current overall Desktop scale
continues to use the panel transform.

Desktop Overlay settings and Overlay Studio will expose the new control using
the existing settings persistence path. Fit to Content will continue to use
the rendered content height; its fallback estimate will account for the
message scale so a larger value cannot produce an undersized automatic height.

### 4. VR Message Text Size

Add `message_text_scale` independently to both existing VR small-log and
large-log settings. The normalized/default value is `1.0`, represented in the
UI as `100%`, with a `0.4`–`2.0` range and the established `10%` step. A missing
field in an existing configuration behaves exactly like `1.0`.

The Python Pillow pipeline will receive the normalized scale at the top-level
small- and large-log render calls:

- Small overlay message font sizes are scaled before text measurement and
  wrapping.
- Large overlay original and translated message font sizes are scaled before
  measurement, wrapping, and image-height calculation.
- Ruby font sizes and ruby/original line metrics derive from the scaled message
  font sizes, preserving token alignment.
- Large-overlay message type/time text continues using its unscaled UI font.
- Image width, background geometry, placement, transforms, and SteamVR
  `ui_scaling` remain independent. The rendered image height is recalculated by
  the existing layout routines, avoiding clipping when text grows.

The VR configuration controls and Overlay Studio preview will expose the
currently selected small/large value independently. Updating one mode will
not overwrite the other mode or the global VR scale.

### 5. Localization and compatibility

Add the user-facing Message Text Size label to all maintained locale files:
English `Message Text Size`, Thai `ขนาดข้อความ`, and translations consistent
with the existing locale style for Japanese, Korean, Simplified Chinese, and
Traditional Chinese.

No old configuration is rewritten merely because the new key is absent.
Normalization supplies defaults at read/render time. Existing Desktop legacy
storage keys continue to migrate through the current helpers. Existing VR
settings retain their current fields and backend update path.

## Test strategy

Tests will be written before production behavior changes and run red first.

### Desktop JavaScript tests

- payload creation and reading retain only the latest three logs;
- legacy/full payload normalization is bounded without changing global state;
- identical payload signatures do not require a state replacement;
- repeated identical font-profile activation performs one resolve/load/add;
- runtime disposal unregisters faces and does not allow late in-flight adds;
- Desktop settings default/clamp/persist behavior includes message text scale;
- message scale is present in message styling but not the panel/chrome scale;
- normal and expanded visible-log behavior remains correct; and
- Fit to Content has a valid larger-text estimate.

### Python VR tests

- missing `message_text_scale` preserves default rendering behavior;
- small and large render paths use configured scaled message fonts;
- image dimensions/wrapping change with scale;
- message type/time font remains unscaled;
- ruby uses the scaled metrics and remains aligned; and
- VR `ui_scaling` remains independent.

### Existing verification

Run the focused tests first, then the existing UI suite, relevant Python test
suite (using an interpreter with pytest installed), focused Rust/Tauri tests,
and the Vite production build. Repeat deterministic payload and font stress
measurements before and after implementation. Report any unavailable
environment-dependent suite explicitly.

## Risks and residual issues

- The exact WebView2 working-set/GPU-memory behavior may require a live Desktop
  Overlay launch and external process measurement; deterministic Node tests
  cannot prove or disprove a full-system freeze.
- The global main-log array and non-virtualized main-log view remain unbounded
  by design in this focused change. They must be assessed separately if long
  sessions still degrade after Desktop transport/runtime hardening.
- SteamVR rendering cannot be fully validated without a running VR/OpenVR
  environment; Python layout tests will cover the deterministic renderer.
