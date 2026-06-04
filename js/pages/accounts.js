/* ==========================================================================
   ACCOUNTS PAGE
========================================================================== */

let _accViewIdx = null;    // null = latest snapshot; number = sorted index
let _accSelectedCat = null;

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
  const text = `${catId} ${typeof getAcctNote === "function" ? getAcctNote(catId) : ""}`;
  if (value < 0 || /credit|loan|debt|overdraft|amex/i.test(text)) return "debt";
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
  const entries = nwSnapshotsSorted();
  if (_accViewIdx !== null && _accViewIdx >= entries.length) _accViewIdx = null;
  renderAccSummary(entries);
  renderAccList(entries);
  renderAccSnapBar(entries);
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

function renderAccList() {
  const list = document.getElementById("acc-list");
  const sub = document.getElementById("acc-list-sub");
  const entry = _accEntry();
  const prev = _accPrevEntry();
  if (!list) return;

  if (!entry) {
    list.innerHTML = `<div class="page-stub"><h3>No accounts yet</h3><div>Use Add Snapshot to record account balances.</div></div>`;
    if (sub) sub.textContent = "No snapshots yet";
    closeAccPanel();
    return;
  }

  const rows = _accRows(entry, prev);
  if (sub) sub.textContent = `${rows.length} account${rows.length === 1 ? "" : "s"} in ${entry.month}`;
  if (!rows.length) {
    list.innerHTML = `<div class="page-stub acc-empty"><h3>No balances recorded</h3><div>Add balances to this snapshot to start tracking accounts.</div></div>`;
    closeAccPanel();
    return;
  }

  const grouped = {
    assets: rows.filter(r => r.section === "assets").sort((a, b) => b.value - a.value),
    debt: rows.filter(r => r.section === "debt").sort((a, b) => a.value - b.value),
    cash: rows.filter(r => r.section === "cash").sort((a, b) => b.value - a.value),
  };
  const labels = { assets: "Assets", debt: "Debt", cash: "Cash" };

  const rowHtml = row => {
    const c = row.cat;
    const status = _accStatus(row);
    const trendVals = _accTrend(c.id);
    const trendCol = row.delta < 0 || row.value < 0 ? "var(--neg)" : "var(--pos)";
    const trend = sparkline(trendVals, { w: 104, h: 28, stroke: trendCol, strokeWidth: 1.6 }) || `<span class="acc-muted">—</span>`;
    const deltaText = row.delta === 0 ? "—" : `${row.delta > 0 ? "+" : "-"}${fmtGBP(Math.abs(row.delta), { dp: 0 })}`;
    const icon = ACC_ICONS[c.id] || c.id.trim()[0]?.toUpperCase() || "?";
    return `<button class="acc-list-row${_accSelectedCat === c.id ? " selected" : ""}" data-cat-id="${c.id.replace(/"/g, "&quot;")}">
      <span class="acc-list-ic" style="background:color-mix(in oklch,${c.color} 50%,transparent)">${icon}</span>
      <span class="acc-account-cell">
        <strong>${c.id}</strong>
        <small>${row.type}</small>
      </span>
      <span class="num blur acc-row-amount${row.value < 0 ? " neg" : ""}">${fmtGBP(row.value, { dp: 0 })}</span>
      <span class="num blur acc-row-delta${row.delta > 0 ? " pos" : row.delta < 0 ? " neg" : ""}">${deltaText}</span>
      <span class="acc-row-trend">${trend}</span>
      <span class="acc-status ${status.tone}">${status.label}</span>
      <span class="acc-row-arrow" aria-hidden="true">›</span>
    </button>`;
  };

  list.innerHTML = Object.keys(grouped).map(key => {
    if (!grouped[key].length) return "";
    return `<div class="acc-section-head">${labels[key]}</div>${grouped[key].map(rowHtml).join("")}`;
  }).join("");

  list.querySelectorAll(".acc-list-row[data-cat-id]").forEach(row => {
    row.addEventListener("click", () => openAccPanel(row.dataset.catId));
  });

  const visibleIds = rows.map(r => r.cat.id);
  if (!_accSelectedCat || !visibleIds.includes(_accSelectedCat)) _accSelectedCat = rows[0].cat.id;
  openAccPanel(_accSelectedCat);
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
  const isLatest = _accIsLatest();
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
    </section>

    <div class="acc-panel-actions">
      <button class="btn-ghost" data-action="add-balance" ${isLatest ? "" : "disabled"} title="${isLatest ? "Edit latest snapshot balance" : "Use Edit snapshots for historical months"}">Add balance</button>
      <button class="btn-ghost" data-action="transfer">Transfer</button>
      <button class="btn-ghost" data-action="edit-account">Edit account</button>
    </div>`;

  panel.querySelector("[data-action='add-balance']")?.addEventListener("click", () => {
    if (isLatest) editAccBalance(catId);
  });
  panel.querySelector("[data-action='transfer']")?.addEventListener("click", () => openAccTransfer(catId));
  panel.querySelector("[data-action='edit-account']")?.addEventListener("click", () => openAccEdit(catId));
  panel.querySelector("[data-action='view-tx']")?.addEventListener("click", () => {
    switchPage("transactions");
    const s = document.getElementById("tx-all-search");
    if (s) { s.value = catId; s.dispatchEvent(new Event("input", { bubbles: true })); }
  });
  panel.querySelector("[data-action='close-panel']")?.addEventListener("click", closeAccPanel);

  panel.hidden = false;
  document.querySelectorAll("#acc-list .acc-list-row").forEach(r => r.classList.toggle("selected", r.dataset.catId === catId));
}

function closeAccPanel() {
  _accSelectedCat = null;
  const panel = document.getElementById("acc-panel");
  if (panel) panel.innerHTML = "";
  document.querySelectorAll("#acc-list .acc-list-row").forEach(r => r.classList.remove("selected"));
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
