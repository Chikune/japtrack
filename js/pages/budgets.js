/* ════════════════════════════════════════
   BUDGETS PAGE
════════════════════════════════════════ */
let _budEditId = null;
let _budDetailId = null;
let _budSort = "priority";
let _budEditMode = false;   // list Edit toggle — reveals edit/delete buttons on rows

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

// Average monthly income — recurring forecast income first, else the mean of the
// last 3 months' actual income (same approach the old allocation-plan card used).
function _budMonthlyIncome() {
  const fcs = (typeof getForecasts === "function") ? getForecasts() : [];
  const fcInc = fcs.filter(f => f.type === "in" && f.recurrence === "monthly").reduce((s, f) => s + f.amount, 0);
  if (fcInc) return fcInc;
  const txns = getTxns();
  const flows = [];
  for (let i = 0; i < 3; i++) {
    let y = _viewMonth.y, m = _viewMonth.m - i;
    while (m < 0) { m += 12; y--; }
    flows.push(mStat(txns, y, m).income);
  }
  const valid = flows.filter(f => f > 0);
  return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : 0;
}

function renderBud() {
  const buds = getBudgets().filter(b => b.type === "out");
  const { actuals, txns } = budgetActualsForMonth();
  // Subline: count + how much of typical income the budgets allocate.
  const sub = document.getElementById("bud-sub");
  if (sub) {
    if (!buds.length) sub.textContent = "Set monthly limits per category";
    else {
      const income = _budMonthlyIncome();
      const totalBud = buds.reduce((s, b) => s + b.amount, 0);
      const allocTxt = income > 0 ? ` · ${Math.round(totalBud / income * 100)}% of income allocated` : "";
      sub.textContent = `${buds.length} budget${buds.length > 1 ? "s" : ""}${allocTxt}`;
    }
  }
  // A selected detail must still exist — but never auto-select (panel is opt-in).
  if (_budDetailId && !buds.some(b => String(budCatOf(b)) === String(_budDetailId))) _budDetailId = null;
  renderBudKPIs(buds, actuals);
  renderBudGrid(buds, actuals);
  renderUnbudgeted(buds, actuals);
  renderBudgetDetail(buds, actuals, txns);
}

// Three slim chips in the card header (same chip style as the Bills calendar).
function renderBudKPIs(buds, actuals) {
  const el = document.getElementById("bud-kpis-inline"); if (!el) return;
  const totalBud = buds.reduce((s, b) => s + b.amount, 0);
  const totalSpent = buds.reduce((s, b) => s + (actuals[budCatOf(b)] || 0), 0);
  const remaining = totalBud - totalSpent;
  el.innerHTML = buds.length ? `
    <span class="sched-kpi"><span>Budget</span><b class="num blur">${fmtGBP(totalBud,{dp:0})}</b></span>
    <span class="sched-kpi"><span>Spent</span><b class="num blur ${totalSpent > totalBud ? "neg" : ""}">${fmtGBP(totalSpent,{dp:0})}</b></span>
    <span class="sched-kpi"><span>Left</span><b class="num blur" style="color:${remaining < 0 ? "var(--neg)" : "var(--pos)"}">${remaining < 0 ? "−" : ""}${fmtGBP(Math.abs(remaining),{dp:0})}</b></span>` : "";
}

function renderBudGrid(buds, actuals) {
  const grid = document.getElementById("bud-grid");
  if (!buds.length) {
    grid.innerHTML = `<div class="page-stub"><h3>No budgets yet</h3><div>Click <b>Add budget</b> to set monthly limits per category.</div></div>`;
    return;
  }
  const sortSel = document.getElementById("bud-sort");
  if (sortSel) sortSel.value = _budSort;
  grid.innerHTML = sortedBudgets(buds, actuals).map(b => budgetRowHTML(b, actuals)).join("");
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
  // Edit/delete only surface in Edit mode (same pattern as Transactions/Bills).
  const acts = _budEditMode ? `<span class="acts">
      <button title="Edit" onclick="openBudModal('${id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
      <button class="danger" title="Delete" onclick="deleteBud('${id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
    </span>` : `<span class="acts"></span>`;
  return `<div class="bud-row-full${String(_budDetailId) === String(budCatOf(b)) ? " active" : ""}" data-bud-id="${budCatOf(b)}">
    <span class="bud-row-cat">
      <span class="bud-row-icon" style="background:color-mix(in oklch,${cat.color || "var(--ink-3)"} 28%,var(--bg-sunk))">${iconFor(c)}</span>
      <span><b>${c}</b><small>${budgetTypeFor(c)}</small></span>
    </span>
    <span class="num blur">${fmtGBP(b.amount)}</span>
    <span class="num blur">${fmtGBP(spent)}</span>
    <span class="num blur ${remaining < 0 ? "neg" : "pos"}">${remaining < 0 ? "-" : ""}${fmtGBP(Math.abs(remaining))}</span>
    <span class="bud-progress-cell"><i><em style="width:${Math.min(100, pct).toFixed(0)}%;background:${fillColor}"></em></i><small>${pct.toFixed(0)}%</small></span>
    <span class="bud-status ${status.key}">${status.label}</span>
    ${acts}
  </div>`;
}
// Toggle semantics: clicking the already-selected row closes the detail panel.
function selectBudgetDetail(id) { _budDetailId = (id != null && String(_budDetailId) === String(id)) ? null : id; renderBud(); }
function toggleBudEditMode() {
  _budEditMode = !_budEditMode;
  const btn = document.getElementById("bud-edit-toggle");
  if (btn) { btn.classList.toggle("editing", _budEditMode); btn.setAttribute("aria-pressed", String(_budEditMode)); }
  renderBud();
}
document.getElementById("bud-sort").addEventListener("change", e => { _budSort = e.target.value; renderBud(); });
document.getElementById("bud-edit-toggle")?.addEventListener("click", toggleBudEditMode);
// Row click → open/close the detail panel (action buttons exempt).
document.getElementById("bud-grid")?.addEventListener("click", e => {
  if (e.target.closest(".acts")) return;
  const row = e.target.closest(".bud-row-full[data-bud-id]");
  if (row) selectBudgetDetail(row.dataset.budId);
});

function renderBudgetDetail(buds, actuals, monthTxns) {
  const panel = document.getElementById("bud-detail-panel");
  if (!panel) return;
  const b = buds.find(x => String(budCatOf(x)) === String(_budDetailId));
  // Detail-only panel: empty (and CSS-hidden) until a budget row is selected.
  if (!b) { panel.innerHTML = ""; return; }
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
      <button class="bud-detail-close" title="Close" onclick="selectBudgetDetail(null)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
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

document.getElementById("bud-m-cancel").addEventListener("click", closeBudModal);
document.getElementById("bud-m-save").addEventListener("click", saveBud);
document.getElementById("bud-modal").addEventListener("click", e => { if (e.target.id === "bud-modal") closeBudModal(); });
