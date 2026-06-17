/* ==========================================================================
   ACCOUNTS PAGE
========================================================================== */

let _accViewIdx = null;    // null = latest snapshot; number = sorted index
let _accSelectedCat = null;
let _accView = "balances"; // 'balances' (grid) | 'flows' (transfers + interest)
let _accTfrFilter = "";    // account name to filter transfers by ('' = all)
let _accIntAccts = [];     // accounts with interest data (populated by renderAccInterest)
function _accIntHiddenSet() { return new Set((typeof getSettings === "function" ? getSettings().acctIntHidden : null) || []); }

const ACC_ICONS = {
  "Current Account": "C",
  "Savings": "S",
  "Lifetime ISA": "L",
  "S&S ISA": "I",
  "Other": "O",
};

function _accEntry() {
  const entries = nwSnapshotsSorted();
  if (!entries.length) return null;
  if (_accViewIdx === null) return entries[entries.length - 1];
  return entries[Math.max(0, Math.min(_accViewIdx, entries.length - 1))];
}

function _accPrevEntry() {
  const entries = nwSnapshotsSorted();
  const entry = _accEntry();
  if (!entry) return null;
  const idx = entries.indexOf(entry);
  return idx > 0 ? entries[idx - 1] : null;
}

function _accEntryIdx() {
  const entries = nwSnapshotsSorted();
  const entry = _accEntry();
  if (!entry) return -1;
  return entries.indexOf(entry);
}

function _accIsLatest() {
  const entries = nwSnapshotsSorted();
  return entries.length && _accEntryIdx() === entries.length - 1;
}

function _accValue(entry, catId) {
  return entry?.allocations?.find(a => a.cat === catId)?.value || 0;
}

function _accMonthValue(month) {
  const t = monthToTime(month);
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function _accProvider(name) {
  if (/amex|american express/i.test(name)) return "Amex";
  if (/santander/i.test(name)) return "Santander";
  if (/moneybox/i.test(name)) return "Moneybox";
  if (/trading\s*212/i.test(name)) return "Trading212";
  return name.split(/\s+/)[0] || "Account";
}

function _accType(catId, value) {
  const note = (typeof getAcctNote === "function" ? getAcctNote(catId) : "") || "";
  if (value < 0 || /credit|loan|debt|overdraft|amex/i.test(catId + " " + note)) return "Debt";
  if (/cash|other/i.test(catId + " " + note)) return "Cash";
  if (/current/i.test(catId + " " + note)) return "Current account";
  if (/isa|investment|trading|shares|stock/i.test(catId + " " + note)) return "Investment";
  if (/saving/i.test(catId + " " + note)) return "Savings";
  return note || "Account";
}

function _accSection(catId, value) {
  // explicit user classification wins
  const ov = (typeof getSettings === "function" ? getSettings().acctSection : null) || {};
  if (ov[catId] && ["assets", "cash", "other"].includes(ov[catId])) return ov[catId];
  const text = `${catId} ${typeof getAcctNote === "function" ? getAcctNote(catId) : ""}`;
  if (value < 0 || /credit|loan|debt|overdraft|amex/i.test(text)) return "other";
  if (/cash|other/i.test(text)) return "cash";
  return "assets";
}

function _accStatus(row) {
  if (row.value < 0) return { label: Math.abs(row.delta) > 100 ? "Attention" : "Watch", tone: Math.abs(row.delta) > 100 ? "bad" : "watch" };
  if (row.delta < -100) return { label: "Watch", tone: "watch" };
  return { label: "Healthy", tone: "good" };
}

function _accRows(entry, prev) {
  return NW_CATS.map(c => {
    const value = _accValue(entry, c.id);
    const prevValue = prev ? _accValue(prev, c.id) : value;
    return {
      cat: c,
      value,
      prevValue,
      delta: value - prevValue,
      type: _accType(c.id, value),
      section: _accSection(c.id, value),
    };
  }).filter(r => r.value !== 0 || r.section === "cash");
}

function _accTrend(catId, count = 7) {
  const entries = nwSnapshotsSorted();
  return entries.slice(Math.max(0, _accEntryIdx() - count + 1), _accEntryIdx() + 1)
    .map(e => _accValue(e, catId));
}

function renderAccountsTab() {
  renderAccGrid();
  renderAccTransfers();
  renderAccInterest();
}

// Switch between the Balances grid and the Transfers & Interest view.
function setAccView(view) {
  _accView = (view === "flows") ? "flows" : "balances";
  const grid = document.getElementById("acc-tab-accounts");
  const flows = document.getElementById("acc-tab-flows");
  if (grid) grid.style.display = _accView === "balances" ? "" : "none";
  if (flows) flows.style.display = _accView === "flows" ? "" : "none";
  document.querySelectorAll("#acc-section-tabs button").forEach(b =>
    b.classList.toggle("active", b.dataset.accView === _accView));
  if (_accView === "flows") { renderAccTransfers(); renderAccInterest(); }
  else renderAccGrid();
}

/* ── Derived interest ─────────────────────────────────────────────────────
   Between two consecutive snapshots, whatever balance growth your logged
   transactions DON'T explain is interest (or fees, when negative):
     interest = bal(cur) − bal(prev) − netFlow(prev..cur]
   netFlow counts income (+), expenses (−) and transfer legs (±) on the
   account in the months after `prev` up to and including `cur`. Derived
   purely from data the user already enters — no rates, no new inputs. */
function _accNetFlow(acct, monthKeys) {
  let net = 0;
  (typeof getTxns === "function" ? getTxns() : []).forEach(t => {
    if (!monthKeys.has(monthKeyStr(t.date))) return;
    const ty = normType(t);
    const amt = Math.abs(Number(t.amount) || 0);
    if (ty === "transfer") {
      if (t.toAccount === acct) net += amt;
      if (t.fromAccount === acct) net -= amt;
    } else if (t.account === acct) {
      net += ty === "in" ? amt : -amt;
    }
  });
  return net;
}
// Month keys strictly after `fromMonth` up to and including `toMonth` ("June 2026" labels).
function _accMonthKeysBetween(fromMonth, toMonth) {
  const keys = new Set();
  const a = new Date(monthToTime(fromMonth)), b = new Date(monthToTime(toMonth));
  let y = a.getFullYear(), m = a.getMonth();
  const endY = b.getFullYear(), endM = b.getMonth();
  while (y < endY || (y === endY && m < endM)) {
    m++; if (m > 11) { m = 0; y++; }
    keys.add(monthKey(y, m));
  }
  return keys;
}
function renderAccInterest() {
  const wrap = document.getElementById("acc-interest");
  if (!wrap) return;
  const entries = nwSnapshotsSorted();
  if (entries.length < 2) {
    wrap.innerHTML = `<div class="acc-tfr-empty">Needs at least two monthly snapshots — once you've saved a second month, interest shows up here automatically.</div>`;
    return;
  }
  const latestTime = monthToTime(entries[entries.length - 1].month);
  const yearAgo = (() => { const d = new Date(latestTime); d.setMonth(d.getMonth() - 11); return d.getTime(); })();
  const accts = NW_CATS.map(c => c.id);
  let rows = [];
  accts.forEach(acct => {
    let last = null, last12 = 0, all = 0, bal12 = [], covered = 0;
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1], cur = entries[i];
      const balPrev = _accValue(prev, acct), balCur = _accValue(cur, acct);
      if (Math.abs(balPrev) < 0.005 && Math.abs(balCur) < 0.005) continue;  // account not in use yet
      const keys = _accMonthKeysBetween(prev.month, cur.month);
      const interest = balCur - balPrev - _accNetFlow(acct, keys);
      covered++;
      all += interest;
      if (monthToTime(cur.month) >= yearAgo) { last12 += interest; bal12.push(balCur); }
      last = { interest, label: cur.month };
    }
    if (!covered) return;
    // Rough effective annual rate from the last 12 months vs the average balance.
    const avgBal = bal12.length ? bal12.reduce((s, v) => s + v, 0) / bal12.length : 0;
    const rate = avgBal > 50 ? (last12 / avgBal) * (12 / Math.min(12, bal12.length)) * 100 : null;
    rows.push({ acct, last, last12, all, rate });
  });
  if (!rows.length) {
    wrap.innerHTML = `<div class="acc-tfr-empty">No account has two snapshots with a balance yet.</div>`;
    _accIntAccts = [];
    const pk = document.getElementById("acc-int-picker"); if (pk) pk.style.display = "none";
    return;
  }
  rows.sort((a, b) => b.all - a.all);
  // Account picker: user chooses which accounts to show here (a current account's
  // "interest" is just tracking noise, so they can hide it). Eligible list = every
  // account with interest data; hidden ones live in settings.acctIntHidden.
  _accIntAccts = rows.map(r => r.acct);
  const hidden = _accIntHiddenSet();
  const visible = rows.filter(r => !hidden.has(r.acct));
  const pk = document.getElementById("acc-int-picker");
  if (pk) {
    pk.style.display = "";
    pk.textContent = (visible.length === rows.length ? "All accounts" : `${visible.length} of ${rows.length}`) + " ▾";
  }
  if (!visible.length) {
    wrap.innerHTML = `<div class="acc-tfr-empty">All accounts hidden — use the picker above to show some.</div>`;
    return;
  }
  rows = visible;
  const fmtI = v => Math.abs(v) < 0.005
    ? `<span style="color:var(--ink-4)">—</span>`
    : `<span class="num blur" style="color:${v > 0 ? "var(--pos)" : "var(--neg)"}">${v > 0 ? "+" : "−"}${fmtGBP(Math.abs(v), { dp: 2 })}</span>`;
  wrap.innerHTML = `<table class="acc-tfr-table">
    <thead><tr><th>Account</th><th>Latest (${_accEsc(rows[0]?.last?.label || "")})</th><th>Last 12 months</th><th>All time</th><th class="acc-tfr-amth">≈ Rate</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="acc-tfr-row">
      <td class="acc-tfr-merch"><strong>${_accEsc(r.acct)}</strong></td>
      <td>${fmtI(r.last ? r.last.interest : 0)}</td>
      <td>${fmtI(r.last12)}</td>
      <td>${fmtI(r.all)}</td>
      <td class="acc-tfr-amt">${(r.rate != null && isFinite(r.rate) && Math.abs(r.rate) < 50 && Math.abs(r.last12) >= 0.005) ? `<span class="num blur">${r.rate.toFixed(1)}%</span> <small style="color:var(--ink-4)">p.a.</small>` : `<span style="color:var(--ink-4)">—</span>`}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

// Read-only list of transfer transactions (money moved between Balances accounts).
function renderAccTransfers() {
  const wrap = document.getElementById("acc-transfers");
  if (!wrap) return;
  const sub = document.getElementById("acc-tfr-sub");
  const allTfrs = (typeof getTxns === "function" ? getTxns() : [])
    .filter(t => normType(t) === "transfer")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // Account dropdown — built from the accounts actually seen in transfers.
  const sel = document.getElementById("acc-tfr-filter");
  if (sel) {
    const accts = [...new Set(allTfrs.flatMap(t => [t.fromAccount, t.toAccount]).filter(Boolean))].sort();
    if (_accTfrFilter && !accts.includes(_accTfrFilter)) _accTfrFilter = "";   // stale filter → reset
    sel.innerHTML = `<option value="">All accounts</option>` +
      accts.map(a => `<option value="${_accEsc(a)}"${a === _accTfrFilter ? " selected" : ""}>${_accEsc(a)}</option>`).join("");
    sel.value = _accTfrFilter;
    sel.style.display = accts.length ? "" : "none";
  }

  const tfrs = _accTfrFilter
    ? allTfrs.filter(t => t.fromAccount === _accTfrFilter || t.toAccount === _accTfrFilter)
    : allTfrs;

  if (sub) sub.textContent = tfrs.length
    ? `${tfrs.length} transfer${tfrs.length === 1 ? "" : "s"}${_accTfrFilter ? " · " + _accEsc(_accTfrFilter) : ""}`
    : "";
  if (!tfrs.length) {
    wrap.innerHTML = `<div class="acc-tfr-empty">${_accTfrFilter ? `No transfers involving ${_accEsc(_accTfrFilter)}.` : "No transfers yet — transfers you add in Transactions appear here."}</div>`;
    return;
  }
  const fmtDate = d => d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
  const rows = tfrs.map(t => `<tr class="acc-tfr-row">
      <td class="acc-tfr-merch"><strong>${_accEsc(t.description || "Transfer")}</strong></td>
      <td class="acc-tfr-route"><span>${_accEsc(t.fromAccount || "—")}</span><span class="acc-tfr-arrow">→</span><span>${_accEsc(t.toAccount || "—")}</span></td>
      <td class="acc-tfr-date">${fmtDate(t.date)}</td>
      <td class="acc-tfr-amt num blur">${fmtGBP(Math.abs(Number(t.amount) || 0), { dp: 2 })}</td>
    </tr>`).join("");
  wrap.innerHTML = `<table class="acc-tfr-table">
    <thead><tr><th>Transfer</th><th>From → To</th><th>Date</th><th class="acc-tfr-amth">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderAccSummary() {
  const totalEl = document.getElementById("acc-total");
  const deltaEl = document.getElementById("acc-delta");
  const moverEl = document.getElementById("acc-mover");
  const moverNameEl = document.getElementById("acc-mover-name");
  const icDelta = document.getElementById("acc-ic-delta");
  const icMover = document.getElementById("acc-ic-mover");
  if (!totalEl || !deltaEl || !moverEl) return;

  const setIcTone = (el, sign) => {
    if (!el) return;
    el.classList.toggle("pos", sign > 0);
    el.classList.toggle("neg", sign < 0);
  };

  const entry = _accEntry();
  const prev = _accPrevEntry();
  if (!entry) {
    totalEl.textContent = "—";
    deltaEl.textContent = "—";
    deltaEl.classList.remove("pos", "neg");
    moverEl.textContent = "—";
    moverEl.classList.remove("pos", "neg");
    if (moverNameEl) moverNameEl.textContent = "No snapshot yet";
    setIcTone(icDelta, 0);
    setIcTone(icMover, 0);
    return;
  }

  const total = nwTotalE(entry);
  const prevTotal = prev ? nwTotalE(prev) : total;
  const delta = total - prevTotal;
  totalEl.textContent = fmtGBP(total, { dp: 0 });
  deltaEl.textContent = prev ? `${delta >= 0 ? "+" : "-"}${fmtGBP(Math.abs(delta), { dp: 0 })}` : "—";
  deltaEl.classList.toggle("pos", delta > 0);
  deltaEl.classList.toggle("neg", delta < 0);
  setIcTone(icDelta, prev ? delta : 0);

  let topMover = null;
  if (prev) {
    topMover = NW_CATS.map(c => {
      const change = _accValue(entry, c.id) - _accValue(prev, c.id);
      return { cat: c, change, abs: Math.abs(change) };
    }).sort((a, b) => b.abs - a.abs)[0];
  }

  if (topMover && topMover.abs > 0) {
    moverEl.textContent = `${topMover.change >= 0 ? "+" : "-"}${fmtGBP(topMover.abs, { dp: 0 })}`;
    moverEl.classList.toggle("pos", topMover.change > 0);
    moverEl.classList.toggle("neg", topMover.change < 0);
    if (moverNameEl) moverNameEl.textContent = topMover.cat.id;
    setIcTone(icMover, topMover.change);
  } else {
    moverEl.textContent = "—";
    moverEl.classList.remove("pos", "neg");
    if (moverNameEl) moverNameEl.textContent = "No movement yet";
    setIcTone(icMover, 0);
  }
}

// Short month label: "May 2026" -> "May 26"
function _accMonthShort(month) {
  const d = new Date(monthToTime(month));
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`;
}
const _accEsc = s => (s || "").replace(/"/g, "&quot;");

// ===== Editable balances grid: draft state + batched "Save changes" =====
let _accDraft = null;     // [{ month, locked, vals:{ [catId]: number } }] (chronological)
let _accBuckets = null;   // [{ id, color, type }]
let _accDirty = false;
const ACC_PALETTE = ["var(--c-current)", "var(--c-savings)", "var(--c-lisa)", "var(--c-ssisa)", "var(--c-other)", "var(--accent)", "var(--pos)", "var(--warn)"];
const ACC_WIN = 4;           // months shown per window
let _accMonthPage = null;    // 0-based window index; null = default to latest
let _accEditMode = false;    // account-edit mode (toolbar Edit button)
let _accSelected = null;     // (legacy) selected account id
let _accTypes = [];          // ordered type subheadings (draft)
let _accDeletedIds = [];     // accounts deleted this edit session — pruned from settings.accounts on Save
function _accPageCount() { return Math.max(1, Math.ceil((_accDraft?.length || 0) / ACC_WIN)); }

function _accBucketType(id) {
  const note = (typeof getAcctNote === "function" ? getAcctNote(id) : "") || "";
  return note || _accType(id, 0);
}

function _accMonthKeyNum(monthStr) { const d = new Date(monthToTime(monthStr)); return d.getFullYear() * 12 + d.getMonth(); }
function _accCurKey() { const n = new Date(); return n.getFullYear() * 12 + n.getMonth(); }

// Build the draft as a CONTINUOUS, chronological run of calendar months (Jan–Dec of every year
// from the earliest data year through the current year). No manual "Add month" — months just
// exist; existing snapshot values are merged in, empty months are £0 and editable.
function _accInitDraft() {
  const entries = nwSnapshotsSorted();
  const memo = (typeof getSettings === "function" ? getSettings().acctMemo : null) || {};
  _accBuckets = NW_CATS.map(c => ({ id: c.id, color: c.color, type: _accBucketType(c.id), note: memo[c.id] || "" }));
  // Type subheadings (ordered): saved list, else the distinct types of existing accounts.
  const saved = (typeof getSettings === "function" ? getSettings().acctTypes : null);
  _accTypes = (Array.isArray(saved) && saved.length) ? saved.slice() : [];
  _accBuckets.forEach(b => { if (b.type && !_accTypes.includes(b.type)) _accTypes.push(b.type); });
  const now = new Date();
  let minY = Math.min(2025, now.getFullYear()), maxY = now.getFullYear();  // always editable back to Jan 2025
  const byKey = {};
  entries.forEach(e => { const d = new Date(monthToTime(e.month)); minY = Math.min(minY, d.getFullYear()); maxY = Math.max(maxY, d.getFullYear()); byKey[d.getFullYear() * 12 + d.getMonth()] = e; });
  _accDraft = [];
  for (let y = minY; y <= maxY; y++) {
    for (let m = 0; m < 12; m++) {
      const snap = byKey[y * 12 + m];
      const vals = {};
      _accBuckets.forEach(b => { vals[b.id] = snap ? _accValue(snap, b.id) : 0; });
      _accDraft.push({ month: `${MONTHS[m]} ${y}`, locked: snap ? !!snap.locked : false, vals });
    }
  }
  _accDeletedIds = [];
  _accDirty = false;
}

function _accDraftTotal(row) {
  return _accBuckets.reduce((s, b) => s + (Number(row.vals[b.id]) || 0), 0);
}
function _accSetDirty() { _accDirty = true; document.getElementById("acc-bal-actions")?.classList.add("dirty"); document.getElementById("acc-save")?.removeAttribute("disabled"); document.getElementById("acc-save-caret")?.removeAttribute("disabled"); }

function _accActionsHTML() {
  return `<span class="acc-tb-dirty"><span class="dot"></span>Unsaved changes</span>
      <div class="acc-tb-save">
        <button class="acc-tb-savebtn" id="acc-save"${_accDirty ? "" : " disabled"}>Save changes</button>
        <button class="acc-tb-savecaret" id="acc-save-caret"${_accDirty ? "" : " disabled"} aria-label="More options">▾</button>
        <div class="acc-tb-menu" id="acc-save-menu" hidden><button id="acc-discard">Discard changes</button></div>
      </div>`;
}
function _accLeftHTML() {
  return `<button class="acc-tb-btn" id="acc-add-account"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>Add account</button>
    <button class="acc-tb-btn" id="acc-add-type"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="13" y2="18"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>Add type</button>
    <button class="acc-tb-btn acc-edit-toggle${_accEditMode ? " editing" : ""}" id="acc-edit-toggle" aria-pressed="${_accEditMode}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>Edit</button>`;
}

// Data-entry table (mirrors Transactions): accounts × a 4-month window + frozen sparkline.
function renderAccGrid() {
  const wrap = document.getElementById("acc-grid");
  const left = document.getElementById("acc-bal-left");
  const actions = document.getElementById("acc-bal-actions");
  if (!wrap) return;
  if (!_accDirty || !_accDraft) _accInitDraft();
  const months = _accDraft, buckets = _accBuckets;

  if (left) left.innerHTML = _accLeftHTML();
  if (actions) { actions.innerHTML = _accActionsHTML(); actions.classList.toggle("dirty", _accDirty); }
  _accWireToolbar();

  if (!months.length) { wrap.innerHTML = `<div class="acc-g-empty"><h3>No accounts yet</h3></div>`; return; }

  // 4-month window; default to the window holding the current month.
  const pageCount = _accPageCount();
  if (_accMonthPage == null) {
    const ck = _accCurKey();
    let idx = months.findIndex(m => _accMonthKeyNum(m.month) === ck);
    if (idx < 0) idx = months.length - 1;
    _accMonthPage = Math.floor(idx / ACC_WIN);
  }
  if (_accMonthPage > pageCount - 1) _accMonthPage = pageCount - 1;
  if (_accMonthPage < 0) _accMonthPage = 0;
  const start = _accMonthPage * ACC_WIN;
  const win = []; for (let i = 0; i < ACC_WIN; i++) win.push(months[start + i] || null);

  // 6M sparkline series = the last 6 months up to (and including) the current month
  const ck = _accCurKey();
  const upto = months.filter(m => _accMonthKeyNum(m.month) <= ck);
  const sparkBase = (upto.length ? upto : months).slice(-6);
  const refMonth = sparkBase[sparkBase.length - 1] || months[months.length - 1];

  // ensure every account's type has a subheading
  buckets.forEach(b => { if (b.type && !_accTypes.includes(b.type)) _accTypes.push(b.type); });
  const typesToShow = _accTypes.length ? _accTypes : ["Accounts"];

  const colCount = 8; // account, navL, 4 months, navR, spark
  const navL = `<th class="acc-g-nav acc-g-navl"><button class="acc-g-navbtn" id="acc-m-prev"${_accMonthPage <= 0 ? " disabled" : ""} aria-label="Earlier months">‹</button></th>`;
  const navR = `<th class="acc-g-nav acc-g-navr"><button class="acc-g-navbtn" id="acc-m-next"${_accMonthPage >= pageCount - 1 ? " disabled" : ""} aria-label="Later months">›</button></th>`;
  const monthHead = win.map(m => {
    if (!m) return `<th class="acc-g-month acc-g-blank"></th>`;
    const cur = _accMonthKeyNum(m.month) === ck ? " acc-g-curmonth" : "";
    return `<th class="acc-g-month${cur}"><span class="acc-g-mlabel">${_accMonthShort(m.month)}</span></th>`;
  }).join("");
  const TRASH_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;

  let body = "";
  typesToShow.forEach(type => {
    const inType = buckets.filter(b => (b.type || "") === type);
    const del = (_accEditMode && !inType.length) ? `<button class="acc-g-typedel" data-type="${_accEsc(type)}" title="Remove type">×</button>` : "";
    const thandle = _accEditMode ? (typeof DRAG_HANDLE_SVG !== "undefined" ? DRAG_HANDLE_SVG : "<span class='drag-handle'>⠿</span>") : "";
    const typeLabel = _accEditMode ? `<input class="acc-g-typename" data-type="${_accEsc(type)}" value="${_accEsc(type)}" aria-label="Type name">` : type;
    body += `<tr class="acc-g-group" data-type="${_accEsc(type)}"><td class="acc-g-grouplabel" colspan="${colCount}">${thandle}${typeLabel}${del}</td></tr>`;
    inType.forEach(b => {
      const icon = ACC_ICONS[b.id] || b.id.trim()[0]?.toUpperCase() || "?";
      const cells = win.map((m, i) => {
        if (!m) return `<td class="acc-g-cell acc-g-blank"></td>`;
        const cur = _accMonthKeyNum(m.month) === ck ? " acc-g-curmonth" : "";
        return `<td class="acc-g-cell${cur}"><input class="acc-g-input" inputmode="decimal" data-cat="${_accEsc(b.id)}" data-idx="${start + i}" value="${fmtGBP(Number(m.vals[b.id]) || 0, { dp: 2 })}" aria-label="${_accEsc(b.id)} ${_accEsc(m.month)}"></td>`;
      }).join("");
      const series = sparkBase.map(mm => Number(mm.vals[b.id]) || 0);
      const sCol = (series[series.length - 1] || 0) < (series[0] || 0) ? "var(--neg)" : "var(--pos)";
      const spark = (typeof sparkline === "function" ? sparkline(series, { w: 112, h: 26, stroke: sCol, strokeWidth: 1.6 }) : "") || `<span class="acc-muted">—</span>`;
      const nameInner = _accEditMode
        ? `${(typeof DRAG_HANDLE_SVG !== "undefined" ? DRAG_HANDLE_SVG : "<span class='drag-handle'>⠿</span>")}<div class="acc-g-nameedit"><input class="acc-g-rename" data-acct="${_accEsc(b.id)}" value="${_accEsc(b.id)}" aria-label="Account name"><input class="acc-g-note" data-acct="${_accEsc(b.id)}" value="${_accEsc(b.note || "")}" placeholder="Add a note…" aria-label="Account note"></div>`
        : `<span class="acc-g-ic" style="background:color-mix(in oklch,${b.color} 50%,transparent)">${icon}</span><span class="acc-g-nametext"><strong>${b.id}</strong>${b.note ? `<small>${_accEsc(b.note)}</small>` : ""}</span>`;
      const endCell = _accEditMode ? `<button class="acc-g-trash" data-acct="${_accEsc(b.id)}" title="Delete account">${TRASH_SVG}</button>` : spark;
      body += `<tr class="acc-g-row" data-cat="${_accEsc(b.id)}" data-type="${_accEsc(type)}">
        <th class="acc-g-name" scope="row"><div class="acc-g-namecell">${nameInner}</div></th>
        <td class="acc-g-nav acc-g-navl"></td>${cells}<td class="acc-g-nav acc-g-navr"></td>
        <td class="acc-g-spark">${endCell}</td>
      </tr>`;
    });
  });

  const totalCells = win.map((m, i) => {
    if (!m) return `<td class="acc-g-total acc-g-blank"></td>`;
    const cur = _accMonthKeyNum(m.month) === ck ? " acc-g-curmonth" : "";
    return `<td class="acc-g-total${cur}" data-total-idx="${start + i}">${fmtGBP(_accDraftTotal(m), { dp: 0 })}</td>`;
  }).join("");
  const totalRow = `<tr class="acc-g-totalrow"><th class="acc-g-name acc-g-totallabel" scope="row">Total</th><td class="acc-g-nav acc-g-navl"></td>${totalCells}<td class="acc-g-nav acc-g-navr"></td><td></td></tr>`;
  // Spacer row absorbs all spare height (table is height:100%) so the Total row is
  // pinned to the card's bottom edge even when there are only a few accounts.
  // colspan MUST equal the real column count — under table-layout:fixed an oversized
  // colspan inflates the table's column count and collapses the month columns.
  const spacerRow = `<tr class="acc-g-spacer" aria-hidden="true"><td colspan="${colCount}"></td></tr>`;

  wrap.innerHTML = `<table class="acc-bal-grid">
    <thead><tr><th class="acc-g-corner">Account</th>${navL}${monthHead}${navR}<th class="acc-g-sparkhead">6M</th></tr></thead>
    <tbody>${body}${spacerRow}${totalRow}</tbody>
  </table>`;
  wrap.classList.toggle("acc-editing", _accEditMode);

  wrap.querySelectorAll(".acc-g-input").forEach(inp => {
    const idx = () => Number(inp.dataset.idx), cat = inp.dataset.cat;
    inp.addEventListener("focus", () => { const v = Number(_accDraft[idx()].vals[cat]) || 0; inp.value = v ? String(v) : ""; inp.select?.(); });
    inp.addEventListener("input", () => { _accDraft[idx()].vals[cat] = parseFloat(inp.value.replace(/[^0-9.\-]/g, "")) || 0; _accSetDirty(); _accLiveRecalc(); });
    inp.addEventListener("blur", () => { inp.value = fmtGBP(Number(_accDraft[idx()].vals[cat]) || 0, { dp: 2 }); });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
  });
  wrap.querySelectorAll(".acc-g-rename").forEach(inp => {
    const oldId = inp.dataset.acct;
    inp.addEventListener("click", e => e.stopPropagation());
    inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
    inp.addEventListener("change", () => { const v = inp.value.trim(); if (v && v !== oldId) _accRenameInline(oldId, v); else inp.value = oldId; });
  });
  wrap.querySelectorAll(".acc-g-note").forEach(inp => {
    const id = inp.dataset.acct;
    inp.addEventListener("click", e => e.stopPropagation());
    inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
    inp.addEventListener("input", () => { const b = _accBucket(id); if (b) { b.note = inp.value; _accSetDirty(); } });
  });
  wrap.querySelectorAll(".acc-g-typename").forEach(inp => {
    const old = inp.dataset.type;
    inp.addEventListener("click", e => e.stopPropagation());
    inp.addEventListener("pointerdown", e => e.stopPropagation());
    inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
    inp.addEventListener("change", () => { const v = inp.value.trim(); if (v && v !== old) _accRenameType(old, v); else inp.value = old; });
  });
  wrap.querySelectorAll(".acc-g-trash").forEach(btn => btn.addEventListener("click", e => { e.stopPropagation(); _accDeleteAccount(btn.dataset.acct); }));
  wrap.querySelectorAll(".acc-g-typedel").forEach(btn => btn.addEventListener("click", e => { e.stopPropagation(); _accDeleteType(btn.dataset.type); }));
  if (_accEditMode) { _accWireAcctDnD(wrap); _accWireTypeDnD(wrap); }
  document.getElementById("acc-m-prev")?.addEventListener("click", () => { if (_accMonthPage > 0) { _accMonthPage--; renderAccGrid(); } });
  document.getElementById("acc-m-next")?.addEventListener("click", () => { if (_accMonthPage < _accPageCount() - 1) { _accMonthPage++; renderAccGrid(); } });
}

// Live-update the visible window's Total cells from the draft (no rebuild → focus preserved).
function _accLiveRecalc() {
  const wrap = document.getElementById("acc-grid");
  if (!wrap || !_accDraft) return;
  wrap.querySelectorAll(".acc-g-total[data-total-idx]").forEach(td => {
    const i = Number(td.dataset.totalIdx);
    if (_accDraft[i]) td.textContent = fmtGBP(_accDraftTotal(_accDraft[i]), { dp: 0 });
  });
}

function _accWireToolbar() {
  document.getElementById("acc-add-account")?.addEventListener("click", e => _accAddAccountPop(e.currentTarget));
  document.getElementById("acc-add-type")?.addEventListener("click", e => _accAddTypePop(e.currentTarget));
  document.getElementById("acc-edit-toggle")?.addEventListener("click", toggleAccEditMode);
  document.getElementById("acc-save")?.addEventListener("click", saveAccChanges);
  const menu = document.getElementById("acc-save-menu");
  document.getElementById("acc-save-caret")?.addEventListener("click", e => { e.stopPropagation(); if (menu) menu.hidden = !menu.hidden; });
  document.getElementById("acc-discard")?.addEventListener("click", () => { if (menu) menu.hidden = true; _accDiscard(); });
}

function saveAccChanges() {
  if (!_accDirty) return;
  const s = getSettings();
  s.nwBuckets = _accBuckets.map(b => ({ id: b.id, color: b.color }));
  s.acctNotes = s.acctNotes || {};
  s.acctMemo = s.acctMemo || {};
  _accBuckets.forEach(b => {
    if (b.type) s.acctNotes[b.id] = b.type;
    if (b.note) s.acctMemo[b.id] = b.note; else delete s.acctMemo[b.id];
  });
  s.acctTypes = _accTypes.slice();
  // Balances is the sole account manager — prune explicitly-deleted accounts from the legacy
  // settings.accounts list so they vanish from transaction/scheduled pickers too. Only names
  // deleted this session and not re-added are removed (transaction-orphan accounts are preserved).
  if (_accDeletedIds.length && Array.isArray(s.accounts)) {
    const live = new Set(_accBuckets.map(b => b.id));
    const gone = new Set(_accDeletedIds.filter(id => !live.has(id)));
    if (gone.size) s.accounts = s.accounts.filter(a => !gone.has(a));
  }
  lsSet("fin_settings", s);
  _accDeletedIds = [];
  if (typeof rebuildNWCats === "function") rebuildNWCats();
  // Persist only months that actually have a balance (auto-generated empty months aren't saved).
  const entries = _accDraft
    .filter(m => _accBuckets.some(b => Math.abs(Number(m.vals[b.id]) || 0) > 0.005))
    .map(m => ({
      month: m.month,
      allocations: _accBuckets.map(b => ({ cat: b.id, value: Number(m.vals[b.id]) || 0 })),
      locked: !!m.locked,
    }));
  lsSet("fin_nw_entries", entries);
  _accDirty = false;
  showToast("Balances saved");
  renderAll();
}

function _accDiscard() { _accInitDraft(); renderAccountsTab(); }

function _accDeleteMonth(i) {
  const m = _accDraft[i];
  if (!m) return;
  const go = () => { _accDraft.splice(i, 1); _accSetDirty(); renderAccGrid(); };
  if (typeof confirmDialog === "function") {
    confirmDialog({ title: "Delete month?", message: `Remove the ${m.month} column? It is applied when you Save changes.`, confirmLabel: "Delete", cancelLabel: "Cancel", danger: true }, go);
  } else { go(); }
}

// ── Popovers (Add month / Add account / account ⋮ menu) ──
function _accClosePops() {
  document.getElementById("acc-pop")?.remove();
  document.removeEventListener("mousedown", _accPopOutside);
  const menu = document.getElementById("acc-save-menu"); if (menu) menu.hidden = true;
}
function _accPopOutside(e) { const pop = document.getElementById("acc-pop"); if (pop && !pop.contains(e.target)) _accClosePops(); }
function _accMountPop(pop, anchor) {
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.position = "fixed";
  const m = 12;
  // Always open DOWNWARD from the anchor; cap the height to the space available below
  // and let the popover scroll internally if its content is taller (never flip upward).
  const top = r.bottom + 6;
  pop.style.top = `${top}px`;
  pop.style.maxHeight = `${Math.max(140, window.innerHeight - top - m)}px`;
  pop.style.overflowY = "auto";
  pop.style.left = `${Math.max(m, Math.min(r.left, window.innerWidth - pop.offsetWidth - m))}px`;
  setTimeout(() => document.addEventListener("mousedown", _accPopOutside), 0);
}
function _accAddMonthPop(anchor) {
  _accClosePops();
  let def;
  if (_accDraft.length) { const d = new Date(monthToTime(_accDraft[_accDraft.length - 1].month)); d.setMonth(d.getMonth() + 1); def = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  else { const n = new Date(); def = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; }
  const pop = document.createElement("div");
  pop.className = "acc-pop"; pop.id = "acc-pop";
  pop.innerHTML = `<label>Add a month</label><input type="month" id="acc-pop-month" value="${def}"><div class="acc-pop-row"><button class="acc-pop-cancel">Cancel</button><button class="acc-pop-add">Add</button></div>`;
  _accMountPop(pop, anchor);
  const inp = pop.querySelector("#acc-pop-month"); inp.focus();
  pop.querySelector(".acc-pop-cancel").addEventListener("click", _accClosePops);
  pop.querySelector(".acc-pop-add").addEventListener("click", () => {
    if (!inp.value) return;
    const [y, mo] = inp.value.split("-").map(Number);
    const month = `${MONTHS[mo - 1]} ${y}`;
    if (_accDraft.find(m => m.month === month)) { showToast(`${month} is already added`); return; }
    const t = monthToTime(month);
    let src = null, srcT = -Infinity;
    _accDraft.forEach(m => { const mt = monthToTime(m.month); if (mt < t && mt > srcT) { srcT = mt; src = m; } });
    const vals = {};
    _accBuckets.forEach(b => { vals[b.id] = src ? (Number(src.vals[b.id]) || 0) : 0; });
    _accDraft.push({ month, locked: false, vals });
    _accDraft.sort((a, b) => monthToTime(a.month) - monthToTime(b.month));
    const newIdx = _accDraft.findIndex(m => m.month === month);
    if (newIdx >= 0) _accMonthPage = Math.floor(newIdx / ACC_WIN); // jump to the window holding it
    _accClosePops(); _accSetDirty(); renderAccGrid();
  });
}
function _accAddAccountPop(anchor) {
  _accClosePops();
  const pop = document.createElement("div");
  pop.className = "acc-pop"; pop.id = "acc-pop";
  const typeOpts = (_accTypes.length ? _accTypes : ["Accounts"]).map(t => `<option value="${_accEsc(t)}">${t}</option>`).join("");
  pop.innerHTML = `<label>Account name</label><input type="text" id="acc-pop-name" placeholder="e.g. Monzo" autocomplete="off"><label class="acc-pop-l2">Type</label><select id="acc-pop-type">${typeOpts}</select><label class="acc-pop-l2">Note</label><input type="text" id="acc-pop-note" placeholder="optional" autocomplete="off"><div class="acc-pop-row"><button class="acc-pop-cancel">Cancel</button><button class="acc-pop-add">Add</button></div>`;
  _accMountPop(pop, anchor);
  const nameInp = pop.querySelector("#acc-pop-name"); nameInp.focus();
  pop.querySelector(".acc-pop-cancel").addEventListener("click", _accClosePops);
  pop.querySelector(".acc-pop-add").addEventListener("click", () => {
    const name = nameInp.value.trim();
    if (!name) { nameInp.focus(); return; }
    if (_accBuckets.find(b => b.id.toLowerCase() === name.toLowerCase())) { showToast("That account already exists"); return; }
    const type = pop.querySelector("#acc-pop-type").value;
    const note = pop.querySelector("#acc-pop-note").value.trim();
    _accBuckets.push({ id: name, color: ACC_PALETTE[_accBuckets.length % ACC_PALETTE.length], type, note });
    _accDraft.forEach(m => { m.vals[name] = 0; });
    _accClosePops(); _accSetDirty(); renderAccGrid();
  });
}
// ── Edit mode: select an account → bottom bar (Rename / Type / Classify / Delete) ──
function toggleAccEditMode() { _accEditMode = !_accEditMode; renderAccGrid(); }
function _accBucket(id) { return _accBuckets ? _accBuckets.find(b => b.id === id) : null; }

// Inline rename (from the editable name input) — migrates references via cascadeAccountRename.
function _accRenameInline(oldId, newName) {
  const accts = (typeof getAllAccounts === "function") ? getAllAccounts() : [];
  if (accts.some(a => a.toLowerCase() === newName.toLowerCase() && a !== oldId)) { showToast(`"${newName}" already exists`); renderAccGrid(); return; }
  if (typeof cascadeAccountRename === "function") cascadeAccountRename(oldId, newName);
  const bk = _accBucket(oldId); if (bk) bk.id = newName;
  _accDraft.forEach(m => { if (oldId in m.vals) { m.vals[newName] = m.vals[oldId]; delete m.vals[oldId]; } });
  const s = getSettings();
  if (s.acctNotes && s.acctNotes[oldId]) { s.acctNotes[newName] = s.acctNotes[oldId]; delete s.acctNotes[oldId]; }
  if (s.acctMemo && s.acctMemo[oldId]) { s.acctMemo[newName] = s.acctMemo[oldId]; delete s.acctMemo[oldId]; }
  lsSet("fin_settings", s);
  showToast(`Renamed to ${newName}`);
  renderAccGrid();
}
function _accDeleteAccount(id) {
  const go = () => { _accBuckets = _accBuckets.filter(b => b.id !== id); _accDraft.forEach(m => { delete m.vals[id]; }); if (!_accDeletedIds.includes(id)) _accDeletedIds.push(id); _accSetDirty(); renderAccGrid(); };
  if (typeof confirmDialog === "function") confirmDialog({ title: "Delete account?", message: `Delete "${id}"? Its balances are removed when you Save changes.`, confirmLabel: "Delete", cancelLabel: "Cancel", danger: true }, go);
  else go();
}
function _accAddTypePop(anchor) {
  _accClosePops();
  const pop = document.createElement("div"); pop.className = "acc-pop"; pop.id = "acc-pop";
  pop.innerHTML = `<label>New type</label><input type="text" id="acc-pop-type-name" placeholder="e.g. Crypto" autocomplete="off"><div class="acc-pop-row"><button class="acc-pop-cancel">Cancel</button><button class="acc-pop-add">Add</button></div>`;
  _accMountPop(pop, anchor);
  const inp = pop.querySelector("#acc-pop-type-name"); inp.focus();
  pop.querySelector(".acc-pop-cancel").addEventListener("click", _accClosePops);
  pop.querySelector(".acc-pop-add").addEventListener("click", () => {
    const name = inp.value.trim(); if (!name) { inp.focus(); return; }
    if (_accTypes.some(t => t.toLowerCase() === name.toLowerCase())) { showToast("That type already exists"); return; }
    _accTypes.push(name); _accClosePops(); _accSetDirty(); renderAccGrid();
  });
}
function _accDeleteType(type) {
  if (_accBuckets.some(b => (b.type || "") === type)) { showToast("Move its accounts out first"); return; }
  _accTypes = _accTypes.filter(t => t !== type); _accSetDirty(); renderAccGrid();
}
// move account `dragId` into `targetType`, positioned before `beforeId` (else appended to the type)
function _accMoveAccount(dragId, targetType, beforeId) {
  const b = _accBucket(dragId); if (!b) return;
  b.type = targetType;
  _accBuckets = _accBuckets.filter(x => x.id !== dragId);
  let at;
  if (beforeId && beforeId !== dragId) { at = _accBuckets.findIndex(x => x.id === beforeId); if (at < 0) at = _accBuckets.length; }
  else { let last = -1; _accBuckets.forEach((x, i) => { if ((x.type || "") === targetType) last = i; }); at = last < 0 ? _accBuckets.length : last + 1; }
  _accBuckets.splice(at, 0, b);
  _accSetDirty(); renderAccGrid();
}
// pointer-drag to move accounts between type subheadings (+ reorder)
function _accWireAcctDnD(wrap) {
  wrap.querySelectorAll(".acc-g-row .drag-handle").forEach(handle => {
    const row = handle.closest(".acc-g-row"); if (!row) return;
    handle.style.touchAction = "none";
    handle.addEventListener("pointerdown", ev => {
      if (ev.button) return;
      ev.preventDefault();
      const dragId = row.dataset.cat;
      handle.setPointerCapture?.(ev.pointerId);
      row.classList.add("acc-dragging");
      let tType = null, beforeId = null, lastHi = null;
      const clearHi = () => { if (lastHi) { lastHi.classList.remove("acc-drop-into"); lastHi = null; } };
      const onMove = e => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const overRow = el && el.closest(".acc-g-row");
        const overGroup = el && el.closest(".acc-g-group");
        clearHi();
        if (overRow && overRow !== row && wrap.contains(overRow)) { tType = overRow.dataset.type; beforeId = overRow.dataset.cat; overRow.classList.add("acc-drop-into"); lastHi = overRow; }
        else if (overGroup && wrap.contains(overGroup)) { tType = overGroup.dataset.type; beforeId = null; overGroup.classList.add("acc-drop-into"); lastHi = overGroup; }
        else { tType = null; }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        row.classList.remove("acc-dragging"); clearHi();
        try { handle.releasePointerCapture?.(ev.pointerId); } catch {}
        if (tType != null) _accMoveAccount(dragId, tType, beforeId);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  });
}

// rename a type subheading — reassigns every account in it to the new type name
function _accRenameType(oldName, newName) {
  if (_accTypes.some(t => t.toLowerCase() === newName.toLowerCase() && t !== oldName)) { showToast("That type already exists"); renderAccGrid(); return; }
  _accTypes = _accTypes.map(t => t === oldName ? newName : t);
  _accBuckets.forEach(b => { if ((b.type || "") === oldName) b.type = newName; });
  _accSetDirty(); renderAccGrid();
}
// reorder a whole type subheading (its accounts follow, since rows render in _accTypes order)
function _accMoveType(dragType, beforeType) {
  if (dragType === beforeType) return;
  _accTypes = _accTypes.filter(t => t !== dragType);
  let at = _accTypes.indexOf(beforeType);
  if (at < 0) at = _accTypes.length;
  _accTypes.splice(at, 0, dragType);
  _accSetDirty(); renderAccGrid();
}
// pointer-drag a type subheading to reorder it (drop onto another type / account → before that type)
function _accWireTypeDnD(wrap) {
  wrap.querySelectorAll(".acc-g-group .drag-handle").forEach(handle => {
    const grp = handle.closest(".acc-g-group"); if (!grp) return;
    handle.style.touchAction = "none";
    handle.addEventListener("pointerdown", ev => {
      if (ev.button) return;
      ev.preventDefault();
      const dragType = grp.dataset.type;
      handle.setPointerCapture?.(ev.pointerId);
      grp.classList.add("acc-dragging");
      let overType = null, lastHi = null;
      const clearHi = () => { if (lastHi) { lastHi.classList.remove("acc-drop-into"); lastHi = null; } };
      const onMove = e => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const og = el && (el.closest(".acc-g-group") || el.closest(".acc-g-row"));
        clearHi();
        if (og && og !== grp && wrap.contains(og) && og.dataset.type && og.dataset.type !== dragType) {
          overType = og.dataset.type;
          const target = wrap.querySelector(`.acc-g-group[data-type="${CSS.escape(overType)}"]`) || og;
          target.classList.add("acc-drop-into"); lastHi = target;
        } else { overType = null; }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        grp.classList.remove("acc-dragging"); clearHi();
        try { handle.releasePointerCapture?.(ev.pointerId); } catch {}
        if (overType != null) _accMoveType(dragType, overType);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  });
}

function renderAccSnapBar(entries) {
  const bar = document.getElementById("acc-snap-bar");
  if (!bar) return;
  if (!entries.length) {
    bar.innerHTML = `
      <div class="acc-snap-left"><svg class="acc-snap-cal" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span>View snapshot for</span><strong>No snapshots</strong></div>
      <button class="acc-snap-mgr-btn" id="acc-snap-open-mgr">Edit snapshots</button>`;
    bar.querySelector("#acc-snap-open-mgr").addEventListener("click", openAccSnapMgr);
    return;
  }

  const idx = _accEntryIdx();
  const entry = _accEntry();
  const isLatest = idx === entries.length - 1;
  bar.innerHTML = `
    <div class="acc-snap-left">
      <svg class="acc-snap-cal" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      <span>View snapshot for</span>
      <button class="icon-btn acc-snap-nav" id="acc-snap-prev" title="Previous snapshot" ${idx <= 0 ? "disabled" : ""}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <select id="acc-snap-select" aria-label="View snapshot month">
        ${entries.map((e, i) => `<option value="${i}"${i === idx ? " selected" : ""}>${e.month}</option>`).join("")}
      </select>
      <button class="icon-btn acc-snap-nav" id="acc-snap-next" title="Next snapshot" ${idx >= entries.length - 1 ? "disabled" : ""}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>
    <div class="acc-snap-note">Showing ${isLatest ? "latest" : "historical"} snapshot for ${entry.month}</div>
    <button class="acc-snap-mgr-btn" id="acc-snap-open-mgr">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      Edit snapshots
    </button>`;

  bar.querySelector("#acc-snap-prev").addEventListener("click", () => {
    if (idx > 0) {
      _accViewIdx = idx - 1;
      renderAccountsTab();
    }
  });
  bar.querySelector("#acc-snap-next").addEventListener("click", () => {
    const newIdx = idx + 1;
    _accViewIdx = newIdx >= entries.length - 1 ? null : newIdx;
    renderAccountsTab();
  });
  bar.querySelector("#acc-snap-select").addEventListener("change", e => {
    const next = Number(e.target.value);
    _accViewIdx = next >= entries.length - 1 ? null : next;
    renderAccountsTab();
  });
  bar.querySelector("#acc-snap-open-mgr").addEventListener("click", openAccSnapMgr);
}

function _accRecentActivity(catId) {
  const txns = (typeof getTxns === "function" ? getTxns() : []).filter(t => {
    const vals = [t.account, t.fromAccount, t.toAccount, t.description, t.notes].filter(Boolean).join(" ").toLowerCase();
    return vals.includes(catId.toLowerCase());
  });
  return txns.sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 3);
}

function openAccPanel(catId) {
  _accSelectedCat = catId;
  const panel = document.getElementById("acc-panel");
  const cat = NW_CATS.find(c => c.id === catId);
  const entry = _accEntry();
  const prev = _accPrevEntry();
  if (!panel || !cat || !entry) return;

  const value = _accValue(entry, catId);
  const prevValue = prev ? _accValue(prev, catId) : value;
  const delta = value - prevValue;
  const type = _accType(catId, value);
  const status = _accStatus({ value, delta });
  const trendVals = _accTrend(catId);
  const trend = sparkline(trendVals, { w: 170, h: 58, stroke: value < 0 || delta < 0 ? "var(--neg)" : "var(--pos)", strokeWidth: 1.8 });
  const note = (typeof getAcctNote === "function" ? getAcctNote(catId) : "") || "";
  const recent = _accRecentActivity(catId);
  const icon = ACC_ICONS[cat.id] || cat.id.trim()[0]?.toUpperCase() || "?";

  panel.innerHTML = `
    <div class="acc-panel-head">
      <span class="acc-list-ic acc-panel-icon" style="background:color-mix(in oklch,${cat.color} 55%,transparent)">${icon}</span>
      <div>
        <h2>${cat.id}</h2>
        <p>${type}</p>
      </div>
      <button class="acc-panel-close" data-action="close-panel" aria-label="Close account details" title="Close">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <section class="acc-panel-section">
      <label>Current balance (${entry.month})</label>
      <strong class="num blur acc-panel-bal${value < 0 ? " neg" : ""}">${fmtGBP(value, { dp: 0 })}</strong>
    </section>

    <div class="acc-mini-grid">
      <div class="acc-mini-card">
        <span>This month</span>
        <strong class="num blur${delta > 0 ? " pos" : delta < 0 ? " neg" : ""}">${delta === 0 ? "—" : `${delta > 0 ? "+" : "-"}${fmtGBP(Math.abs(delta), { dp: 0 })}`}</strong>
        <small>vs last snapshot</small>
      </div>
      <div class="acc-mini-card">
        <span>30 day trend</span>
        ${trend || `<strong class="acc-muted">—</strong>`}
      </div>
    </div>

    <section class="acc-panel-section">
      <label>Account status</label>
      <div class="acc-status-line"><span class="dot ${status.tone}"></span><strong>${status.label}</strong></div>
      <p>${status.tone === "bad" ? "This account needs attention." : status.tone === "watch" ? "Keep an eye on this account." : "Your account is in good shape."}</p>
    </section>

    <section class="acc-panel-section">
      <div class="acc-panel-row-head">
        <label>Recent activity</label>
        <button class="acc-link" data-action="view-tx">View all transactions</button>
      </div>
      <div class="acc-activity-list">
        ${recent.length ? recent.map(t => {
          const amt = Number(t.amount || 0);
          const sign = t.type === "in" ? "+" : t.type === "transfer" ? "" : "-";
          const tone = t.type === "in" ? "pos" : t.type === "transfer" ? "transfer" : "neg";
          return `<div class="acc-activity-row">
            <span><strong>${t.description || (t.type === "transfer" ? "Transfer" : "Transaction")}</strong><small>${t.date || ""}</small></span>
            <em class="num ${tone}">${sign}${fmtGBP(Math.abs(amt), { dp: 2 })}</em>
          </div>`;
        }).join("") : `<div class="acc-muted">No matching transactions yet.</div>`}
      </div>
    </section>

    <section class="acc-panel-section">
      <label>Account details</label>
      <div class="acc-detail-grid">
        <span>Account type</span><strong>${type}</strong>
        <span>Provider</span><strong>${_accProvider(catId)}</strong>
        <span>Notes</span><strong>${note || "—"}</strong>
      </div>
    </section>`;

  panel.querySelector("[data-action='view-tx']")?.addEventListener("click", () => {
    switchPage("transactions");
    const s = document.getElementById("tx-all-search");
    if (s) { s.value = catId; s.dispatchEvent(new Event("input", { bubbles: true })); }
  });
  panel.querySelector("[data-action='close-panel']")?.addEventListener("click", closeAccPanel);

  panel.hidden = false;
  document.querySelectorAll("#acc-grid .acc-g-row").forEach(r => r.classList.toggle("selected", r.dataset.cat === catId));
}

function closeAccPanel() {
  _accSelectedCat = null;
  const panel = document.getElementById("acc-panel");
  if (panel) panel.innerHTML = "";
  document.querySelectorAll("#acc-grid .acc-g-row").forEach(r => r.classList.remove("selected"));
}

function editAccBalance(catId) {
  const sorted = nwSnapshotsSorted();
  openNWModal(sorted.length ? sorted.length - 1 : null);
  setTimeout(() => document.getElementById("nw-m-" + safeId(catId))?.focus(), 100);
}

function openAccTransfer(catId) {
  if (typeof openTxModal !== "function") { showToast("Transfer editor unavailable"); return; }
  openTxModal(null, "transfer");
  setTimeout(() => {
    const from = document.getElementById("tx-m-from");
    if (from && [...from.options].some(o => o.value === catId)) from.value = catId;
  }, 50);
}

function openAccEdit(catId) {
  if (typeof openAcctEditModal === "function") openAcctEditModal(catId);
  else switchPage("settings");
}

function openAccSnapMgr() {
  const modal = document.getElementById("acc-snap-mgr");
  if (!modal) return;
  renderAccSnapMgrList();
  modal.hidden = false;
}

function closeAccSnapMgr() {
  const modal = document.getElementById("acc-snap-mgr");
  if (modal) modal.hidden = true;
}

function renderAccSnapMgrList() {
  const tbody = document.getElementById("acc-snap-mgr-rows");
  if (!tbody) return;
  const entries = nwSnapshotsSorted();
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="acc-mgr-empty">No snapshots yet. Create the first one to start tracking balances.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.slice().reverse().map((e, displayIdx) => {
    const sortedIdx = entries.length - 1 - displayIdx;
    const total = nwTotalE(e);
    const prev = sortedIdx > 0 ? entries[sortedIdx - 1] : null;
    const delta = prev ? total - nwTotalE(prev) : null;
    const locked = !!e.locked;
    return `<tr>
      <td><strong>${e.month}</strong></td>
      <td class="num blur">${fmtGBP(total, { dp: 0 })}</td>
      <td class="num${delta > 0 ? " pos" : delta < 0 ? " neg" : ""}">${delta === null ? "—" : `${delta >= 0 ? "+" : "-"}${fmtGBP(Math.abs(delta), { dp: 0 })}`}</td>
      <td><span class="acc-lock-state ${locked ? "locked" : ""}">${locked ? "Locked" : "Editable"}</span></td>
      <td>
        <div class="acc-mgr-actions">
          <button class="btn-ghost" onclick="openAccMgrEdit(${sortedIdx})" ${locked ? "disabled" : ""}>Edit</button>
          <button class="btn-ghost" onclick="dupAccSnap(${sortedIdx})">Duplicate</button>
          <button class="btn-ghost" onclick="toggleAccSnapLock(${sortedIdx})">${locked ? "Unlock" : "Lock"}</button>
          <button class="btn-danger" onclick="deleteAccSnap(${sortedIdx})" ${locked ? "disabled" : ""}>Delete</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function openAccMgrEdit(idx) {
  const entry = nwSnapshotsSorted()[idx];
  if (entry?.locked) { showToast("Snapshot is locked"); return; }
  closeAccSnapMgr();
  openNWModal(idx);
  const title = document.getElementById("nw-modal-title");
  if (title && entry) title.textContent = `Edit Snapshot — ${entry.month}`;
}

function dupAccSnap(idx) {
  const entries = nwSnapshotsSorted();
  const source = entries[idx];
  if (!source) return;
  const d = new Date(monthToTime(source.month));
  d.setMonth(d.getMonth() + 1);
  const newMonth = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (entries.find(e => e.month === newMonth)) { showToast(`${newMonth} already exists`); return; }
  const all = getNWEntries();
  all.push({ month: newMonth, allocations: source.allocations.map(a => ({ ...a })), locked: false });
  lsSet("fin_nw_entries", all);
  showToast(`Duplicated to ${newMonth}`);
  renderAccSnapMgrList();
  renderAll();
}

function toggleAccSnapLock(idx) {
  const entries = nwSnapshotsSorted();
  const target = entries[idx];
  if (!target) return;
  const all = getNWEntries();
  const realIdx = all.findIndex(e => e === target || e.month === target.month);
  if (realIdx < 0) return;
  all[realIdx].locked = !all[realIdx].locked;
  lsSet("fin_nw_entries", all);
  showToast(all[realIdx].locked ? "Snapshot locked" : "Snapshot unlocked");
  renderAccSnapMgrList();
}

function deleteAccSnap(idx) {
  const entry = nwSnapshotsSorted()[idx];
  if (entry?.locked) { showToast("Unlock this snapshot before deleting it"); return; }
  deleteNWSnapshot(idx);
  setTimeout(() => {
    renderAccSnapMgrList();
    renderAccountsTab();
  }, 30);
}

(function wireAccMgr() {
  document.getElementById("acc-snap-mgr-close")?.addEventListener("click", closeAccSnapMgr);
  document.getElementById("acc-snap-mgr-add")?.addEventListener("click", () => { closeAccSnapMgr(); openNWModal(null); });
  document.getElementById("acc-snap-mgr")?.addEventListener("click", e => { if (e.target.id === "acc-snap-mgr") closeAccSnapMgr(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !document.getElementById("acc-snap-mgr")?.hidden) closeAccSnapMgr(); });
})();

// Checklist popover: pick which accounts appear in the Interest earned table.
function _accIntTogglePop(anchor) {
  if (document.getElementById("acc-pop")) { _accClosePops(); return; }
  _accClosePops();
  if (!_accIntAccts.length) return;
  const hidden = _accIntHiddenSet();
  const pop = document.createElement("div");
  pop.className = "acc-pop"; pop.id = "acc-pop";
  pop.innerHTML = `<label>Show accounts</label>` +
    _accIntAccts.map(a => `<label class="acc-pop-check"><input type="checkbox" data-acct="${_accEsc(a)}"${hidden.has(a) ? "" : " checked"}> ${_accEsc(a)}</label>`).join("") +
    `<div class="acc-pop-row"><button class="acc-pop-cancel" id="acc-int-showall">Show all</button></div>`;
  _accMountPop(pop, anchor);
  pop.addEventListener("change", e => {
    const cb = e.target.closest("input[data-acct]"); if (!cb) return;
    const s = getSettings(); const set = new Set(s.acctIntHidden || []);
    if (cb.checked) set.delete(cb.dataset.acct); else set.add(cb.dataset.acct);
    s.acctIntHidden = [...set]; lsSet("fin_settings", s);
    renderAccInterest();
  });
  pop.querySelector("#acc-int-showall")?.addEventListener("click", () => {
    const s = getSettings(); s.acctIntHidden = []; lsSet("fin_settings", s);
    renderAccInterest(); _accClosePops();
  });
}

// Balances view picker (Balances grid ↔ Transfers & Interest) + transfers account filter.
(function wireAccView() {
  document.getElementById("acc-section-tabs")?.addEventListener("click", e => {
    const b = e.target.closest("[data-acc-view]"); if (!b) return;
    setAccView(b.dataset.accView);
  });
  document.getElementById("acc-tfr-filter")?.addEventListener("change", e => {
    _accTfrFilter = e.target.value || "";
    renderAccTransfers();
  });
  document.getElementById("acc-int-picker")?.addEventListener("click", e => {
    e.stopPropagation();
    _accIntTogglePop(e.currentTarget);
  });
})();
