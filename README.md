# Japtrack

A private, local-first personal finance app — transactions, budgets, bills &
subscriptions, accounts, savings goals, cash-flow forecasting, a debt-payoff
calculator, and reports. Built with [Tauri](https://tauri.app) (a tiny Rust
shell around a web UI), so the installers are small and use the operating
system's built-in web engine.

**Your data never leaves your device.** Everything is stored locally in the OS
app-data folder (`%APPDATA%` on Windows, `~/Library/Application Support` on
macOS). None of it is in this repository.

## Download & install

Grab the installer for your machine from the
[**Releases**](../../releases) page:

| Platform | File | Notes |
|---|---|---|
| **Windows** | `Japtrack_*_x64-setup.exe` | Fully self-contained. Auto-downloads Microsoft's WebView2 runtime only if your PC doesn't already have it. Double-click to install. |
| **macOS — Apple Silicon** (M1/M2/M3/M4) | `Japtrack_*_aarch64.dmg` | Open the `.dmg`, drag Japtrack to Applications. |
| **macOS — Intel** | `Japtrack_*_x64.dmg` | Same — open the `.dmg`, drag to Applications. |

> **macOS first launch:** this is an unsigned build, so Gatekeeper blocks a
> normal double-click the first time. **Right-click the app → Open → Open** to
> approve it once; it opens normally after that.

Nothing else needs downloading — the app's HTML/CSS/JS and icons are all bundled
inside the installer.

## Building the installers (maintainer)

Mac `.dmg` files can only be built on macOS, so cross-platform builds run on
GitHub Actions (free Windows + macOS runners). The workflow lives in
[`.github/workflows/release.yml`](.github/workflows/release.yml).

**To ship a new version:**

1. Bump `"version"` in `src-tauri/tauri.conf.json` (e.g. `1.0.0` → `1.0.1`).
2. Commit and push.
3. Tag and push the tag:
   ```sh
   git tag v1.0.1
   git push --tags
   ```
4. Watch the **Actions** tab. When the three build jobs finish, a **draft
   Release** appears with all installers attached. Open it, click **Publish**,
   and share the link.

Manual build without a tag: **Actions → Build installers → Run workflow** — the
installers appear as downloadable artifacts on the run page (no Release created).

### Local Windows-only build

```sh
# from the repo root, with the Rust toolchain + Tauri CLI installed
cargo tauri build
```
Produces `src-tauri/target/release/bundle/nsis/Japtrack_*_x64-setup.exe`.

## Project layout

| Path | What it is |
|---|---|
| `index.html` | App shell — loads the CSS/JS modules below. |
| `css/` | Styles (`variables`, `layout`, `components`, `pages`). |
| `js/` | App logic. `js/pages/` holds one module per screen (dashboard, transactions, budgets, accounts, goals, forecast, debt, settings, …). |
| `icons/` | App icons for every platform (`.ico`, `.icns`, PNGs). |
| `assets/` | Brand logos used at runtime. |
| `sw.js` / `manifest.webmanifest` | Service worker + manifest (web/PWA build only). |
| `src-tauri/` | The Tauri/Rust wrapper. `copy-web.ps1` copies the web files into `src-tauri/web/` and cache-stamps them before each build. Don't edit `src-tauri/web/` directly — it's generated. |
