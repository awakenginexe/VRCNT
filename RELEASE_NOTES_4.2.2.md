# VRCNT 4.2.2

VRCNT 4.2.2 changes release delivery without changing application features.

## Distribution and installer

- Release files are now hosted entirely on GitHub Releases.
- The setup executable is a thin installer and does not contain the CUDA application payload.
- The installer checks for `VRCNT_4.2.2.7z.001`, `.002`, and `.003` beside itself before using the network. A fully offline install also keeps `package-manifest.json` and `package-manifest.json.sig` beside the installer.
- Online downloads run concurrently, retain safe partial files for retry/resume, and report per-file and total progress, percentage, and speed.
- The package manifest is authenticated before its SHA-256 values are trusted; every package part is then verified before extraction.
- Extraction uses the bundled `7za.exe`. The same multipart archive can be manually extracted for portable use.
- Existing WebView2 checks, upgrades, shortcuts, registry entries, user-data migration, uninstall behavior, and the opt-in user-data removal choice are preserved.

## Updater and release pipeline

- Tauri now reads `latest.json` from the latest GitHub Release.
- The existing Tauri updater public key and mandatory signature verification are unchanged.
- GitHub Actions builds the CUDA payload, creates exactly three sub-2-GiB package parts, signs the package manifest and updater artifact, produces `SHA256SUMS.txt`, and publishes every asset to `v4.2.2`.
- Signing private keys and passwords are read only from GitHub Actions Secrets.

## Required GitHub Actions secrets

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (only when the private key is encrypted)

The same existing Tauri signing identity is used to authenticate both updater artifacts and the package manifest. No private signing material is stored in the repository.
