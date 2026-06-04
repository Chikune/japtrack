/* ════════════════════════════════════════
   SCHEDULED TAB
════════════════════════════════════════ */
let _schedEditId = null;
let _schedModalType = "out";
let _schedSelectedId = null;

// A scheduled item is treated as a repayment automatically when its category is a
// repayment one (matches "Repayments", "Repayment", "Repayments & Subscriptions", …).
function schedIsRepayment(r) {
  return /repayment/i.test((r && r.category) || "");
}

// Auto-create scheduled (Bills & Subscriptions) entries from imported transactions
// whose category is Repayments or Subscriptions. Dedupes against existing recurring
// items by (description + amount). Returns the number of new bills created.
function ensureBillsFromTxns(addedTxns) {
  if (!Array.isArray(addedTxns) || !addedTxns.length) return 0;
  const isBillCat = c => /repayment|subscription/i.test(c || "");
  const norm = s => (s || "").toLowerCase().trim();
  const recs = getRecurring();
  const exactMatch = (desc, amt) => recs.some(r =>
    norm(r.description) === norm(desc) && Math.abs((r.amount || 0) - amt) < 0.01);
  // A bill with the same description but a DIFFERENT amount — likely a price change
  // (e.g. Three Network £10 → £25), not a brand-new subscription. We ask the user.
  const sameDescDiffAmt = (desc, amt) => recs.find(r =>
    norm(r.description) === norm(desc) && Math.abs((r.amount || 0) - amt) >= 0.01);
  const dayOf = (t) => { const m = (t.date || "").match(/^\d{4}-\d{2}-(\d{2})$/); return m ? Math.max(1, Math.min(31, parseInt(m[1], 10) || 1)) : 1; };
  const newRec = (t, amt, idx) => ({
    id: Date.now() + Math.floor(Math.random() * 100000) + idx,
    description: t.description, amount: amt, day: dayOf(t),
    type: "out", category: t.category, account: t.account || "", period: "monthly"
  });

  const seenInBatch = new Set();
  const ambiguous = []; // price-change candidates → resolved via prompts after the pass
  let added = 0;
  addedTxns.forEach((t, idx) => {
    if (!t) return;
    if (normType(t) !== "out") return;
    if (!isBillCat(t.category)) return;
    if (!t.description) return;
    const amt = Math.abs(Number(t.amount) || 0);
    if (amt <= 0) return;
    const batchKey = norm(t.description) + "|" + amt.toFixed(2);
    if (seenInBatch.has(batchKey)) return;
    seenInBatch.add(batchKey);
    if (exactMatch(t.description, amt)) return;            // already a bill at this price
    const existing = sameDescDiffAmt(t.description, amt);
    if (existing) { ambiguous.push({ t, amt, idx, existing }); return; } // ask the user
    recs.push(newRec(t, amt, idx));                        // genuinely new bill
    added++;
  });
  if (added) lsSet("fin_recurring", recs);

  // Resolve price-change candidates one at a time so the user can decide per bill:
  // update the existing bill's amount, or add it as a separate new bill.
  if (ambiguous.length && typeof confirmDialog === "function") {
    let i = 0;
    const next = () => {
      if (i >= ambiguous.length) { renderAll(); return; }
      const { t, amt, idx, existing } = ambiguous[i++];
      confirmDialog({
        title: "Same bill at a new price?",
        message: `“${existing.description}” is already a recurring bill at ${fmtGBP(existing.amount,{dp:2})}, but this import has ${fmtGBP(amt,{dp:2})}. Is this the same bill with a new price, or a separate new bill?`,
        confirmLabel: "Update the amount",
        cancelLabel: "Add as new bill",
        danger: false,
        onCancel: () => {   // Add as a separate new bill
          const list = getRecurring();
          list.push(newRec(t, amt, idx));
          lsSet("fin_recurring", list);
          showToast(`Added “${t.description}” as a new bill`);
          next();
        },
      }, () => {            // Update the existing bill's amount
        const list = getRecurring();
        const r = list.find(x => String(x.id) === String(existing.id));
        if (r) { r.amount = amt; r.day = dayOf(t); lsSet("fin_recurring", list); }
        showToast(`Updated “${existing.description}” to ${fmtGBP(amt,{dp:0})}`);
        next();
      });
    };
    next();
  }
  return added;
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  return ["th","st","nd","rd","th","th","th","th","th","th"][n%10];
}

function recIsPosted(r, txns, y, m) {
  const mk = monthKey(y, m);
  return txns.some(t =>
    monthKeyStr(t.date) === mk &&
    (t.description||"").toLowerCase() === (r.description||"").toLowerCase() &&
    Math.abs(t.amount - r.amount) < 0.01);
}

function renderSched() {
  const recs = getRecurring().filter(r => (r.period||"monthly") === "monthly");
  const txns = getTxns();
  document.getElementById("sched-sub").textContent = recs.length
    ? `${recs.length} recurring item${recs.length>1?'s':''}`
    : "No recurring items — add some to see your monthly schedule";
  renderSchedSummary(recs, txns);
  renderSchedList(recs, txns);
  // Keep the breakdown panel in sync after re-renders (e.g. mark-posted updates balance).
  if (_schedSelectedId) {
    const sel = getRecurring().find(x => String(x.id) === String(_schedSelectedId));
    if (sel) openSchedPanel(_schedSelectedId); else closeSchedPanel();
  }
}

function renderSchedSummary(recs, txns) {
  const monthEl = document.getElementById("sched-cal-month"); if (!monthEl) return;
  monthEl.textContent = monthLabel(_viewMonth.y, _viewMonth.m);
  const out = recs.filter(r => r.type==='out').reduce((s,r)=>s+r.amount,0);
  const inn = recs.filter(r => r.type==='in').reduce((s,r)=>s+r.amount,0);
  const net = inn - out;
  document.getElementById("sched-sum-in").textContent = fmtGBP(inn,{dp:0});
  document.getElementById("sched-sum-out").textContent = fmtGBP(out,{dp:0});
  const netEl = document.getElementById("sched-sum-net");
  netEl.textContent = (net>=0?'+':'−')+fmtGBP(Math.abs(net),{dp:0});
  netEl.style.color = net>=0 ? 'var(--pos)' : 'var(--neg)';
  const today = new Date();
  const isCurMonth = _viewMonth.y === today.getFullYear() && _viewMonth.m === today.getMonth();
  const dim = new Date(_viewMonth.y, _viewMonth.m+1, 0).getDate();
  let nextDay = null, nextRec = null;
  recs.forEach(r => {
    const day = Math.min(r.day || 1, dim);
    if (recIsPosted(r, txns, _viewMonth.y, _viewMonth.m)) return;
    if (isCurMonth && day < today.getDate()) return;
    if (nextDay === null || day < nextDay) { nextDay = day; nextRec = r; }
  });
  document.getElementById("sched-sum-next").textContent = nextRec
    ? `${nextRec.description} · ${nextDay}${ordinal(nextDay)}${isCurMonth?` (in ${nextDay - today.getDate()}d)`:''}`
    : "all posted";
}

function renderSchedList(recs, txns) {
  const sec = document.getElementById("sched-sections");
  if (!recs.length) {
    sec.innerHTML = `<div class="page-stub" style="margin-top:18px"><h3>No scheduled items</h3><div>Click <b>Add scheduled</b> to set up recurring payments or income.</div></div>`;
    return;
  }
  const today = new Date();
  const isCur = _viewMonth.y === today.getFullYear() && _viewMonth.m === today.getMonth();
  const todayDay = today.getDate();
  const dim = new Date(_viewMonth.y, _viewMonth.m+1, 0).getDate();
  const groups = { posted: [], dueSoon: [], later: [] };
  recs.forEach(r => {
    const day = Math.min(r.day || 1, dim);
    const posted = recIsPosted(r, txns, _viewMonth.y, _viewMonth.m);
    if (posted) groups.posted.push({r, day, posted: true});
    else if (isCur && day < todayDay) groups.dueSoon.push({r, day, overdue: true});
    else if (isCur && (day - todayDay) <= 7) groups.dueSoon.push({r, day});
    else groups.later.push({r, day});
  });

  const rowHtml = ({r, day, posted, overdue}) => {
    const isIn = r.type === "in";
    const cat = CAT_BY[r.category] || {};
    const sign = isIn ? "+£" : "−£";
    let badge;
    if (posted) badge = `<span class="badge-status posted">Posted ✓</span>`;
    else if (overdue) badge = `<span class="badge-status overdue">Overdue · ${day}${ordinal(day)}</span>`;
    else if (isCur) {
      const da = day - todayDay;
      badge = `<span class="badge-status ${da<=7?'due-soon':'later'}">${da===0?'Today':'in '+da+'d'} · ${day}${ordinal(day)}</span>`;
    } else {
      badge = `<span class="badge-status later">${day}${ordinal(day)}</span>`;
    }
    let repayHtml = "";
    if (schedIsRepayment(r) && r.total > 0) {
      const paid = Math.min(r.paid || 0, r.total);
      const pct = (paid / r.total) * 100;
      const remaining = Math.max(r.total - paid, 0);
      const done = remaining <= 0.005;
      repayHtml = `<div class="sched-repay">
        <div class="sched-repay-track"><div class="sched-repay-fill${done?' done':''}" style="width:${Math.min(100,pct).toFixed(1)}%"></div></div>
        <div class="sched-repay-meta"><span class="num blur">${fmtGBP(paid,{dp:0})}</span> of <span class="num blur">${fmtGBP(r.total,{dp:0})}</span> · ${done?'<b>Paid off ✓</b>':`<span class="num blur">${fmtGBP(remaining,{dp:0})}</span> left`}</div>
      </div>`;
    }
    return `<div class="sched-row-full ${posted?'posted':''}${String(r.id)===_schedSelectedId?' selected':''}" data-rec-id="${r.id}">
      <div class="ic" style="background:color-mix(in oklch,${cat.color||(isIn?'var(--pos)':'var(--ink-3)')} 30%,var(--bg-sunk));color:var(--ink)">📅</div>
      <div class="info"><b>${r.description||'—'}</b><span>${r.category || (isIn?'Income':'—')}${r.account?' · '+r.account:''}</span>${repayHtml}</div>
      ${badge}
      <div class="amt ${isIn?'pos':''}"><span class="blur">${sign}${r.amount.toFixed(0)}</span></div>
      <div class="acts">
        ${!posted ? `<button title="Mark posted (creates a transaction)" onclick="markScheduledPosted('${r.id}', ${day})" style="color:var(--pos);border-color:color-mix(in oklch, var(--pos) 30%, var(--line))"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l4 4L19 6"/></svg></button>` : ''}
        <button title="Edit" onclick="openSchedModal('${r.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button class="danger" title="Delete" onclick="deleteSched('${r.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </div>
    </div>`;
  };

  groups.posted.sort((a,b) => a.day - b.day);
  groups.dueSoon.sort((a,b) => a.day - b.day);
  groups.later.sort((a,b) => a.day - b.day);

  let html = "";
  if (groups.dueSoon.length) html += `<div class="sched-section"><h3>Due soon</h3><div class="sched-list-full">${groups.dueSoon.map(rowHtml).join("")}</div></div>`;
  if (groups.later.length)   html += `<div class="sched-section"><h3>Later${isCur?' this month':''}</h3><div class="sched-list-full">${groups.later.map(rowHtml).join("")}</div></div>`;
  if (groups.posted.length)  html += `<div class="sched-section"><h3>Posted</h3><div class="sched-list-full">${groups.posted.map(rowHtml).join("")}</div></div>`;
  sec.innerHTML = html;
}

/* ── Breakdown panel (right-hand detail for a selected bill) ── */
function _schedShortDate(s) {
  try { const d = new Date(s); if (isNaN(d)) return s; return d.toLocaleDateString("en-GB", { day:"numeric", month:"short" }); }
  catch { return s; }
}
function openSchedPanel(id) {
  const rec = getRecurring().find(x => String(x.id) === String(id));
  if (!rec) { closeSchedPanel(); return; }
  _schedSelectedId = String(id);
  renderSchedPanel(rec);
  document.querySelectorAll("#sched-sections .sched-row-full").forEach(el =>
    el.classList.toggle("selected", el.dataset.recId === _schedSelectedId));
}
function closeSchedPanel() {
  _schedSelectedId = null;
  const p = document.getElementById("sched-panel");
  if (p) p.innerHTML = "";
  document.querySelectorAll("#sched-sections .sched-row-full.selected").forEach(el => el.classList.remove("selected"));
}
function renderSchedPanel(rec) {
  const panel = document.getElementById("sched-panel"); if (!panel) return;
  const isIn = rec.type === "in";
  const cat = CAT_BY[rec.category] || {};
  const icon = cat.icon || (isIn ? "💷" : "📅");
  const txns = getTxns();
  const matches = txns
    .filter(t => (t.description||"").toLowerCase() === (rec.description||"").toLowerCase() && Math.abs(t.amount - rec.amount) < 0.01)
    .sort((a,b) => (b.date||"").localeCompare(a.date||"")).slice(0,3);
  const recentHtml = matches.length
    ? matches.map(t => `<div class="sp-recent"><span>${_schedShortDate(t.date)}</span><span class="num blur ${isIn?'pos':'neg'}">${isIn?'+':'−'}${fmtGBP(Math.abs(t.amount),{dp:0})}</span></div>`).join("")
    : `<div class="sp-empty">No payments logged yet</div>`;

  const repay = schedIsRepayment(rec) && rec.total > 0;
  let bodyHtml;
  if (repay) {
    const paid = Math.min(rec.paid || 0, rec.total);
    const remaining = Math.max(rec.total - paid, 0);
    const pct = rec.total > 0 ? (paid / rec.total) * 100 : 0;
    const done = remaining <= 0.005;
    const monthsLeft = (done || rec.amount <= 0) ? 0 : Math.ceil(remaining / rec.amount);
    let payoff = "Paid off";
    if (!done) { const d = new Date(_viewMonth.y, _viewMonth.m + monthsLeft, 1); payoff = monthLabel(d.getFullYear(), d.getMonth()); }
    bodyHtml = `
      <div class="sp-hero"><span class="sp-hero-lab">${done?'Repaid':'Balance left'}</span><span class="sp-hero-val num blur ${done?'pos':''}">${fmtGBP(remaining,{dp:0})}</span></div>
      <div class="sched-repay sp-bar">
        <div class="sched-repay-track"><div class="sched-repay-fill${done?' done':''}" style="width:${Math.min(100,pct).toFixed(1)}%"></div></div>
        <div class="sched-repay-meta"><span class="num blur">${fmtGBP(paid,{dp:0})}</span> of <span class="num blur">${fmtGBP(rec.total,{dp:0})}</span> paid · ${pct.toFixed(0)}%</div>
      </div>
      <div class="sp-grid">
        <div class="sp-cell"><span>Monthly</span><b class="num blur">${fmtGBP(rec.amount,{dp:0})}</b></div>
        <div class="sp-cell"><span>Payments left</span><b>${done?'0':monthsLeft}</b></div>
        <div class="sp-cell"><span>Projected payoff</span><b>${payoff}</b></div>
        <div class="sp-cell"><span>Due day</span><b>${(rec.day||1)}${ordinal(rec.day||1)}</b></div>
      </div>`;
  } else {
    bodyHtml = `
      <div class="sp-hero"><span class="sp-hero-lab">${isIn?'Monthly income':'Monthly amount'}</span><span class="sp-hero-val num blur ${isIn?'pos':'neg'}">${isIn?'+':'−'}${fmtGBP(rec.amount,{dp:0})}</span></div>
      <div class="sp-grid">
        <div class="sp-cell"><span>Per year</span><b class="num blur">${isIn?'+':'−'}${fmtGBP(rec.amount*12,{dp:0})}</b></div>
        <div class="sp-cell"><span>Due day</span><b>${(rec.day||1)}${ordinal(rec.day||1)}</b></div>
        <div class="sp-cell"><span>Category</span><b>${rec.category||'—'}</b></div>
        <div class="sp-cell"><span>Account</span><b>${rec.account||'—'}</b></div>
      </div>`;
  }

  const posted = recIsPosted(rec, txns, _viewMonth.y, _viewMonth.m);
  panel.innerHTML = `
    <div class="sp-head">
      <div class="sp-ic" style="background:color-mix(in oklch,${cat.color||(isIn?'var(--pos)':'var(--ink-3)')} 30%,var(--bg-sunk))">${icon}</div>
      <div class="sp-title"><h2>${rec.description||'—'}</h2><p>${rec.category||(isIn?'Income':'—')}${rec.account?' · '+rec.account:''}</p></div>
      <button class="sp-close" title="Close" onclick="closeSchedPanel()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>
    ${bodyHtml}
    <div class="sp-recent-wrap"><div class="sp-section-h">Recent payments</div>${recentHtml}</div>
    <div class="sp-foot">
      ${posted ? `<button class="btn-ghost" disabled>Posted ✓</button>` : `<button class="btn-primary" onclick="markScheduledPosted('${rec.id}', ${rec.day||1})">Mark posted</button>`}
      <button class="btn-ghost" onclick="openSchedModal('${rec.id}')">Edit</button>
      <button class="btn-ghost sp-del" onclick="deleteSched('${rec.id}')">Delete</button>
    </div>`;
}

function openSchedModal(id = null) {
  _schedEditId = id;
  const r = id ? getRecurring().find(x => String(x.id) === String(id)) : null;
  document.getElementById("sched-modal-title").textContent = id ? "Edit scheduled" : "Add scheduled";
  _schedModalType = r ? (r.type === "in" ? "in" : "out") : "out";
  document.querySelectorAll("#sched-m-type-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === _schedModalType));
  populateSchedCatSelect(r?.category);
  const accts = [...new Set([...getTxAccts(), ...getSettings().accounts])].filter(Boolean);
  document.getElementById("sched-m-acct").innerHTML = accts.map(a => `<option value="${a}"${r?.account===a?' selected':''}>${a}</option>`).join("");
  document.getElementById("sched-m-desc").value = r?.description || "";
  document.getElementById("sched-m-amt").value = r?.amount || "";
  document.getElementById("sched-m-day").value = r?.day || 1;
  document.getElementById("sched-m-total").value = (r && r.total != null) ? r.total : "";
  document.getElementById("sched-m-paid").value  = (r && r.paid != null) ? r.paid : "";
  document.getElementById("sched-m-cat").onchange = _schedUpdateRepayVisibility;
  _schedUpdateRepayVisibility();
  document.getElementById("sched-modal").hidden = false;
  setTimeout(() => document.getElementById("sched-m-desc").focus(), 50);
}
function _schedUpdateRepayVisibility() {
  const isRepay = /repayment/i.test(document.getElementById("sched-m-cat").value || "");
  document.getElementById("sched-m-repay-row").style.display = isRepay ? "" : "none";
  document.getElementById("sched-m-paid-row").style.display  = isRepay ? "" : "none";
}
function populateSchedCatSelect(selected) {
  const cats = getAllCats(_schedModalType === "in" ? "in" : "exp");
  document.getElementById("sched-m-cat").innerHTML = cats.map(c => `<option value="${c.id}"${selected===c.id?' selected':''}>${c.icon} ${c.id}</option>`).join("");
}
function closeSchedModal() { document.getElementById("sched-modal").hidden = true; _schedEditId = null; }
function saveSched() {
  const desc = document.getElementById("sched-m-desc").value.trim();
  const amt = parseFloat(document.getElementById("sched-m-amt").value);
  const day = parseInt(document.getElementById("sched-m-day").value, 10);
  const cat = document.getElementById("sched-m-cat").value;
  const acct = document.getElementById("sched-m-acct").value;
  if (!desc) { showToast("Please enter a description"); return; }
  if (!amt || amt <= 0) { showToast("Please enter an amount"); return; }
  if (!day || day < 1 || day > 31) { showToast("Day must be 1–31"); return; }
  const isRepay = /repayment/i.test(cat);
  const total = isRepay ? (parseFloat(document.getElementById("sched-m-total").value) || 0) : null;
  const paid  = isRepay ? Math.max(0, parseFloat(document.getElementById("sched-m-paid").value) || 0) : null;
  let recs = getRecurring();
  if (_schedEditId) {
    const r = recs.find(x => String(x.id) === String(_schedEditId));
    if (r) {
      Object.assign(r, { description: desc, amount: amt, day, type: _schedModalType, category: cat, account: acct });
      if (isRepay) { r.total = total; r.paid = paid; }
      else { delete r.total; delete r.paid; }
    }
  } else {
    const item = { id: Date.now() + Math.floor(Math.random()*1000), description: desc, amount: amt, day, type: _schedModalType, category: cat, account: acct, period: "monthly" };
    if (isRepay) { item.total = total; item.paid = paid; }
    recs.push(item);
  }
  lsSet("fin_recurring", recs);
  closeSchedModal();
  showToast(_schedEditId ? "Scheduled updated" : "Scheduled added");
  renderAll();
}
function deleteSched(id) {
  confirmDialog({ title:"Delete scheduled item?", message:"This can't be undone.", confirmLabel:"Delete", danger:true }, () => {
    const recs = getRecurring().filter(r => String(r.id) !== String(id));
    lsSet("fin_recurring", recs);
    showToast("Scheduled deleted");
    renderAll();
  });
}

function markScheduledPosted(recId, day) {
  const recs = getRecurring();
  const rec = recs.find(x => String(x.id) === String(recId));
  if (!rec) return;
  const dim = new Date(_viewMonth.y, _viewMonth.m+1, 0).getDate();
  const safeDay = Math.min(day || 1, dim);
  const dateStr = `${_viewMonth.y}-${String(_viewMonth.m+1).padStart(2,'0')}-${String(safeDay).padStart(2,'0')}`;
  const txns = getTxns();
  const tx = {
    id: Date.now() + Math.floor(Math.random() * 100000),
    type: rec.type || "out",
    amount: rec.amount,
    date: dateStr,
    description: rec.description || "",
    category: rec.category || (rec.type === "in" ? "Other Income" : "Misc"),
    account: rec.account || ""
  };
  txns.push(tx);
  lsSet("fin_txns", txns);
  // Repayment: knock the posted amount off the outstanding balance.
  if (schedIsRepayment(rec) && rec.total != null) {
    rec.paid = Math.min((rec.paid || 0) + rec.amount, rec.total);
    lsSet("fin_recurring", recs);
    const left = Math.max(rec.total - rec.paid, 0);
    showToast(left <= 0.005
      ? `${rec.description || 'Repayment'} paid off 🎉`
      : `Posted · ${fmtGBP(left,{dp:0})} left on ${rec.description || 'repayment'}`);
    renderAll();
    return;
  }
  showToast(`Posted: ${rec.description || 'item'} (${fmtGBP(rec.amount,{dp:0})})`);
  renderAll();
}

// Row click → open the breakdown panel (but let the inline action buttons work).
document.getElementById("sched-sections")?.addEventListener("click", e => {
  if (e.target.closest(".acts")) return;
  const row = e.target.closest(".sched-row-full[data-rec-id]");
  if (!row) return;
  if (row.dataset.recId === _schedSelectedId) closeSchedPanel();
  else openSchedPanel(row.dataset.recId);
});
document.getElementById("sched-m-cancel").addEventListener("click", closeSchedModal);
document.getElementById("sched-m-save").addEventListener("click", saveSched);
document.getElementById("sched-modal").addEventListener("click", e => { if (e.target.id === "sched-modal") closeSchedModal(); });
document.getElementById("sched-m-type-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-type]"); if (!b) return;
  _schedModalType = b.dataset.type;
  document.querySelectorAll("#sched-m-type-seg button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.type === _schedModalType));
  populateSchedCatSelect();
  _schedUpdateRepayVisibility();
});

