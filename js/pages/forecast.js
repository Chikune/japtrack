/* ════════════════════════════════════════
   FORECAST TAB
════════════════════════════════════════ */
let _fcEditId = null;
let _fcModalType = "in";
let _fcModalRec = "monthly";
let _fcMonths = 12;
let _fcScenario = null;
let _fcView = "income"; // "income" (spendable balance) | "networth" (total net worth)

function renderForecast() {
  if (!document.getElementById("fc-kpis")) return;
  const now = new Date();
  const months = buildForecastMonths(now, _fcMonths);
  const sub = document.getElementById("fc-sub");
  if (sub) sub.textContent = "See your financial future and plan ahead";
  renderForecastKPIs(months);
  renderForecastChart(months);
  renderBalanceForecast(months);
  renderForecastInsights(months);
  renderForecastTable();
  renderForecastScenarios();
  // (renderAllocPlan moved to renderBud — see budgets.js)
  renderPlans();
}

/* ────────────────────────────────────────
   BALANCE FORECAST — projects an account's running balance forward using the
   latest NW snapshot as the starting point and the forecast cash flow.
   The dropdown picks which account to project (defaults to Current Account
   when present, since that's where day-to-day cash flow lands).
   ──────────────────────────────────────── */
let _fcBalanceAcct = null;
function renderBalanceForecast(months) {
  const seg = document.getElementById("fc-balance-acct");
  const grid = document.getElementById("fc-balance-grid");
  if (!seg || !grid) return;
  // Build account list from the latest NW snapshot (those are the accounts that have a balance).
  const entries = (typeof nwSnapshotsSorted === "function") ? nwSnapshotsSorted() : (getNWEntries() || []);
  const last = entries.length ? entries[entries.length - 1] : null;
  if (!last) {
    seg.innerHTML = "";
    grid.innerHTML = `<div class="fc-empty-chart">Add an account snapshot to see your projected balance.</div>`;
    return;
  }
  // View toggle: net income (spendable balance) vs net worth (assets − liabilities).
  const isNW = _fcView === "networth";
  document.querySelectorAll("#fc-view-seg button").forEach(b =>
    b.setAttribute("aria-pressed", (b.dataset.view === _fcView) ? "true" : "false"));
  const titleEl = document.getElementById("fc-balance-title");
  const subEl   = document.getElementById("fc-balance-sub");
  if (titleEl) titleEl.textContent = isNW ? "Net worth over time" : "Net income over time";
  if (subEl)   subEl.textContent   = isNW
    ? "Projected total net worth (debt paydown counts as savings)"
    : "Projected spendable balance, month by month";

  // Account picker only applies to the spendable-balance view; net worth is whole-portfolio.
  const accts = ["__all__", ...last.allocations.map(a => a.cat)];
  if (!_fcBalanceAcct || !accts.includes(_fcBalanceAcct)) _fcBalanceAcct = "__all__";
  const accountLabel = a => a === "__all__" ? "All accounts" : a;
  if (isNW) {
    seg.innerHTML = "";
    seg.style.display = "none";
  } else {
    seg.style.display = "";
    // Compact dropdown (mirrors the Balances "Interest earned" picker) so the chart
    // head stays tidy regardless of how many accounts exist.
    seg.innerHTML = `<button type="button" class="fc-acct-dd" id="fc-acct-dd-btn" aria-haspopup="true">${accountLabel(_fcBalanceAcct)} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>`;
    document.getElementById("fc-acct-dd-btn").addEventListener("click", e => {
      e.stopPropagation();
      _fcOpenAcctPop(e.currentTarget, accts, accountLabel, months);
    });
  }

  const startBalance = isNW
    ? nwTotalE(last)
    : (_fcBalanceAcct === "__all__" ? nwTotalE(last) : (last.allocations.find(a => a.cat === _fcBalanceAcct)?.value || 0));
  let running = startBalance;
  const series = months.map(m => {
    // Net worth: paying debt principal is net-worth-neutral (cash → smaller liability),
    // only interest is a true loss, and transfers stay as your assets (neutral).
    // Net income: spendable balance, so transfers out reduce it.
    const delta = isNW
      ? (m.income || 0) - (m.expenses || 0) + (m.debtPrincipal || 0)
      : (m.income || 0) - (m.expenses || 0) - (m.transferOut || 0);
    running += delta;
    return { ym: m.ym, net: delta, balance: running };
  });
  grid.innerHTML = forecastLineChart(series, startBalance);
}

// Single-select account popover for the balance chart. Reuses the shared .acc-pop
// styling + positioner (`_accMountPop`/`_accClosePops`) so it matches the Balances picker.
function _fcOpenAcctPop(anchor, accts, accountLabel, months) {
  if (document.getElementById("acc-pop")) { _accClosePops(); return; }
  if (typeof _accClosePops === "function") _accClosePops();
  const pop = document.createElement("div");
  pop.className = "acc-pop"; pop.id = "acc-pop";
  pop.innerHTML = `<label>Project account</label>` + accts.map(a =>
    `<button type="button" class="acc-pop-opt${a === _fcBalanceAcct ? " sel" : ""}" data-acct="${(a + "").replace(/"/g, "&quot;")}">${accountLabel(a)}</button>`).join("");
  _accMountPop(pop, anchor);
  pop.addEventListener("click", e => {
    const b = e.target.closest(".acc-pop-opt"); if (!b) return;
    _fcBalanceAcct = b.dataset.acct;
    _accClosePops();
    renderBalanceForecast(months);
    renderForecastInsights(months);
  });
}

/* ────────────────────────────────────────
   BUDGET ALLOCATION PLAN — derived live from the user's saved budgets.
   Each budget contributes one slice; the unspoken-for income remainder
   shows as an "Unallocated" slice so you can see how much of your monthly
   income is still un-budgeted at a glance.
   ──────────────────────────────────────── */
function renderAllocPlan() {
  const donutEl = document.getElementById("fc-alloc-donut");
  const rowsEl  = document.getElementById("fc-alloc-rows");
  const subEl   = document.getElementById("fc-alloc-sub");
  const sumEl   = document.getElementById("fc-alloc-summary");
  if (!donutEl || !rowsEl) return;

  // Average monthly income — prefer recurring forecast income; fall back to last 3 months of actual income.
  const fcs = getForecasts();
  const monthlyFcInc = fcs
    .filter(f => f.type === "in" && f.recurrence === "monthly")
    .reduce((s,f) => s + f.amount, 0);

  let monthlyIncome = monthlyFcInc;
  if (!monthlyIncome) {
    const txns = getTxns();
    const flows = [];
    for (let i = 0; i < 3; i++) {
      let y = _viewMonth.y, m = _viewMonth.m - i;
      while (m < 0) { m += 12; y--; }
      flows.push(mStat(txns, y, m).income);
    }
    const valid = flows.filter(f => f > 0);
    monthlyIncome = valid.length ? valid.reduce((s,v) => s+v, 0) / valid.length : 0;
  }

  // Build slices from the saved budgets (same source as the table above this card).
  const buds = getBudgets().filter(b => b.type === "out");
  const budSlices = buds.map(b => {
    const catId = b.id || b.category;
    const cat = (typeof CAT_BY !== "undefined" ? CAT_BY[catId] : null) || {};
    return {
      label: catId,
      value: Math.max(0, Number(b.amount) || 0),
      color: cat.color || "var(--ink-3)",
      icon: typeof iconFor === "function" ? iconFor(catId) : "",
      kind: "budget",
    };
  }).filter(s => s.value > 0);

  const totalBudgeted = budSlices.reduce((s, x) => s + x.value, 0);
  const remainder = monthlyIncome > 0 ? Math.max(0, monthlyIncome - totalBudgeted) : 0;
  const overspent = monthlyIncome > 0 && totalBudgeted > monthlyIncome
    ? totalBudgeted - monthlyIncome : 0;

  const slices = budSlices.slice();
  if (remainder > 0) slices.push({ label: "Unallocated", value: remainder, color: "var(--line)", icon: "·", kind: "remainder" });

  // The donut total = total of slices (which equals income if budgets ≤ income, else equals budgets).
  const ringTotal = slices.reduce((s, x) => s + x.value, 0);

  // Sub-text
  if (subEl) {
    const incomeStr = monthlyIncome > 0 ? fmtGBP(monthlyIncome,{dp:0}) + "/mo income" : "no income data yet";
    if (!buds.length) {
      subEl.innerHTML = `Based on <b>${incomeStr}</b> · add budgets above and they'll appear here automatically.`;
    } else if (overspent > 0) {
      subEl.innerHTML = `Based on <b>${incomeStr}</b> · <b style="color:var(--neg)">over-budgeted by ${fmtGBP(overspent,{dp:0})}/mo</b>`;
    } else if (monthlyIncome > 0) {
      const pctAlloc = (totalBudgeted / monthlyIncome * 100).toFixed(0);
      subEl.innerHTML = `Based on <b>${incomeStr}</b> · <b>${fmtGBP(totalBudgeted,{dp:0})}</b> allocated (<b style="color:var(--accent-ink)">${pctAlloc}%</b>) · <b>${fmtGBP(remainder,{dp:0})}</b> left to allocate`;
    } else {
      subEl.innerHTML = `Showing <b>${fmtGBP(totalBudgeted,{dp:0})}</b> across <b>${buds.length}</b> budget${buds.length>1?'s':''} · add a recurring income to see allocation %.`;
    }
  }

  // Donut SVG
  const cx = 50, cy = 50, rOuter = 42, rInner = 28;
  function arcPath(startA, endA) {
    const toXY = (a, r) => [cx + r*Math.cos(a), cy + r*Math.sin(a)];
    const large = (endA - startA) > Math.PI ? 1 : 0;
    const [x1,y1] = toXY(startA, rOuter);
    const [x2,y2] = toXY(endA,   rOuter);
    const [x3,y3] = toXY(endA,   rInner);
    const [x4,y4] = toXY(startA, rInner);
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${rOuter},${rOuter} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${rInner},${rInner} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z`;
  }
  let acc = -Math.PI / 2;
  const slicePaths = (ringTotal > 0 ? slices : []).map(s => {
    if (s.value <= 0) return "";
    const sweep = (s.value / ringTotal) * Math.PI * 2;
    const start = acc, end = acc + sweep;
    acc = end;
    return `<path d="${arcPath(start, end)}" fill="${s.color}" stroke="var(--bg-elev)" stroke-width="0.6"/>`;
  }).join("");

  // Centre label — shows monthly income if known, else total budgeted
  const centreVal = monthlyIncome > 0
    ? fmtGBP(monthlyIncome,{dp:0,compact:true})
    : (totalBudgeted > 0 ? fmtGBP(totalBudgeted,{dp:0,compact:true}) : "—");
  const centreLab = monthlyIncome > 0 ? "per month" : "budgeted";
  const centre = `
    <text x="50" y="46" text-anchor="middle" style="font-family:Inter;font-size:5px;fill:var(--ink-3);text-transform:uppercase;letter-spacing:0.06em">${centreLab}</text>
    <text x="50" y="56" text-anchor="middle" style="font-family:'Fraunces',serif;font-size:11px;fill:var(--ink);font-weight:500">${centreVal}</text>`;

  const placeholder = (ringTotal === 0)
    ? `<circle cx="${cx}" cy="${cy}" r="${(rOuter+rInner)/2}" fill="none" stroke="var(--line)" stroke-width="${rOuter-rInner}" stroke-dasharray="2 4"/>`
    : "";

  donutEl.innerHTML = `
    <svg viewBox="0 0 100 100" width="100%" height="auto" style="display:block;max-width:280px;margin:0 auto">
      ${placeholder}${slicePaths}${centre}
    </svg>`;

  // Read-only rows showing each budget's contribution
  if (!slices.length) {
    rowsEl.innerHTML = cardEmpty(`No budgets yet, add some above and they'll appear here as a live allocation pie.`);
  } else {
    rowsEl.innerHTML = slices.map(s => {
      const pctOfRing   = ringTotal      ? (s.value / ringTotal      * 100) : 0;
      const pctOfIncome = monthlyIncome  ? (s.value / monthlyIncome  * 100) : null;
      const isRem = s.kind === "remainder";
      return `<div class="bp-row" style="grid-template-columns:18px 1fr 90px 100px;${isRem?'opacity:0.75;':''}">
        <i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${s.color};border:1px solid var(--line)"></i>
        <div class="bp-label" style="display:flex;align-items:center;gap:6px;background:transparent;border:none;padding:7px 0">${s.icon || ""} ${s.label}</div>
        <div class="bp-amt blur" style="text-align:right">${fmtGBP(s.value,{dp:0})}/mo</div>
        <div class="bp-amt"     style="text-align:right;color:var(--ink-3)">${pctOfIncome !== null ? pctOfIncome.toFixed(0) + "% of income" : pctOfRing.toFixed(0) + "%"}</div>
      </div>`;
    }).join("");
  }

  // Annual summary
  if (sumEl) {
    if (monthlyIncome > 0 && buds.length) {
      const horizon = 12;
      const totalIncomeYear = monthlyIncome * horizon;
      const totalBudgetedYear = totalBudgeted * horizon;
      const remainderYear = Math.max(0, totalIncomeYear - totalBudgetedYear);
      sumEl.innerHTML = `
        <div class="bp-sum-head">
          <span>Over 12 months at this plan</span>
          <b class="num blur">${fmtGBP(totalIncomeYear,{dp:0})} income</b>
        </div>
        <div class="bp-sum-grid">
          <div class="bp-sum-cell"><div class="bp-sum-label"><i style="background:var(--accent)"></i>Allocated to budgets</div>
            <div class="bp-sum-row"><span>per month</span><b class="num blur">${fmtGBP(totalBudgeted,{dp:0})}</b></div>
            <div class="bp-sum-row"><span>over 12m</span><b class="num blur">${fmtGBP(totalBudgetedYear,{dp:0})}</b></div></div>
          <div class="bp-sum-cell"><div class="bp-sum-label"><i style="background:var(--line)"></i>Unallocated</div>
            <div class="bp-sum-row"><span>per month</span><b class="num blur">${fmtGBP(remainder,{dp:0})}</b></div>
            <div class="bp-sum-row"><span>over 12m</span><b class="num blur">${fmtGBP(remainderYear,{dp:0})}</b></div></div>
        </div>`;
    } else {
      sumEl.innerHTML = "";
    }
  }
}

// Convert any CSS colour (oklch / hex / rgb / hsl) to #RRGGBB so it can populate <input type="color">.
// Uses an offscreen canvas which the browser parses with its full CSS engine.
const _hexCache = new Map();
function rgbHex(c) {
  if (!c) return "#888888";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map(x=>x+x).join("");
  if (_hexCache.has(c)) return _hexCache.get(c);
  try {
    const ctx = (rgbHex._ctx ||= document.createElement("canvas").getContext("2d"));
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;                                   // browser parses & stores as rgb()
    const m = String(ctx.fillStyle).match(/\d+/g);
    const hex = m ? "#" + m.slice(0,3).map(n => Number(n).toString(16).padStart(2,"0")).join("") : "#888888";
    _hexCache.set(c, hex);
    return hex;
  } catch { return "#888888"; }
}

function addAllocSlice() {
  const cur = getAllocPlan();
  const palette = ["oklch(70% 0.10 240)","oklch(72% 0.12 320)","oklch(70% 0.10 150)","oklch(72% 0.12 50)","oklch(70% 0.05 75)","oklch(72% 0.13 130)","oklch(72% 0.12 30)"];
  const used = new Set(cur.map(c => c.color));
  const color = palette.find(c => !used.has(c)) || palette[0];
  cur.push({ id: "slice-" + Date.now(), label: "New slice", pct: 0, color });
  setAllocPlan(cur);
  renderAllocPlan();
}

/* ── Payment Plans ── */
let _planEditId = null;

// Payment plans = the debts the user added on the Balance projection page. Each debt is a
// forecast of future costs (amortising minimum payments). The card is read-only here —
// clicking routes to Balance projection, where debts are added/edited.
function renderPlans() {
  const el = document.getElementById("plan-grid");
  if (!el) return;
  const debts = ((typeof getDebts === "function") ? getDebts() : [])
    .filter(d => (d.kind || "debt") === "debt");

  if (!debts.length) {
    el.innerHTML = `<div class="plan-empty" style="grid-column:1/-1">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" style="display:block;margin:0 auto 10px"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h4m-4 4h8"/></svg>
      <p>No debts yet — add them on <b>Balance projection</b> to forecast future costs here.</p>
    </div>`;
    return;
  }

  // Amortise so each debt has a payoff month + total interest cost.
  const sim = (typeof simulateDebtPayoff === "function") ? simulateDebtPayoff(debts, "avalanche", 0) : null;
  const perDebt = (sim && sim.perDebt) ? sim.perDebt : [];
  const monthLbl = n => {
    const d = new Date(); d.setMonth(d.getMonth() + n);
    return d.toLocaleString("default", { month: "short", year: "numeric" });
  };

  el.innerHTML = debts.map(d => {
    const w = perDebt.find(x => String(x.id) === String(d.id)) || {};
    const remaining = Math.max(0, +d.balance || 0);
    const min = Math.max(0, +d.min || 0);
    const apr = Math.max(0, +d.apr || 0);
    const paidMonth = w.paidMonth || null;
    const monthsLeft = paidMonth || (min > 0 ? Math.ceil(remaining / min) : 0);
    const payoffLabel = paidMonth ? monthLbl(paidMonth) : (min > 0 ? "—" : "no min set");
    const interestCost = +w.interestPaid || 0;
    return `<div class="plan-card fc-payment-card" data-debt-id="${d.id}" onclick="switchPage('debt')" title="Manage on Balance projection" style="cursor:pointer">
      <div class="plan-card-head">
        <div class="plan-ic">💳</div>
        <div class="plan-info">
          <h4>${d.name || "Untitled debt"}</h4>
          <div class="sub">${monthsLeft ? `${monthsLeft} month${monthsLeft===1?'':'s'} left` : "Future cost"}</div>
        </div>
      </div>

      <div class="plan-amount">
        <span class="blur">${fmtGBP(remaining,{dp:0})}</span> <span class="of">remaining</span>
      </div>

      <div class="plan-counters">
        <div class="plan-counter"><b class="blur">${fmtGBP(min,{dp:0})}</b> / month</div>
        <div class="plan-counter"><b>${apr.toFixed(apr % 1 ? 1 : 0)}%</b> APR</div>
        ${interestCost > 0 ? `<div class="plan-counter"><b class="blur">${fmtGBP(interestCost,{dp:0})}</b> interest</div>` : ""}
      </div>

      <div class="plan-foot">
        <span class="plan-payoff">Pays off <b>${payoffLabel}</b></span>
      </div>
    </div>`;
  }).join("");
}

function openPlanModal(id = null) {
  _planEditId = id;
  const p = id ? getPlans().find(x => String(x.id) === String(id)) : null;
  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
  document.getElementById("plan-modal-title").textContent = p ? "Edit payment plan" : "Add payment plan";
  document.getElementById("plan-m-name").value    = p?.name    || "";
  document.getElementById("plan-m-emoji").value   = p?.emoji   || "";
  document.getElementById("plan-m-total").value   = p?.total   || "";
  document.getElementById("plan-m-payment").value = p?.payment || "";
  document.getElementById("plan-m-paid").value    = p?.paid    || "";
  document.getElementById("plan-m-start").value   = p?.startMonth || thisMonth;
  document.getElementById("plan-modal").hidden = false;
  setTimeout(() => document.getElementById("plan-m-name").focus(), 50);
}

function closePlanModal() { document.getElementById("plan-modal").hidden = true; _planEditId = null; }

function savePlan() {
  const name    = document.getElementById("plan-m-name").value.trim();
  const total   = parseFloat(document.getElementById("plan-m-total").value);
  const payment = parseFloat(document.getElementById("plan-m-payment").value);
  if (!name || isNaN(total) || total <= 0 || isNaN(payment) || payment <= 0) {
    showToast("Please fill in Name, Total owed, and Monthly payment."); return;
  }
  const paid  = parseFloat(document.getElementById("plan-m-paid").value) || 0;
  const start = document.getElementById("plan-m-start").value;
  const emoji = document.getElementById("plan-m-emoji").value.trim() || "💳";
  const list  = getPlans();
  if (_planEditId) {
    const idx = list.findIndex(x => String(x.id) === String(_planEditId));
    if (idx !== -1) list[idx] = { ...list[idx], name, emoji, total, payment, paid: Math.min(paid, total), startMonth: start };
  } else {
    list.push({ id: Date.now(), name, emoji, total, payment, paid: Math.min(paid, total), startMonth: start });
  }
  lsSet("fin_plans", list);
  closePlanModal();
  renderPlans();
  showToast("Payment plan saved");
}

function deletePlan(id) {
  confirmDialog({ title:"Remove payment plan?", message:"This can't be undone.", confirmLabel:"Remove", danger:true }, () => {
    lsSet("fin_plans", getPlans().filter(p => String(p.id) !== String(id)));
    renderPlans();
    showToast("Plan removed");
  });
}

function logPlanPayment(id) {
  const list = getPlans();
  const idx  = list.findIndex(p => String(p.id) === String(id));
  if (idx === -1) return;
  const p = list[idx];
  const newPaid = Math.min((p.paid || 0) + (p.payment || 0), p.total || 0);
  list[idx] = { ...p, paid: newPaid };
  lsSet("fin_plans", list);
  renderPlans();
  const remaining = Math.max((p.total || 0) - newPaid, 0);
  if (remaining <= 0.005) showToast("🎉 Paid off!");
  else showToast(`Payment logged · ${curSym()}${fmt(newPaid)} paid`);
}

function buildForecastMonths(now, count) {
  const forecasts = getForecasts();
  const includeScheduled = document.getElementById("fc-include-sched")?.checked !== false;
  const recurring = includeScheduled ? getRecurring() : [];

  // ── Balance-projection integration ──────────────────────────────────────────
  // Future costs/income the user planned on the Balance projection page feed the
  // forecast: debts (their amortising minimum payments), income items, and savings
  // transfers. Debts already mirrored as a scheduled "Repayments" bill are skipped
  // here so they aren't double-counted (matches debtCreateBill's name key).
  const bpItems = (typeof getDebts === "function") ? getDebts() : [];
  const bpDebtsAll = bpItems.filter(d => (d.kind || "debt") === "debt");
  const bpDebts = bpDebtsAll.filter(d =>
    !recurring.some(r => (r.description || "").toLowerCase() === (d.name || "").toLowerCase()));
  const bpIncomeSum   = bpItems.filter(d => d.kind === "income").reduce((s, d) => s + (+d.amount || 0), 0);
  const bpTransferSum = bpItems.filter(d => d.kind === "transfer").reduce((s, d) => s + (+d.amount || 0), 0);
  // Amortise the (non-duplicated) debts once; series[k] = the k-th month's totals.
  const sim = (typeof simulateDebtPayoff === "function" && bpDebts.length)
    ? simulateDebtPayoff(bpDebts, "avalanche", 0) : null;
  const simAt = k => (sim && sim.series && sim.series[k]) ? sim.series[k] : null; // k=1 → first payment month

  const months = [];
  const startY = (typeof _viewMonth !== "undefined") ? _viewMonth.y : now.getFullYear();
  const startM = (typeof _viewMonth !== "undefined") ? _viewMonth.m : now.getMonth();
  for (let i = 0; i < count; i++) {
    let y = startY, m = startM + i;
    while (m > 11) { m -= 12; y++; }
    const ym = `${y}-${String(m+1).padStart(2,"0")}`;
    let income = 0, expenses = 0;
    // Forecast items
    forecasts.forEach(f => {
      if (f.startMonth > ym) return;
      if (f.recurrence === "once" && f.startMonth !== ym) return;
      if (f.endMonth && f.endMonth < ym) return;
      if (f.type === "in") income += f.amount || 0;
      else expenses += f.amount || 0;
    });
    // Scheduled recurring
    recurring.forEach(r => {
      const amt = r.amount || 0;
      if (r.type === "in") income += amt;
      else if (r.type === "out") expenses += amt;
    });
    // Balance-projection debts (amortising), income, and transfers
    const s = simAt(i + 1);
    const debtPaid     = s ? (s.paid || 0)     : 0;
    const debtInterest = s ? (s.interest || 0) : 0;
    const debtPrincipal = Math.max(0, debtPaid - debtInterest);
    expenses += debtPaid;
    income   += bpIncomeSum;
    const transferOut = bpTransferSum;
    if (_fcScenario) {
      const scenarioAmt = _fcScenario.amount || 0;
      const maxMonths = _fcScenario.months || count;
      if (i < maxMonths) {
        if (_fcScenario.type === "in") income += scenarioAmt;
        else expenses += scenarioAmt;
      }
    }
    months.push({
      ym, label: `${MONTHS[m]} '${String(y).slice(2)}`,
      income, expenses, net: income - expenses,
      transferOut, debtInterest, debtPrincipal,
    });
  }
  return months;
}

function renderForecastKPIs(months) {
  const el = document.getElementById("fc-kpis"); if (!el) return;
  const avgIn  = months.reduce((s,m)=>s+m.income,0) / months.length;
  const avgOut = months.reduce((s,m)=>s+m.expenses,0) / months.length;
  const avgNet = avgIn - avgOut;
  const projected = projectedBalanceForMonths(months);
  const projectedMonth = months[months.length - 1]?.ym || "";
  const icIncome = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17l9-9"/><path d="M12 8h5v5"/></svg>`;
  const icSpend  = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></svg>`;
  const icNet    = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`;
  const icProj   = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>`;
  el.innerHTML = `
    <div class="fc-kpi-card income">
      <div class="fc-kpi-ic income">${icIncome}</div>
      <div><span>Monthly income</span><strong class="num blur">${fmtGBP(avgIn,{dp:0})}</strong><p>Average per month</p></div>
    </div>
    <div class="fc-kpi-card spending">
      <div class="fc-kpi-ic spending">${icSpend}</div>
      <div><span>Monthly spending</span><strong class="num blur">${fmtGBP(avgOut,{dp:0})}</strong><p>Average per month</p></div>
    </div>
    <div class="fc-kpi-card net ${avgNet>=0?'pos':'neg'}">
      <div class="fc-kpi-ic net ${avgNet>=0?'pos':'neg'}">${icNet}</div>
      <div><span>Monthly net</span><strong class="num blur">${(avgNet>=0?'+':'−')+fmtGBP(Math.abs(avgNet),{dp:0})}</strong><p>Average per month</p></div>
    </div>
    <div class="fc-kpi-card projected">
      <div class="fc-kpi-ic projected">${icProj}</div>
      <div><span>Projected balance (${months.length}M)</span><strong class="num blur">${fmtSignedGBP(projected,{dp:0,plainPositive:true})}</strong><p>In ${formatYM(projectedMonth)}</p></div>
    </div>`;
}

function renderForecastChart(months) {
  const el = document.getElementById("fc-chart"); if (el) el.innerHTML = "";
  const br = document.getElementById("fc-balance-row"); if (br) br.innerHTML = "";
}

function renderForecastTable() {
  const tbody = document.getElementById("fc-tbody"); if (!tbody) return;
  const items = getForecasts();
  const cnt = document.getElementById("fc-item-count");
  if (cnt) cnt.textContent = items.length ? `${items.length} item${items.length!==1?'s':''}` : "";
  if (!items.length) {
    tbody.innerHTML = `<div class="fc-empty-list">No forecast items yet. Add recurring income, expenses, or a one-time change.</div>`;
    return;
  }
  const groups = [
    { key: "in", title: "Income", tone: "income" },
    { key: "out", title: "Expenses", tone: "expense" },
    { key: "transfer", title: "Transfers", tone: "transfer" },
  ];
  tbody.innerHTML = groups.map(g => {
    const rows = items.filter(f => f.type === g.key || (g.key === "out" && f.type !== "in" && f.type !== "transfer"));
    if (!rows.length && g.key === "transfer") return "";
    if (!rows.length) return `<section class="fc-item-group"><h3>${g.title}</h3><div class="fc-muted">No ${g.title.toLowerCase()} forecast items</div></section>`;
    return `<section class="fc-item-group">
      <h3>${g.title}</h3>
      ${rows.map(f => forecastItemRow(f, g.tone)).join("")}
    </section>`;
  }).join("");
}

function forecastItemRow(f, tone) {
  const recLabel = f.recurrence === "monthly" ? "Monthly" : "One-time";
  const due = f.startMonth ? formatYM(f.startMonth) : "—";
  const end = f.endMonth ? `Ends ${formatYM(f.endMonth)}` : "Ongoing";
  const badgeClass = f.type === "in" ? "income" : f.type === "transfer" ? "transfer" : "expense";
  const badgeLabel = f.type === "in" ? "Income" : f.type === "transfer" ? "Transfer" : "Expense";
  const icon = f.type === "in"
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>`
    : f.type === "transfer"
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 9h13l-4-4"/><path d="M20 15H7l4 4"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M17 7L7 17"/><path d="M16 17H7V8"/></svg>`;
  return `<div class="fc-item-row">
    <span class="fc-item-icon ${tone}">${icon}</span>
    <span class="fc-item-main">
      <strong>${f.label || "Untitled item"}</strong>
      <small>${end}</small>
    </span>
    <span class="fc-item-badge ${badgeClass}">${badgeLabel}</span>
    <span class="fc-item-amount num blur ${f.type === "in" ? "pos" : "neg"}">${fmtGBP(f.amount || 0, { dp: 2 })}<small>/mo</small></span>
    <span class="fc-item-rec">${recLabel}</span>
    <span class="fc-item-due">${due}</span>
    <span class="fc-item-actions">
      <button title="Edit" onclick="openFcModal('${f.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
      <button class="danger" title="Delete" onclick="deleteFcItem('${f.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
    </span>
  </div>`;
}

function formatYM(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return Number.isFinite(y) && Number.isFinite(m) ? `${MONTHS[m - 1]} ${y}` : ym;
}

function fmtSignedGBP(v, opts = {}) {
  const abs = fmtGBP(Math.abs(v || 0), opts);
  if (v < 0) return `-${abs}`;
  return opts.plainPositive ? abs : `+${abs}`;
}

function latestForecastBalanceStart() {
  const entries = (typeof nwSnapshotsSorted === "function") ? nwSnapshotsSorted() : (getNWEntries() || []);
  const last = entries.length ? entries[entries.length - 1] : null;
  if (!last) return { balance: 0, month: "" };
  if (_fcBalanceAcct && _fcBalanceAcct !== "__all__") {
    return { balance: last.allocations.find(a => a.cat === _fcBalanceAcct)?.value || 0, month: last.month };
  }
  return { balance: nwTotalE(last), month: last.month };
}

function projectedBalanceForMonths(months) {
  const start = latestForecastBalanceStart().balance;
  return start + months.reduce((s, m) => s + m.net - (m.transferOut || 0), 0);
}

function forecastSeries(months) {
  let running = latestForecastBalanceStart().balance;
  return months.map(m => {
    running += m.net - (m.transferOut || 0);
    return { ym: m.ym, balance: running };
  });
}

function renderForecastOutlook(months) {
  const el = document.getElementById("fc-outlook"); if (!el) return;
  const series = forecastSeries(months);
  const low = series.reduce((a, b) => b.balance < a.balance ? b : a, series[0] || { balance: 0, ym: "" });
  const stable = !series.some(p => p.balance < 0);
  el.innerHTML = `
    <div><span class="fc-check">✓</span><strong>Lowest balance:</strong> <span class="num blur">${fmtSignedGBP(low.balance,{dp:0,plainPositive:true})}</span> in ${formatYM(low.ym)}</div>
    <div><span class="fc-check">✓</span><strong>Financial runway:</strong> <span class="${stable ? "pos" : "warn"}">${stable ? "Stable" : "Watch"}</span></div>`;
}

function renderForecastInsights(months) {
  const el = document.getElementById("fc-insights"); if (!el) return;
  const series = forecastSeries(months);
  const low = series.reduce((a, b) => b.balance < a.balance ? b : a, series[0] || { balance: 0, ym: "" });
  const avgNet = months.reduce((s, m) => s + m.net, 0) / Math.max(months.length, 1);
  const plansEnding = getPlans().filter(p => {
    const remaining = Math.max((p.total || 0) - (p.paid || 0), 0);
    const monthsLeft = p.payment > 0 ? Math.ceil(remaining / p.payment) : Infinity;
    return monthsLeft <= months.length && monthsLeft > 0;
  }).length;
  const upcoming = getForecasts().filter(f => f.startMonth && f.startMonth > months[0]?.ym && f.startMonth <= months[Math.min(2, months.length - 1)]?.ym).length;
  el.innerHTML = `
    <div class="fc-insight-row good">
      <span>↗</span>
      <div><strong>${avgNet >= 0 ? "You're on track" : "Balance needs attention"}</strong><p>${avgNet >= 0 ? "Income is covering planned spending and projected savings." : "Projected spending is higher than recurring income."}</p></div>
    </div>
    <div class="fc-insight-row watch">
      <span>◷</span>
      <div><strong>Watch period</strong><p>Your lowest projected balance is <span class="num blur">${fmtSignedGBP(low.balance,{dp:0,plainPositive:true})}</span> in ${formatYM(low.ym)}.</p></div>
    </div>
    <div class="fc-insight-row info">
      <span>□</span>
      <div><strong>Upcoming changes</strong><p>${plansEnding} payment plan${plansEnding!==1?'s':''} finish within this view. ${upcoming} forecast item${upcoming!==1?'s':''} start soon.</p></div>
    </div>`;
}

function forecastLineChart(series, startBalance) {
  if (!series.length) return `<div class="fc-empty-chart">No projection data yet.</div>`;
  const vals = [startBalance, ...series.map(p => p.balance)];
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const pad = Math.max((max - min) * 0.14, 100);
  const yMin = min - pad;
  const yMax = max + pad;
  const w = 920, h = 330, left = 54, right = 24, top = 18, bottom = 44;
  const plotW = w - left - right, plotH = h - top - bottom;
  const x = i => left + (series.length <= 1 ? 0 : i / (series.length - 1) * plotW);
  const y = v => top + (yMax - v) / (yMax - yMin) * plotH;
  const pts = series.map((p, i) => ({ ...p, x: x(i), y: y(p.balance) }));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fill = `${path} L${pts[pts.length-1].x.toFixed(1)},${y(0).toFixed(1)} L${pts[0].x.toFixed(1)},${y(0).toFixed(1)} Z`;
  const zeroY = y(0);
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const low = b.balance < 0 || a.balance < 0;
    const warn = !low && Math.min(a.balance, b.balance) < 500;
    segs.push(`<path d="M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}" stroke="var(--${low?'neg':warn?'warn':'pos'})" stroke-width="3" stroke-linecap="round"/>`);
  }
  const tickVals = [yMax - pad, (yMax + yMin) / 2, yMin + pad];
  return `<svg class="fc-line-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Projected balance line chart">
    <defs><linearGradient id="fc-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--pos)" stop-opacity=".28"/><stop offset="100%" stop-color="var(--pos)" stop-opacity=".02"/></linearGradient></defs>
    ${tickVals.map(v => `<g><line x1="${left}" x2="${w-right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line-2)"/><text x="10" y="${(y(v)+4).toFixed(1)}">${fmtSignedGBP(v,{dp:0,plainPositive:true})}</text></g>`).join("")}
    <line x1="${left}" x2="${w-right}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="var(--line)" stroke-dasharray="4 5"/>
    <path d="${fill}" fill="url(#fc-fill)"/>
    ${segs.join("")}
    ${pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--${p.balance < 0 ? 'neg' : p.balance < 500 ? 'warn' : 'pos'})"><title>${formatYM(p.ym)}: ${fmtSignedGBP(p.balance,{dp:0,plainPositive:true})}</title></circle>`).join("")}
    ${pts.map((p,i) => i % Math.ceil(pts.length / 6) === 0 || i === pts.length - 1 ? `<text x="${p.x.toFixed(1)}" y="${h-14}" text-anchor="middle">${p.ym.slice(5)}/${p.ym.slice(2,4)}</text>` : "").join("")}
  </svg>`;
}

function renderForecastScenarios() {
  const el = document.getElementById("fc-scenarios"); if (!el) return;
  const items = [
    { id: "salary", icon: "↗", title: "Salary increase", sub: "+£300 / month", type: "in", amount: 300 },
    { id: "rent", icon: "⌂", title: "Rent increase", sub: "+£150 / month", type: "out", amount: 150 },
    { id: "gym", icon: "▣", title: "New expense", sub: "Gym £50 / month", type: "out", amount: 50 },
    { id: "temp", icon: "＋", title: "Temporary income", sub: "3 months", type: "in", amount: 200, months: 3 },
  ];
  el.innerHTML = items.map(s => `<button class="fc-scenario${_fcScenario?.id === s.id ? " active" : ""}" data-id="${s.id}">
    <span>${s.icon}</span><strong>${s.title}</strong><small>${s.sub}</small><em>›</em>
  </button>`).join("") + (_fcScenario ? `<button class="fc-scenario-clear" id="fc-scenario-clear">Clear scenario</button>` : `<button class="fc-scenario-clear" id="fc-scenario-custom">Create custom scenario</button>`);
  el.querySelectorAll(".fc-scenario[data-id]").forEach(btn => btn.addEventListener("click", () => {
    const next = items.find(s => s.id === btn.dataset.id);
    _fcScenario = _fcScenario?.id === next.id ? null : next;
    renderForecast();
  }));
  document.getElementById("fc-scenario-clear")?.addEventListener("click", () => { _fcScenario = null; renderForecast(); });
  document.getElementById("fc-scenario-custom")?.addEventListener("click", () => showToast("Custom scenarios can be added safely in a later pass."));
}

// Open the forecast-item modal pre-set to a type (used by the in-page toolbar buttons).
function openFcModalTyped(type) {
  openFcModal(null);
  _fcModalType = (type === "out") ? "out" : "in";
  document.querySelectorAll("#fc-m-type-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === _fcModalType));
}
function openFcModal(id = null) {
  _fcEditId = id;
  const f = id ? getForecasts().find(x => String(x.id) === String(id)) : null;
  document.getElementById("fc-modal-title").textContent = f ? "Edit forecast item" : "Add forecast item";
  _fcModalType = f?.type || "in";
  _fcModalRec  = f?.recurrence || "monthly";
  document.querySelectorAll("#fc-m-type-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === _fcModalType));
  document.querySelectorAll("#fc-m-rec-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.rec === _fcModalRec));
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  document.getElementById("fc-m-label").value = f?.label || "";
  document.getElementById("fc-m-amt").value = f?.amount || "";
  document.getElementById("fc-m-start").value = f?.startMonth || thisMonth;
  // End is now expressed as a duration in months. If editing an item that has an explicit endMonth,
  // back-compute the duration so the field is pre-populated.
  const startVal = f?.startMonth || thisMonth;
  const endVal   = f?.endMonth || "";
  document.getElementById("fc-m-months").value = endVal ? monthsBetweenInclusive(startVal, endVal) : "";
  document.getElementById("fc-m-end-row").style.display = _fcModalRec === "monthly" ? "" : "none";
  updateFcEndPreview();
  document.getElementById("fc-modal").hidden = false;
  setTimeout(() => document.getElementById("fc-m-label").focus(), 50);
}

// "May 2026" + 6 months → "Oct 2026" (inclusive count)
function addMonthsToYM(ym, n) {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + (n - 1);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2,"0")}`;
}
function monthsBetweenInclusive(startYM, endYM) {
  if (!startYM || !endYM) return "";
  const [sy, sm] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  return Math.max(1, (ey * 12 + em) - (sy * 12 + sm) + 1);
}
function updateFcEndPreview() {
  const start = document.getElementById("fc-m-start").value;
  const months = parseInt(document.getElementById("fc-m-months").value, 10);
  const previewEl = document.getElementById("fc-m-end-preview");
  if (!previewEl) return;
  if (!start || !months || months < 1) { previewEl.textContent = ""; return; }
  const endYM = addMonthsToYM(start, months);
  if (!endYM) { previewEl.textContent = ""; return; }
  const [ey, em] = endYM.split("-").map(Number);
  previewEl.textContent = `→ ends ${monthLabel(ey, em - 1)}`;
}
function closeFcModal() { document.getElementById("fc-modal").hidden = true; _fcEditId = null; }
function saveFcItem() {
  const label = document.getElementById("fc-m-label").value.trim();
  const amount = parseFloat(document.getElementById("fc-m-amt").value);
  const start = document.getElementById("fc-m-start").value;
  if (!label) { showToast("Please enter a label"); return; }
  if (!amount || amount <= 0) { showToast("Please enter an amount"); return; }
  if (!start) { showToast("Please set a start month"); return; }
  const monthsRaw = document.getElementById("fc-m-months").value;
  const months = monthsRaw ? parseInt(monthsRaw, 10) : null;
  const endMonth = (months && months > 0) ? addMonthsToYM(start, months) : null;
  const item = { type: _fcModalType, label, amount, recurrence: _fcModalRec, startMonth: start, endMonth };
  const list = getForecasts();
  if (_fcEditId) {
    const idx = list.findIndex(f => String(f.id) === String(_fcEditId));
    if (idx >= 0) list[idx] = { ...list[idx], ...item };
  } else {
    item.id = Date.now() + Math.floor(Math.random()*1000);
    list.push(item);
  }
  lsSet("fin_forecast", list);
  closeFcModal();
  showToast(_fcEditId ? "Item updated" : "Forecast item added");
  renderForecast();
}
function deleteFcItem(id) {
  confirmDialog({ title:"Remove forecast item?", message:"This can't be undone.", confirmLabel:"Remove", danger:true }, () => {
    lsSet("fin_forecast", getForecasts().filter(f => String(f.id) !== String(id)));
    showToast("Removed");
    renderForecast();
  });
}

// In-page Forecast toolbar (mirrors the Balances toolbar) — replaces the old topbar add menu.
document.getElementById("fc-tb-add-income")?.addEventListener("click", () => openFcModalTyped("in"));
document.getElementById("fc-tb-add-expense")?.addEventListener("click", () => openFcModalTyped("out"));
document.getElementById("fc-tb-manage")?.addEventListener("click", () => openFcModal(null));
document.getElementById("fc-m-start").addEventListener("input", updateFcEndPreview);
document.getElementById("fc-m-months").addEventListener("input", updateFcEndPreview);
document.getElementById("fc-alloc-add")?.addEventListener("click", addAllocSlice);
document.getElementById("fc-manage-items")?.addEventListener("click", () => openFcModal(null));
document.getElementById("fc-view-all-items")?.addEventListener("click", () => openFcModal(null));
document.getElementById("fc-custom-scenario")?.addEventListener("click", () => showToast("Scenario buttons simulate changes without saving data."));
document.getElementById("fc-m-cancel").addEventListener("click", closeFcModal);
document.getElementById("fc-m-save").addEventListener("click", saveFcItem);
document.getElementById("fc-modal").addEventListener("click", e => { if (e.target.id === "fc-modal") closeFcModal(); });
document.getElementById("fc-m-type-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-type]"); if (!b) return;
  _fcModalType = b.dataset.type;
  document.querySelectorAll("#fc-m-type-seg button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.type === _fcModalType));
});
document.getElementById("fc-m-rec-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-rec]"); if (!b) return;
  _fcModalRec = b.dataset.rec;
  document.querySelectorAll("#fc-m-rec-seg button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.rec === _fcModalRec));
  document.getElementById("fc-m-end-row").style.display = _fcModalRec === "monthly" ? "" : "none";
});
document.getElementById("fc-include-sched").addEventListener("change", () => {
  const months = buildForecastMonths(new Date(), _fcMonths);
  renderForecastChart(months);
});

// Payment plans are now sourced from Balance projection debts — the card routes there to manage them.
document.getElementById("plan-add-btn")?.addEventListener("click", () => { if (typeof switchPage === "function") switchPage("debt"); });
document.getElementById("plan-m-cancel")?.addEventListener("click", closePlanModal);
document.getElementById("plan-m-save").addEventListener("click", savePlan);
document.getElementById("plan-modal").addEventListener("click", e => { if (e.target.id === "plan-modal") closePlanModal(); });

document.getElementById("fc-view-seg")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-view]");
  if (!btn || btn.dataset.view === _fcView) return;
  _fcView = btn.dataset.view;
  const months = buildForecastMonths(new Date(), _fcMonths);
  renderBalanceForecast(months);
});

document.getElementById("fc-months-seg").addEventListener("click", e => {
  const btn = e.target.closest("[data-months]");
  if (!btn) return;
  _fcMonths = parseInt(btn.dataset.months, 10);
  document.querySelectorAll("#fc-months-seg button").forEach(b =>
    b.setAttribute("aria-pressed", b === btn ? "true" : "false")
  );
  renderForecast();
});

document.getElementById("set-name").addEventListener("input", e => {
  const s = getSettings(); s.name = e.target.value.trim(); lsSet("fin_settings", s);
  applySidebarProfile();
  if (typeof renderGreeting === "function") renderGreeting();
  // refresh preview if the letter is the active avatar
  if (!s.avatarDataUrl) {
    const prev = document.getElementById("set-av-preview");
    if (prev) prev.innerHTML = avatarInner();
  }
});
// Profile avatar — click the avatar to upload an image; "Use letter" to revert to first letter of name.
document.getElementById("set-av-btn").addEventListener("click", () => document.getElementById("set-av-file").click());
document.getElementById("set-av-file").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1024*1024) { showToast("Image too large (max 1MB)"); e.target.value=""; return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const s = getSettings();
    s.avatarDataUrl = ev.target.result;
    delete s.avatarEmoji; // emoji concept dropped from UI; clear any legacy value
    lsSet("fin_settings", s);
    applySidebarProfile();
    const prev = document.getElementById("set-av-preview");
    prev.innerHTML = avatarInner();
    prev.style.background = "transparent";
    showToast("Profile picture updated");
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});
document.getElementById("set-av-letter").addEventListener("click", () => {
  const s = getSettings();
  delete s.avatarDataUrl;
  delete s.avatarEmoji;
  lsSet("fin_settings", s);
  applySidebarProfile();
  const prev = document.getElementById("set-av-preview");
  prev.innerHTML = avatarInner();
  prev.style.background = "";
  showToast("Using first letter of your name");
});
document.getElementById("set-currency").addEventListener("change", e => {
  const s = getSettings(); s.currency = e.target.value; lsSet("fin_settings", s);
  applySidebarProfile();
  // fmtGBP reads settings.currency live — re-render so every amount reformats now.
  if (typeof renderAll === "function") renderAll();
  showToast(`Currency set to ${e.target.value}`);
});
document.getElementById("set-datefmt").addEventListener("change", e => {
  const s = getSettings(); s.dateFormat = e.target.value; lsSet("fin_settings", s);
  if (typeof renderAll === "function") renderAll();
  showToast("Date format updated");
});
document.getElementById("set-weekstart-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-ws]"); if (!b) return;
  const s = getSettings(); s.weekStart = +b.dataset.ws; lsSet("fin_settings", s);
  document.querySelectorAll("#set-weekstart-seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
  if (typeof renderAll === "function") renderAll();
  showToast(`Week starts ${+b.dataset.ws === 0 ? "Sunday" : "Monday"}`);
});
document.getElementById("set-theme-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-theme]"); if(!b) return;
  _dark = b.dataset.theme === "dark"; applyTheme();
  document.querySelectorAll("#set-theme-seg button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.theme === b.dataset.theme));
});
document.getElementById("set-density-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-density]"); if(!b) return;
  document.documentElement.dataset.density = b.dataset.density;
  localStorage.setItem("ledger_density", b.dataset.density);
  document.querySelectorAll("#set-density-seg button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.density === b.dataset.density));
});
// (Privacy mode removed from Settings — toggled via the eye icon in the topbar.)
document.getElementById("set-accent").addEventListener("input", e => {
  const hex = e.target.value;
  const s = getSettings(); s.accentColor = hex; lsSet("fin_settings", s);
  applyAccent(hex);
  document.querySelectorAll("#set-accent-presets button").forEach(b => b.setAttribute("aria-pressed", b.dataset.color.toLowerCase() === hex.toLowerCase()));
});
document.querySelectorAll("#set-accent-presets button").forEach(b => {
  b.addEventListener("click", () => {
    const hex = b.dataset.color;
    document.getElementById("set-accent").value = hex;
    document.getElementById("set-accent").dispatchEvent(new Event("input"));
  });
});
document.getElementById("set-accent-reset").addEventListener("click", () => {
  const s = getSettings(); delete s.accentColor; lsSet("fin_settings", s);
  applyAccent(null);
  document.getElementById("set-accent").value = "#7fb069";
  document.querySelectorAll("#set-accent-presets button").forEach(b => b.removeAttribute("aria-pressed"));
});

// Positive colour
document.getElementById("set-pos").addEventListener("input", e => {
  const hex = e.target.value;
  const s = getSettings(); s.posColor = hex; lsSet("fin_settings", s);
  applyPosColor(hex);
  document.querySelectorAll("#set-pos-presets button").forEach(b => b.setAttribute("aria-pressed", b.dataset.color.toLowerCase() === hex.toLowerCase()));
});
document.querySelectorAll("#set-pos-presets button").forEach(b => {
  b.addEventListener("click", () => {
    document.getElementById("set-pos").value = b.dataset.color;
    document.getElementById("set-pos").dispatchEvent(new Event("input"));
  });
});
document.getElementById("set-pos-reset").addEventListener("click", () => {
  const s = getSettings(); delete s.posColor; lsSet("fin_settings", s);
  applyPosColor(null);
  document.getElementById("set-pos").value = "#6aaa64";
  document.querySelectorAll("#set-pos-presets button").forEach(b => b.removeAttribute("aria-pressed"));
});

// Negative colour
document.getElementById("set-neg").addEventListener("input", e => {
  const hex = e.target.value;
  const s = getSettings(); s.negColor = hex; lsSet("fin_settings", s);
  applyNegColor(hex);
  document.querySelectorAll("#set-neg-presets button").forEach(b => b.setAttribute("aria-pressed", b.dataset.color.toLowerCase() === hex.toLowerCase()));
});
document.querySelectorAll("#set-neg-presets button").forEach(b => {
  b.addEventListener("click", () => {
    document.getElementById("set-neg").value = b.dataset.color;
    document.getElementById("set-neg").dispatchEvent(new Event("input"));
  });
});
document.getElementById("set-neg-reset").addEventListener("click", () => {
  const s = getSettings(); delete s.negColor; lsSet("fin_settings", s);
  applyNegColor(null);
  document.getElementById("set-neg").value = "#e85a78";
  document.querySelectorAll("#set-neg-presets button").forEach(b => b.removeAttribute("aria-pressed"));
});

// Border radius
document.getElementById("set-radius").addEventListener("input", e => {
  const px = Number(e.target.value);
  const s = getSettings(); s.radius = px; lsSet("fin_settings", s);
  applyRadius(px);
  const v = document.getElementById("set-radius-val");
  if (v) v.textContent = px + "px";
});

// App-icon variant picker
document.getElementById("set-icon-variant").addEventListener("click", e => {
  const b = e.target.closest("[data-variant]"); if (!b) return;
  const v = b.dataset.variant;
  const s = getSettings(); s.iconVariant = v; lsSet("fin_settings", s);
  applyIconVariant(v);
  document.querySelectorAll("#set-icon-variant button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.variant === v));
});

// Reduce motion — disable all animations/transitions app-wide
document.getElementById("set-motion-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  const on = b.dataset.rm === "1";
  const s = getSettings(); if (on) s.reduceMotion = true; else delete s.reduceMotion; lsSet("fin_settings", s);
  document.documentElement.dataset.motion = on ? "reduced" : "";
  document.querySelectorAll("#set-motion-seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
});
// Compact numbers — abbreviate large amounts (£1.2k) everywhere
document.getElementById("set-compact-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-compact]"); if (!b) return;
  const on = b.dataset.compact === "1";
  const s = getSettings(); if (on) s.compactNumbers = true; else delete s.compactNumbers; lsSet("fin_settings", s);
  document.querySelectorAll("#set-compact-seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
  if (typeof renderAll === "function") renderAll();
});
// Sidebar — auto-collapse (hover to expand) vs always open
document.getElementById("set-sidebar-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-sb]"); if (!b) return;
  const auto = b.dataset.sb === "1";
  const s = getSettings(); if (auto) delete s.sidebarAuto; else s.sidebarAuto = false; lsSet("fin_settings", s);
  document.body.classList.toggle("sidebar-auto", auto);
  document.querySelectorAll("#set-sidebar-seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
});
// Start in privacy mode — launch preference only (live blur stays controlled by the eye icon).
document.getElementById("set-privacy-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-pd]"); if (!b) return;
  const on = b.dataset.pd === "1";
  const s = getSettings(); if (on) s.privacyDefault = true; else delete s.privacyDefault; lsSet("fin_settings", s);
  document.querySelectorAll("#set-privacy-seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
});

document.getElementById("set-cat-type").addEventListener("click", e => {
  const b = e.target.closest("[data-type]"); if(!b) return;
  _setCatType = b.dataset.type;
  document.querySelectorAll("#set-cat-type button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.type === _setCatType));
  renderCatMgr();
});
// NW-bucket / Accounts settings controls were removed (those live on the Balances
// page now), and the Import & Export controls were rebuilt as a unified ticklist
// (wired in settings.js). Only the custom-category modal wiring remains here.
document.getElementById("cat-m-cancel").addEventListener("click", closeCustomCatModal);
document.getElementById("cat-m-save").addEventListener("click", saveCustomCat);
document.getElementById("cat-modal").addEventListener("click", e => { if (e.target.id === "cat-modal") closeCustomCatModal(); });
document.getElementById("cat-m-type-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-type]"); if(!b) return;
  _catModalType = b.dataset.type;
  document.querySelectorAll("#cat-m-type-seg button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.type === _catModalType));
});

