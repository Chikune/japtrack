let _privacy    = false;
let _dark       = localStorage.getItem("ledger_theme") === "dark";
let _range      = "1Y";
let _bucketFilter = "all";
let _txType     = "all";
let _txAcc      = "all";
let _search     = "";
let _activePop  = null;

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let _viewMonth = (() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; })();

function monthKey(y, m) { return `${y}-${String(m+1).padStart(2,"0")}`; }
function monthKeyStr(s) { const d = new Date(s+"T00:00:00"); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function monthLabel(y, m) { return `${MONTHS[m]} ${y}`; }
function prevMonth(y, m) { return m === 0 ? [y-1, 11] : [y, m-1]; }
// Supported display currencies. symbol = prefix glyph, locale = grouping/decimal rules.
const CURRENCIES = {
  GBP: { symbol: "£", locale: "en-GB" },
  USD: { symbol: "$", locale: "en-US" },
  EUR: { symbol: "€", locale: "de-DE" },
  CAD: { symbol: "$", locale: "en-CA" },
  AUD: { symbol: "$", locale: "en-AU" },
  JPY: { symbol: "¥", locale: "ja-JP" },
  INR: { symbol: "₹", locale: "en-IN" },
};
// Resolve the active currency from settings; default GBP so existing data is unchanged.
function activeCurrency() {
  let code = "GBP";
  try { code = (getSettings().currency || "GBP"); } catch {}
  return CURRENCIES[code] || CURRENCIES.GBP;
}

// Currency-aware money formatter. Name kept as fmtGBP for the many existing
// call sites; fmtMoney is a clearer alias for new code.
function fmtGBP(n, opts = {}) {
  const { sign = false, dp = 2, minDp = dp, compact = false } = opts;
  const cur = activeCurrency();
  const abs = Math.abs(n);
  let str;
  if (compact && abs >= 1000) {
    str = abs >= 1e6 ? (abs/1e6).toFixed(2)+"M" : abs >= 1e4 ? (abs/1e3).toFixed(1)+"k" : (abs/1e3).toFixed(2)+"k";
  } else {
    str = abs.toLocaleString(cur.locale, { minimumFractionDigits: minDp, maximumFractionDigits: dp });
  }
  const pre = n < 0 ? `−${cur.symbol}` : (sign ? `+${cur.symbol}` : cur.symbol);
  return pre + str;
}
const fmtMoney = fmtGBP;
// Bare active-currency symbol, for the few hand-built `£`-prefixed strings.
function curSym() { return activeCurrency().symbol; }

// One consistent in-card empty state. Pass inner HTML (text, optional <a> CTA);
// the wrapper styling (muted, centered, uniform padding) is unified here.
function cardEmpty(html) {
  return `<div class="empty-note">${html}</div>`;
}

// Minimal inline sparkline — one <polyline> in a non-scaling SVG. No library,
// no listeners. Returns "" for <2 finite points so callers can `|| ""`.
function sparkline(values, opts = {}) {
  const v = (values || []).filter(n => typeof n === "number" && isFinite(n));
  if (v.length < 2) return "";
  const { w = 64, h = 20, stroke = "var(--ink-3)", fill = "none", strokeWidth = 1.5 } = opts;
  const min = Math.min(...v), max = Math.max(...v);
  const span = (max - min) || 1;
  const n = v.length;
  const pts = v.map((d, i) => {
    const x = (i / (n - 1)) * w;
    const y = h - ((d - min) / span) * (h - 2) - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const area = fill !== "none"
    ? `<polygon points="0,${h} ${pts} ${w},${h}" fill="${fill}" stroke="none"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${area}<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

// Settings-aware date formatter. Accepts a Date, an ISO "YYYY-MM-DD" string,
// or a full date string. mode: "short" (no year unless given) | "full".
const _MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function dateFmtPref() { try { return getSettings().dateFormat || "DMY"; } catch { return "DMY"; } }
function weekStartPref() { try { const v = getSettings().weekStart; return v == null ? 1 : +v; } catch { return 1; } }
function fmtDate(d, opts = {}) {
  const { withYear = false } = opts;
  const dt = (d instanceof Date) ? d : new Date(String(d).length <= 10 ? d + "T00:00:00" : d);
  if (isNaN(dt)) return "—";
  const day = dt.getDate(), mon = dt.getMonth(), yr = dt.getFullYear();
  const fmt = dateFmtPref();
  if (fmt === "ISO") return `${yr}-${String(mon+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  if (fmt === "MDY") return withYear ? `${_MON3[mon]} ${day}, ${yr}` : `${_MON3[mon]} ${day}`;
  return withYear ? `${day} ${_MON3[mon]} ${yr}` : `${day} ${_MON3[mon]}`;   // DMY default
}

// Splits — a transaction may carry `splits: [{category, amount}]` instead of a single category.
// txCategoryEntries fans out a tx into one entry per category for aggregation.
function isSplit(t) { return Array.isArray(t.splits) && t.splits.length > 0; }
function txCategoryEntries(t) {
  if (isSplit(t)) return t.splits.map(s => ({ category: s.category, amount: s.amount }));
  return [{ category: t.category, amount: t.amount }];
}

function normType(t) {
  const r = (t.type||"out").toLowerCase();
  if (r==="in"||r==="income") return "in";
  if (r==="transfer")          return "transfer";
  return "out";
}

function showToast(msg) {
  const el = document.getElementById("toast-el");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el._tid);
  el._tid = setTimeout(() => { el.style.display = "none"; }, 1800);
}

function applyPrivacy() {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("privacy", _privacy));
  const icon = document.getElementById("privacy-icon");
  icon.innerHTML = _privacy
    ? `<path d="M3 3l18 18M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2"/><path d="M9.5 5.6A10 10 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1"/><path d="M6.5 6.5A18 18 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1"/>`
    : `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`;
}

function applyTheme() {
  document.documentElement.dataset.theme = _dark ? "dark" : "light";
  localStorage.setItem("ledger_theme", _dark ? "dark" : "light");
  // Auto-mode brand icon flips with the theme — re-apply.
  if (typeof getSettings === "function") {
    const s = getSettings();
    if ((s.iconVariant || "auto") === "auto") applyIconVariant("auto");
  }
}

function applyAccent(hex) {
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--accent-ink");
    return;
  }
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-soft", `color-mix(in oklch, ${hex} 18%, var(--bg))`);
  root.style.setProperty("--accent-ink",  `color-mix(in oklch, ${hex} 70%, var(--ink))`);
}

function applyPosColor(hex) {
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty("--pos");
    root.style.removeProperty("--pos-soft");
    return;
  }
  root.style.setProperty("--pos", hex);
  root.style.setProperty("--pos-soft", `color-mix(in oklch, ${hex} 14%, var(--bg))`);
}

function applyNegColor(hex) {
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty("--neg");
    root.style.removeProperty("--neg-soft");
    return;
  }
  root.style.setProperty("--neg", hex);
  root.style.setProperty("--neg-soft", `color-mix(in oklch, ${hex} 14%, var(--bg))`);
}

function applyRadius(px) {
  document.documentElement.style.setProperty("--radius", px + "px");
}

// Sets the brand mark image based on the chosen icon variant.
// Variants: "auto" (matches theme), "dark", "light", "amber".
function applyIconVariant(variant) {
  const v = variant || "auto";
  let pick = v;
  if (v === "auto") pick = (document.documentElement.dataset.theme === "dark") ? "light" : "dark";
  const src = `./assets/logos/icon-${pick}.svg`;
  document.querySelectorAll(".brand-mark-img").forEach(el => { el.src = src; });
}

function avatarInner() {
  const s = getSettings();
  if (s.avatarDataUrl) return `<img src="${s.avatarDataUrl}" alt="">`;
  if (s.avatarEmoji) return s.avatarEmoji;
  return ((s.name||"U")[0]||"U").toUpperCase();
}
function applySidebarProfile() {
  const s = getSettings();
  document.getElementById("me-name").textContent = s.name || "User";
  const sub = document.getElementById("me-sub");
  if (sub) sub.textContent = `Personal · ${s.currency || "GBP"}`;
  const card = document.getElementById("me-card");
  if (card) card.setAttribute("data-tooltip", (s.name || "User") + " · profile");
  const av = document.getElementById("me-av");
  if (av) {
    av.innerHTML = avatarInner();
    if (s.avatarDataUrl) { av.style.background = "transparent"; }
    else { av.style.background = ""; }
  }
}

/* ════════════════════════════════════════
   MONTH PICKER
════════════════════════════════════════ */
function updateMonthLabel() {
  document.getElementById("month-label").textContent = monthLabel(_viewMonth.y, _viewMonth.m);
}
document.getElementById("month-prev").addEventListener("click", () => {
  const [y, m] = prevMonth(_viewMonth.y, _viewMonth.m);
  _viewMonth = { y, m };
  updateMonthLabel();
  renderAll();
});
document.getElementById("month-next").addEventListener("click", () => {
  let { y, m } = _viewMonth;
  m++; if (m > 11) { m = 0; y++; }
  _viewMonth = { y, m };
  updateMonthLabel();
  renderAll();
});

/* ════════════════════════════════════════
   GREETING + DATELINE
════════════════════════════════════════ */
function renderGreeting() {
  const h = new Date().getHours();
  const gr = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const s = getSettings();
  // First name only (anything before first space) so "Joshua Smith" → "Joshua".
  const name = (s.name || "").trim().split(/\s+/)[0];
  const greetEl = document.getElementById("greeting");
  if (greetEl) greetEl.textContent = name ? `${gr}, ${name}.` : `${gr}.`;
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months2 = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const now = new Date();
  const dateEl = document.getElementById("dateline");
  if (dateEl) dateEl.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months2[now.getMonth()]}`;
}

/* ════════════════════════════════════════
   MONTH STATS HELPER
════════════════════════════════════════ */
// Spending-by-category that nets refunds (income-typed txns tagged with an
// expense category) against the expense bucket. Mirrors the dashboard pattern
// at dashboard.js:985-986 so refunds zero out their original category
// everywhere it's aggregated.
function _expCatSet() {
  return new Set((typeof getAllCats === "function" ? getAllCats("exp") : []).map(c => c.id));
}
function netSpendByCategory(txns, expCatSet) {
  expCatSet = expCatSet || _expCatSet();
  const map = {};
  txns.forEach(t => {
    if (typeof isRefundLeg === "function" && isRefundLeg(t)) return; // paired refunds net to zero — excluded
    const ty = normType(t);
    if (ty === "out") txCategoryEntries(t).forEach(e => { map[e.category] = (map[e.category]||0) + e.amount; });
    else if (ty === "in" && expCatSet.has(t.category)) map[t.category] = (map[t.category]||0) - t.amount;
  });
  return map;
}
// Sum of "refund-like" income inside a set — money that cancels prior spending and
// should reduce your real spend figure. Two cases:
//   1) income tagged with an EXPENSE category (e.g. friend repaid your "Clothing")
//   2) income in the dedicated "Reimbursement" category (work expenses paid back, etc.)
// Both feed netSpent so the dashboard shows what you ACTUALLY spent after money back.
function refundsTotal(txns, expCatSet) {
  expCatSet = expCatSet || _expCatSet();
  return txns
    .filter(t => normType(t) === "in" && (expCatSet.has(t.category) || t.category === "Reimbursement"))
    .reduce((s,t)=>s+t.amount, 0);
}

function mStat(txns, y, m) {
  const key = monthKey(y, m);
  // Exclude paired-refund legs (hidden Refunds category): both sides net to zero,
  // so they must not inflate spending OR income anywhere downstream.
  const mt  = txns.filter(t => monthKeyStr(t.date) === key && !(typeof isRefundLeg === "function" && isRefundLeg(t)));
  const expSet = _expCatSet();
  const spent = mt.filter(t => normType(t) === "out").reduce((s,t)=>s+t.amount,0);
  const refunds = refundsTotal(mt, expSet);
  return {
    income:   mt.filter(t => normType(t) === "in").reduce((s,t)=>s+t.amount,0),
    spent,
    refunds,
    netSpent: Math.max(0, spent - refunds),
    invested: mt.filter(t => normType(t) === "transfer").reduce((s,t)=>s+t.amount,0),
    txns:     mt
  };
}

// Stats over an inclusive YYYY-MM range. End defaults to current month.
// Used by the dashboard summary KPIs ("since X" totals).
function rangeStat(txns, startYM, endYM) {
  if (!endYM) {
    const n = new Date();
    endYM = monthKey(n.getFullYear(), n.getMonth());
  }
  if (!startYM) startYM = endYM;
  const within = txns.filter(t => {
    if (typeof isRefundLeg === "function" && isRefundLeg(t)) return false; // paired refunds excluded
    const k = monthKeyStr(t.date);
    return k && k >= startYM && k <= endYM;
  });
  const [sy, sm] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  const months = Math.max(1, (ey * 12 + em) - (sy * 12 + sm) + 1);
  const expSet = _expCatSet();
  const spent = within.filter(t => normType(t) === "out").reduce((s,t)=>s+t.amount,0);
  const refunds = refundsTotal(within, expSet);
  return {
    income:   within.filter(t => normType(t) === "in").reduce((s,t)=>s+t.amount,0),
    spent,
    refunds,
    netSpent: Math.max(0, spent - refunds),
    invested: within.filter(t => normType(t) === "transfer").reduce((s,t)=>s+t.amount,0),
    txns:     within,
    months, startYM, endYM,
  };
}

// Default stats-start = earliest tx month if it's within the last year, else 12 months ago.
function defaultStatsStart() {
  const months = getTxns().map(t => monthKeyStr(t.date)).filter(Boolean).sort();
  const earliest = months[0];
  const n = new Date();
  const yearAgo = monthKey(n.getFullYear() - 1, n.getMonth());
  return earliest && earliest > yearAgo ? earliest : yearAgo;
}
function getStatsStart() {
  return getSettings().statsStart || defaultStatsStart();
}
function ymLabel(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return monthLabel(y, m - 1);
}

/* ════════════════════════════════════════
   CONFIRM DIALOG — drop-in replacement for window.confirm()
   Usage: confirmDialog("Delete this?", () => { ...delete... })
          confirmDialog({ title, message, confirmLabel, cancelLabel, danger }, onConfirm)
════════════════════════════════════════ */
function confirmDialog(opts, onConfirm) {
  if (typeof opts === "string") opts = { message: opts };
  // Optional: opts.onCancel runs when the user picks the cancel button (not on
  // backdrop/Escape dismiss). Lets a dialog offer two real choices.
  const onCancel = opts.onCancel;
  const m = document.getElementById("confirm-modal");
  if (!m) { if (window.confirm(opts.message || "Are you sure?")) onConfirm && onConfirm(); else onCancel && onCancel(); return; }
  const titleEl = document.getElementById("confirm-title");
  const msgEl = document.getElementById("confirm-msg");
  const ok = document.getElementById("confirm-ok");
  const cancel = document.getElementById("confirm-cancel");
  titleEl.textContent = opts.title || "Are you sure?";
  msgEl.textContent = opts.message || "";
  ok.textContent = opts.confirmLabel || "Confirm";
  ok.className = opts.danger === false ? "btn-primary" : "btn-danger";
  cancel.textContent = opts.cancelLabel || "Cancel";
  m.hidden = false;
  setTimeout(() => ok.focus(), 30);
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); cleanup(); }
    else if (e.key === "Enter") { e.preventDefault(); cleanup(); onConfirm && onConfirm(); }
  };
  const onBackdrop = (e) => { if (e.target === m) cleanup(); };
  const cleanup = () => {
    m.hidden = true;
    ok.onclick = null; cancel.onclick = null; m.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onKey);
  };
  ok.onclick = () => { cleanup(); onConfirm && onConfirm(); };
  cancel.onclick = () => { cleanup(); onCancel && onCancel(); };
  m.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onKey);
}

/* ════════════════════════════════════════
   PROMPT DIALOG — text-input variant of confirmDialog
   Usage: promptDialog({ title, message, defaultValue, placeholder, confirmLabel }, (value) => {...})
════════════════════════════════════════ */
function promptDialog(opts, onConfirm) {
  if (typeof opts === "string") opts = { message: opts };
  const m = document.getElementById("prompt-modal");
  if (!m) { const v = window.prompt(opts.message || "Enter a value", opts.defaultValue || ""); if (v != null) onConfirm && onConfirm(v); return; }
  document.getElementById("prompt-title").textContent = opts.title || "Enter a value";
  document.getElementById("prompt-msg").textContent = opts.message || "";
  const inp = document.getElementById("prompt-input");
  inp.value = opts.defaultValue || "";
  inp.placeholder = opts.placeholder || "";
  const ok = document.getElementById("prompt-ok");
  const cancel = document.getElementById("prompt-cancel");
  ok.textContent = opts.confirmLabel || "OK";
  cancel.textContent = opts.cancelLabel || "Cancel";
  m.hidden = false;
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
  const cleanup = () => {
    m.hidden = true;
    ok.onclick = null; cancel.onclick = null; m.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); cleanup(); }
    else if (e.key === "Enter" && document.activeElement === inp) { e.preventDefault(); const v = inp.value.trim(); cleanup(); if (v) onConfirm && onConfirm(v); }
  };
  const onBackdrop = (e) => { if (e.target === m) cleanup(); };
  ok.onclick = () => { const v = inp.value.trim(); cleanup(); if (v) onConfirm && onConfirm(v); };
  cancel.onclick = cleanup;
  m.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onKey);
}

/* ════════════════════════════════════════
   HERO NET WORTH — STACKED AREA SVG
════════════════════════════════════════ */
function nwTotal(e) { return e.allocations.reduce((s,a)=>s+a.value,0); }

