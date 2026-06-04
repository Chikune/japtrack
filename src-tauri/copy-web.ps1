# copy-web.ps1 — copies the frontend source files into src-tauri/web before Tauri builds.
# Run automatically via tauri.conf.json beforeBuildCommand / beforeDevCommand.

$dest = Join-Path $PSScriptRoot 'web'
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }

$root = Resolve-Path (Join-Path $PSScriptRoot '..')

# ── Top-level files ──────────────────────────────────────────────────
$topFiles = @('index.html','manifest.webmanifest','sw.js')
foreach ($f in $topFiles) {
    $src = Join-Path $root $f
    if (Test-Path $src) {
        Copy-Item $src $dest -Force
        Write-Host "copied $f"
    } else {
        Write-Warning "missing: $src"
    }
}

# ── icons/ folder ────────────────────────────────────────────────────
$iconsSrc  = Join-Path $root 'icons'
$iconsDest = Join-Path $dest 'icons'
if (Test-Path $iconsSrc) {
    if (-not (Test-Path $iconsDest)) { New-Item -ItemType Directory -Path $iconsDest -Force | Out-Null }
    Get-ChildItem $iconsSrc -Filter '*.png' | ForEach-Object {
        Copy-Item $_.FullName $iconsDest -Force
        Write-Host "copied icons/$($_.Name)"
    }
} else { Write-Warning "icons/ folder not found at $iconsSrc" }

# ── assets/logos/ folder (brand SVGs + PNGs used at runtime) ─────────
$logosSrc  = Join-Path $root 'assets\logos'
$logosDest = Join-Path $dest 'assets\logos'
if (Test-Path $logosSrc) {
    if (-not (Test-Path $logosDest)) { New-Item -ItemType Directory -Path $logosDest -Force | Out-Null }
    Get-ChildItem $logosSrc -File | ForEach-Object {
        Copy-Item $_.FullName $logosDest -Force
        Write-Host "copied assets/logos/$($_.Name)"
    }
} else { Write-Warning "assets/logos/ folder not found at $logosSrc" }

# ── css/ folder ──────────────────────────────────────────────────────
$cssSrc  = Join-Path $root 'css'
$cssDest = Join-Path $dest 'css'
if (Test-Path $cssSrc) {
    if (-not (Test-Path $cssDest)) { New-Item -ItemType Directory -Path $cssDest -Force | Out-Null }
    Get-ChildItem $cssSrc -Filter '*.css' | ForEach-Object {
        Copy-Item $_.FullName $cssDest -Force
        Write-Host "copied css/$($_.Name)"
    }
} else { Write-Warning "css/ folder not found at $cssSrc" }

# ── js/ folder (including pages/ subdirectory) ───────────────────────
$jsSrc  = Join-Path $root 'js'
$jsDest = Join-Path $dest 'js'
if (Test-Path $jsSrc) {
    if (-not (Test-Path $jsDest)) { New-Item -ItemType Directory -Path $jsDest -Force | Out-Null }
    $pagesDest = Join-Path $jsDest 'pages'
    if (-not (Test-Path $pagesDest)) { New-Item -ItemType Directory -Path $pagesDest -Force | Out-Null }

    Get-ChildItem $jsSrc -Filter '*.js' | ForEach-Object {
        Copy-Item $_.FullName $jsDest -Force
        Write-Host "copied js/$($_.Name)"
    }
    $pagesSrc = Join-Path $jsSrc 'pages'
    if (Test-Path $pagesSrc) {
        Get-ChildItem $pagesSrc -Filter '*.js' | ForEach-Object {
            Copy-Item $_.FullName $pagesDest -Force
            Write-Host "copied js/pages/$($_.Name)"
        }
    }
} else { Write-Warning "js/ folder not found at $jsSrc" }

# ── Cache-busting stamp ──────────────────────────────────────────────
# The Tauri desktop shell runs with NO service worker (app.js unregisters it),
# so nothing busts WebView2's HTTP disk cache — rebuilt scripts can be served
# stale. Append ?v=<build stamp> to every local js/css URL in the copied
# index.html so the cache key changes every build and fresh code always loads.
# Only the src-tauri/web copy is stamped; source index.html stays clean.
# Idempotent: URLs that already carry a ?query are skipped; remote font URLs
# are untouched because we only match ./js and ./css paths.
$indexDest = Join-Path $dest 'index.html'
if (Test-Path $indexDest) {
    $stamp = Get-Date -Format 'yyyyMMddHHmmss'
    $html  = Get-Content $indexDest -Raw
    $html  = [regex]::Replace($html, '(src|href)="(\./(?:js|css)/[^"?]+\.(?:js|css))"', "`$1=`"`$2?v=$stamp`"")
    Set-Content -Path $indexDest -Value $html -Encoding utf8 -NoNewline
    Write-Host "stamped index.html assets with ?v=$stamp"
} else {
    Write-Warning "index.html not found in dest for stamping: $indexDest"
}

Write-Host "copy-web done."
