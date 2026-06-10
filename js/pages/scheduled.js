/* ════════════════════════════════════════
   SCHEDULED TAB
════════════════════════════════════════ */
let _schedEditId = null;
let _schedModalType = "out";
let _schedEditMode = false;   // list Edit toggle — reveals edit/delete buttons on rows
let _schedSelDay = null;      // calendar-selected day (1–31) — highlights matching rows
let _schedMonthKey = null;    // last rendered month; selection resets when it changes

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
        showToast(`Updated “${existing.description}” to ${fmtGBP(amt,{dp:2,minDp:0})}`);
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
  return txns.some(t => {
    if (monthKeyStr(t.date) !== mk) return false;
    // Hard link first: app-posted transactions carry the bill's id, so the match
    // survives renames and price edits.
    if (t.recId != null) return String(t.recId) === String(r.id);
    // Fallback heuristic for bank-imported / hand-entered transactions.
    return (t.description||"").toLowerCase() === (r.description||"").toLowerCase() &&
           Math.abs(t.amount - r.amount) < 0.01;
  });
}

function renderSched() {
  const recs = getRecurring().filter(r => (r.period||"monthly") === "monthly");
  const txns = getTxns();
  // Calendar day-selection only makes sense within one month — clear it on month change.
  const mk = monthKey(_viewMonth.y, _viewMonth.m);
  if (mk !== _schedMonthKey) { _schedMonthKey = mk; _schedSelDay = null; }
  renderSchedSummary(recs, txns);
  renderSchedCal(recs, txns);
  renderSchedList(recs, txns);
  // "Post due (n)" only shows when there's something due-and-unposted to post.
  const postBtn = document.getElementById("sched-post-due");
  if (postBtn) {
    const due = _schedDueUnposted();
    postBtn.hidden = !due.length;
    const lbl = postBtn.querySelector("span");
    if (lbl) lbl.textContent = `Post due (${due.length})`;
  }
}

function renderSchedSummary(recs, txns) {
  const monthEl = document.getElementById("sched-cal-month"); if (!monthEl) return;
  monthEl.textContent = monthLabel(_viewMonth.y, _viewMonth.m);
  const out = recs.filter(r => r.type==='out').reduce((s,r)=>s+r.amount,0);
  const inn = recs.filter(r => r.type==='in').reduce((s,r)=>s+r.amount,0);
  const net = inn - out;
  const kpis = document.getElementById("sched-kpis");
  if (kpis) kpis.innerHTML = `
    <span class="sched-kpi"><span>In</span><b class="num blur pos">${fmtGBP(inn,{dp:2,minDp:0})}</b></span>
    <span class="sched-kpi"><span>Out</span><b class="num blur neg">${fmtGBP(out,{dp:2,minDp:0})}</b></span>
    <span class="sched-kpi"><span>Net</span><b class="num blur" style="color:${net>=0?'var(--pos)':'var(--neg)'}">${(net>=0?'+':'−')+fmtGBP(Math.abs(net),{dp:2,minDp:0})}</b></span>`;
  // Subline under "Planned bills": count + next unposted due date.
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
  const sub = document.getElementById("sched-sub");
  if (sub) {
    if (!recs.length) sub.textContent = "No recurring items yet";
    else {
      const next = nextRec
        ? `Next: ${nextRec.description} · ${nextDay}${ordinal(nextDay)}${isCurMonth?` (in ${nextDay - today.getDate()}d)`:''}`
        : "All posted ✓";
      sub.textContent = `${recs.length} item${recs.length>1?'s':''} · ${next}`;
    }
  }
}

// ── Month calendar (right card): every bill pinned to its due day ──
function renderSchedCal(recs, txns) {
  const grid = document.getElementById("sched-cal"); if (!grid) return;
  const hdr = document.getElementById("sched-cal-hdr");
  const ws = (typeof weekStartPref === "function") ? weekStartPref() : 1; // 1=Mon, 0=Sun
  const dow = ws === 0 ? ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"] : ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  if (hdr) hdr.innerHTML = dow.map(d => `<div>${d}</div>`).join("");
  const y = _viewMonth.y, m = _viewMonth.m;
  const dim = new Date(y, m + 1, 0).getDate();
  const firstDow = (new Date(y, m, 1).getDay() - ws + 7) % 7;
  const today = new Date();
  const isCurMonth = y === today.getFullYear() && m === today.getMonth();
  // Bucket bills by (clamped) due day.
  const byDay = {};
  recs.forEach(r => {
    const day = Math.min(r.day || 1, dim);
    (byDay[day] = byDay[day] || []).push(r);
  });
  const MAX_PILLS = 3;
  let html = Array(firstDow).fill(`<div class="sched-cal-cell empty"></div>`).join("");
  for (let d = 1; d <= dim; d++) {
    const bills = (byDay[d] || []).slice().sort((a,b) => (a.amount||0) - (b.amount||0));
    const classes = ["sched-cal-cell"];
    if (isCurMonth && d === today.getDate()) classes.push("today");
    if (d === _schedSelDay) classes.push("sel");
    if (bills.length) classes.push("has-bills");
    const pills = bills.slice(0, MAX_PILLS).map(r => {
      const posted = recIsPosted(r, txns, y, m);
      const overdue = !posted && isCurMonth && d < today.getDate();
      const cls = posted ? " posted" : (r.type === "in" ? " in" : (overdue ? " overdue" : ""));
      return `<div class="pill${cls}" title="${(r.description||'').replace(/"/g,'&quot;')} · ${fmtGBP(r.amount,{dp:2,minDp:0})}">${r.description || '—'}</div>`;
    }).join("");
    const more = bills.length > MAX_PILLS ? `<div class="more">+${bills.length - MAX_PILLS} more</div>` : "";
    html += `<div class="${classes.join(" ")}" data-day="${d}"><span class="day">${d}</span>${pills}${more}</div>`;
  }
  grid.innerHTML = html;
}

function renderSchedList(recs, txns) {
  const sec = document.getElementById("sched-sections");
  if (!recs.length) {
    sec.innerHTML = `<div class="page-stub" style="margin-top:18px"><h3>No scheduled items</h3><div>Click <b>Add</b> to set up recurring payments or income.</div></div>`;
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
        <div class="sched-repay-meta"><span class="num blur">${fmtGBP(paid,{dp:2,minDp:0})}</span> of <span class="num blur">${fmtGBP(r.total,{dp:2,minDp:0})}</span> · ${done?'<b>Paid off ✓</b>':`<span class="num blur">${fmtGBP(remaining,{dp:2,minDp:0})}</span> left`}</div>
      </div>`;
    }
    // Mark-posted is the everyday action so it's always visible; edit/delete
    // only appear in Edit mode (mirrors the Transactions table).
    const editActs = _schedEditMode ? `
        <button title="Edit" onclick="openSchedModal('${r.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button class="danger" title="Delete" onclick="deleteSched('${r.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>` : '';
    return `<div class="sched-row-full ${posted?'posted':''}${day===_schedSelDay?' cal-hl':''}" data-rec-id="${r.id}" data-day="${day}">
      <div class="ic" style="background:color-mix(in oklch,${cat.color||(isIn?'var(--pos)':'var(--ink-3)')} 30%,var(--bg-sunk));color:var(--ink)">📅</div>
      <div class="info"><b>${r.description||'—'}</b><span>${r.category || (isIn?'Income':'—')}${r.account?' · '+r.account:''}</span>${repayHtml}</div>
      ${badge}
      <div class="amt ${isIn?'pos':''}"><span class="blur">${isIn ? fmtGBP(r.amount,{sign:true,minDp:0}) : fmtGBP(-r.amount,{minDp:0})}</span></div>
      <div class="acts">
        ${!posted ? `<button title="Mark posted (creates a transaction)" onclick="markScheduledPosted('${r.id}', ${day})" style="color:var(--pos);border-color:color-mix(in oklch, var(--pos) 30%, var(--line))"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l4 4L19 6"/></svg></button>` : ''}${editActs}
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

// Build the transaction for posting `rec` on `day` of the viewed month and push it
// onto `txns` (caller persists). Stamps `recId` so recIsPosted has a durable link.
// Also knocks repayment balances down; returns true if `rec` itself was mutated.
function _postScheduledCore(rec, day, txns) {
  const dim = new Date(_viewMonth.y, _viewMonth.m+1, 0).getDate();
  const safeDay = Math.min(day || rec.day || 1, dim);
  txns.push({
    id: Date.now() + Math.floor(Math.random() * 100000),
    type: rec.type || "out",
    amount: rec.amount,
    date: `${_viewMonth.y}-${String(_viewMonth.m+1).padStart(2,'0')}-${String(safeDay).padStart(2,'0')}`,
    description: rec.description || "",
    category: rec.category || (rec.type === "in" ? "Other Income" : "Misc"),
    account: rec.account || "",
    recId: rec.id,
  });
  if (schedIsRepayment(rec) && rec.total != null) {
    rec.paid = Math.min((rec.paid || 0) + rec.amount, rec.total);
    return true;
  }
  return false;
}

function markScheduledPosted(recId, day) {
  const recs = getRecurring();
  const rec = recs.find(x => String(x.id) === String(recId));
  if (!rec) return;
  const txns = getTxns();
  const repayChanged = _postScheduledCore(rec, day, txns);
  lsSet("fin_txns", txns);
  if (repayChanged) {
    lsSet("fin_recurring", recs);
    const left = Math.max(rec.total - rec.paid, 0);
    showToast(left <= 0.005
      ? `${rec.description || 'Repayment'} paid off 🎉`
      : `Posted · ${fmtGBP(left,{dp:2,minDp:0})} left on ${rec.description || 'repayment'}`);
    renderAll();
    return;
  }
  showToast(`Posted: ${rec.description || 'item'} (${fmtGBP(rec.amount,{dp:2,minDp:0})})`);
  renderAll();
}

// One click posts every bill that's due-and-unposted in the viewed month
// (current month: due day has passed or is today; past months: everything unposted).
function _schedDueUnposted() {
  const recs = getRecurring().filter(r => (r.period||"monthly") === "monthly");
  const txns = getTxns();
  const today = new Date();
  const isCur  = _viewMonth.y === today.getFullYear() && _viewMonth.m === today.getMonth();
  const isPast = new Date(_viewMonth.y, _viewMonth.m + 1, 0) < today && !isCur;
  if (!isCur && !isPast) return [];   // future months have nothing "due" yet
  const dim = new Date(_viewMonth.y, _viewMonth.m+1, 0).getDate();
  return recs.filter(r => {
    if (recIsPosted(r, txns, _viewMonth.y, _viewMonth.m)) return false;
    const day = Math.min(r.day || 1, dim);
    return isPast || day <= today.getDate();
  });
}
function postDueScheduled() {
  const due = _schedDueUnposted();
  if (!due.length) { showToast("Nothing due to post"); return; }
  const total = due.reduce((s, r) => s + (r.type === "in" ? 0 : r.amount), 0);
  const names = due.map(r => r.description || "—").join(", ");
  confirmDialog({
    title: `Post ${due.length} item${due.length > 1 ? "s" : ""}?`,
    message: `Creates a transaction for each on its due date: ${names}.${total ? ` Total out: ${fmtGBP(total,{dp:2,minDp:0})}.` : ""}`,
    confirmLabel: "Post all",
  }, () => {
    const recs = getRecurring();
    const txns = getTxns();
    let repayChanged = false;
    due.forEach(d => {
      const rec = recs.find(x => String(x.id) === String(d.id));
      if (rec) repayChanged = _postScheduledCore(rec, rec.day, txns) || repayChanged;
    });
    lsSet("fin_txns", txns);
    if (repayChanged) lsSet("fin_recurring", recs);
    showToast(`Posted ${due.length} item${due.length > 1 ? "s" : ""}`);
    renderAll();
  });
}

// ── Calendar ↔ list cross-highlighting + card toolbar ──
function _schedSelectDay(day) {
  _schedSelDay = (_schedSelDay === day) ? null : day;
  const recs = getRecurring().filter(r => (r.period||"monthly") === "monthly");
  const txns = getTxns();
  renderSchedCal(recs, txns);
  renderSchedList(recs, txns);
  if (_schedSelDay != null) {
    document.querySelector("#sched-sections .sched-row-full.cal-hl")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}
function toggleSchedEditMode() {
  _schedEditMode = !_schedEditMode;
  const btn = document.getElementById("sched-edit-toggle");
  if (btn) { btn.classList.toggle("editing", _schedEditMode); btn.setAttribute("aria-pressed", String(_schedEditMode)); }
  renderSchedList(getRecurring().filter(r => (r.period||"monthly") === "monthly"), getTxns());
}
// Calendar day click → highlight that day's bills in the list (toggle).
document.getElementById("sched-cal")?.addEventListener("click", e => {
  const cell = e.target.closest(".sched-cal-cell[data-day]");
  if (!cell) return;
  _schedSelectDay(parseInt(cell.dataset.day, 10));
});
// List row click → spotlight its due day on the calendar (toggle). Action buttons exempt.
document.getElementById("sched-sections")?.addEventListener("click", e => {
  if (e.target.closest(".acts")) return;
  const row = e.target.closest(".sched-row-full[data-day]");
  if (!row) return;
  _schedSelectDay(parseInt(row.dataset.day, 10));
});
document.getElementById("sched-add")?.addEventListener("click", () => openSchedModal(null));
document.getElementById("sched-edit-toggle")?.addEventListener("click", toggleSchedEditMode);
document.getElementById("sched-post-due")?.addEventListener("click", postDueScheduled);
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

