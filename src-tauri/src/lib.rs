use tauri::Manager;

/// Returns the canonical path to the on-disk data file:
/// %APPDATA%\com.ledger.dashboard\data.json on Windows.
fn store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("data.json"))
}

fn backup_paths(path: &std::path::Path) -> Vec<std::path::PathBuf> {
    let dir = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    vec![
        dir.join("data.bak1.json"),
        dir.join("data.bak2.json"),
        dir.join("data.bak3.json"),
        dir.join("data.json.bak"),
    ]
}

fn valid_store_json(text: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(v) => v.is_object() && (v.get("txns").is_some() || v.get("version").is_some()),
        Err(_) => false,
    }
}

#[tauri::command]
fn store_load(app: tauri::AppHandle) -> Result<String, String> {
    let path = store_path(&app)?;
    let mut first_err: Option<String> = None;
    for candidate in std::iter::once(path.clone()).chain(backup_paths(&path).into_iter()) {
        if !candidate.exists() {
            continue;
        }
        match std::fs::read_to_string(&candidate) {
            Ok(text) if valid_store_json(&text) => return Ok(text),
            Ok(_) => {
                if first_err.is_none() {
                    first_err = Some(format!("{} is not valid store JSON", candidate.display()));
                }
            }
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("read failed for {}: {e}", candidate.display()));
                }
            }
        }
    }
    if let Some(err) = first_err {
        Err(err)
    } else {
        Ok(String::new())
    }
}

/// Atomic write: stage to data.json.tmp then rename. Keeps a short rolling
/// backup chain so a bad/corrupt write does not strand the user.
#[tauri::command]
fn store_save(app: tauri::AppHandle, data: String) -> Result<String, String> {
    if !valid_store_json(&data) {
        return Err("refusing to save invalid store JSON".into());
    }
    let path = store_path(&app)?;
    let dir = path.parent().ok_or("no parent dir")?.to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;

    let tmp = dir.join("data.json.tmp");
    let bak1 = dir.join("data.bak1.json");
    let bak2 = dir.join("data.bak2.json");
    let bak3 = dir.join("data.bak3.json");

    std::fs::write(&tmp, &data).map_err(|e| format!("write failed: {e}"))?;
    if path.exists() {
        // Rotate: bak2 -> bak3, bak1 -> bak2, current -> bak1.
        let _ = std::fs::remove_file(&bak3);
        if bak2.exists() {
            std::fs::rename(&bak2, &bak3)
                .map_err(|e| format!("backup rotate failed: {e}"))?;
        }
        if bak1.exists() {
            std::fs::rename(&bak1, &bak2)
                .map_err(|e| format!("backup rotate failed: {e}"))?;
        }
        std::fs::rename(&path, &bak1).map_err(|e| format!("backup failed: {e}"))?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("commit failed: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Returns the absolute path the JS layer can show in Settings ("Data file: ...").
#[tauri::command]
fn store_path_str(app: tauri::AppHandle) -> Result<String, String> {
    Ok(store_path(&app)?.to_string_lossy().into_owned())
}

/// Opens the data directory in the OS file manager so the user can see / copy
/// their data.json + backups. Explorer often returns a non-zero exit code even
/// on success, so we only treat a spawn failure as an error.
#[tauri::command]
fn reveal_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let path = store_path(&app)?;
    let dir = path.parent().ok_or("no parent dir")?.to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
    }
    Ok(())
}

pub fn run() {
    // Use a fresh WebView2 user-data folder so we escape any stale service worker
    // / cache from older Japtrack builds. The user's real data lives in
    // app_data_dir (Roaming\com.ledger.dashboard\data.json), completely
    // independent of this UDF — switching folders does NOT touch the user's data.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let udf = std::path::PathBuf::from(local)
            .join("com.ledger.dashboard")
            .join("webview2-v2");
        let _ = std::fs::create_dir_all(&udf);
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", udf);
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            store_load,
            store_save,
            store_path_str,
            reveal_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
