/* ════════════════════════════════════════
   TRANSACTIONS TAB
════════════════════════════════════════ */
// "transactions" is the unified view (no type filter); the other three are filtered sub-views.
// The filter value "all" passes through normType() check in applyTxFilters.
const TX_PAGE_TYPES   = { transactions: "all", expenses: "out", income: "in", transfers: "transfer" };
const TX_PAGE_LABELS  = { transactions: "transaction", expenses: "expense", income: "income", transfers: "transfer" };
const TX_PAGE_PLURALS = { transactions: "transactions", expenses: "expenses", income: "income", transfers: "transfers" };
const TX_PAGE_HEADS   = { transactions: "Transactions", expenses: "Expenses", income: "Income", transfers: "Transfers" };
const TX_PAGE_ADDLBL  = { transactions: "Add transaction", expenses: "Add expense", income: "Add income", transfers: "Add transfer" };

let _txAllType = "all"; // set by switchPage; "out"|"in"|"transfer"|"all"
let _txAllRange = "this";
let _txAllAccts = new Set();
let _txAllCats = new Set();
let _txFilterTypes = new Set();
let _txAmountMin = "";
let _txAmountMax = "";
let _txDateFrom = "";
let _txDateTo = "";
let _txAllSearchQ = "";
let _txAllSort = "date-desc";
let _txAllPage = 0;
// The page size actually rendered last (set by renderTxAllTable). In fit-mode this
// differs from _txAllPageSize, so select-all / sync must use THIS to match the view.
let _txEffSize = 25;
// Page size is user-configurable + persisted. "fit" (default) shows just enough rows to
// fill the viewport without scrolling; "all" disables paging.
const _TX_PAGE_SIZE_OPTIONS = ["fit", 25, 50, 100, "all"];
let _txFitMode = false;
let _txAllPageSize = (() => {
  const raw = localStorage.getItem("ledger_tx_pagesize");
  if (raw === null || raw === "fit") { _txFitMode = true; return 25; } // 25 = fallback until measured
  if (raw === "all") return Infinity;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 25;
})();
// Best-effort: how many rows fit inside the FIXED-height scroll region (below the
// sticky header) without scrolling. The box itself no longer resizes to the content —
// it fills the screen — so we measure that fixed area rather than the viewport.
function txFitRows() {
  const wrap = document.querySelector("#page-tx .tx-table-scroll");
  if (!wrap) return 20;
  const avail = wrap.clientHeight;
  if (avail <= 0) return 20; // page not laid out / not visible yet
  const thead = wrap.querySelector("thead");
  const headH = thead ? thead.getBoundingClientRect().height : 34;
  const ROW_PITCH = 44; // fixed uniform row height (keep in sync with the td height in CSS)
  return Math.max(6, Math.floor((avail - headH) / ROW_PITCH));
}
function setTxPageSize(v) {
  if (v === "fit") { _txFitMode = true; localStorage.setItem("ledger_tx_pagesize", "fit"); }
  else if (v === "all") { _txFitMode = false; _txAllPageSize = Infinity; localStorage.setItem("ledger_tx_pagesize", "all"); }
  else {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    _txFitMode = false; _txAllPageSize = n;
    localStorage.setItem("ledger_tx_pagesize", String(n));
  }
  _txAllPage = 0;
  renderTxAllTable(applyTxFilters());
}
let _txSelected = new Set();
// Edit mode (off by default): when on, the checkbox + actions columns appear and the
// Edit button turns red. Off → those columns hide and the data columns spread to fill.
let _txEditMode = false;
let _txEditId = null;
let _txModalType = "out";
let _activeTxPop = null;

// Case-insensitive dedupe — picks the casing defined in settings first, otherwise the first observed casing.
// This is defensive: data may still hold duplicates until the user resolves them via the integrity audit.
function _dedupeIciSorted(items, canonicalPriority = []) {
  const priority = new Set(canonicalPriority);
  const byKey = new Map();
  items.filter(Boolean).forEach(it => {
    const k = String(it).toLowerCase();
    const existing = byKey.get(k);
    if (!existing) { byKey.set(k, it); return; }
    // Prefer canonical (settings-defined) casing
    if (!priority.has(existing) && priority.has(it)) byKey.set(k, it);
  });
  return [...byKey.values()].sort();
}
function getTxAccts() {
  const raw = getTxns().flatMap(t => [t.account, t.fromAccount, t.toAccount].filter(Boolean));
  return _dedupeIciSorted(raw, getSettings().accounts || []);
}
function getTxCats() {
  const raw = getTxns().map(t => t.category).filter(Boolean);
  const canonical = (typeof getAllCats === "function") ? [...getAllCats("exp"), ...getAllCats("in")].map(c => c.id) : [];
  return _dedupeIciSorted(raw, canonical);
}

function applyTxFilters() {
  const all = getTxns();
  const now = new Date();
  let startMs = 0, endMs = Infinity;
  if (_txAllRange === "this") {
    startMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    endMs = new Date(now.getFullYear(), now.getMonth()+1, 1).getTime();
  } else if (_txAllRange === "3M") {
    startMs = new Date(now.getFullYear(), now.getMonth()-3, now.getDate()).getTime();
  } else if (_txAllRange === "6M") {
    startMs = new Date(now.getFullYear(), now.getMonth()-6, now.getDate()).getTime();
  } else if (_txAllRange === "1Y") {
    startMs = new Date(now.getFullYear()-1, now.getMonth(), now.getDate()).getTime();
  }
  let list = all.filter(t => {
    if (!t.date) return _txAllRange === "all";
    const d = new Date(t.date+"T00:00:00").getTime();
    if (d < startMs || d >= endMs) return false;
    if (_txAllType !== "all" && normType(t) !== _txAllType) return false;
    if (_txFilterTypes.size && !_txFilterTypes.has(normType(t))) return false;
    if (_txAllAccts.size && !([t.account, t.fromAccount, t.toAccount].some(a => _txAllAccts.has(a)))) return false;
    if (_txAllCats.size && !_txAllCats.has(t.category)) return false;
    if (_txAmountMin !== "" && Math.abs(t.amount || 0) < parseFloat(_txAmountMin)) return false;
    if (_txAmountMax !== "" && Math.abs(t.amount || 0) > parseFloat(_txAmountMax)) return false;
    if (_txDateFrom && (!t.date || t.date < _txDateFrom)) return false;
    if (_txDateTo && (!t.date || t.date > _txDateTo)) return false;
    if (_txAllSearchQ) {
      const q = _txAllSearchQ.toLowerCase();
      if (![t.description, t.category, t.account, t.fromAccount, t.toAccount, t.notes].some(v => (v||"").toLowerCase().includes(q))) return false;
    }
    return true;
  });
  list.sort((a,b) => {
    if (_txAllSort === "date-desc") return (a.date||"") < (b.date||"") ? 1 : -1;
    if (_txAllSort === "date-asc")  return (a.date||"") > (b.date||"") ? 1 : -1;
    if (_txAllSort === "amount-desc") return (b.amount||0) - (a.amount||0);
    if (_txAllSort === "amount-asc")  return (a.amount||0) - (b.amount||0);
    if (_txAllSort === "merchant") return (a.description||"").localeCompare(b.description||"");
    return 0;
  });
  return list;
}

function renderTxAll() {
  const filtered = applyTxFilters();
  // "all" view counts every transaction; specific tabs count only that type.
  const typeTotal = _txAllType === "all"
    ? getTxns().length
    : getTxns().filter(t => normType(t) === _txAllType).length;
  const plural  = TX_PAGE_PLURALS[_activePage] || "transactions";
  const singular = TX_PAGE_LABELS[_activePage] || "transaction";
  document.getElementById("tx-all-sub").textContent = typeTotal
    ? (filtered.length < typeTotal
        ? `${filtered.length} of ${typeTotal} ${plural} shown`
        : `${typeTotal} ${plural}`)
    : `No ${plural} yet — click ${TX_PAGE_ADDLBL[_activePage] || "Add"} to begin`;
  renderTxActiveChips();
  renderTxAllTable(filtered);
  renderTxFilterControls();
  renderTxBulkBar();
}

function renderTxSummary(filtered) {
  const el = document.getElementById("tx-summary-bar"); if (!el) return;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth()+1, 1).getTime();
  const monthTxns = getTxns().filter(t => {
    if (!t.date) return false;
    const d = new Date(t.date+"T00:00:00").getTime();
    return d >= start && d < end;
  });
  const spent = monthTxns.filter(t => normType(t)==="out").reduce((s,t)=>s+t.amount,0);
  const income = monthTxns.filter(t => normType(t)==="in").reduce((s,t)=>s+t.amount,0);
  const net = income - spent;
  const incomeSeries = txMonthlySeries(6).map(s => s.income);
  const netSeries = txMonthlySeries(6).map(s => s.income - s.spent);
  const SVG = {
    wallet: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19"/><path d="M16 14.5h3"/></svg>`,
    arrow:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>`,
    trend:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 16 9 10 13 14 21 6"/><polyline points="21 11 21 6 16 6"/></svg>`,
    doc:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,
  };
  const cards = [
    { label: "Spent", value: fmtGBP(spent,{dp:0}), cls: "neg", ic: SVG.wallet },
    { label: "Income", value: fmtGBP(income,{dp:0}), cls: "pos", ic: SVG.arrow },
    { label: "Net", value: `${net < 0 ? "-" : ""}${fmtGBP(Math.abs(net),{dp:0})}`, cls: net >= 0 ? "pos" : "neg", ic: SVG.trend },
    { label: "Transactions", value: String(monthTxns.length), cls: "", ic: SVG.doc },
  ];
  el.innerHTML = cards.map(c => `
    <div class="tx-kpi-card">
      <span class="tx-kpi-ic ${c.cls}">${c.ic}</span>
      <div class="tx-kpi-copy">
        <span class="tx-kpi-lab">${c.label}</span>
        <b class="blur ${c.cls}">${c.value}</b>
      </div>
    </div>
  `).join("");
}

function txMonthlySeries(months = 6) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    let y = _viewMonth.y, m = _viewMonth.m - i;
    while (m < 0) { y--; m += 12; }
    const s = mStat(getTxns(), y, m);
    out.push({ income: s.income, spent: s.spent });
  }
  return out;
}
function txSparkBars(values, mode) {
  const max = Math.max(1, ...values.map(v => Math.abs(v)));
  return `<div class="tx-kpi-spark ${mode}" aria-hidden="true">${values.map(v => {
    const h = Math.max(3, Math.round(Math.abs(v) / max * 18));
    const cls = v < 0 ? "neg" : "pos";
    return `<i class="${cls}" style="height:${h}px"></i>`;
  }).join("")}</div>`;
}

function renderTxActiveChips() {
  const el = document.getElementById("tx-active-chips"); if (!el) return;
  const chips = [];
  // Type chip omitted — type is fixed per page
  if (_txAllRange !== "this") chips.push({ label: "Range: " + (_txAllRange==='1Y'?'1Y':_txAllRange==='all'?'All time':_txAllRange), clear: () => { _txAllRange="this"; document.querySelectorAll('#tx-all-range button').forEach(b=>b.setAttribute('aria-pressed', b.dataset.range==='this')); } });
  _txAllAccts.forEach(a => chips.push({ label: "Acct: " + a, clear: () => { _txAllAccts.delete(a); } }));
  _txAllCats.forEach(c => chips.push({ label: "Cat: " + c, clear: () => { _txAllCats.delete(c); } }));
  _txFilterTypes.forEach(t => chips.push({ label: "Type: " + ({out:"Expense", in:"Income", transfer:"Transfer"}[t] || t), clear: () => { _txFilterTypes.delete(t); } }));
  if (_txAmountMin !== "") chips.push({ label: `Min: ${fmtGBP(parseFloat(_txAmountMin)||0,{dp:0})}`, clear: () => { _txAmountMin=""; const inp=document.getElementById('tx-amount-min'); if(inp) inp.value=""; } });
  if (_txAmountMax !== "") chips.push({ label: `Max: ${fmtGBP(parseFloat(_txAmountMax)||0,{dp:0})}`, clear: () => { _txAmountMax=""; const inp=document.getElementById('tx-amount-max'); if(inp) inp.value=""; } });
  if (_txDateFrom) chips.push({ label: "From: " + _txDateFrom, clear: () => { _txDateFrom=""; const inp=document.getElementById('tx-date-from'); if(inp) inp.value=""; } });
  if (_txDateTo) chips.push({ label: "To: " + _txDateTo, clear: () => { _txDateTo=""; const inp=document.getElementById('tx-date-to'); if(inp) inp.value=""; } });
  if (_txAllSearchQ) chips.push({ label: `Search: "${_txAllSearchQ}"`, clear: () => { _txAllSearchQ=""; const inp=document.getElementById('tx-all-search'); if(inp) inp.value=""; } });
  if (!chips.length) { el.innerHTML = ""; return; }
  el.innerHTML = chips.map((c, i) => `<span class="achip">${c.label}<button data-i="${i}" title="Remove">×</button></span>`).join("") + ` <button class="achip" style="background:transparent;cursor:pointer" onclick="clearAllTxFilters()">Clear all</button>`;
  el.querySelectorAll(".achip button[data-i]").forEach(btn => {
    btn.addEventListener("click", () => { chips[+btn.dataset.i].clear(); _txAllPage = 0; renderTxAll(); });
  });
}

function clearAllTxFilters() {
  // _txAllType is locked per page — do not reset it
  _txAllRange = "this"; _txAllAccts.clear(); _txAllCats.clear(); _txFilterTypes.clear(); _txAllSearchQ = "";
  _txAmountMin = ""; _txAmountMax = ""; _txDateFrom = ""; _txDateTo = "";
  document.querySelectorAll('#tx-all-range button').forEach(b => b.setAttribute('aria-pressed', b.dataset.range==='this'));
  const inp = document.getElementById('tx-all-search'); if (inp) inp.value = "";
  const topSearch = document.getElementById('search-inp'); if (topSearch) topSearch.value = "";
  ["tx-amount-min","tx-amount-max","tx-date-from","tx-date-to"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  _txAllPage = 0;
  renderTxAll();
}

function renderTxAllTable(filtered) {
  const tbody = document.getElementById("tx-all-tbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px 0;color:var(--ink-4)">No transactions match your filters.</td></tr>`;
    document.getElementById("tx-all-pager").innerHTML = "";
    return;
  }
  // Build the tbody HTML (one uniform row per transaction) for a given array.
  function buildTxRows(rowsArr) {
    // Memoise the expense-category set so the refund-glyph check is O(1) per row.
    const EXP_CAT_SET = new Set(getAllCats("exp").map(c => c.id));
    return rowsArr.map(t => {
      const ty = normType(t);
      const isIn = ty === "in", isTfr = ty === "transfer";
      const cat = CAT_BY[t.category] || {};
      const desc = t.description || (isTfr ? `${t.fromAccount||""} → ${t.toAccount||""}` : "—");
      const acct = t.account || t.fromAccount || "—";
      const toAcct = t.toAccount || "";
      const aMeta = ACCT_META[acct] || {};
      const avatarColor = cat.color || (isTfr ? "var(--c-lisa)" : "var(--ink-4)");
      const letter = (t.description||desc).trim()[0]?.toUpperCase() || "?";
      const amtSign = isTfr ? "£" : (isIn ? "+£" : "−£");
      const amtClass = isTfr ? "tx-amt transfer" : (isIn ? "tx-amt pos" : "tx-amt neg");
      const dateStr = t.date ? new Date(t.date+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"2-digit"}) : "—";
      const catId = t.category || (isTfr ? "Transfer" : "—");
      // Single-line merchant cell — the old sub-line just duplicated the Account + Date columns.
      // Sub-line is reused for: transfers (route), or a user note ("payment for shoes").
      // Notes win if present — they're the user's own annotation.
      const note = (t.notes || "").trim();
      const subLine = note
        ? `<div class="tx-desc tx-note" title="${note.replace(/"/g,'&quot;')}">${note}</div>`
        : (isTfr ? `<div class="tx-desc">${t.fromAccount || "—"} → ${t.toAccount || "—"}</div>` : "");
      // A "refund" is an income txn either explicitly tagged on import (t.isRefund)
      // OR detected on the fly — income whose category is an expense category.
      // We prefix the merchant name with ↩ so the row visibly reads as a refund.
      const isRefund = !!t.isRefund || (ty === "in" && t.category && EXP_CAT_SET.has(t.category));
      const refundGlyph = isRefund ? '<span class="tx-refund-glyph" title="Refund — cancels original expense">↩</span> ' : '';
      const acctBg = aMeta.color ? `color-mix(in oklch, ${aMeta.color} 20%, transparent)` : "color-mix(in oklch, var(--bg-sunk) 82%, transparent)";
      const sel = _txSelected.has(String(t.id));
      return `<tr class="${sel ? 'tx-row-sel' : ''}">
        <td class="tx-check-col"><input type="checkbox" class="tx-row-check" ${sel ? 'checked' : ''} aria-label="Select transaction" onclick="toggleTxSelected('${t.id}')"></td>
        <td><div class="tx-merch"><div class="tx-av" style="background:color-mix(in oklch,${avatarColor} 30%,var(--bg-sunk));color:var(--ink-2)">${letter}</div><div><b>${refundGlyph}${desc}</b>${subLine}</div></div></td>
        <td>${isTfr?`<span class="cat-pill"><i class="swatch" style="background:var(--c-lisa)"></i>Transfer</span>`:buildCatPill(t.id, catId)}</td>
        <td class="tx-date">${dateStr}</td>
        <td><span class="acct-tag" style="background:${acctBg};color:var(--ink-2)">${acct}${isTfr && toAcct ? "" : ""}</span></td>
        <td class="${amtClass}"><span class="blur">${amtSign}${Math.abs(t.amount).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}</span></td>
        <td class="tx-actions-col"><div class="nw-act tx-row-actions">
          <button title="Edit" onclick="openTxModal('${t.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="danger" title="Delete" onclick="deleteTx('${t.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
        </div></td>
      </tr>`;
    }).join("");
  }

  // Effective page size. In fit mode: render a generous probe, measure the rows block, and
  // shrink to the count that fills the viewport — then PAGINATE at that size so older pages
  // remain reachable via the page buttons (fit only sets the page size, not a single page).
  let effSize;
  if (_txFitMode) {
    effSize = Math.min(filtered.length, Math.max(txFitRows() + 14, 30));
    let probe = filtered.slice(0, effSize);
    tbody.innerHTML = buildTxRows(probe);
    // Shrink the probe until the rows fit the fixed scroll region (below the sticky
    // header), so fit-mode fills the box exactly with no internal scrollbar.
    const wrap = document.querySelector("#page-tx .tx-table-scroll");
    if (wrap && wrap.clientHeight > 0) {
      const thead = wrap.querySelector("thead");
      const headH = thead ? thead.getBoundingClientRect().height : 0;
      const avail = wrap.clientHeight - headH;
      let guard = 0;
      while (probe.length > 5 && tbody.getBoundingClientRect().height > avail && guard++ < 80) {
        probe = probe.slice(0, probe.length - 1);
        tbody.innerHTML = buildTxRows(probe);
      }
    }
    effSize = Math.max(probe.length, 1);
  } else {
    effSize = _txAllPageSize;
  }
  const pages = effSize === Infinity ? 1 : Math.max(1, Math.ceil(filtered.length / effSize));
  if (_txAllPage >= pages) _txAllPage = pages - 1;
  if (_txAllPage < 0) _txAllPage = 0;
  // Record the size we actually rendered so select-all / sync use the SAME slice
  // as what's on screen (fit-mode measures a different size than _txAllPageSize).
  _txEffSize = effSize;
  const start = effSize === Infinity ? 0 : _txAllPage * effSize;
  const slice = filtered.slice(start, start + effSize);
  tbody.innerHTML = buildTxRows(slice);

  const shownFrom = filtered.length ? start + 1 : 0;
  const shownTo = Math.min(start + slice.length, filtered.length);
  const curVal = _txFitMode ? "fit" : (_txAllPageSize === Infinity ? "all" : String(_txAllPageSize));
  const sizeSel = `<label class="pager-size">Show
    <select onchange="setTxPageSize(this.value)">
      ${_TX_PAGE_SIZE_OPTIONS.map(opt => {
        const val = String(opt);
        const lab = opt === "fit" ? "Fit to page" : opt === "all" ? "All" : `${opt} per page`;
        return `<option value="${val}"${val===curVal?' selected':''}>${lab}</option>`;
      }).join("")}
    </select>
  </label>`;
  const info = `<span>Showing ${shownFrom}–${shownTo} of ${filtered.length} transactions</span>`;
  // Single page (everything fits / "All") → just the size control + count, no page buttons.
  if (pages <= 1) {
    document.getElementById("tx-all-pager").innerHTML = `${sizeSel}${info}`;
    return;
  }
  const pageButtons = Array.from({ length: Math.min(pages, 5) }, (_, i) => {
    let p = i;
    if (pages > 5) {
      const startPage = Math.min(Math.max(_txAllPage - 2, 0), pages - 5);
      p = startPage + i;
    }
    return `<button class="pager-num${p===_txAllPage?' active':''}" onclick="goTxPage(${p})">${p+1}</button>`;
  }).join("");
  document.getElementById("tx-all-pager").innerHTML = `
    ${sizeSel}
    ${info}
    <div class="pager-pages">
      <button onclick="goTxPage(${_txAllPage-1})" ${_txAllPage===0?'disabled':''}>‹</button>
      ${pageButtons}
      <button onclick="goTxPage(${_txAllPage+1})" ${_txAllPage>=pages-1?'disabled':''}>›</button>
    </div>`;
}

function goTxPage(p) { _txAllPage = p; renderTxAllTable(applyTxFilters()); window.scrollTo({top:0}); }

function renderTxFilterControls() {
  const accountWrap = document.getElementById("tx-filter-accounts");
  const catWrap = document.getElementById("tx-filter-categories");
  if (accountWrap) {
    const accts = getTxAccts();
    accountWrap.innerHTML = accts.length
      ? accts.map(a => `<label><input type="checkbox" data-filter-account="${String(a).replace(/"/g,'&quot;')}" ${_txAllAccts.has(a)?'checked':''}> ${a}</label>`).join("")
      : `<div class="tx-filter-empty">No accounts yet</div>`;
  }
  if (catWrap) {
    const cats = getTxCats();
    catWrap.innerHTML = cats.length
      ? cats.map(c => `<label><input type="checkbox" data-filter-category="${String(c).replace(/"/g,'&quot;')}" ${_txAllCats.has(c)?'checked':''}> ${c}</label>`).join("")
      : `<div class="tx-filter-empty">No categories yet</div>`;
  }
  document.querySelectorAll("[data-filter-type]").forEach(cb => { cb.checked = _txFilterTypes.has(cb.dataset.filterType); });
  const fields = {
    "tx-amount-min": _txAmountMin,
    "tx-amount-max": _txAmountMax,
    "tx-date-from": _txDateFrom,
    "tx-date-to": _txDateTo,
  };
  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el && el.value !== value) el.value = value;
  });
  const activeCount = _txAllAccts.size + _txAllCats.size + _txFilterTypes.size +
    (_txAmountMin !== "" ? 1 : 0) + (_txAmountMax !== "" ? 1 : 0) + (_txDateFrom ? 1 : 0) + (_txDateTo ? 1 : 0);
  const badge = document.getElementById("tx-filter-badge");
  if (badge) {
    badge.textContent = activeCount ? activeCount : "All";
    badge.className = "badge" + (activeCount ? "" : " muted");
  }
}

function toggleTxSelected(id) {
  const k = String(id);
  if (_txSelected.has(k)) _txSelected.delete(k); else _txSelected.add(k);
  renderTxBulkBar();
  syncTxAllCheck();
}
function toggleTxAllSelected(checked) {
  const filtered = applyTxFilters();
  const start = _txEffSize === Infinity ? 0 : _txAllPage * _txEffSize;
  const slice = filtered.slice(start, start + _txEffSize);
  if (checked) slice.forEach(t => _txSelected.add(String(t.id)));
  else slice.forEach(t => _txSelected.delete(String(t.id)));
  renderTxAllTable(filtered);
  renderTxBulkBar();
}
function syncTxAllCheck() {
  const filtered = applyTxFilters();
  const start = _txEffSize === Infinity ? 0 : _txAllPage * _txEffSize;
  const slice = filtered.slice(start, start + _txEffSize);
  const allOn = slice.length > 0 && slice.every(t => _txSelected.has(String(t.id)));
  const ck = document.getElementById("tx-all-check");
  if (ck) ck.checked = allOn;
}
function clearTxSelection() { _txSelected.clear(); renderTxAll(); }
// Toggle edit mode: reveal/hide the checkbox + actions columns and recolour the button.
// Leaving edit mode drops any pending selection so the bulk bar can't linger.
function toggleTxEditMode() {
  _txEditMode = !_txEditMode;
  const card = document.querySelector("#page-tx .tx-table-card");
  const btn = document.getElementById("tx-edit-toggle");
  if (card) card.classList.toggle("tx-editing", _txEditMode);
  if (btn) { btn.classList.toggle("editing", _txEditMode); btn.setAttribute("aria-pressed", String(_txEditMode)); }
  if (!_txEditMode) _txSelected.clear();
  renderTxAll();
}
function renderTxBulkBar() {
  const bar = document.getElementById("tx-bulk-bar");
  if (_txSelected.size) { bar.hidden = false; document.getElementById("tx-bulk-count").textContent = _txSelected.size; }
  else bar.hidden = true;
}

// Unified Bulk edit modal: description, category, note, and account(s) in one place.
function bulkChangeAccountsOpen() {
  if (!_txSelected.size) return;
  const accts = (typeof NW_CATS !== "undefined" ? NW_CATS.map(b => b.id) : []).filter(Boolean);
  const opt = (a) => `<option value="${a.replace(/"/g,'&quot;')}">${a}</option>`;
  const NONE = `<option value="__keep__" selected>— Don't change —</option>`;
  const isTransfer = _txAllType === "transfer";
  document.getElementById("tx-bulk-acct-row").style.display = isTransfer ? "none" : "";
  document.getElementById("tx-bulk-from-row").style.display = isTransfer ? "" : "none";
  document.getElementById("tx-bulk-to-row").style.display   = isTransfer ? "" : "none";
  document.getElementById("tx-bulk-desc").value = "";
  document.getElementById("tx-bulk-note").value = "";
  document.getElementById("tx-bulk-acct-sel").innerHTML = NONE + accts.map(opt).join("");
  document.getElementById("tx-bulk-from-sel").innerHTML = NONE + accts.map(opt).join("");
  document.getElementById("tx-bulk-to-sel").innerHTML   = NONE + accts.map(opt).join("");
  // Category — only meaningful for income/expense (transfers use from/to accounts).
  const catRow = document.getElementById("tx-bulk-cat-row");
  const catSel = document.getElementById("tx-bulk-cat-sel");
  if (isTransfer) {
    catRow.style.display = "none";
    catSel.innerHTML = NONE;
  } else {
    catRow.style.display = "";
    const copt = (c) => `<option value="${String(c.id).replace(/"/g,'&quot;')}">${c.icon||''} ${c.id}</option>`;
    let cats;
    if (_txAllType === "in") {
      cats = `<optgroup label="── Income ──">${getAllCats("in").map(copt).join("")}</optgroup>`
           + `<optgroup label="── Expense (for reimbursements) ──">${getAllCats("exp").map(copt).join("")}</optgroup>`;
    } else {
      cats = getAllCats("exp").map(copt).join("");
    }
    catSel.innerHTML = NONE + cats;
  }
  document.getElementById("tx-bulk-accts-modal").hidden = false;
  setTimeout(() => document.getElementById("tx-bulk-desc").focus(), 30);
}

function bulkChangeAccountsApply() {
  const isTransfer = _txAllType === "transfer";
  const desc = document.getElementById("tx-bulk-desc").value;
  const note = document.getElementById("tx-bulk-note").value;
  const cVal = document.getElementById("tx-bulk-cat-sel").value;
  const aVal = document.getElementById("tx-bulk-acct-sel").value;
  const fVal = document.getElementById("tx-bulk-from-sel").value;
  const tVal = document.getElementById("tx-bulk-to-sel").value;
  const changeDesc = desc.trim() !== "";
  const changeNote = note.trim() !== "";
  const changeC = !isTransfer && cVal !== "__keep__";
  const changeA = !isTransfer && aVal !== "__keep__";
  const changeF = isTransfer && fVal !== "__keep__";
  const changeT = isTransfer && tVal !== "__keep__";
  if (!changeDesc && !changeNote && !changeC && !changeA && !changeF && !changeT) {
    showToast("Change at least one field to apply");
    return;
  }
  const txns = getTxns();
  let n = 0;
  txns.forEach(t => {
    if (!_txSelected.has(String(t.id))) return;
    if (changeDesc) t.description = desc.trim();
    if (changeNote) t.notes = note.trim();
    if (changeC) t.category = cVal;
    if (changeA) t.account = aVal;
    if (changeF) t.fromAccount = fVal;
    if (changeT) t.toAccount = tVal;
    n++;
  });
  lsSet("fin_txns", txns);
  document.getElementById("tx-bulk-accts-modal").hidden = true;
  showToast(`${n} transaction${n===1?'':'s'} updated`);
  _txSelected.clear();
  renderAll();
}

function deleteTx(id) {
  confirmDialog({ title:"Delete transaction?", message:"This can't be undone.", confirmLabel:"Delete", danger:true }, () => {
    const txns = getTxns().filter(t => String(t.id) !== String(id));
    lsSet("fin_txns", txns);
    _txSelected.delete(String(id));
    showToast("Transaction deleted");
    renderAll();
  });
}

function bulkDeleteTx() {
  if (!_txSelected.size) return;
  const n = _txSelected.size;
  confirmDialog({ title:"Delete transactions?", message:`Delete ${n} transaction${n>1?'s':''}? This can't be undone.`, confirmLabel:"Delete", danger:true }, () => {
    const txns = getTxns().filter(t => !_txSelected.has(String(t.id)));
    lsSet("fin_txns", txns);
    showToast(`${n} transaction${n>1?'s':''} deleted`);
    _txSelected.clear();
    renderAll();
  });
}

/* ── Tx modal ── */
function openTxModal(id = null, defaultType = null, prefill = null) {
  _txEditId = id;
  const t = id ? getTxns().find(x => String(x.id) === String(id)) : null;
  document.getElementById("tx-modal-title").textContent = id ? "Edit transaction" : "Add transaction";
  _txModalType = t ? normType(t) : (defaultType || TX_PAGE_TYPES[_activePage] || "out");
  syncTxModalType();
  // Accounts come from the Balances page (NW_CATS) so transfers/accounts stay consistent with it.
  // For an existing txn, keep its current value if it isn't a Balances account (don't lose imports).
  const accts = (typeof NW_CATS !== "undefined" ? NW_CATS.map(b => b.id) : []).filter(Boolean);
  const optsFor = cur => ((cur && !accts.includes(cur)) ? [cur, ...accts] : accts)
    .map(a => `<option value="${String(a).replace(/"/g, "&quot;")}">${a}</option>`).join("");
  document.getElementById("tx-m-acct").innerHTML = optsFor(t?.account);
  document.getElementById("tx-m-from").innerHTML = optsFor(t?.fromAccount);
  document.getElementById("tx-m-to").innerHTML = optsFor(t?.toAccount);
  const today = new Date().toISOString().slice(0,10);
  document.getElementById("tx-m-date").value = t?.date || today;
  document.getElementById("tx-m-amt").value = t?.amount || "";
  document.getElementById("tx-m-desc").value = t?.description || "";
  document.getElementById("tx-m-notes").value = t?.notes || "";
  document.getElementById("tx-m-acct").value = t?.account || accts[0] || "";
  document.getElementById("tx-m-from").value = t?.fromAccount || accts[0] || "";
  document.getElementById("tx-m-to").value = t?.toAccount || accts[1] || accts[0] || "";
  populateTxCatSelect(t?.category);
  // Prefill for a NEW transaction (e.g. sending a project expense to Transactions).
  if (prefill && !id) {
    if (prefill.description != null) document.getElementById("tx-m-desc").value = prefill.description;
    if (prefill.amount != null) document.getElementById("tx-m-amt").value = prefill.amount;
    if (prefill.category != null) {
      populateTxCatSelect(prefill.category);
      document.getElementById("tx-m-cat").value = prefill.category;
    }
  }
  document.getElementById("tx-modal").hidden = false;
  setTimeout(() => document.getElementById("tx-m-amt").focus(), 50);
}
function populateTxCatSelect(selected) {
  // For income transactions we also offer expense categories — useful for reimbursements
  // (e.g. you bought £50 of shoes for a friend; their £50 transfer back is tagged "Clothing"
  // so the two cancel out in the breakdown).
  const sel = document.getElementById("tx-m-cat");
  const opt = (c) => `<option value="${String(c.id).replace(/"/g,'&quot;')}"${selected===c.id?' selected':''}>${c.icon||''} ${c.id}</option>`;
  if (_txModalType === "in") {
    const inCats  = getAllCats("in");
    const expCats = getAllCats("exp");
    sel.innerHTML =
      `<optgroup label="── Income ──">${inCats.map(opt).join("")}</optgroup>` +
      `<optgroup label="── Expense (for reimbursements) ──">${expCats.map(opt).join("")}</optgroup>`;
  } else {
    const cats = getAllCats("exp");
    sel.innerHTML = cats.map(opt).join("");
  }
}

/* ── Split editor ── */
let _txSplitRows = []; // [{category, amount}]
function renderSplitRows() {
  const wrap = document.getElementById("tx-m-splits");
  if (!wrap) return;
  const cats = getAllCats(_txModalType === "in" ? "in" : "exp");
  const opts = cats.map(c => `<option value="${c.id}">${c.icon} ${c.id}</option>`).join("");
  wrap.innerHTML = _txSplitRows.map((r, i) => `
    <div class="tx-split-row">
      <select data-idx="${i}" data-field="category">${opts}</select>
      <input type="number" step="0.01" min="0" value="${r.amount||''}" placeholder="0.00" data-idx="${i}" data-field="amount" />
      <button type="button" data-idx="${i}" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>
  `).join("");
  // Set selected category in each select
  wrap.querySelectorAll("select[data-field='category']").forEach(sel => {
    const idx = +sel.dataset.idx;
    if (_txSplitRows[idx]?.category) sel.value = _txSplitRows[idx].category;
  });
  wrap.querySelectorAll("input[data-field='amount']").forEach(inp => {
    inp.addEventListener("input", e => { _txSplitRows[+inp.dataset.idx].amount = parseFloat(inp.value) || 0; updateSplitStatus(); });
  });
  wrap.querySelectorAll("select[data-field='category']").forEach(sel => {
    sel.addEventListener("change", e => { _txSplitRows[+sel.dataset.idx].category = sel.value; });
  });
  wrap.querySelectorAll("button[data-idx]").forEach(btn => {
    btn.addEventListener("click", () => { _txSplitRows.splice(+btn.dataset.idx, 1); renderSplitRows(); updateSplitStatus(); });
  });
  updateSplitStatus();
}
function updateSplitStatus() {
  const tot = _txSplitRows.reduce((s, r) => s + (r.amount || 0), 0);
  const target = parseFloat(document.getElementById("tx-m-amt").value) || 0;
  const status = document.getElementById("tx-m-split-status");
  if (!status) return;
  const remaining = target - tot;
  if (Math.abs(remaining) < 0.01 && target > 0 && _txSplitRows.length) {
    status.textContent = `${fmtGBP(tot,{dp:2})} ✓ matches`;
    status.className = "ok";
  } else if (target > 0) {
    status.textContent = `${fmtGBP(tot,{dp:2})} of ${fmtGBP(target,{dp:2})} · ${remaining >= 0 ? fmtGBP(remaining,{dp:2})+' left' : fmtGBP(-remaining,{dp:2})+' over'}`;
    status.className = remaining < 0 ? "warn" : "";
  } else {
    status.textContent = "Set total amount above";
    status.className = "";
  }
}
function setSplitMode(on, presetSplits = null) {
  document.getElementById("tx-m-split-toggle").checked = on;
  document.getElementById("tx-m-cat-row").style.display = on ? "none" : "";
  document.getElementById("tx-m-split-wrap").hidden = !on;
  if (on) {
    if (presetSplits && presetSplits.length) {
      _txSplitRows = presetSplits.map(s => ({ category: s.category, amount: s.amount }));
    } else if (!_txSplitRows.length) {
      _txSplitRows = [{ category: "", amount: 0 }, { category: "", amount: 0 }];
    }
    renderSplitRows();
  } else {
    _txSplitRows = [];
  }
}
function syncTxModalType() {
  document.querySelectorAll("#tx-m-type-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === _txModalType));
  document.querySelectorAll("#tx-modal .row[data-only]").forEach(r => {
    const onlyTypes = r.dataset.only.split(",");
    r.dataset.hidden = !onlyTypes.includes(_txModalType);
  });
  populateTxCatSelect();
}
function closeTxModal() { document.getElementById("tx-modal").hidden = true; _txEditId = null; }
function saveTx() {
  const amt = parseFloat(document.getElementById("tx-m-amt").value);
  const date = document.getElementById("tx-m-date").value;
  const desc = document.getElementById("tx-m-desc").value.trim();
  const notes = (document.getElementById("tx-m-notes")?.value || "").trim();
  if (!amt || amt <= 0) { showToast("Please enter an amount"); return; }
  if (!date) { showToast("Please pick a date"); return; }
  const tx = { type: _txModalType, amount: amt, date, description: desc };
  if (notes) tx.notes = notes; else if (_txEditId) tx.notes = ""; // explicit clear
  if (_txModalType === "transfer") {
    tx.fromAccount = document.getElementById("tx-m-from").value;
    tx.toAccount   = document.getElementById("tx-m-to").value;
    if (tx.fromAccount === tx.toAccount) { showToast("From and To must differ"); return; }
  } else {
    tx.account  = document.getElementById("tx-m-acct").value;
    tx.category = document.getElementById("tx-m-cat").value;
  }
  let txns = getTxns();
  if (_txEditId) {
    const idx = txns.findIndex(t => String(t.id) === String(_txEditId));
    if (idx >= 0) txns[idx] = { ...txns[idx], ...tx };
  } else {
    tx.id = Date.now() + Math.floor(Math.random()*1000);
    txns.push(tx);
  }
  lsSet("fin_txns", txns);
  closeTxModal();
  showToast(_txEditId ? "Transaction updated" : "Transaction added");
  renderAll();
}

const txAddBtn = document.getElementById("tx-add-btn");
if (txAddBtn) txAddBtn.addEventListener("click", () => openTxModal(null));
document.getElementById("tx-m-cancel").addEventListener("click", closeTxModal);
document.getElementById("tx-m-save").addEventListener("click", saveTx);
document.getElementById("tx-modal").addEventListener("click", e => { if (e.target.id === "tx-modal") closeTxModal(); });
document.getElementById("tx-m-type-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-type]"); if (!b) return;
  _txModalType = b.dataset.type;
  syncTxModalType();
});

// Recompute the "fit to page" row count when the window resizes.
let _txFitTimer = null;
window.addEventListener("resize", () => {
  if (!_txFitMode) return;
  clearTimeout(_txFitTimer);
  _txFitTimer = setTimeout(() => {
    if (document.getElementById("page-tx")?.classList.contains("active")) renderTxAllTable(applyTxFilters());
  }, 160);
});

/* ── Filter bar handlers ── */
document.getElementById("tx-all-range").addEventListener("click", e => {
  const b = e.target.closest("[data-range]"); if(!b) return;
  _txAllRange = b.dataset.range; _txAllPage = 0;
  document.querySelectorAll("#tx-all-range button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.range === _txAllRange));
  renderTxAll();
});
document.getElementById("tx-all-search").addEventListener("input", e => {
  _txAllSearchQ = e.target.value; _txAllPage = 0; renderTxAll();
});
document.getElementById("tx-all-sort").addEventListener("change", e => {
  _txAllSort = e.target.value; renderTxAll();
});
document.getElementById("tx-filter-btn").addEventListener("click", e => {
  e.stopPropagation();
  const panel = document.getElementById("tx-filter-panel");
  const btn = document.getElementById("tx-filter-btn");
  const open = panel.hidden;
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (open) setTimeout(() => document.addEventListener("mousedown", onTxFilterPanelOutside), 0);
});
function onTxFilterPanelOutside(e) {
  const panel = document.getElementById("tx-filter-panel");
  const btn = document.getElementById("tx-filter-btn");
  if (!panel || panel.hidden) return;
  if (!panel.contains(e.target) && !btn.contains(e.target)) {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onTxFilterPanelOutside);
  }
}
document.getElementById("tx-filter-panel").addEventListener("change", e => {
  const account = e.target.dataset.filterAccount;
  const category = e.target.dataset.filterCategory;
  const type = e.target.dataset.filterType;
  if (account !== undefined) e.target.checked ? _txAllAccts.add(account) : _txAllAccts.delete(account);
  if (category !== undefined) e.target.checked ? _txAllCats.add(category) : _txAllCats.delete(category);
  if (type !== undefined) e.target.checked ? _txFilterTypes.add(type) : _txFilterTypes.delete(type);
  if (e.target.id === "tx-amount-min") _txAmountMin = e.target.value;
  if (e.target.id === "tx-amount-max") _txAmountMax = e.target.value;
  if (e.target.id === "tx-date-from") _txDateFrom = e.target.value;
  if (e.target.id === "tx-date-to") _txDateTo = e.target.value;
  _txAllPage = 0;
  renderTxAll();
});
document.getElementById("tx-filter-panel").addEventListener("input", e => {
  if (e.target.id === "tx-amount-min") _txAmountMin = e.target.value;
  if (e.target.id === "tx-amount-max") _txAmountMax = e.target.value;
  if (e.target.id === "tx-date-from") _txDateFrom = e.target.value;
  if (e.target.id === "tx-date-to") _txDateTo = e.target.value;
  if (["tx-amount-min","tx-amount-max","tx-date-from","tx-date-to"].includes(e.target.id)) {
    _txAllPage = 0;
    renderTxAll();
  }
});
document.getElementById("tx-filter-clear").addEventListener("click", clearAllTxFilters);
document.getElementById("tx-filter-done").addEventListener("click", () => {
  const panel = document.getElementById("tx-filter-panel");
  panel.hidden = true;
  document.getElementById("tx-filter-btn").setAttribute("aria-expanded", "false");
  document.removeEventListener("mousedown", onTxFilterPanelOutside);
});
document.querySelectorAll(".tx-table-full th.sortable").forEach(th => {
  th.addEventListener("click", () => {
    const k = th.dataset.sort;
    const cur = _txAllSort;
    if (k === "date")     _txAllSort = cur === "date-desc" ? "date-asc" : "date-desc";
    else if (k === "amount") _txAllSort = cur === "amount-desc" ? "amount-asc" : "amount-desc";
    else if (k === "merchant") _txAllSort = "merchant";
    document.getElementById("tx-all-sort").value = _txAllSort;
    renderTxAll();
  });
});

document.getElementById("tx-bulk-del").addEventListener("click", bulkDeleteTx);
document.getElementById("tx-bulk-accts").addEventListener("click", bulkChangeAccountsOpen);
document.getElementById("tx-bulk-accts-save").addEventListener("click", bulkChangeAccountsApply);
document.getElementById("tx-bulk-accts-modal").addEventListener("click", e => { if (e.target.id === "tx-bulk-accts-modal") e.currentTarget.hidden = true; });

/* ── Filter popovers (accounts, categories) ── */
// items can be a flat array of strings OR a structured array of
//   [{ heading: "Expense" }, "Cat A", "Cat B", { heading: "Income" }, "Cat C", ...]
// Headings render as non-selectable labels so the user can't accidentally pick them.
function openTxFilterPop(btnId, items, selectedSet, onChange) {
  closeTxPops();
  const btn = document.getElementById(btnId);
  const pop = document.createElement("div");
  pop.className = "filter-pop";
  // Selectable values only (no headings) — used for Select-all / outside-click matching.
  const selectableItems = items.filter(it => typeof it === "string");
  pop.innerHTML = items.map((it, idx) => {
    if (typeof it !== "string") {
      return `<div class="pop-heading">${it.heading}</div>`;
    }
    const safeId = `flt-${btnId}-${idx}`;
    const safeText = it.replace(/</g, "&lt;");
    return `<label><input type="checkbox" id="${safeId}" data-val="${it.replace(/"/g,'&quot;')}" ${selectedSet.has(it)?'checked':''}><span>${safeText}</span></label>`;
  }).join("") + `<div class="pop-foot"><button data-action="clear">Clear</button><button data-action="all">Select all</button></div>`;
  btn.appendChild(pop);
  btn.setAttribute("aria-expanded", "true");
  _activeTxPop = { pop, btn, onChange };
  pop.addEventListener("change", e => {
    if (e.target.matches('input[type="checkbox"]')) {
      const val = e.target.dataset.val;
      if (e.target.checked) selectedSet.add(val); else selectedSet.delete(val);
      onChange();
    }
  });
  pop.addEventListener("click", e => {
    const b = e.target.closest("[data-action]"); if (!b) return;
    if (b.dataset.action === "clear") selectedSet.clear();
    if (b.dataset.action === "all") selectableItems.forEach(i => selectedSet.add(i));
    pop.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = selectedSet.has(cb.dataset.val); });
    onChange();
  });
  setTimeout(() => document.addEventListener("mousedown", onTxPopOutside), 0);
}
function onTxPopOutside(e) {
  if (!_activeTxPop) return;
  if (!_activeTxPop.btn.contains(e.target)) closeTxPops();
}
function closeTxPops() {
  document.querySelectorAll(".filter-pop").forEach(p => p.remove());
  document.querySelectorAll('.filter-btn[aria-expanded="true"]').forEach(b => b.setAttribute("aria-expanded","false"));
  _activeTxPop = null;
  document.removeEventListener("mousedown", onTxPopOutside);
}
const legacyAcctBtn = document.getElementById("tx-acct-btn");
if (legacyAcctBtn) legacyAcctBtn.addEventListener("click", e => {
  e.stopPropagation();
  if (legacyAcctBtn.getAttribute("aria-expanded") === "true") { closeTxPops(); return; }
  openTxFilterPop("tx-acct-btn", getTxAccts(), _txAllAccts, () => { _txAllPage = 0; renderTxAll(); });
});
const legacyCatBtn = document.getElementById("tx-cat-btn");
if (legacyCatBtn) legacyCatBtn.addEventListener("click", e => {
  e.stopPropagation();
  if (legacyCatBtn.getAttribute("aria-expanded") === "true") { closeTxPops(); return; }
  const observed = new Set(getTxCats());
  const expCatsAll = getAllCats("exp").map(c => c.id);
  const incCatsAll = getAllCats("in").map(c => c.id);
  const expCats = expCatsAll.filter(c => observed.has(c));
  const incCats = incCatsAll.filter(c => observed.has(c));
  const knownSet = new Set([...expCatsAll, ...incCatsAll]);
  const otherCats = [...observed].filter(c => !knownSet.has(c)).sort();
  const items = [];
  if (expCats.length) { items.push({ heading: "Expense" }); items.push(...expCats); }
  if (incCats.length) { items.push({ heading: "Income" });  items.push(...incCats); }
  if (otherCats.length) { items.push({ heading: "Other" }); items.push(...otherCats); }
  openTxFilterPop("tx-cat-btn", items, _txAllCats, () => { _txAllPage = 0; renderTxAll(); });
});

(function wireTxSectionTabs() {
  const tabs = document.getElementById("tx-section-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", e => {
    const b = e.target.closest("[data-tx-section]");
    if (!b) return;
    const section = b.dataset.txSection;
    tabs.querySelectorAll("button").forEach(btn => btn.classList.toggle("active", btn === b));
    document.getElementById("tx-section-transactions").hidden = section !== "transactions";
    document.getElementById("tx-section-imports").hidden = section !== "imports";
    // Type + time-range filters only apply to the transactions list — hide on Imports.
    const filters = document.getElementById("tx-toolbar-filters");
    if (filters) filters.hidden = section !== "transactions";
    if (section === "imports" && typeof renderMerchantRules === "function") renderMerchantRules();
  });
})();

