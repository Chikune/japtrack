# Japtrack

A private, local-first personal finance app for tracking transactions, budgets, bills & subscriptions, accounts, savings goals, cash flow, debt payoff, and reports. Built with [Tauri](https://tauri.app)—a tiny Rust shell around a web UI—so installers stay small and use your OS's built-in web engine.

**Your data never leaves your device.** Everything lives locally in your OS app-data folder (`%APPDATA%` on Windows, `~/Library/Application Support` on macOS). Nothing is stored in this repository.

## Download & install

Grab the installer for your machine from the **[Releases](../../releases)** page:

| Platform | File | Notes |
|---|---|---|
| **Windows** | `Japtrack_*_x64-setup.exe` | Self-contained. Auto-downloads WebView2 only if you don't have it. Double-click to install. |
| **macOS — Apple Silicon** (M1/M2/M3/M4) | `Japtrack_*_aarch64.dmg` | Open the `.dmg`, drag Japtrack to Applications. |
| **macOS — Intel** | `Japtrack_*_x64.dmg` | Same—open the `.dmg`, drag to Applications. |

> **macOS first launch:** this is an unsigned build, so Gatekeeper blocks a normal double-click at first. **Right-click the app → Open → Open** to approve it once. It opens normally after that.

Nothing else to download—HTML, CSS, JS, and icons are all bundled inside the installer.

## Building the installers (maintainer)

Mac `.dmg` files can only be built on macOS, so cross-platform builds run on GitHub Actions (free Windows + macOS runners). The workflow lives in [`.github/workflows/release.yml`](.github/workflows/release.yml).

**To ship a new version:**

1. Bump `"version"` in `src-tauri/tauri.conf.json` (e.g. `1.0.0` → `1.0.1`).
2. Commit and push.
3. Tag and push:
   ```sh
   git tag v1.0.1
   git push --tags
   ```
4. Watch the **Actions** tab. When builds finish, a **draft Release** appears with all installers. Open it, click **Publish**, and share the link.

Manual build without a tag: **Actions → Build installers → Run workflow**—installers appear as downloadable artifacts (no Release created).

### Local Windows-only build

```sh
# from the repo root, with Rust + Tauri CLI installed
cargo tauri build
```
Produces `src-tauri/target/release/bundle/nsis/Japtrack_*_x64-setup.exe`.

## Project layout

| Path | What it is |
|---|---|
| `index.html` | App shell—loads CSS/JS modules. |
| `css/` | Styles (`variables`, `layout`, `components`, `pages`). |
| `js/` | App logic. `js/pages/` has one module per screen (dashboard, transactions, budgets, accounts, goals, forecast, debt, settings…). |
| `icons/` | App icons for every platform (`.ico`, `.icns`, PNGs). |
| `assets/` | Brand logos used at runtime. |
| `sw.js` / `manifest.webmanifest` | Service worker + manifest (web/PWA build only). |
| `src-tauri/` | Tauri/Rust wrapper. `copy-web.ps1` copies web files into `src-tauri/web/` and cache-stamps them before each build. Don't edit `src-tauri/web/` directly—it's generated. |
