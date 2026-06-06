/* ════════════════════════════════════════
   SPA ROUTER (sidebar nav)
════════════════════════════════════════ */
let _activePage = "home";
let _navExpanded = new Set(JSON.parse(localStorage.getItem("ledger_nav_expanded") || '["tx","planning","accounts"]'));

function applyNavExpanded() {
  document.querySelectorAll(".nav-group").forEach(g => {
    g.dataset.expanded = _navExpanded.has(g.dataset.group) ? "true" : "false";
  });
}
function toggleNavGroup(name) {
  if (_navExpanded.has(name)) _navExpanded.delete(name); else _navExpanded.add(name);
  localStorage.setItem("ledger_nav_expanded", JSON.stringify([..._navExpanded]));
  applyNavExpanded();
}

function switchPage(name) {
  // Guard: if the user has unsaved Appearance changes and is leaving Settings, prompt.
  if (_activePage === "settings" && name !== "settings" && typeof apprNavGuard === "function" && typeof apprDirty === "function" && apprDirty()) {
    apprNavGuard(() => _switchPageNow(name));
    return;
  }
  _switchPageNow(name);
}
function _switchPageNow(name) {
  _activePage = name;
  // Entering Settings with no pending edits: refresh the snapshot so dirty-detection
  // reflects the live persisted values (handles late file-hydration after first load).
  if (name === "settings" && typeof apprDirty === "function" && !apprDirty() && typeof captureApprSnapshot === "function") {
    captureApprSnapshot();
    if (typeof updateApprSaveBar === "function") updateApprSaveBar();
  }
  // Tx sub-pages (expenses/income/transfers) → #page-tx
  // Accounts sub-pages (accounts/networth) → #page-accounts (with the right inner tab active)
  const ACC_SUBPAGES = { accounts: "accounts", networth: "networth" };
  const displayPage = TX_PAGE_TYPES[name] ? "tx" : (ACC_SUBPAGES[name] ? "accounts" : name);
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.dataset.page === displayPage));
  // Activate the matching Accounts inner tab + sync the page heading / add button label
  if (ACC_SUBPAGES[name]) {
    const sub = ACC_SUBPAGES[name];
    document.querySelectorAll("#acc-tabs button").forEach(b => b.classList.toggle("active", b.dataset.accTab === sub));
    document.getElementById("acc-tab-accounts").style.display = (sub === "accounts") ? "" : "none";
    document.getElementById("acc-tab-networth").style.display = (sub === "networth") ? "" : "none";
  }
  // Topbar Add button is context-aware — it opens the snapshot modal on the
  // Balances / Net worth page, so label it "Add Snapshot" there (and reset to
  // the generic "Add" everywhere else).
  const addLabels = {
    accounts: "Add Snapshots", networth: "Add Snapshots",
    transactions: "Add transaction", expenses: "Add transaction",
    income: "Add income", transfers: "Add transfer",
    budgets: "Add budget", goals: "Add goal",
    scheduled: "Add bill", holidays: "Add holiday",
    debt: "Add debt",
  };
  const addBtnLabel = document.getElementById("add-btn-label");
  if (addBtnLabel) addBtnLabel.textContent = addLabels[name] || "Add";
  // Hide the topbar Add button where it doesn't apply: Forecast has its own
  // header add button, and Reports/insights is a read-only dashboard.
  const topAddDiv = document.querySelector(".top-add");
  if (topAddDiv) topAddDiv.style.display = (name === "home" || name === "forecast" || name === "insights" || name === "settings" || name === "goals" || name === "help" || name === "accounts" || name === "networth") ? "none" : "";
  // Sidebar highlight: tx sub-pages (expenses/income/transfers) all map back to the
  // "transactions" sidebar item, since they're tabs within that one page.
  const sidebarPage = (TX_PAGE_TYPES[name] && name !== "transactions") ? "transactions" : name;
  document.querySelectorAll(".nav-item[data-page]").forEach(b => {
    if (b.dataset.page === sidebarPage) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  // If switching to a tx sub-page: lock type, update heading + add-btn label, re-render
  if (TX_PAGE_TYPES[name]) {
    _txAllType = TX_PAGE_TYPES[name];
    _txAllPage = 0;
    const titleEl = document.getElementById("tx-page-title");
    if (titleEl) titleEl.textContent = "Transactions";
    // Sync the inline tab picker so the right pill is highlighted.
    document.querySelectorAll("#tx-type-tabs button").forEach(b => {
      b.classList.toggle("active", b.dataset.txTab === name);
    });
    renderTxAll();
  }
  // Parent group highlight + auto-expand if active is inside
  document.querySelectorAll(".nav-group").forEach(g => {
    const containsActive = !!g.querySelector(`.nav-item[data-page="${name}"]`);
    g.classList.toggle("has-active", containsActive);
    if (containsActive && !_navExpanded.has(g.dataset.group)) {
      _navExpanded.add(g.dataset.group);
      localStorage.setItem("ledger_nav_expanded", JSON.stringify([..._navExpanded]));
      g.dataset.expanded = "true";
    }
  });
  // Crumbs
  const titles = { home: "Dashboard", insights: "Reports", forecast: "Forecast", debt: "Debt payoff", help: "Help & guide", networth: "Accounts · Net worth", transactions: "Transactions", expenses: "Transactions · Expenses", income: "Transactions · Income", transfers: "Transactions · Transfers", budgets: "Budgets", scheduled: "Bills & Subscriptions", accounts: "Accounts", goals: "Goals", holidays: "Holidays", settings: "Settings" };
  const crumbs = document.querySelector(".crumbs");
  if (crumbs) {
    if (name === "insights") {
      crumbs.style.display = "none";
    } else {
      crumbs.style.display = "";
      crumbs.innerHTML = `Ledger / <b>${titles[name] || "Dashboard"}</b>`;
    }
  }
  // Relocate the month picker into the active page's slot, or park it
  const mp = document.querySelector(".month-pick");
  let slot;
  if (name === "insights") slot = document.querySelector(".topbar .topbar-ins-slot .month-slot");
  else if (name === "budgets") slot = document.querySelector(".topbar .topbar-bud-slot .month-slot");
  else if (name === "forecast") slot = document.querySelector(".topbar .topbar-fc-slot .month-slot");
  else if (name === "scheduled") slot = document.querySelector(".topbar .topbar-sched-slot .month-slot");
  else slot = null;
  if (mp) {
    if (slot && !slot.contains(mp)) slot.appendChild(mp);
    else if (!slot) document.getElementById("month-pick-parking").appendChild(mp);
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}
document.querySelectorAll(".nav-item[data-page]").forEach(btn => {
  btn.addEventListener("click", () => switchPage(btn.dataset.page));
});
document.getElementById("settings-btn").addEventListener("click", () => switchPage("settings"));

/* Help page: scroll-spy that highlights the table-of-contents link for the
   section currently in view, and smooth-scrolls when a TOC link is clicked. */
(function wireHelpToc() {
  const toc = document.getElementById("help-toc");
  if (!toc) return;
  const links = [...toc.querySelectorAll(".help-toc-link")];
  const byId = id => links.find(a => a.getAttribute("href") === "#" + id);
  // Smooth-scroll within the .main scroller (anchors don't natively scroll a nested
  // overflow container reliably across all webviews).
  links.forEach(a => a.addEventListener("click", e => {
    const id = a.getAttribute("href").slice(1);
    const sec = document.getElementById(id);
    if (sec) { e.preventDefault(); sec.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }));
  const sections = [...document.querySelectorAll("#page-help .help-sec")];
  if (!sections.length || !("IntersectionObserver" in window)) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        const link = byId(en.target.id);
        if (link) { links.forEach(l => l.classList.remove("active")); link.classList.add("active"); }
      }
    });
  }, { root: document.querySelector(".main"), rootMargin: "0px 0px -70% 0px", threshold: 0 });
  sections.forEach(s => obs.observe(s));
})();

// Accounts page inner tabs — switch between Accounts and Net worth without leaving the page
(function wireAccTabs() {
  const tabs = document.getElementById("acc-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", e => {
    const b = e.target.closest("[data-acc-tab]"); if (!b) return;
    switchPage(b.dataset.accTab);
  });
})();

// Transactions page inner tabs — Type picker (All / Expenses / Income / Transfers).
(function wireTxTypeTabs() {
  const tabs = document.getElementById("tx-type-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", e => {
    const b = e.target.closest("[data-tx-tab]"); if (!b) return;
    switchPage(b.dataset.txTab);
  });
})();

// Dashboard mini-calendar arrow controls
(function wireHomeCalendar() {
  const step = (delta) => {
    if (typeof _homeCalState === "undefined") return;
    let m = _homeCalState.month + delta;
    let y = _homeCalState.year;
    while (m > 11) { m -= 12; y++; }
    while (m < 0)  { m += 12; y--; }
    _homeCalState.month = m; _homeCalState.year = y;
    _homeCalState.selectedDate = null;
    renderHomeCalendar();
  };
  const prev = document.getElementById("home-cal-prev");
  const next = document.getElementById("home-cal-next");
  if (prev) prev.addEventListener("click", () => step(-1));
  if (next) next.addEventListener("click", () => step(1));
})();

// Settings section nav: filter view — clicking a tab hides every other section.
(function wireSettingsTabs() {
  const tabs = document.getElementById("settings-tabs");
  if (!tabs) return;
  const SECTION_IDS = ["sec-appearance","sec-buckets","sec-categories","sec-accounts","sec-data","sec-about"];
  // Map each settings section to the renderer that fills it, so opening a tab
  // always shows fresh content even if an earlier renderAll silently failed.
  const SECTION_RENDERERS = {
    "sec-buckets":    () => typeof renderNWMgr   === "function" && renderNWMgr(),
    "sec-categories": () => typeof renderCatMgr  === "function" && renderCatMgr(),
    "sec-accounts":   () => typeof renderAcctMgr === "function" && renderAcctMgr(),
  };
  function showOnly(id) {
    SECTION_IDS.forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = (s === id) ? "" : "none";
    });
    tabs.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.target === id));
    try { SECTION_RENDERERS[id] && SECTION_RENDERERS[id](); } catch (e) { console.error("section render failed:", id, e); }
    // Scroll to top whenever section changes, so the user always sees the section heading first.
    const main = document.querySelector(".main");
    if (main) main.scrollTo({ top: 0, behavior: "instant" in main.scrollTo ? "instant" : "auto" });
  }
  tabs.addEventListener("click", e => {
    const b = e.target.closest("[data-target]"); if (!b) return;
    const target = b.dataset.target;
    // Guard tab switches AWAY from Appearance with unsaved changes
    if (target !== "sec-appearance" && typeof apprNavGuard === "function" && typeof apprDirty === "function" && apprDirty()) {
      apprNavGuard(() => showOnly(target));
      return;
    }
    showOnly(target);
  });
  // Default visible section
  showOnly("sec-appearance");
})();

// Profile modal — opens when the user clicks their profile in the sidebar.
function openProfileModal() {
  // Make sure the inputs reflect current settings (renderSettings is what populates them
  // via the existing wiring; calling it here keeps the popover in sync without depending
  // on the Settings page being mounted).
  if (typeof renderSettings === "function") renderSettings();
  document.getElementById("profile-modal").hidden = false;
  setTimeout(() => document.getElementById("set-name")?.focus(), 50);
}
function closeProfileModal() {
  document.getElementById("profile-modal").hidden = true;
  // Refresh the sidebar avatar/name in case anything changed.
  if (typeof applySidebarProfile === "function") applySidebarProfile();
}
document.getElementById("me-card").addEventListener("click", openProfileModal);
document.getElementById("profile-m-done").addEventListener("click", closeProfileModal);
document.getElementById("profile-modal").addEventListener("click", e => {
  if (e.target.id === "profile-modal") closeProfileModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !document.getElementById("profile-modal").hidden) closeProfileModal();
});

// Generic Escape-to-close for every modal (a11y: escape-routes). Prefers the
// modal's own Cancel/close button so per-modal cleanup still runs; otherwise
// just hides it. The first-run onboarding and the lock screen are excluded —
// those must be resolved by the user, not dismissed.
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".modal-backdrop:not([hidden])")]
    .filter(m => m.id !== "onboard-modal");
  if (!open.length) return;
  const top = open[open.length - 1];
  e.preventDefault();
  const closer = top.querySelector('[id$="-cancel"], [id$="-close"], [id$="-done"], .modal-close');
  if (closer) closer.click(); else top.hidden = true;
});
document.querySelectorAll(".nav-group-header").forEach(h => {
  h.addEventListener("click", () => toggleNavGroup(h.closest(".nav-group").dataset.group));
});
applyNavExpanded();

/* Mobile sidebar drawer */
function openMobileMenu() { document.documentElement.dataset.sidebarMobile = "open"; }
function closeMobileMenu() { document.documentElement.dataset.sidebarMobile = "closed"; }
document.getElementById("menu-btn").addEventListener("click", openMobileMenu);
document.getElementById("sidebar-scrim").addEventListener("click", closeMobileMenu);
// Close drawer when navigating on mobile
document.querySelectorAll(".sidebar .nav-item[data-page], .sidebar #settings-btn").forEach(el => {
  el.addEventListener("click", () => { if (window.matchMedia("(max-width: 820px)").matches) closeMobileMenu(); });
});

/* Keyboard shortcuts */
document.addEventListener("keydown", e => {
  // ⌘K / Ctrl+K → focus topbar search (auto-switches to Expenses tab)
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!TX_PAGE_TYPES[_activePage]) switchPage("expenses");
    const inp = document.getElementById("search-inp");
    if (inp) { inp.focus(); inp.select(); }
    return;
  }
  // Don't intercept other shortcuts while typing
  const tag = (e.target?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
  // N → context-aware new (same as topbar +)
  if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    document.getElementById("add-btn").click();
    return;
  }
  // / → focus search
  if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const inp = document.getElementById("search-inp");
    if (inp) { inp.focus(); inp.select(); }
  }
});

/* ════════════════════════════════════════
   RENDER ALL
════════════════════════════════════════ */
// Shared isolation wrapper: a single failing renderer (missing element, runtime
// error) must never blank out the rest of the app. Errors surface in console.
function safeRun(name, fn) {
  try { fn(); } catch (e) { console.error("render." + name + " failed:", e); }
}
function renderAll() {
  safeRun("home",     renderHomeAll);
  safeRun("insights", renderInsightsTab);
  safeRun("nw",       renderNW);
  safeRun("tx",       renderTxAll);
  safeRun("bud",      renderBud);
  safeRun("sched",    renderSched);
  safeRun("accounts", renderAccountsTab);
  safeRun("goals",    renderGoals);
  safeRun("holidays", renderHolidays);
  safeRun("forecast", renderForecast);
  safeRun("debt",     typeof renderDebt === "function" ? renderDebt : () => {});
  safeRun("settings", renderSettings);
}

/* ════════════════════════════════════════
   INIT
════════════════════════════════════════ */
if (_dark) document.documentElement.dataset.theme = "dark";
// Density toggle is hidden for now — force compact as the single canonical layout.
document.documentElement.dataset.density = "compact";
localStorage.setItem("ledger_density", "compact");
if (typeof seedMissingCatIcons === "function") seedMissingCatIcons();
// One-time cleanup: move already-imported refund pairs into the hidden Refunds
// category so both legs cancel out (fixes spend that was still counting in Misc
// etc. from imports made before the both-legs rule). Runs once, guarded by a flag.
(function migrateRefundPairsV1() {
  try {
    const s = getSettings();
    if (s.refundMigrationV1) return;
    const REF = (typeof REFUND_CAT !== "undefined") ? REFUND_CAT : "Refunds";
    const txns = getTxns();
    if (txns.length) {
      const expSet = new Set((typeof getAllCats === "function" ? getAllCats("exp") : []).map(c => c.id));
      const cn = (d) => String(d || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const within30 = (a, b) => {
        if (!a || !b) return false;
        const da = new Date(a + "T00:00:00").getTime(), db = new Date(b + "T00:00:00").getTime();
        return !isNaN(da) && !isNaN(db) && Math.abs(da - db) <= 30 * 864e5;
      };
      const ty = (t) => { const r = (t.type || "out").toLowerCase(); return r === "in" || r === "income" ? "in" : r === "transfer" ? "transfer" : "out"; };
      // A refund candidate: income already flagged isRefund, OR income whose category
      // is an expense category (the old "tagged with original category" scheme).
      const refundIncome = txns.filter(t => ty(t) === "in" && t.category !== REF && (t.isRefund || expSet.has(t.category)));
      const outTxns = txns.filter(t => ty(t) === "out" && t.category !== REF);
      let touched = 0;
      refundIncome.forEach(rt => {
        const name = cn(rt.description), amt = Math.abs(rt.amount || 0);
        // match the most-recent unmatched expense of same merchant + amount within ±30d
        let best = null;
        outTxns.forEach(ot => {
          if (ot._refMigDone) return;
          if (Math.abs((ot.amount || 0) - amt) > 0.01) return;
          if (cn(ot.description) !== name) return;
          if (!within30(ot.date, rt.date)) return;
          if (!best || (ot.date || "") > (best.date || "")) best = ot;
        });
        // Always file the refund income leg under Refunds; file its matched charge too.
        rt.category = REF; rt.isRefund = true; touched++;
        if (best) { best.category = REF; best.isRefund = true; best._refMigDone = true; touched++; }
      });
      if (touched) {
        // Back up the pre-migration list once, then clean the temp flag and persist.
        try { localStorage.setItem("fin_txns_prerefundmigration", JSON.stringify(getTxns())); } catch {}
        txns.forEach(t => { delete t._refMigDone; });
        lsSet("fin_txns", txns);
        console.info(`[refund-migration] reclassified ${touched} txn(s) into ${REF}`);
      }
    }
    s.refundMigrationV1 = true;
    lsSet("fin_settings", s);
  } catch (e) { console.warn("refund migration skipped:", e); }
})();
rebuildCatBy();
rebuildNWCats();
// Merge NW buckets + every account name observed in transactions into settings.accounts,
// so the unified accounts list is the single source of truth everywhere.
if (typeof syncAccountsFromAllSources === "function") syncAccountsFromAllSources();
applySidebarProfile();

// Auto-collapse sidebar on hover (always-on for now; can be settings-driven later)
document.body.classList.add("sidebar-auto");

// Detect Tauri runtime; wire window controls + tag the body
(function tauriBoot() {
  const isTauri = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
  if (!isTauri) return;
  document.documentElement.classList.add("tauri");
  document.body.classList.add("tauri");

  async function getWin() {
    if (window.__TAURI__?.window?.getCurrentWindow) return window.__TAURI__.window.getCurrentWindow();
    if (window.__TAURI__?.window?.getCurrent)        return window.__TAURI__.window.getCurrent();
    // Tauri 2.x without globalTauri: use plugin invoke
    try {
      const mod = await import("@tauri-apps/api/window");
      return mod.getCurrentWindow ? mod.getCurrentWindow() : mod.getCurrent();
    } catch { return null; }
  }
  document.getElementById("win-close").addEventListener("click", async () => { const w = await getWin(); if (w) w.close(); });
  document.getElementById("win-min").addEventListener("click",   async () => { const w = await getWin(); if (w) w.minimize(); });
  document.getElementById("win-max").addEventListener("click",   async () => { const w = await getWin(); if (w) w.toggleMaximize ? w.toggleMaximize() : (await w.isMaximized() ? w.unmaximize() : w.maximize()); });
})();
const _initSettings = getSettings();
// Lock as early as possible so data is never briefly visible before the gate.
// These lock-state bindings MUST be declared before initAppLock() runs:
// initAppLock() is a hoisted function declaration that reads/writes them, so
// keeping the `let`s at their old (later) position left them in the Temporal
// Dead Zone — the call below threw an uncaught ReferenceError that killed the
// entire boot (renderAll, hydrate, watchdog all never ran → blank dashboard).
let _appUnlocked = false;
let _idleTimer = null;
initAppLock();
if (_initSettings.accentColor) applyAccent(_initSettings.accentColor);
if (_initSettings.posColor)    applyPosColor(_initSettings.posColor);
if (_initSettings.negColor)    applyNegColor(_initSettings.negColor);
if (_initSettings.radius != null) applyRadius(_initSettings.radius);
applyIconVariant(_initSettings.iconVariant || "auto");
updateMonthLabel();
renderAll();
// Hydrate from the on-disk JSON file (Tauri). This is the AUTHORITATIVE load —
// the synchronous localStorage paint above may be empty/stale on a cold start,
// so we always rebuild + re-render once the file is in, not just when it differs.
let _bootFinished = false;
function _finishBoot() {
  if (_bootFinished) return;
  _bootFinished = true;
  // Each step is isolated AND the loader is removed in a finally — a failure in
  // any single step can never strand the app on the loading screen again.
  const step = (name, fn) => { try { fn(); } catch (e) { console.error("boot." + name + " failed:", e); } };
  try {
    step("rebuildCatBy", rebuildCatBy);
    step("rebuildNWCats", rebuildNWCats);
    step("syncAccounts", () => { if (typeof syncAccountsFromAllSources === "function") syncAccountsFromAllSources(); });
    step("renderAll", renderAll);
    step("lock", () => { if (getSettings().pinHash && !_appUnlocked) lockApp(); });
    step("pinUI", refreshPinSettingsUI);
    step("onboarding", maybeShowOnboarding);
  } finally {
    document.body.classList.remove("booting");
  }
}
Store.hydrateFromFile()
  .then((adopted) => {
    if (!_bootFinished) { _finishBoot(); return; }
    // The 3s watchdog already revealed the UI using the synchronous
    // localStorage store (empty/stale on a cold start after an installer
    // wipes WebView2 storage) BEFORE the on-disk file finished loading. The
    // file is authoritative, so once it lands we must re-apply it — otherwise
    // the data never appears and the first-run onboarding modal that fired
    // against the empty store stays up forever (the bug seen after reinstall).
    if (adopted) {
      const restep = (name, fn) => { try { fn(); } catch (e) { console.error("rehydrate." + name + " failed:", e); } };
      restep("rebuildCatBy", rebuildCatBy);
      restep("rebuildNWCats", rebuildNWCats);
      restep("syncAccounts", () => { if (typeof syncAccountsFromAllSources === "function") syncAccountsFromAllSources(); });
      restep("renderAll", renderAll);
      restep("retractOnboarding", () => {
        const ob = document.getElementById("onboard-modal");
        if (ob) ob.hidden = true;
      });
    }
  })
  .catch(err => { console.error("Boot hydrate failed", err); _finishBoot(); });
// Watchdog: if hydrate is slow/hung, reveal whatever we have after 3s so the
// app is never stuck behind the loader.
setTimeout(_finishBoot, 3000);
// Initial month-pick relocation (active page = home, so park it)
{
  const mp = document.querySelector(".month-pick");
  if (mp) document.getElementById("month-pick-parking").appendChild(mp);
}

/* ════════════════════════════════════════
   PWA service worker + install button
════════════════════════════════════════ */
if ("serviceWorker" in navigator) {
  const _inTauri = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
  if (_inTauri) {
    // Tauri ships a fresh bundle each build; the SW would just serve stale HTML.
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(err => console.warn("SW register failed", err));
    });
  }
}
/* ════════════════════════════════════════
   ABOUT PANEL  (keep APP_VERSION in sync with src-tauri/tauri.conf.json + Cargo.toml)
════════════════════════════════════════ */
const APP_VERSION = "1.0.0";
(function wireAbout() {
  const vEl = document.getElementById("about-version");
  if (vEl) vEl.textContent = `Japtrack ${APP_VERSION}`;
  const pathEl = document.getElementById("about-datapath");
  const openBtn = document.getElementById("about-open-folder");
  const inTauri = !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
  if (inTauri && typeof Store?.filePath === "function") {
    Promise.resolve(Store.filePath()).then(p => {
      if (p && pathEl) pathEl.textContent = p;
      if (p && openBtn) openBtn.style.display = "";
    }).catch(() => {});
  }
  if (openBtn) openBtn.addEventListener("click", async () => {
    const p = pathEl ? pathEl.textContent : "";
    // Prefer the native folder-reveal command; fall back to copying the path.
    try {
      const t = window.__TAURI__;
      const inv = (t && ((t.core && t.core.invoke) || t.invoke));
      if (inv) { await inv("reveal_data_dir"); return; }
      throw new Error("no invoke");
    } catch {
      try {
        await navigator.clipboard.writeText(p);
        showToast("Data file path copied — paste into your file manager");
      } catch { showToast(p); }
    }
  });
  const upBtn = document.getElementById("about-check-updates");
  if (upBtn) upBtn.addEventListener("click", () => {
    showToast(`You're on Japtrack ${APP_VERSION}. Updates ship as a new installer — re-run it to upgrade; your data file is untouched.`);
  });
  const diagBtn = document.getElementById("about-run-diag");
  if (diagBtn) diagBtn.addEventListener("click", runDataDiagnostics);
})();

/* ════════════════════════════════════════
   DATA-LAYER DIAGNOSTICS  (read-only — never mutates the live store)
   Runs in the real WebView engine the app ships with. Guards the
   invariants that, if broken, would corrupt or lose other users' data.
════════════════════════════════════════ */
function runDataDiagnostics() {
  const out = document.getElementById("diag-out");
  const results = [];
  const check = (name, fn) => {
    try {
      const r = fn();
      results.push({ name, ok: r === true, detail: r === true ? "" : String(r) });
    } catch (e) {
      results.push({ name, ok: false, detail: (e && e.message) || String(e) });
    }
  };
  const keysOf = o => Object.keys(o).sort().join(",");

  // 1 — _emptyStore() shape + version
  check("_emptyStore has all keys + correct version", () => {
    const e = _emptyStore();
    if (e.version !== STORE_SCHEMA) return `version ${e.version} ≠ STORE_SCHEMA ${STORE_SCHEMA}`;
    for (const k of ["txns","settings","nwEntries","budgets","recurring","goals","holidays","forecast","plans","allocPlan"]) {
      if (!(k in e)) return `missing key: ${k}`;
    }
    for (const k of ["txns","nwEntries","budgets","recurring","goals","holidays","forecast","plans","allocPlan"]) {
      if (!Array.isArray(e[k])) return `${k} is not an array`;
    }
    return true;
  });

  // 2 — _migrate backfills + stamps an untagged store
  check("_migrate backfills missing keys + stamps version", () => {
    const m = _migrate({ txns: [{ id: 1 }] });
    if (m.version !== STORE_SCHEMA) return `version not stamped (got ${m.version})`;
    if (keysOf(m) !== keysOf(_emptyStore())) return `key set differs: ${keysOf(m)}`;
    if (!Array.isArray(m.budgets) || m.budgets.length !== 0) return "budgets not backfilled";
    if (m.txns.length !== 1) return "existing data lost during migrate";
    return true;
  });

  // 3 — _migrate runs the ordered chain from version 0 without data loss
  check("_migrate version 0 → STORE_SCHEMA preserves data", () => {
    const seed = { version: 0, txns: [{ id: 9, amount: 5 }], settings: { name: "X" } };
    const m = _migrate(JSON.parse(JSON.stringify(seed)));
    if (m.version !== STORE_SCHEMA) return `did not reach STORE_SCHEMA (got ${m.version})`;
    if (m.txns[0].id !== 9 || m.settings.name !== "X") return "data mutated unexpectedly";
    return true;
  });

  // 4 — exportAll round-trips losslessly through JSON (no key/precision loss)
  check("Store.exportAll JSON round-trips losslessly", () => {
    const a = Store.exportAll();
    const b = JSON.parse(JSON.stringify(a));
    if (keysOf(a) !== keysOf(b)) return "key set changed across JSON round-trip";
    for (const k of Object.keys(_emptyStore())) if (!(k in a)) return `export missing key: ${k}`;
    if (typeof a.version !== "number") return "export has no numeric version";
    return true;
  });

  // 5 — isRestorableBackup accepts valid shapes, rejects junk
  check("isRestorableBackup accepts valid / rejects invalid", () => {
    if (typeof isRestorableBackup !== "function") return "isRestorableBackup not defined";
    const good = [
      { backupMarker: "japtrack-backup" },
      { app: "Japtrack" }, { app: "ledger" },
      { version: 1, txns: [] },
      { fin_txns: [] },
    ];
    const bad = [ null, undefined, 42, "str", {}, { foo: 1 }, { version: 1 } /* no txns */ ];
    for (const g of good) if (!isRestorableBackup(g)) return `wrongly rejected: ${JSON.stringify(g)}`;
    for (const b of bad) if (isRestorableBackup(b)) return `wrongly accepted: ${JSON.stringify(b)}`;
    return true;
  });

  // 6 — auditDataIntegrity contract: shape + total === sum of components
  check("auditDataIntegrity returns a consistent contract", () => {
    const a = auditDataIntegrity();
    for (const k of ["dupCats","dupAccts","orphanCats","orphanAccts","warnings"]) {
      if (!Array.isArray(a[k])) return `${k} is not an array`;
    }
    if (typeof a.uncategorised !== "number") return "uncategorised not a number";
    if (typeof a.total !== "number") return "total not a number";
    const expected = a.dupCats.length + a.dupAccts.length + a.orphanCats.length +
                     a.orphanAccts.length + (a.uncategorised > 0 ? 1 : 0) + (a.warningCount || 0);
    if (a.total !== expected) return `total ${a.total} ≠ recomputed ${expected}`;
    return true;
  });

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  if (out) {
    out.innerHTML = results.map(r =>
      `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12.5px;padding:3px 0">
        <span style="color:${r.ok ? "var(--pos)" : "var(--neg)"};font-weight:600">${r.ok ? "✓" : "✗"}</span>
        <span style="color:var(--ink-2)">${r.name}${r.detail ? ` — <span style="color:var(--neg)">${r.detail}</span>` : ""}</span>
      </div>`).join("") +
      `<div style="margin-top:6px;font-size:12px;color:${fail ? "var(--neg)" : "var(--pos)"};font-weight:600">${pass}/${results.length} checks passed</div>`;
  }
  showToast(fail ? `Diagnostics: ${fail} check${fail === 1 ? "" : "s"} FAILED` : `Diagnostics: all ${pass} checks passed`);
}

/* ════════════════════════════════════════
   APP LOCK (PIN)
   Only a salted SHA-256 hash of the PIN is stored — never the PIN itself.
   The overlay is opaque so data is never visible while locked.
════════════════════════════════════════ */
// _appUnlocked / _idleTimer are declared up in the INIT block — they must exist
// before the hoisted initAppLock() call runs (see the note there). Declaring
// them here with `let` would also be a duplicate-declaration SyntaxError.

function _randSalt() {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function _pinHash(pin, salt) {
  const data = new TextEncoder().encode(String(salt) + ":" + String(pin));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function lockApp() {
  if (!getSettings().pinHash) return;       // nothing to lock with
  _appUnlocked = false;
  clearTimeout(_idleTimer);
  const ls = document.getElementById("lock-screen");
  const inp = document.getElementById("lock-pin");
  const err = document.getElementById("lock-err");
  if (err) err.textContent = "";
  if (inp) inp.value = "";
  if (ls) { ls.hidden = false; setTimeout(() => inp && inp.focus(), 50); }
}

async function _attemptUnlock() {
  const s = getSettings();
  const inp = document.getElementById("lock-pin");
  const err = document.getElementById("lock-err");
  if (!inp) return;
  const h = await _pinHash(inp.value, s.pinSalt || "");
  if (h === s.pinHash) {
    _appUnlocked = true;
    const ls = document.getElementById("lock-screen"); if (ls) ls.hidden = true;
    if (err) err.textContent = "";
    inp.value = "";
    _armIdle();
  } else {
    if (err) err.textContent = "Incorrect PIN";
    inp.value = ""; inp.focus();
  }
}

function _armIdle() {
  clearTimeout(_idleTimer);
  const s = getSettings();
  const mins = +(s.autoLockMin || 0);
  if (!mins || !s.pinHash || !_appUnlocked) return;
  _idleTimer = setTimeout(lockApp, mins * 60000);
}
["mousemove", "keydown", "click", "wheel", "touchstart"].forEach(ev =>
  window.addEventListener(ev, () => { if (_appUnlocked) _armIdle(); }, { passive: true }));

function initAppLock() {
  if (getSettings().pinHash) lockApp();
  else _appUnlocked = true;
  const ub = document.getElementById("lock-unlock");
  const pin = document.getElementById("lock-pin");
  const fg = document.getElementById("lock-forgot");
  if (ub) ub.addEventListener("click", _attemptUnlock);
  if (pin) pin.addEventListener("keydown", e => { if (e.key === "Enter") _attemptUnlock(); });
  if (fg) fg.addEventListener("click", () => {
    confirmDialog({
      title: "Forgot PIN?",
      message: "There is no PIN recovery. To regain access you must erase all data on this device. If you have a backup file you can restore it afterwards from Settings → Import & Export.",
      confirmLabel: "Erase all data",
      danger: true,
    }, () => { Store.resetAll(); location.reload(); });
  });
  refreshPinSettingsUI();
}

function refreshPinSettingsUI() {
  const s = getSettings(); const has = !!s.pinHash;
  const st  = document.getElementById("set-pin-state");
  const setB = document.getElementById("set-pin-set");
  const rmB = document.getElementById("set-pin-remove");
  const row = document.getElementById("set-autolock-row");
  const al  = document.getElementById("set-autolock");
  if (st)  st.textContent  = has ? "PIN is set" : "PIN not set";
  if (setB) setB.textContent = has ? "Change PIN" : "Set PIN";
  if (rmB) rmB.style.display = has ? "" : "none";
  if (row) row.style.display = has ? "" : "none";
  if (al)  al.value = String(s.autoLockMin || 0);
}

// Uses the app's proven promptDialog/confirmDialog (#prompt-modal / #confirm-modal)
// rather than a bespoke modal — same dialog system used everywhere else.
function openPinModal() {
  const s = getSettings();
  const save = async (np) => {
    const salt = _randSalt();
    s.pinSalt = salt;
    s.pinHash = await _pinHash(np, salt);
    if (s.autoLockMin == null) s.autoLockMin = 5;   // sensible default once a PIN exists
    lsSet("fin_settings", s);
    refreshPinSettingsUI();
    _armIdle();
    showToast("PIN saved");
  };
  const askNew = () => {
    promptDialog({
      title: s.pinHash ? "Change PIN" : "Set a PIN",
      message: "Choose a 4–6 digit PIN. Only a salted hash is stored — there is no recovery if you forget it (keep a backup).",
      placeholder: "4–6 digits", confirmLabel: "Next",
    }, (np) => {
      if (!/^\d{4,6}$/.test(np)) { showToast("PIN must be 4–6 digits"); return; }
      promptDialog({
        title: "Confirm PIN",
        message: "Re-enter the same PIN to confirm.",
        placeholder: "Repeat PIN", confirmLabel: "Save PIN",
      }, (cf) => {
        if (cf !== np) { showToast("PINs didn't match — try again"); return; }
        save(np);
      });
    });
  };
  if (s.pinHash) {
    promptDialog({
      title: "Verify current PIN",
      message: "Enter your current PIN to change it.",
      placeholder: "Current PIN", confirmLabel: "Verify",
    }, async (cur) => {
      const ch = await _pinHash(cur, s.pinSalt || "");
      if (ch !== s.pinHash) { showToast("Current PIN is incorrect"); return; }
      askNew();
    });
  } else {
    askNew();
  }
}
async function _savePin() {
  const s = getSettings();
  const err = document.getElementById("pin-err");
  const cur = document.getElementById("pin-cur").value;
  const np  = document.getElementById("pin-new").value;
  const cf  = document.getElementById("pin-confirm").value;
  if (s.pinHash) {
    const ch = await _pinHash(cur, s.pinSalt || "");
    if (ch !== s.pinHash) { err.textContent = "Current PIN is incorrect"; return; }
  }
  if (!/^\d{4,6}$/.test(np)) { err.textContent = "PIN must be 4–6 digits"; return; }
  if (np !== cf) { err.textContent = "PINs don't match"; return; }
  const salt = _randSalt();
  s.pinSalt = salt;
  s.pinHash = await _pinHash(np, salt);
  if (s.autoLockMin == null) s.autoLockMin = 5;   // sensible default once a PIN exists
  lsSet("fin_settings", s);
  document.getElementById("pin-modal").hidden = true;
  refreshPinSettingsUI();
  _armIdle();
  showToast("PIN saved");
}

(function wireAppLock() {
  const setB = document.getElementById("set-pin-set");
  const rmB  = document.getElementById("set-pin-remove");
  const al   = document.getElementById("set-autolock");
  const save = document.getElementById("pin-save");
  const cancel = document.getElementById("pin-cancel");
  if (setB) setB.addEventListener("click", openPinModal);
  if (save) save.addEventListener("click", _savePin);
  if (cancel) cancel.addEventListener("click", () => { document.getElementById("pin-modal").hidden = true; });
  if (al) al.addEventListener("change", e => {
    const s = getSettings(); s.autoLockMin = +e.target.value || 0; lsSet("fin_settings", s);
    _armIdle();
    showToast(+e.target.value ? `Auto-lock after ${e.target.value} min` : "Auto-lock off");
  });
  if (rmB) rmB.addEventListener("click", () => {
    confirmDialog({
      title: "Remove PIN?",
      message: "The app will no longer lock. Anyone with access to this device can open it.",
      confirmLabel: "Remove PIN",
      danger: true,
    }, () => {
      const s = getSettings(); delete s.pinHash; delete s.pinSalt; lsSet("fin_settings", s);
      _appUnlocked = true;
      refreshPinSettingsUI();
      showToast("PIN removed");
    });
  });
})();

/* ════════════════════════════════════════
   FIRST-RUN ONBOARDING
════════════════════════════════════════ */
let _onbSeed = "empty";

function maybeShowOnboarding() {
  const s = getSettings();
  if (s.onboarded) return;
  // Existing users (pre-onboarding builds) already have data — don't nag them.
  const hasData = (getTxns().length || getNWEntries().length || getBudgets().length ||
                   getRecurring().length || getGoals().length || (s.name && s.name.trim()));
  if (hasData) { s.onboarded = true; lsSet("fin_settings", s); return; }
  const modal = document.getElementById("onboard-modal");
  if (!modal) return;
  _onbSeed = "empty";
  modal.hidden = false;
  setTimeout(() => { const n = document.getElementById("onb-name"); if (n) n.focus(); }, 60);
}

(function wireOnboarding() {
  const seg = document.getElementById("onb-seed-seg");
  if (seg) seg.addEventListener("click", e => {
    const b = e.target.closest("[data-seed]"); if (!b) return;
    _onbSeed = b.dataset.seed;
    seg.querySelectorAll("[data-seed]").forEach(x => x.setAttribute("aria-pressed", x === b));
  });
  const start = document.getElementById("onb-start");
  if (start) start.addEventListener("click", () => {
    const s = getSettings();
    const name = (document.getElementById("onb-name").value || "").trim();
    const cur  = document.getElementById("onb-currency").value || "GBP";
    if (name) s.name = name;
    s.currency = cur;                 // stored now; wired into formatting in a later pass
    s.onboarded = true;
    lsSet("fin_settings", s);
    if (_onbSeed === "sample") generateSampleData();
    document.getElementById("onboard-modal").hidden = true;
    if (typeof applySidebarProfile === "function") applySidebarProfile();
    rebuildCatBy();
    rebuildNWCats();
    if (typeof syncAccountsFromAllSources === "function") syncAccountsFromAllSources();
    renderAll();
    showToast(_onbSeed === "sample" ? "Sample data loaded" : "You're all set");
  });
})();

// Generate ~3 months of realistic example data so a new user lands on a populated app.
function generateSampleData() {
  const accounts = ["Current Account", "Savings", "Credit Card"];
  const s = getSettings();
  s.accounts = Array.from(new Set([...(s.accounts || []), ...accounts]));
  lsSet("fin_settings", s);

  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  const uid = () => Date.now() + Math.floor(Math.random() * 1e6);
  const txns = getTxns();
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const around = (base, pct) => Math.round(base * (1 + (Math.random() * 2 - 1) * pct));

  for (let mAgo = 2; mAgo >= 0; mAgo--) {
    const y = today.getFullYear(), m = today.getMonth() - mAgo;
    const monthEnd = new Date(y, m + 1, 0).getDate();
    const day = d => iso(new Date(y, m, Math.min(d, monthEnd)));

    // Income
    txns.push({ id: uid(), type: "in", amount: 2850, date: day(28), description: "Monthly Salary", account: "Current Account", category: "Salary" });
    // Fixed costs
    txns.push({ id: uid(), type: "out", amount: 1100, date: day(1),  description: "Rent", account: "Current Account", category: "Housing" });
    txns.push({ id: uid(), type: "out", amount: around(95, 0.1), date: day(3), description: "Mobile + Broadband", account: "Current Account", category: "Subscriptions" });
    txns.push({ id: uid(), type: "out", amount: 15.99, date: day(5), description: "Netflix", account: "Credit Card", category: "Subscriptions" });
    txns.push({ id: uid(), type: "out", amount: around(60, 0.15), date: day(8), description: "Energy Bill", account: "Current Account", category: "Housing" });
    // Variable spend
    const groceryStores = ["Tesco", "Sainsbury's", "Aldi", "Lidl"];
    const eateries = ["Pret", "Nando's", "Local Pub", "Sushi Bar", "Coffee House"];
    for (let w = 0; w < 4; w++) {
      txns.push({ id: uid(), type: "out", amount: around(48, 0.25), date: day(2 + w * 7), description: pick(groceryStores), account: "Current Account", category: "Groceries" });
      txns.push({ id: uid(), type: "out", amount: around(22, 0.4),  date: day(5 + w * 7), description: pick(eateries),     account: "Credit Card",   category: "Dining" });
    }
    txns.push({ id: uid(), type: "out", amount: around(40, 0.3), date: day(12), description: "Train Pass", account: "Current Account", category: "Transport" });
    txns.push({ id: uid(), type: "out", amount: around(35, 0.5), date: day(18), description: pick(["Cinema", "Concert", "Bowling"]), account: "Credit Card", category: "Entertainment" });
    txns.push({ id: uid(), type: "out", amount: around(55, 0.6), date: day(22), description: pick(["Zara", "Uniqlo", "ASOS"]), account: "Credit Card", category: "Clothing" });
    // Move money to savings
    txns.push({ id: uid(), type: "transfer", amount: 400, date: day(28), description: "Monthly saving", fromAccount: "Current Account", toAccount: "Savings" });
    // Pay off the card
    txns.push({ id: uid(), type: "transfer", amount: around(180, 0.2), date: day(27), description: "Credit card payment", fromAccount: "Current Account", toAccount: "Credit Card" });
  }
  lsSet("fin_txns", txns);

  // A couple of budgets
  const budgets = getBudgets();
  if (!budgets.length) {
    budgets.push({ id: "Groceries", category: "Groceries", type: "out", amount: 250 });
    budgets.push({ id: "Dining", category: "Dining", type: "out", amount: 150 });
    budgets.push({ id: "Entertainment", category: "Entertainment", type: "out", amount: 80 });
    lsSet("fin_budgets", budgets);
  }

  // One net-worth snapshot for the current month
  const nw = getNWEntries();
  if (!nw.length) {
    const mk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    nw.push({
      id: uid(),
      month: mk,
      allocations: [
        { cat: "Current Account", value: 1850 },
        { cat: "Savings", value: 6200 },
        { cat: "Credit Card", value: -240 },
      ],
    });
    lsSet("fin_nw_entries", nw);
  }
}

// PWA install prompt removed — irrelevant inside Tauri (the app is already installed natively).
