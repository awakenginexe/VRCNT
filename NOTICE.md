# Notices

VRCNT is an unofficial customized fork based on VRCT.

## Upstream Project

- Project: VRCT
- Repository: https://github.com/misyaguziya/VRCT
- Original author/copyright: Copyright (c) 2023 misyaguziya
- License: MIT

The original VRCT copyright notice and MIT License terms are preserved in this repository's LICENSE file.

## VRCNT Changes

VRCNT branding, UI changes, packaging changes, and project-specific modifications are Copyright (c) 2026 awakenginexe and released under the same MIT License unless otherwise noted.

## Third-party Assets and Dependencies

This project includes third-party open-source dependencies through npm, Rust crates, and Python packages. Their respective licenses remain with their original authors.

The Windows installer bundles the standalone 7-Zip command-line extractor
(`7za.exe`) from [7-Zip](https://www.7-zip.org/), distributed under the GNU
LGPL with the 7-Zip unRAR restriction, and
[minisign](https://github.com/jedisct1/minisign), distributed under the ISC
license. These tools are used only for authenticated package verification and
extraction.

The vendored `src-tauri/vendor/glib-0.18.5` is the official GLib Rust crate
under its preserved MIT license and copyright notices. It includes the
[upstream RUSTSEC-2024-0429 fix](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34)
backported without changing the 0.18 API or claiming a newer upstream version.
The original archive SHA-256 is recorded in the vendored Cargo manifest.
