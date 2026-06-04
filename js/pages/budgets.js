/* ════════════════════════════════════════
   BUDGETS PAGE
════════════════════════════════════════ */
let _budEditId = null;
let _budDetailId = null;
let _budExpanded = false;
let _budStatusFilter = "all";
let _budSort = "priority";
const _budSelected = new Set();

function budCatOf(b) { return b.id || b.category; }
function budgetTypeFor(cat) {
  if (/housing|insurance|repay|subscription|medical|education|transport/i.test(cat)) return "Essential";
  if (/grocer|dining|fees|misc|sports|clothing/i.test(cat)) return "Variable";
  return "Discretionary";
}
function budgetMonthPace() {
  const today = new Date();
  const dim = new Date(_viewMonth.y, _viewMonth.m + 1, 0).getDate();
  let day = 0;
  if (_viewMonth.y === today.getFullYear() && _viewMonth.m === today.getMonth()) day = today.getDate();
  else if (new Date(_viewMonth.y, _viewMonth.m + 1, 0) < today) day = dim;
  return { dim, day, pct: dim ? (day / dim) * 100 : 0 };
}
function budgetStatus(b, spent) {
  const pct = b.amount ? (spent / b.amount) * 100 : 0;
  const pace = budgetMonthPace().pct;
  if (spent > b.amount) return { key: "over", label: "Over budget" };
  if (pct >= 90 || (pace > 0 && pct > pace + 18)) return { key: "watch", label: "Watch" };
  return { key: "track", label: "On track" };
}
function budgetSortScore(b, actuals) {
  const spent = actuals[budCatOf(b)] || 0;
  const s = budgetStatus(b, spent).key;
  const statusRank = s === "over" ? 0 : s === "watch" ? 1 : 2;
  return [statusRank, -spent, String(budCatOf(b)).toLowerCase()];
}
function sortedBudgets(buds, actuals) {
  return buds.slice().sort((a, b) => {
    if (_budSort === "category") return String(budCatOf(a)).localeCompare(String(budCatOf(b)));
    if (_budSort === "spent") return (actuals[budCatOf(b)] || 0) - (actuals[budCatOf(a)] || 0);
    const aa = budgetSortScore(a, actuals), bb = budgetSortScore(b, actuals);
    return aa[0] - bb[0] || aa[1] - bb[1] || aa[2].localeCompare(bb[2]);
  });
}
function budgetActualsForMonth() {
  const cur = mStat(getTxns(), _viewMonth.y, _viewMonth.m);
  // Net refunds against the matching expense bucket — see netSpendByCategory.
  // Without this a £369 refund would still leave the budget bar pinned at £369.
  const actuals = netSpendByCategory(cur.txns);
  return { actuals, txns: cur.txns };
}

function renderBud() {
  if (typeof renderAllocPlan === "function") renderAllocPlan();
  const buds = getBudgets().filter(b => b.type === "out");
  const { actuals, txns } = budgetActualsForMonth();
  document.getElementById("bud-sub").textContent = "Plan, track and manage your spending";
  if (_budDetailId && !buds.some(b => String(budCatOf(b)) === String(_budDetailId))) _budDetailId = buds.length ? budCatOf(buds[0]) : null;
  renderBudKPIs(buds, actuals);
  renderBudGrid(buds, actuals);
  renderUnbudgeted(buds, actuals);
  renderBudgetDetail(buds, actuals, txns);
  renderBudBulkBar();
}

function renderBudKPIs(buds, actuals) {
  const totalBud = buds.reduce((s, b) => s + b.amount, 0);
  const totalSpent = buds.reduce((s, b) => s + (actuals[budCatOf(b)] || 0), 0);
  const remaining = totalBud - totalSpent;
  const stats = buds.map(b => budgetStatus(b, actuals[budCatOf(b)] || 0).key);
  const onTrack = stats.filter(s => s === "track").length;
  const over = stats.filter(s => s === "over").length;
  const spentPct = totalBud ? Math.round(totalSpent / totalBud * 100) : 0;
  const ICONS = {
    list:   `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>`,
    down:   `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>`,
    wallet: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19"/><path d="M16 14.5h3"/></svg>`,
    check:  `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>`,
    alert:  `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/></svg>`,
  };
  const cards = [
    { label: "Total budget", value: fmtGBP(totalBud, { dp: 0 }), sub: "Monthly limit", cls: "", ic: ICONS.list, tone: "" },
    { label: "Total spent", value: fmtGBP(totalSpent, { dp: 0 }), sub: `${spentPct}% of budget`, cls: totalSpent > totalBud ? "neg" : "", ic: ICONS.down, tone: "neg" },
    { label: "Total remaining", value: `${remaining < 0 ? "-" : ""}${fmtGBP(Math.abs(remaining), { dp: 0 })}`, sub: remaining < 0 ? "Over budget" : "Left to spend", cls: remaining < 0 ? "neg" : "pos", ic: ICONS.wallet, tone: remaining < 0 ? "neg" : "pos" },
    { label: "On track", value: String(onTrack), sub: `${buds.length ? Math.round(onTrack / buds.length * 100) : 0}% of budgets`, cls: "pos", ic: ICONS.check, tone: "pos" },
    { label: "Over budget", value: String(over), sub: `${buds.length ? Math.round(over / buds.length * 100) : 0}% of budgets`, cls: "neg", ic: ICONS.alert, tone: "neg" },
  ];
  document.getElementById("bud-kpis").innerHTML = cards.map(c => `
    <div class="bud-kpi-card">
      <div class="bud-kpi-copy">
        <span>${c.label}</span>
        <b class="blur ${c.cls}">${c.value}</b>
        <small>${c.sub}</small>
      </div>
      <span class="bud-kpi-ic ${c.tone}">${c.ic}</span>
    </div>
  `).join("");
}

function renderBudGrid(buds, actuals) {
  const grid = document.getElementById("bud-grid");
  const rowCount = document.getElementById("bud-row-count");
  const toggle = document.getElementById("bud-view-toggle");
  const foot = document.getElementById("bud-list-foot");
  if (!buds.length) {
    rowCount.textContent = "";
    toggle.hidden = true;
    if (foot) foot.style.display = "none";
    grid.innerHTML = `<div class="page-stub"><h3>No budgets yet</h3><div>Click <b>Add budget</b> to set monthly limits per category.</div></div>`;
    return;
  }
  const sorted = sortedBudgets(buds, actuals);
  const filtered = _budStatusFilter === "all" ? sorted : sorted.filter(b => budgetStatus(b, actuals[budCatOf(b)] || 0).key === _budStatusFilter);
  const visible = _budExpanded ? filtered : filtered.slice(0, 5);
  if (foot) foot.style.display = "";
  rowCount.textContent = `Show ${visible.length} of ${filtered.length} budgets`;
  renderBudgetStatusTabs(sorted, actuals);
  const sortSel = document.getElementById("bud-sort");
  if (sortSel) sortSel.value = _budSort;
  toggle.hidden = filtered.length <= 5;
  toggle.textContent = _budExpanded ? "Show fewer" : "View all budgets";
  grid.innerHTML = visible.map(b => budgetRowHTML(b, actuals)).join("");
}

function renderBudgetStatusTabs(buds, actuals) {
  const counts = { all: buds.length, track: 0, watch: 0, over: 0 };
  buds.forEach(b => counts[budgetStatus(b, actuals[budCatOf(b)] || 0).key]++);
  document.querySelectorAll("#bud-status-tabs button").forEach(btn => {
    const f = btn.dataset.budFilter;
    btn.classList.toggle("active", f === _budStatusFilter);
    const label = f === "all" ? "All" : f === "track" ? "On track" : f === "watch" ? "Watch" : "Over budget";
    btn.textContent = `${label} (${counts[f] || 0})`;
  });
}

function budgetRowHTML(b, actuals) {
  const c = budCatOf(b);
  const cat = CAT_BY[c] || {};
  const spent = actuals[c] || 0;
  const remaining = b.amount - spent;
  const pct = b.amount ? (spent / b.amount) * 100 : 0;
  const status = budgetStatus(b, spent);
  const fillColor = status.key === "over" ? "var(--neg)" : status.key === "watch" ? "var(--warn)" : (cat.color || "var(--pos)");
  const id = String(budCatOf(b)).replace(/'/g, "\\'");
  return `<div class="bud-row-full${String(_budDetailId) === String(budCatOf(b)) ? " active" : ""}">
    <span class="bud-row-cat">
      <span class="bud-row-icon" style="background:color-mix(in oklch,${cat.color || "var(--ink-3)"} 28%,var(--bg-sunk))">${iconFor(c)}</span>
      <span><b>${c}</b><small>${budgetTypeFor(c)}</small></span>
    </span>
    <span class="num blur">${fmtGBP(b.amount)}</span>
    <span class="num blur">${fmtGBP(spent)}</span>
    <span class="num blur ${remaining < 0 ? "neg" : "pos"}">${remaining < 0 ? "-" : ""}${fmtGBP(Math.abs(remaining))}</span>
    <span class="bud-progress-cell"><i><em style="width:${Math.min(100, pct).toFixed(0)}%;background:${fillColor}"></em></i><small>${pct.toFixed(0)}%</small></span>
    <span class="bud-status ${status.key}">${status.label}</span>
    <button class="bud-arrow" onclick="selectBudgetDetail('${id}')" title="Open budget details" aria-label="Open budget details"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
  </div>`;
}
function toggleBudgetListExpanded() { _budExpanded = !_budExpanded; renderBud(); }
function selectBudgetDetail(id) { _budDetailId = id; renderBud(); }
document.getElementById("bud-view-toggle").addEventListener("click", toggleBudgetListExpanded);
document.getElementById("bud-status-tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-bud-filter]"); if (!b) return;
  _budStatusFilter = b.dataset.budFilter;
  _budExpanded = false;
  renderBud();
});
document.getElementById("bud-sort").addEventListener("change", e => { _budSort = e.target.value; renderBud(); });

function renderBudgetDetail(buds, actuals, monthTxns) {
  const panel = document.getElementById("bud-detail-panel");
  const b = buds.find(x => String(budCatOf(x)) === String(_budDetailId));
  if (!b) {
    renderBudgetSummaryRail(panel, buds, actuals, monthTxns);
    return;
  }
  const c = budCatOf(b);
  const spent = actuals[c] || 0;
  const remaining = b.amount - spent;
  const status = budgetStatus(b, spent);
  const pace = budgetMonthPace().pct;
  const expected = b.amount * (pace / 100);
  const recent = monthTxns.filter(t => normType(t) === "out" && txCategoryEntries(t).some(e => e.category === c)).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0, 5);
  const id = String(c).replace(/'/g, "\\'");
  panel.innerHTML = `
    <div class="bud-detail-title">
      <div><h2>${c}</h2><span>${budgetTypeFor(c)}</span></div>
      <span class="bud-status ${status.key}">${status.label}</span>
    </div>
    <div class="bud-detail-stats">
      <div><span>Budget amount</span><b class="blur">${fmtGBP(b.amount)}</b></div>
      <div><span>Spent</span><b class="blur">${fmtGBP(spent)}</b></div>
      <div><span>Remaining</span><b class="blur ${remaining < 0 ? "neg" : "pos"}">${remaining < 0 ? "-" : ""}${fmtGBP(Math.abs(remaining))}</b></div>
    </div>
    <div class="bud-detail-section">
      <h3>Pacing status</h3>
      <p>You're <b class="${spent <= expected ? "pos" : "neg"}">${fmtGBP(Math.abs(expected - spent), { dp: 0 })}</b> ${spent <= expected ? "below" : "ahead of"} expected pace.</p>
      <div class="bud-pace-mini"><span style="width:${Math.min(100, spent / b.amount * 100).toFixed(0)}%"></span><i style="left:${Math.min(100, pace).toFixed(0)}%"></i></div>
    </div>
    <div class="bud-detail-section">
      <h3>Recent transactions</h3>
      <div class="bud-recent-list">${recent.length ? recent.map(t => `<div><span>${t.description || c}<small>${t.date || ""}</small></span><b class="blur">-${fmtGBP(t.amount)}</b></div>`).join("") : `<p>No recent transactions this month.</p>`}</div>
    </div>
    <div class="bud-detail-actions">
      <button class="btn-ghost" onclick="openBudModal('${id}')">Edit budget</button>
      <button class="btn-danger" onclick="deleteBud('${id}')">Delete budget</button>
    </div>
  `;
}

function renderBudgetSummaryRail(panel, buds, actuals, monthTxns) {
  const totalBud = buds.reduce((s,b)=>s+b.amount,0);
  const totalSpent = buds.reduce((s,b)=>s+(actuals[budCatOf(b)]||0),0);
  const remaining = Math.max(0, totalBud - totalSpent);
  const statusCounts = { track: 0, watch: 0, over: 0 };
  buds.forEach(b => statusCounts[budgetStatus(b, actuals[budCatOf(b)] || 0).key]++);
  const pct = totalBud ? Math.min(100, totalSpent / totalBud * 100) : 0;
  const pace = budgetMonthPace().pct;
  const expected = totalBud * (pace / 100);
  const updates = sortedBudgets(buds, actuals).slice(0, 3);
  panel.innerHTML = `
    <div class="bud-rail-card">
      <h2>Budget summary</h2>
      <div class="bud-donut" style="--spent:${pct * 3.6}deg"><b>${fmtGBP(totalSpent,{dp:0})}</b><span>of ${fmtGBP(totalBud,{dp:0})}</span></div>
      <div class="bud-legend">
        <span><i class="track"></i>On track <b>${statusCounts.track}</b></span>
        <span><i class="watch"></i>Watch <b>${statusCounts.watch}</b></span>
        <span><i class="over"></i>Over budget <b>${statusCounts.over}</b></span>
        <span><i class="remaining"></i>Remaining <b>${fmtGBP(remaining,{dp:0})}</b></span>
      </div>
    </div>
    <div class="bud-rail-card">
      <div class="bud-pace-head">
        <h2>Pacing</h2>
        <span class="bud-pace-badge ${totalSpent <= expected ? "pos" : "neg"}">${totalSpent <= expected ? "On pace" : "Ahead"}</span>
      </div>
      <p>You're <b class="${totalSpent <= expected ? "pos" : "neg"}">${fmtGBP(Math.abs(expected-totalSpent),{dp:0})}</b> ${totalSpent <= expected ? "below" : "ahead of"} expected pace.</p>
      <div class="bud-pace-mini"><span style="width:${pct.toFixed(0)}%"></span><i style="left:${Math.min(100, pace).toFixed(0)}%"></i></div>
      <div class="bud-pace-foot">
        <span class="num blur">${fmtGBP(expected,{dp:0})}<small>Expected by today</small></span>
        <span class="num blur bud-pace-foot-r">${fmtGBP(totalSpent,{dp:0})}<small>Actual spent</small></span>
      </div>
    </div>
    <div class="bud-rail-card">
      <h2>Recent budget updates</h2>
      <div class="bud-update-list">${updates.map(b => {
        const c = budCatOf(b), s = budgetStatus(b, actuals[c] || 0);
        return `<button onclick="selectBudgetDetail('${String(c).replace(/'/g,"\\'")}')"><span>${iconFor(c)}</span><b>${c}<small>${s.label}</small></b></button>`;
      }).join("") || `<p>No budgets yet.</p>`}</div>
    </div>
  `;
}

function renderUnbudgeted(buds, actuals) {
  const budCats = new Set(buds.map(budCatOf));
  const unbud = Object.entries(actuals).filter(([c]) => !budCats.has(c)).sort((a,b)=>b[1]-a[1]);
  const card = document.getElementById("unbud-card");
  if (!unbud.length) { card.style.display = "none"; return; }
  card.style.display = "block";
  document.getElementById("unbud-list").innerHTML = unbud.map(([cat, amt]) => {
    const c = CAT_BY[cat] || {};
    return `<div class="unbud-row">
      <div class="ic" style="background:color-mix(in oklch,${c.color || "var(--ink-3)"} 26%,var(--bg-sunk))">${iconFor(cat)}</div>
      <div class="name">${cat}<small>${fmtGBP(amt)} spent</small></div>
      <button onclick="openBudModal(null,'${cat.replace(/'/g,"\\'")}',${Math.ceil(amt)})">Create budget</button>
    </div>`;
  }).join("");
}

function openBudModal(id = null, prefillCat = null, suggestedAmount = null) {
  _budEditId = id;
  const buds = getBudgets();
  const b = id ? buds.find(x => String(x.id||x.category) === String(id)) : null;
  document.getElementById("bud-modal-title").textContent = id ? "Edit budget" : "Add budget";
  const sel = document.getElementById("bud-m-cat");
  if (id) {
    sel.innerHTML = `<option>${id}</option>`;
    sel.disabled = true;
  } else {
    const used = new Set(buds.map(budCatOf));
    const avail = getAllCats("exp").filter(c => !used.has(c.id) || c.id === prefillCat);
    if (!avail.length && !prefillCat) { showToast("All categories have budgets"); return; }
    sel.innerHTML = avail.map(c => `<option value="${c.id}"${prefillCat===c.id?' selected':''}>${c.icon} ${c.id}</option>`).join("");
    if (prefillCat && !avail.some(c => c.id === prefillCat)) sel.innerHTML += `<option value="${prefillCat}" selected>${iconFor(prefillCat)} ${prefillCat}</option>`;
    sel.disabled = false;
  }
  document.getElementById("bud-m-amt").value = b?.amount || suggestedAmount || "";
  const repeat = document.getElementById("bud-m-repeat");
  if (repeat) repeat.checked = true;
  document.getElementById("bud-modal").hidden = false;
  setTimeout(() => document.getElementById("bud-m-amt").focus(), 50);
}
function closeBudModal() { document.getElementById("bud-modal").hidden = true; _budEditId = null; }
function saveBud() {
  const amt = parseFloat(document.getElementById("bud-m-amt").value);
  const cat = _budEditId || document.getElementById("bud-m-cat").value;
  if (!amt || amt <= 0) { showToast("Please enter an amount"); return; }
  if (!cat) { showToast("Please pick a category"); return; }
  let buds = getBudgets();
  if (_budEditId) {
    const b = buds.find(x => String(x.id||x.category) === String(_budEditId));
    if (b) b.amount = amt;
  } else {
    buds.push({ id: cat, type: "out", category: cat, amount: amt, period: "monthly" });
    _budDetailId = cat;
  }
  lsSet("fin_budgets", buds);
  closeBudModal();
  showToast(_budEditId ? "Budget updated" : "Budget added");
  renderAll();
}
function deleteBud(id) {
  confirmDialog({ title: "Delete budget?", message: "Delete this budget? This can't be undone.", confirmLabel: "Delete", danger: true }, () => {
    const buds = getBudgets().filter(b => String(b.id||b.category) !== String(id));
    lsSet("fin_budgets", buds);
    if (String(_budDetailId) === String(id)) _budDetailId = null;
    showToast("Budget deleted");
    renderAll();
  });
}

function toggleBudSelected(id) { const k = String(id); if (_budSelected.has(k)) _budSelected.delete(k); else _budSelected.add(k); renderBud(); }
function toggleBudAllSelected(checked) { if (!checked) _budSelected.clear(); renderBud(); }
function clearBudSelection() { _budSelected.clear(); renderBud(); }
function renderBudBulkBar() {
  const bar = document.getElementById("bud-bulk-bar");
  if (!bar) return;
  bar.hidden = !_budSelected.size;
  if (_budSelected.size) document.getElementById("bud-bulk-count").textContent = _budSelected.size;
}
function bulkDeleteBud() {
  if (!_budSelected.size) return;
  const n = _budSelected.size;
  confirmDialog({ title: "Delete budgets?", message: `Delete ${n} budget${n>1?'s':''}? This can't be undone.`, confirmLabel: "Delete", danger: true }, () => {
    const buds = getBudgets().filter(b => !_budSelected.has(String(b.id || b.category)));
    lsSet("fin_budgets", buds);
    _budSelected.clear();
    showToast(`${n} budget${n>1?'s':''} deleted`);
    renderAll();
  });
}

document.getElementById("bud-bulk-del").addEventListener("click", bulkDeleteBud);
document.getElementById("bud-m-cancel").addEventListener("click", closeBudModal);
document.getElementById("bud-m-save").addEventListener("click", saveBud);
document.getElementById("bud-modal").addEventListener("click", e => { if (e.target.id === "bud-modal") closeBudModal(); });
