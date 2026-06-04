# Ledger

Single-file vanilla-JS personal finance app. Ships three ways:

1. **Browser** — open `ledger.html` directly.
2. **PWA** — install from any modern browser (own icon, full-screen, offline).
3. **Native Windows app** — `dist/Ledger.exe` (3 MB, no Chrome required).

All data lives in `localStorage`.

## Files

### Web app (source of truth)
| File | What it is |
|---|---|
| `ledger.html` | The whole app — edit this for any change. |
| `manifest.webmanifest` | PWA manifest (name, icons, theme). |
| `sw.js` | Service worker (offline cache, stale-while-revalidate). Bump `CACHE = "ledger-v2"` after edits to invalidate old caches. |
| `icon-192.png` / `icon-512.png` / `icon-512-maskable.png` | PWA icons. |

### Native app
| File / folder | What it is |
|---|---|
| `dist/Ledger.exe` | Standalone 3 MB executable. Just double-click. Uses Windows' built-in WebView2. |
| `dist/Ledger_1.0.0_x64-setup.exe` | NSIS installer (1 MB) — Start menu shortcut, uninstaller. |
| `dist/Ledger_1.0.0_x64_en-US.msi` | MSI installer (1.6 MB) — for Group Policy / managed deployment. |
| `src-tauri/` | Tauri / Rust project that wraps the HTML into a native binary. Don't edit `web/` (auto-copied from project root before each build). |

### Project
| File / folder | What it is |
|---|---|
| `templates/import-template.csv` | CSV template for transaction import. |
| `notes.txt` | Personal notes. |
| `.claude/` | Claude Code config. |
| `archive/` | Old versions and the legacy v1 dashboard — kept for reference. |

## Run in the browser

```sh
python -m http.server 8766
```

Open <http://localhost:8766/ledger.html>. `localhost` counts as a secure origin so the service worker activates and the install button works.

## Install as PWA

- **Desktop Chrome / Edge**: install icon in the URL bar, or click the ⬇ button in the topbar.
- **iOS Safari**: Share → Add to Home Screen.
- **Android Chrome**: "Install app" prompt or browser menu → Install.

## Run native (Windows)

Just double-click `dist/Ledger.exe`. No browser involved at runtime — the binary uses Windows' bundled WebView2 (already installed on Windows 11 and modern Windows 10).

To install with a Start menu shortcut, run `dist/Ledger_1.0.0_x64-setup.exe` instead.

## Rebuild the native app after edits

After editing `ledger.html`, rebuild the .exe:

```powershell
$env:CARGO_HOME       = "D:\cargo"
$env:RUSTUP_HOME      = "D:\rustup"
$env:CARGO_TARGET_DIR = "D:\cargo-target"
$env:TMP              = "D:\tmp"
$env:TEMP             = "D:\tmp"
$env:PATH             = "D:\cargo\bin;${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC;$env:PATH"
cd "C:\Users\J\Documents\Claude Projects\src-tauri"
cargo tauri build
```

Build outputs land in `D:\cargo-target\release\` and `D:\cargo-target\release\bundle\`.
Then copy the new binary / installers into `dist/` (or replace in place).

For a fast dev loop with hot reload, use `cargo tauri dev` instead — saves to `ledger.html` reload the running window in ~1 second.

The first build is ~10 min (Rust compiles all dependencies). Subsequent builds after editing `ledger.html` are ~30 seconds since only the asset bundle changes.

## Deploy as a website

Drop these onto any HTTPS host (Cloudflare Pages, Netlify Drop, GitHub Pages):

```
ledger.html
manifest.webmanifest
sw.js
icon-192.png
icon-512.png
icon-512-maskable.png
```

## Data

Everything is in browser `localStorage`:
- `fin_txns` — transactions
- `fin_budgets` — monthly budgets
- `fin_nw_entries` — net worth snapshots
- `fin_recurring` — scheduled / recurring items
- `fin_goals` — savings goals
- `fin_settings` — name, currency, theme, accent, custom categories, etc.

Use **Settings → Data** to export a full JSON backup, export transactions to CSV, or import either format.

> Note: data is **per-runtime**. Browser localStorage and the native-app storage are separate buckets. Use Settings → Data → Export JSON to move between them.
