/* ════════════════════════════════════════
   STORAGE — bundled, versioned, atomic-with-backup data store.

   All user data (transactions, budgets, snapshots, goals, settings, etc.)
   lives in ONE namespaced JSON blob (`fd_store_v1`) instead of nine
   independent `fin_*` keys. This:
     • isolates app data from the rest of localStorage / WebView2 storage
     • makes export/import a single, atomic operation
     • supports schema versioning + migrations for future changes
     • keeps 3 rolling backups so a corrupt write never wipes data
     • auto-imports legacy `fin_*` data on first run (one-time, idempotent)

   The legacy `lsGet("fin_X")` / `lsSet("fin_X", v)` API is preserved as a
   thin shim that routes those reads/writes through the Store, so existing
   call sites keep working with no changes.
════════════════════════════════════════ */
const STORE_KEY     = "fd_store_v1";
const STORE_BACKUPS = ["fd_store_v1_bak1", "fd_store_v1_bak2", "fd_store_v1_bak3"];
const STORE_SCHEMA  = 2;

// Map old per-key names → new store top-level fields (used both for the legacy
// shim and for one-time migration off the original `fin_*` keys).
const STORE_KEYMAP = {
  fin_txns:       "txns",
  fin_settings:   "settings",
  fin_nw_entries: "nwEntries",
  fin_budgets:    "budgets",
  fin_recurring:  "recurring",
  fin_goals:      "goals",
  fin_holidays:   "holidays",
  fin_forecast:   "forecast",
  fin_plans:      "plans",
  fin_alloc_plan: "allocPlan",
};

function _emptyStore() {
  return {
    version:   STORE_SCHEMA,
    lastWrite: 0,
    txns: [], settings: {}, nwEntries: [], budgets: [],
    recurring: [], goals: [], holidays: [], forecast: [], plans: [], allocPlan: [],
  };
}

// Ordered schema migrations. To evolve the store, bump STORE_SCHEMA and add a
// MIGRATIONS[n] that transforms a store at version n-1 → n and returns it.
// Migrations must be pure-ish and idempotent-safe; they run oldest → newest.
const MIGRATIONS = {
  // 1: baseline. Pre-versioning stores have no `version`; stamping them to 1
  //    (plus the key-backfill below) is the only work needed. No-op transform.
  1: (s) => s,
  // 2: split the legacy combined "Repayments & Subscriptions" category into the
  //    two separate built-in categories. Transactions/bills are reassigned by a
  //    keyword heuristic (loan/repayment terms → Repayments, otherwise
  //    Subscriptions); the combined custom category is removed. Idempotent: once
  //    nothing references the combined name, re-running is a no-op.
  2: (s) => {
    const COMBINED = "Repayments & Subscriptions";
    const REPAY_RE = /(repay|repayment|loan|finance|financing|klarna|clearpay|afterpay|laybuy|paypal\s*credit|instal?ment|hire\s*purchase|monzo\s*flex|\bflex\b|credit\s*agreement)/i;
    const split = (desc) => REPAY_RE.test(desc || "") ? "Repayments" : "Subscriptions";
    (s.txns || []).forEach(t => { if (t.category === COMBINED) t.category = split(t.description); });
    (s.recurring || []).forEach(r => { if (r.category === COMBINED) r.category = split(r.description); });
    const st = s.settings || (s.settings = {});
    // Delete the combined custom category.
    if (Array.isArray(st.customCats)) st.customCats = st.customCats.filter(c => c && c.id !== COMBINED);
    // Make sure the two built-in categories are visible (un-hide if the user had hidden them).
    if (Array.isArray(st.hiddenDefaultCats)) st.hiddenDefaultCats = st.hiddenDefaultCats.filter(id => id !== "Repayments" && id !== "Subscriptions");
    return s;
  },
};

function _migrate(obj) {
  let s = obj;
  let from = s.version || 0;
  while (from < STORE_SCHEMA) {
    const next = from + 1;
    try {
      if (typeof MIGRATIONS[next] === "function") s = MIGRATIONS[next](s) || s;
    } catch (e) {
      console.error(`Store: migration ${from}→${next} failed`, e);
      break; // stop at the last good version rather than corrupting further
    }
    s.version = next;
    from = next;
  }
  // Backfill any missing top-level keys with empty defaults.
  const def = _emptyStore();
  for (const k of Object.keys(def)) if (!(k in s)) s[k] = def[k];
  return s;
}

// One-time pull-up from the original `fin_*` keys. Returns null if there's
// nothing legacy to migrate.
function _legacyPullup() {
  const present = Object.keys(STORE_KEYMAP).some(k => localStorage.getItem(k) != null);
  if (!present) return null;
  const out = _emptyStore();
  for (const [legacy, key] of Object.entries(STORE_KEYMAP)) {
    const raw = localStorage.getItem(legacy);
    if (raw == null) continue;
    try { out[key] = JSON.parse(raw); } catch {}
  }
  return out;
}

function _loadStore() {
  // Try main store first, then each backup in order — survives a corrupt write.
  for (const k of [STORE_KEY, ...STORE_BACKUPS]) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") return _migrate(obj);
    } catch (e) { console.warn("Store: failed to parse", k, e); }
  }
  // No store + no backups — fall back to legacy `fin_*` keys (first-run upgrade).
  const migrated = _legacyPullup();
  if (migrated) {
    console.info("Store: migrated from legacy fin_* keys");
    return migrated;
  }
  return _emptyStore();
}

let _store = null;
let _flushTimer = null;
let _filePath = null; // populated once Tauri's store_path_str command resolves
let _fileHydrationDone = false;
let _pendingFileWrite = false;

// Detect the Tauri runtime. When present, the JSON store lives as a real file
// at %APPDATA%\com.ledger.dashboard\data.json — survives WebView2 cache wipes,
// reinstalls, and is user-readable / backup-able.
// True when the Tauri bridge is present in ANY form (globalTauri object OR
// the v2 internals bridge). The old code returned window.__TAURI__ even when
// only __TAURI_INTERNALS__ existed → undefined → disk I/O silently no-op'd.
function _tauriReady() {
  return (typeof window !== "undefined") && !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
}
function _tauri() { return _tauriReady(); }  // back-compat for existing call sites
// Resolve an invoke() across every Tauri 2.x shape (globalTauri core/invoke,
// or the internals bridge when withGlobalTauri is off).
function _resolveInvoke() {
  if (typeof window === "undefined") return null;
  const t = window.__TAURI__;
  if (t) {
    const inv = (t.core && t.core.invoke) || t.invoke;
    if (typeof inv === "function") return inv;
  }
  const ti = window.__TAURI_INTERNALS__;
  if (ti && typeof ti.invoke === "function") return ti.invoke.bind(ti);
  return null;
}
// Poll briefly for the bridge — Tauri injects its API into the WebView
// asynchronously, so at first boot it may not be there for a few hundred ms.
async function _waitForTauriBridge(timeoutMs = 2500) {
  if (_resolveInvoke()) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 50));
    if (_resolveInvoke()) return true;
  }
  return !!_resolveInvoke();
}
async function _invoke(cmd, args) {
  const inv = _resolveInvoke();
  if (!inv) return null;
  return inv(cmd, args);
}

function _persistLocalStorage() {
  if (!_store) return;
  // Rolling localStorage backups (cur → bak1 → bak2 → bak3) — kept as a fast
  // in-memory mirror for instant startup and browser-mode fallback.
  try {
    const cur  = localStorage.getItem(STORE_KEY);
    if (cur) {
      const bak1 = localStorage.getItem(STORE_BACKUPS[0]);
      const bak2 = localStorage.getItem(STORE_BACKUPS[1]);
      if (bak2) localStorage.setItem(STORE_BACKUPS[2], bak2);
      if (bak1) localStorage.setItem(STORE_BACKUPS[1], bak1);
      localStorage.setItem(STORE_BACKUPS[0], cur);
    }
  } catch (e) { console.warn("Store: backup rotation failed", e); }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(_store));
  } catch (e) {
    console.error("Store: localStorage write failed", e);
    _notifyWriteFailure("Storage is full — your latest changes may not be saved. Export a backup now.");
  }
}

// Surface persistence failures to the user exactly once per failure streak so a
// silent data-loss can never happen on a finance app. Reset on next good write.
let _writeFailed = false;
function _notifyWriteFailure(msg) {
  if (_writeFailed) return;
  _writeFailed = true;
  if (typeof showToast === "function") showToast(msg);
}
function _notifyWriteOK() {
  if (!_writeFailed) return;
  _writeFailed = false;
  if (typeof showToast === "function") showToast("Saving restored");
}

async function _persistFile() {
  if (!_store) return;
  // Native data must be loaded before any native file write is allowed. Without
  // this gate, an empty localStorage boot can overwrite a good data.json before
  // the Tauri file bridge finishes hydrating.
  if (!_fileHydrationDone) {
    _pendingFileWrite = true;
    return;
  }
  try {
    const path = await _invoke("store_save", { data: JSON.stringify(_store) });
    if (path) _filePath = path;
    _notifyWriteOK();
  } catch (e) {
    console.warn("Store: file write failed", e);
    _notifyWriteFailure("Couldn't save to disk — your data may not persist. Use Settings → Export backup.");
  }
}

function _persist() {
  if (!_store) return;
  _store.lastWrite = Date.now();
  _persistLocalStorage();          // synchronous, fast — covers reload immediately
  if (_tauri()) _persistFile();    // async — writes to disk in the background
}

// Batch rapid sequential writes (e.g. typing in the planner) into a single flush.
function _scheduleWrite() {
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(_persist, 80);
}
window.addEventListener("beforeunload", () => { clearTimeout(_flushTimer); _persist(); });
window.addEventListener("pagehide",     () => { clearTimeout(_flushTimer); _persist(); });

/// Async hydration: if running under Tauri, prefer the on-disk JSON file.
/// Falls back to whatever was loaded from localStorage on the synchronous path.
/// Re-renders the UI if the file held different data.
async function _hydrateFromFile() {
  // Wait for the Tauri bridge rather than giving up if it hasn't injected yet
  // (the cause of "data sometimes doesn't load at all" on a slow launch).
  if (!await _waitForTauriBridge()) {
    _fileHydrationDone = true;
    return false;
  }
  try {
    const text = await _invoke("store_load");
    _fileHydrationDone = true;
    if (!text) {
      // No file yet — push the current (localStorage-derived) store to disk so the file exists.
      if (_store) await _persistFile();
      return false;
    }
    const fileObj = JSON.parse(text);
    if (!fileObj || typeof fileObj !== "object") return false;
    const next = _migrate(fileObj);
    // In Tauri, the real file is authoritative. localStorage is only a mirror
    // and may be empty/stale after cache clears, reinstalls, or WebView resets.
    _store = next;
    _pendingFileWrite = false;
    // Sync the new state back to localStorage so subsequent boots are fast.
    _persistLocalStorage();
    return true;
  } catch (e) {
    console.warn("Store: file load failed, sticking with localStorage", e);
    _fileHydrationDone = true;
    _pendingFileWrite = false;
    _notifyWriteFailure("Couldn't load the data file — existing file was left untouched. Export a backup before making changes.");
    return false;
  }
}

// Resolve and remember where the file lives — useful for the Settings UI.
async function storeFilePath() {
  if (_filePath) return _filePath;
  if (!_tauri()) return null;
  try { _filePath = await _invoke("store_path_str"); } catch {}
  return _filePath;
}

// Public Store API — most code goes through lsGet/lsSet, but advanced ops use these directly.
const Store = {
  get(key, fb) {
    if (!_store) _store = _loadStore();
    return _store[key] === undefined ? fb : _store[key];
  },
  set(key, value) {
    if (!_store) _store = _loadStore();
    _store[key] = value;
    _scheduleWrite();
  },
  flush() { clearTimeout(_flushTimer); _persist(); },
  exportAll() {
    if (!_store) _store = _loadStore();
    return JSON.parse(JSON.stringify(_store));
  },
  importAll(blob) {
    if (!blob || typeof blob !== "object") throw new Error("Invalid import payload");
    let next;
    if (blob.version !== undefined && blob.txns !== undefined) {
      // New bundled format
      next = _migrate(blob);
    } else {
      // Legacy flat format (each top-level key is a fin_* JSON value)
      next = _emptyStore();
      for (const [legacy, key] of Object.entries(STORE_KEYMAP)) {
        if (blob[legacy] !== undefined) next[key] = blob[legacy];
      }
    }
    _store = next;
    _persist();
  },
  resetAll() { _store = _emptyStore(); _persist(); },
  // Async — pulls truth from the on-disk JSON file if running under Tauri.
  // Returns true if the file's data replaced the in-memory store.
  hydrateFromFile() { return _hydrateFromFile(); },
  // For diagnostics / settings panel
  status() {
    if (!_store) _store = _loadStore();
    return {
      schema: _store.version,
      lastWrite: _store.lastWrite,
      sizeBytes: (localStorage.getItem(STORE_KEY) || "").length,
      backups: STORE_BACKUPS.map(k => !!localStorage.getItem(k)),
      filePath: _filePath,
      backend: _tauri() ? "file + localStorage mirror" : "localStorage only",
    };
  },
  filePath() { return storeFilePath(); },
};

// Legacy shim: existing call sites use lsGet("fin_X") / lsSet("fin_X", v).
// Route those through the Store; for any non-mapped key, fall through to raw localStorage
// (covers `ledger_theme`, `ledger_density`, etc — UI prefs that don't need versioning).
const lsGet = (k, fb) => {
  const mapped = STORE_KEYMAP[k];
  if (mapped !== undefined) return Store.get(mapped, fb);
  try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; }
};
const lsSet = (k, v) => {
  const mapped = STORE_KEYMAP[k];
  if (mapped !== undefined) { Store.set(mapped, v); return; }
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("ls write failed", k, e); }
};

function getTxns()      { return lsGet("fin_txns", []); }
function getSettings()  { return lsGet("fin_settings", { expCats: DEFAULT_EXP_CATS.map(c=>c.id), incCats: DEFAULT_INC_CATS.map(c=>c.id), accounts: ["Monzo","Santander","Amex"] }); }
function getMerchantRules() { return getSettings().merchantRules || []; }
function setMerchantRules(rules) { const s = getSettings(); s.merchantRules = rules; lsSet("fin_settings", s); }
// Find first user rule matching raw description.
// Pattern is a case-insensitive substring, OR a JS regex if formatted /body/flags.
function findMerchantRule(rawDesc) {
  if (!rawDesc) return null;
  const up = rawDesc.toUpperCase();
  for (const r of getMerchantRules()) {
    if (!r.pattern) continue;
    const p = r.pattern.trim();
    let hit = false;
    if (p.startsWith("/") && p.lastIndexOf("/") > 0) {
      try {
        const lastSlash = p.lastIndexOf("/");
        const body = p.slice(1, lastSlash);
        const flags = p.slice(lastSlash + 1) || "i";
        hit = new RegExp(body, flags).test(rawDesc);
      } catch { hit = false; }
    } else {
      hit = up.includes(p.toUpperCase());
    }
    if (hit) return r;
  }
  return null;
}
function upsertMerchantRule(rule) {
  if (!rule || !rule.pattern) return;
  const rules = getMerchantRules();
  const key = rule.pattern.toUpperCase();
  const idx = rules.findIndex(r => r.pattern && r.pattern.toUpperCase() === key);
  if (idx >= 0) rules[idx] = { ...rules[idx], ...rule };
  else rules.push({ id: Date.now() + Math.random(), ...rule });
  setMerchantRules(rules);
}
function deleteMerchantRule(id) {
  setMerchantRules(getMerchantRules().filter(r => String(r.id) !== String(id)));
}

/* ════════════════════════════════════════
   CASCADE RENAMES — keep accounts / categories consistent across all data.
   Returns a summary of what was touched so the UI can give feedback.
════════════════════════════════════════ */
function cascadeAccountRename(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return { txns: 0, recurring: 0, rules: 0, snapshots: 0 };
  const summary = { txns: 0, recurring: 0, rules: 0, snapshots: 0 };
  // Transactions: .account, .fromAccount, .toAccount
  const txns = getTxns();
  txns.forEach(t => {
    let touched = false;
    if (t.account === oldName)     { t.account = newName; touched = true; }
    if (t.fromAccount === oldName) { t.fromAccount = newName; touched = true; }
    if (t.toAccount === oldName)   { t.toAccount = newName; touched = true; }
    if (touched) summary.txns++;
  });
  lsSet("fin_txns", txns);
  // Recurring (scheduled)
  const rec = lsGet("fin_recurring", []);
  rec.forEach(r => { if (r.account === oldName) { r.account = newName; summary.recurring++; } });
  lsSet("fin_recurring", rec);
  // Merchant rules — when type=transfer the toAccount stores the destination name
  const rules = getMerchantRules();
  let rulesTouched = false;
  rules.forEach(r => { if (r.toAccount === oldName) { r.toAccount = newName; summary.rules++; rulesTouched = true; } });
  if (rulesTouched) setMerchantRules(rules);
  // NW snapshot allocations
  const nwEntries = lsGet("fin_nw_entries", []);
  nwEntries.forEach(e => {
    (e.allocations || []).forEach(a => { if (a.cat === oldName) { a.cat = newName; summary.snapshots++; } });
  });
  lsSet("fin_nw_entries", nwEntries);
  // settings.accounts + settings.nwBuckets (NW bucket list)
  const s = getSettings();
  s.accounts = [...new Set((s.accounts || []).map(a => a === oldName ? newName : a))];
  if (Array.isArray(s.nwBuckets)) {
    s.nwBuckets = s.nwBuckets.map(b => b && b.id === oldName ? { ...b, id: newName } : b);
  }
  lsSet("fin_settings", s);
  if (typeof rebuildNWCats === "function") rebuildNWCats();
  return summary;
}

/* ════════════════════════════════════════
   UNIFIED ACCOUNTS — accounts ∪ NW buckets ∪ observed-in-txns.
   Net-worth buckets, transaction accounts, and any orphan strings observed in transactions
   are all "places where money lives" and should appear as one list everywhere.
════════════════════════════════════════ */
function getAllAccounts() {
  const fromSettings = (getSettings().accounts || []);
  const fromNW = (typeof NW_CATS !== "undefined" ? NW_CATS.map(b => b.id) : []);
  const fromTxns = getTxns().flatMap(t => [t.account, t.fromAccount, t.toAccount]).filter(Boolean);
  const seen = new Map(); // lower → canonical
  [...fromSettings, ...fromNW, ...fromTxns].forEach(a => {
    if (!a) return;
    const k = a.toLowerCase();
    if (!seen.has(k)) seen.set(k, a);
    // Prefer settings-defined casing
    if (fromSettings.includes(a)) seen.set(k, a);
  });
  return [...seen.values()].sort();
}

// One-time sync (called on boot): merges NW buckets + observed-txn account names into
// settings.accounts so Settings → Accounts shows the truly complete list. Idempotent.
function syncAccountsFromAllSources() {
  const s = getSettings();
  s.accounts = s.accounts || [];
  const existing = new Set(s.accounts.map(a => a.toLowerCase()));
  const additions = [];
  const tryAdd = (name) => {
    if (!name) return;
    const k = name.toLowerCase();
    if (!existing.has(k)) { additions.push(name); existing.add(k); }
  };
  (typeof NW_CATS !== "undefined" ? NW_CATS : []).forEach(b => tryAdd(b.id));
  getTxns().forEach(t => { tryAdd(t.account); tryAdd(t.fromAccount); tryAdd(t.toAccount); });
  if (additions.length) {
    s.accounts = [...s.accounts, ...additions];
    lsSet("fin_settings", s);
  }
  return additions;
}

/* ════════════════════════════════════════
   DATA INTEGRITY AUDIT
   Surfaces orphan categories/accounts (used in transactions but not defined in settings)
   and case-insensitive duplicates so the user can merge / add them.
════════════════════════════════════════ */
function auditDataIntegrity() {
  const issues = { dupCats: [], dupAccts: [], orphanCats: [], orphanAccts: [] };
  const txns = getTxns();
  const s = getSettings();
  const hidden = new Set(s.hiddenDefaultCats || []);
  // Build canonical category list (defined in settings)
  const definedCats = new Set([
    ...DEFAULT_EXP_CATS.filter(c => !hidden.has(c.id)).map(c => c.id),
    ...DEFAULT_INC_CATS.filter(c => !hidden.has(c.id)).map(c => c.id),
    ...(s.customCats || []).map(c => c.id),
    REFUND_CAT, // hidden system category for paired refunds — known, never an orphan
  ]);
  // Unified defined accounts = settings.accounts ∪ NW buckets (places money lives).
  const definedAccts = new Set([
    ...(s.accounts || []),
    ...(typeof NW_CATS !== "undefined" ? NW_CATS.map(b => b.id) : []),
  ]);
  // Observed values + their usage counts
  const catCounts = {}; const acctCounts = {};
  txns.forEach(t => {
    if (t.category)    catCounts[t.category]    = (catCounts[t.category]    || 0) + 1;
    if (t.account)     acctCounts[t.account]    = (acctCounts[t.account]    || 0) + 1;
    if (t.fromAccount) acctCounts[t.fromAccount]= (acctCounts[t.fromAccount]|| 0) + 1;
    if (t.toAccount)   acctCounts[t.toAccount]  = (acctCounts[t.toAccount]  || 0) + 1;
  });
  // Orphans: observed but not in defined sets
  Object.keys(catCounts).forEach(c => { if (!definedCats.has(c)) issues.orphanCats.push({ name: c, count: catCounts[c] }); });
  Object.keys(acctCounts).forEach(a => { if (!definedAccts.has(a)) issues.orphanAccts.push({ name: a, count: acctCounts[a] }); });
  // Uncategorised transactions — type=in/out but no category set. Transfers don't need one.
  issues.uncategorised = txns.filter(t => (t.type === "in" || t.type === "out") && !t.category).length;
  // Case-insensitive duplicate groups (in defined-or-observed pool)
  const groupBy = (names, counts) => {
    const groups = {};
    names.forEach(n => {
      const k = String(n).toLowerCase();
      groups[k] = groups[k] || [];
      groups[k].push({ name: n, count: counts[n] || 0 });
    });
    return Object.values(groups).filter(g => g.length > 1);
  };
  const allCatNames = [...new Set([...definedCats, ...Object.keys(catCounts)])];
  const allAcctNames = [...new Set([...definedAccts, ...Object.keys(acctCounts)])];
  issues.dupCats  = groupBy(allCatNames, catCounts);
  issues.dupAccts = groupBy(allAcctNames, acctCounts);
  // Sort orphans by usage descending — high-impact first
  issues.orphanCats.sort((a,b) => b.count - a.count);
  issues.orphanAccts.sort((a,b) => b.count - a.count);

  // Read-only warnings: structurally-odd records the user should review.
  // (Not auto-fixable via cascade rename, so surfaced as guidance.)
  const warnings = [];
  const noAcct = txns.filter(t => (t.type === "in" || t.type === "out") && !t.account && !t.fromAccount).length;
  if (noAcct) warnings.push(`${noAcct} transaction${noAcct===1?'':'s'} with no account`);
  const badBudgets = getBudgets().filter(b => typeof b.amount === "number" && b.amount < 0).length;
  if (badBudgets) warnings.push(`${badBudgets} budget${badBudgets===1?'':'s'} with a negative limit`);
  const noTarget = getGoals().filter(g => !(g.target > 0)).length;
  if (noTarget) warnings.push(`${noTarget} goal${noTarget===1?'':'s'} with no target amount`);
  const badRec = getRecurring().filter(r => { const d = +r.day; return r.day != null && (!Number.isInteger(d) || d < 1 || d > 31); }).length;
  if (badRec) warnings.push(`${badRec} recurring item${badRec===1?'':'s'} with an invalid day-of-month`);
  const emptySnap = getNWEntries().filter(e => !Array.isArray(e.allocations) || !e.allocations.some(a => (a.value || 0) !== 0)).length;
  if (emptySnap) warnings.push(`${emptySnap} net-worth snapshot${emptySnap===1?'':'s'} with no values`);
  issues.warnings = warnings;
  issues.warningCount = warnings.length;

  issues.total = issues.dupCats.length + issues.dupAccts.length + issues.orphanCats.length + issues.orphanAccts.length + (issues.uncategorised > 0 ? 1 : 0) + issues.warningCount;
  return issues;
}

function cascadeCategoryRename(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return { txns: 0, recurring: 0, budgets: 0, forecast: 0, rules: 0 };
  const summary = { txns: 0, recurring: 0, budgets: 0, forecast: 0, rules: 0 };
  // Transactions
  const txns = getTxns();
  txns.forEach(t => { if (t.category === oldName) { t.category = newName; summary.txns++; } });
  lsSet("fin_txns", txns);
  // Recurring
  const rec = lsGet("fin_recurring", []);
  rec.forEach(r => { if (r.category === oldName) { r.category = newName; summary.recurring++; } });
  lsSet("fin_recurring", rec);
  // Budgets — id and category both reference the cat name
  const buds = lsGet("fin_budgets", []);
  buds.forEach(b => {
    let touched = false;
    if (b.id === oldName)       { b.id = newName; touched = true; }
    if (b.category === oldName) { b.category = newName; touched = true; }
    if (touched) summary.budgets++;
  });
  lsSet("fin_budgets", buds);
  // Forecast items
  const fc = lsGet("fin_forecast", []);
  fc.forEach(f => { if (f.cat === oldName) { f.cat = newName; summary.forecast++; } });
  lsSet("fin_forecast", fc);
  // Merchant rules
  const rules = getMerchantRules();
  let rulesTouched = false;
  rules.forEach(r => { if (r.category === oldName) { r.category = newName; summary.rules++; rulesTouched = true; } });
  if (rulesTouched) setMerchantRules(rules);
  // settings.customCats — rename if the renamed cat is custom
  const s = getSettings();
  let customTouched = false;
  (s.customCats || []).forEach(c => { if (c.id === oldName) { c.id = newName; customTouched = true; } });
  // Dedupe customCats by id in case the new name collides with another entry (merge).
  if (customTouched) {
    const seen = new Set();
    s.customCats = (s.customCats || []).filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id); return true;
    });
  }
  // If oldName was a default, the rename has to "stick" — we promote it to a custom with the new name
  // and hide the original default. EXCEPT: if the new name already matches an existing category
  // (default or custom), this is really a MERGE, so we just hide the default without adding a new custom.
  const isDefault = [...DEFAULT_EXP_CATS, ...DEFAULT_INC_CATS].some(c => c.id === oldName);
  if (isDefault && !customTouched) {
    const defCat = [...DEFAULT_EXP_CATS, ...DEFAULT_INC_CATS].find(c => c.id === oldName);
    s.customCats = s.customCats || [];
    const alreadyExists = [...DEFAULT_EXP_CATS, ...DEFAULT_INC_CATS, ...s.customCats]
      .some(c => c.id !== oldName && c.id === newName);
    if (!alreadyExists) {
      // Promote: clone defaults' icon/colour under the new name. Tag with _fromDefault so the
      // UI knows it's really the renamed default, not a user-authored custom (no CUSTOM badge).
      s.customCats.push({
        id: newName, icon: defCat.icon, color: defCat.color,
        type: DEFAULT_INC_CATS.some(c => c.id === oldName) ? "in" : "exp",
        _fromDefault: oldName,
      });
    }
    s.hiddenDefaultCats = [...new Set([...(s.hiddenDefaultCats || []), oldName])];
  }
  lsSet("fin_settings", s);
  rebuildCatBy();
  return summary;
}
function getNWEntries() { return lsGet("fin_nw_entries", []); }
function getBudgets()   { return lsGet("fin_budgets", []); }
function getRecurring() { return lsGet("fin_recurring", []); }
function getGoals()     { return lsGet("fin_goals", []); }
function getHolidays()  { return lsGet("fin_holidays", []); }
function setHolidays(arr) { lsSet("fin_holidays", arr); }
function getDebts()     { return lsGet("fin_debts", []); }
function setDebts(arr)  { lsSet("fin_debts", arr); }
function getDebtSettings() { return lsGet("fin_debt_settings", { strategy: "avalanche", extra: 0 }); }
function setDebtSettings(s) { lsSet("fin_debt_settings", s); }
// Built-in cost types for holiday line items. Users can still type free-text in the future.
const HOLIDAY_CATEGORIES = [
  { id: "Flights",       icon: "✈️", color: "oklch(72% 0.12 240)" },
  { id: "Accommodation", icon: "🏨", color: "oklch(70% 0.12 320)" },
  { id: "Food & Drink",  icon: "🍽️", color: "oklch(72% 0.12 30)"  },
  { id: "Transport",     icon: "🚌", color: "oklch(70% 0.10 200)" },
  { id: "Activities",    icon: "🎟️", color: "oklch(72% 0.13 130)" },
  { id: "Shopping",      icon: "🛍️", color: "oklch(72% 0.10 350)" },
  { id: "Insurance",     icon: "🛡️", color: "oklch(70% 0.08 200)" },
  { id: "Other",         icon: "📦", color: "oklch(70% 0.04 250)" },
];
function getForecasts() { return lsGet("fin_forecast", []); }
function getPlans()     { return lsGet("fin_plans", []); }
function getAllocPlan() {
  return lsGet("fin_alloc_plan", [
    { id: "needs",   label: "Needs (rent, bills, food)",       pct: 50, color: "oklch(70% 0.10 240)" },
    { id: "wants",   label: "Wants (entertainment, lifestyle)", pct: 30, color: "oklch(72% 0.12 320)" },
    { id: "savings", label: "Savings & investments",            pct: 20, color: "oklch(70% 0.10 150)" },
  ]);
}
function setAllocPlan(arr) { lsSet("fin_alloc_plan", arr); }

/* ════════════════════════════════════════
   DESIGN DATA
════════════════════════════════════════ */
const DEFAULT_EXP_CATS = [
  { id: "Groceries",     icon: "🛒", color: "oklch(72% 0.12 150)" },
  { id: "Dining",        icon: "🍽️", color: "oklch(72% 0.12 30)"  },
  { id: "Transport",     icon: "🚌", color: "oklch(72% 0.10 240)" },
  { id: "Subscriptions", icon: "🔁", color: "oklch(65% 0.08 280)" },
  { id: "Entertainment", icon: "🎬", color: "oklch(72% 0.12 320)" },
  { id: "Repayments",    icon: "💳", color: "oklch(65% 0.10 260)" },
  { id: "Insurance",     icon: "🛡️", color: "oklch(70% 0.08 200)" },
  { id: "Medical",       icon: "🩺", color: "oklch(70% 0.10 200)" },
  { id: "Education",     icon: "📚", color: "oklch(70% 0.12 75)"  },
  { id: "Sports",        icon: "🏋️", color: "oklch(72% 0.13 130)" },
  { id: "Holiday",       icon: "✈️", color: "oklch(72% 0.12 50)"  },
  { id: "Clothing",      icon: "👕", color: "oklch(72% 0.10 350)" },
  { id: "Gifts",         icon: "🎁", color: "oklch(70% 0.12 0)"   },
  { id: "Fees",          icon: "💸", color: "oklch(65% 0.06 75)"  },
  { id: "Misc",          icon: "📦", color: "oklch(70% 0.04 250)" },
  { id: "Housing",       icon: "🏡", color: "oklch(68% 0.10 230)" },
];
const DEFAULT_INC_CATS = [
  { id: "Wages",         icon: "💷", color: "oklch(60% 0.12 150)" },
  { id: "Salary",        icon: "💼", color: "oklch(60% 0.12 150)" },
  { id: "Reimbursement", icon: "↩️", color: "oklch(65% 0.10 180)" },
  { id: "Other Income",  icon: "💰", color: "oklch(65% 0.10 100)" },
];
// Hidden system category for paired refunds. Both legs of a refund pair (the
// incoming refund AND its matched original charge) are filed here so they net to
// zero and are excluded from every spending/income total — nothing actually left
// the account. It never appears in category dropdowns (see getAllCats) and is
// skipped by all aggregation helpers (see isRefundLeg / the chokepoints in utils.js).
const REFUND_CAT = "Refunds";
const REFUND_CAT_DEF = { id: REFUND_CAT, icon: "↩️", color: "oklch(62% 0.02 250)", hidden: true };
// A transaction is a "refund leg" (excluded from totals) if it's filed under the
// hidden Refunds category. Centralised so every aggregation uses the same rule.
function isRefundLeg(t) { return !!t && t.category === REFUND_CAT; }

const ALL_CATS = [...DEFAULT_EXP_CATS, ...DEFAULT_INC_CATS, REFUND_CAT_DEF];
const CAT_BY   = Object.fromEntries(ALL_CATS.map(c => [c.id, {...c}]));

/* ── Custom-cat & emoji-override helpers ── */
// Keyword → emoji fallback so user-created categories without an icon
// still get something sensible based on the category name.
const ICON_KEYWORDS = [
  // expense-ish
  [/repay|loan|debt|credit|installment|repayment/i, "💳"],
  [/subscript|netflix|spotify|stream|membership|renew/i, "🔁"],
  [/lifestyle|cloth|fashion|shopping|outfit|wardrobe|apparel/i, "👕"],
  [/eat|dine|restaurant|takeaway|takeout|food court|brunch|lunch|dinner/i, "🍽️"],
  [/ticket|event|concert|festival|gig|show/i, "🎟️"],
  [/home|household|furniture|decor|garden/i, "🏠"],
  [/office|workspace|stationery/i, "🏢"],
  [/business|professional|consult/i, "💼"],
  [/other|misc|miscell|general/i, "📦"],
  [/grocer|supermarket|market|produce/i, "🥬"],
  [/transport|travel|commut|uber|taxi|train|bus|tube|metro|fuel|petrol|gas station/i, "🚆"],
  [/entertain|movie|cinema|netflix|game|music|spotify|streaming/i, "🎬"],
  [/gift|present|donation|charity/i, "🎁"],
  [/medical|doctor|health|pharmacy|hospital|dentist/i, "🩺"],
  [/educat|school|learn|book|course|tuition|university/i, "📚"],
  [/sport|gym|fitness|workout|train(ing)?|club/i, "🏋"],
  [/holiday|vacation|trip|flight|airbnb|hotel/i, "✈️"],
  [/fee|bank charge|service charge|atm/i, "💸"],
  [/insur/i, "🛡️"],
  [/coffee|cafe|café|starbucks|costa|pret/i, "☕"],
  [/drink|alcohol|bar |pub|wine|beer|cocktail/i, "🍺"],
  [/utility|util|electric|gas bill|water bill|bill/i, "💡"],
  [/internet|broadband|wifi/i, "📡"],
  [/phone|mobile|sim|carrier/i, "📱"],
  [/pet|dog|cat |vet/i, "🐾"],
  [/baby|kid|child|nursery/i, "👶"],
  [/car|auto|vehicle|mot/i, "🚗"],
  [/rent\b/i, "🏠"],
  [/mortgage/i, "🏡"],
  [/tax|hmrc/i, "🧾"],
  [/saving/i, "💰"],
  [/personal care|beauty|skincare|cosmet|haircut|barber|salon/i, "💅"],
  [/laundry|cleaning/i, "🧺"],
  // income-ish
  [/salary|wage|payroll/i, "💷"],
  [/freelance|contract|gig income/i, "🧾"],
  [/refund|reimburs|cashback|return/i, "↩"],
  [/dividend|interest|invest/i, "📈"],
  [/bonus/i, "🎉"],
];
function guessCatEmoji(name) {
  if (!name) return null;
  for (const [re, emoji] of ICON_KEYWORDS) if (re.test(name)) return emoji;
  return null;
}
function resolveIcon(cat, overrides) {
  // priority: user override → declared icon on category → keyword guess → null (renderer will fallback to bullet)
  if (overrides && overrides[cat.id]) return overrides[cat.id];
  if (cat.icon) return cat.icon;
  return guessCatEmoji(cat.id) || cat.icon;
}
function getAllCats(type) {
  const s = getSettings();
  const customs = (s.customCats || []).filter(c => c.type === type);
  const hidden = new Set(s.hiddenDefaultCats || []);
  const defaults = (type === "in" ? DEFAULT_INC_CATS : DEFAULT_EXP_CATS).filter(c => !hidden.has(c.id));
  const overrides = s.catEmojis || {};
  return [...defaults, ...customs].map(c => ({ ...c, icon: resolveIcon(c, overrides) }));
}
function rebuildCatBy() {
  const s = getSettings();
  const customs = s.customCats || [];
  const overrides = s.catEmojis || {};
  Object.keys(CAT_BY).forEach(k => delete CAT_BY[k]);
  [...DEFAULT_EXP_CATS, ...DEFAULT_INC_CATS, REFUND_CAT_DEF, ...customs].forEach(c => {
    CAT_BY[c.id] = { ...c, icon: resolveIcon(c, overrides) };
  });
}

// Single source of truth for "what emoji should I render for this category name?"
// Used everywhere — dashboard, transactions list, insights, settings. Handles three cases:
//   1) Known category (default or custom)         → use its declared icon
//   2) Unknown category that matches a keyword    → use the keyword-guess emoji
//   3) Fallback                                   → use '•'
function iconFor(catId) {
  if (!catId) return "•";
  const cat = CAT_BY[catId];
  if (cat && cat.icon) return cat.icon;
  const g = (typeof guessCatEmoji === "function") ? guessCatEmoji(catId) : null;
  return g || "•";
}

// One-time migration: any custom category without an icon gets the keyword-guessed
// emoji baked in permanently, so the dashboard / settings / tx lists all show the
// same icon (no implicit fallback magic in the rendering layer).
function seedMissingCatIcons() {
  const s = getSettings();
  const customs = s.customCats || [];
  let changed = false;
  for (const c of customs) {
    if (!c.icon) {
      const guess = guessCatEmoji(c.id);
      if (guess) { c.icon = guess; changed = true; }
    }
  }
  if (changed) {
    s.customCats = customs;
    lsSet("fin_settings", s);
  }
  return changed;
}
function getAcctEmoji(name) {
  const s = getSettings();
  return (s.acctEmojis||{})[name] || (name||"?")[0].toUpperCase();
}
function setCatEmoji(id, emoji) {
  const s = getSettings();
  s.catEmojis = s.catEmojis || {};
  if (emoji && emoji.trim()) s.catEmojis[id] = emoji.trim(); else delete s.catEmojis[id];
  lsSet("fin_settings", s);
  rebuildCatBy();
  renderAll();
}
function setAcctEmoji(name, emoji) {
  const s = getSettings();
  s.acctEmojis = s.acctEmojis || {};
  if (emoji && emoji.trim()) s.acctEmojis[name] = emoji.trim(); else delete s.acctEmojis[name];
  lsSet("fin_settings", s);
  renderAll();
}
// User-editable freeform note shown next to an account name (overrides ACCT_META.subtitle).
// Setting an empty string explicitly hides the hardcoded default.
function setAcctNote(name, note) {
  const s = getSettings();
  s.acctNotes = s.acctNotes || {};
  s.acctNotes[name] = (note || "").trim();
  lsSet("fin_settings", s);
  renderAll();
}
// Resolver — anywhere we display "Monzo · Current" type subtitles we go through this.
function getAcctNote(name) {
  const s = getSettings();
  const notes = s.acctNotes || {};
  if (name in notes) return notes[name];
  return (ACCT_META[name] && ACCT_META[name].subtitle) || "";
}

const DEFAULT_NW_CATS = [
  { id: "Current Account", color: "var(--c-current)" },
  { id: "Savings",         color: "var(--c-savings)"  },
  { id: "Lifetime ISA",    color: "var(--c-lisa)"     },
  { id: "S&S ISA",         color: "var(--c-ssisa)"    },
  { id: "Other",           color: "var(--c-other)"    },
];
// Computed dynamically — overridden by user-defined buckets in settings.
let NW_CATS = DEFAULT_NW_CATS.slice();
function rebuildNWCats() {
  const s = getSettings();
  const custom = s.nwBuckets;
  NW_CATS = (Array.isArray(custom) && custom.length) ? custom.slice() : DEFAULT_NW_CATS.slice();
}

const ACCT_META = {
  "Monzo":      { color: "oklch(85% 0.10 30)",  subtitle: "Current" },
  "Santander":  { color: "oklch(85% 0.12 28)",  subtitle: "Savings" },
  "Amex":       { color: "oklch(82% 0.05 240)", subtitle: "Credit"  },
};

/* ════════════════════════════════════════
   STATE
════════════════════════════════════════ */
