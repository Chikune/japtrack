/* ════════════════════════════════════════
   DEBT PAYOFF PLANNER
   Snowball (smallest balance first) vs Avalanche (highest APR first).
   Debts persist in fin_debts; strategy + extra payment in fin_debt_settings.
════════════════════════════════════════ */
let _debtEditId = null;

/* ── Payoff simulation ──────────────────────────────────────────────────────
 * Month-by-month amortisation. Every debt accrues monthly interest (APR/12),
 * each gets at least its minimum payment, and any leftover budget (sum of mins
 * already paid off + user's extra) is funnelled to the single "target" debt
 * chosen by the active strategy. Returns per-debt results + portfolio totals.
 * Guards against never-ending plans (min payment ≤ interest) by capping months.
 * ──────────────────────────────────────────────────────────────────────────── */
function simulateDebtPayoff(debts, strategy, extra) {
  const MAX_MONTHS = 1200; // 100 years — safety cap
  // Working copy
  const work = debts.map(d => ({
    id: d.id, name: d.name, color: d.color,
    bal: Math.max(0, +d.balance || 0),
    apr: Math.max(0, +d.apr || 0),
    min: Math.max(0, +d.min || 0),
    paidMonth: null, interestPaid: 0, startBal: Math.max(0, +d.balance || 0),
  }));
  const active = () => work.filter(d => d.bal > 0.005);
  const totalMin = work.reduce((s, d) => s + d.min, 0);
  let budget = totalMin + Math.max(0, +extra || 0);

  // Detectable stall: any debt whose minimum can't cover its first month's interest
  // AND there's no extra capacity will balloon forever. We still simulate (extra may
  // clear others first, freeing budget), but flag it if the cap is hit.
  let month = 0;
  let stalled = false;

  // Monthly series for the chart: starting point (month 0 = today) is the full balance.
  const startTotal = work.reduce((s, d) => s + d.bal, 0);
  let cumPaid = 0, cumInterest = 0;
  const series = [{ month: 0, date: new Date(), remaining: startTotal, paid: 0, interest: 0, cumPaid: 0, cumInterest: 0, debtsLeft: work.length, clearedNames: [] }];

  while (active().length && month < MAX_MONTHS) {
    month++;
    let paidThisMonth = 0, interestThisMonth = 0;
    // 1. Accrue interest
    active().forEach(d => {
      const interest = d.bal * (d.apr / 100 / 12);
      d.bal += interest;
      d.interestPaid += interest;
      interestThisMonth += interest;
    });
    // 2. Pay minimums (capped at balance)
    let pool = budget;
    active().forEach(d => {
      const pay = Math.min(d.min, d.bal);
      d.bal -= pay;
      pool -= pay;
      paidThisMonth += pay;
    });
    // 3. Funnel leftover to the strategy target
    let guard = 0;
    while (pool > 0.005 && active().length && guard < 100) {
      guard++;
      const target = _debtTarget(active(), strategy);
      if (!target) break;
      const pay = Math.min(pool, target.bal);
      target.bal -= pay;
      pool -= pay;
      paidThisMonth += pay;
    }
    // 4. Mark anything cleared this month
    const clearedNames = [];
    work.forEach(d => { if (d.paidMonth === null && d.bal <= 0.005) { d.bal = 0; d.paidMonth = month; clearedNames.push(d.name); } });
    // 5. Record the month's remaining balance, amount paid, interest, and running totals
    const remaining = work.reduce((s, d) => s + Math.max(0, d.bal), 0);
    cumPaid += paidThisMonth;
    cumInterest += interestThisMonth;
    series.push({ month, date: _addMonths(new Date(), month), remaining, paid: paidThisMonth, interest: interestThisMonth, cumPaid, cumInterest, debtsLeft: active().length, clearedNames });
  }
  if (month >= MAX_MONTHS && active().length) stalled = true;

  const totalInterest = work.reduce((s, d) => s + d.interestPaid, 0);
  const totalStart = work.reduce((s, d) => s + d.startBal, 0);
  // Payoff order = sequence in which debts hit zero
  const order = work.filter(d => d.paidMonth !== null)
    .sort((a, b) => a.paidMonth - b.paidMonth);
  return {
    months: month, stalled,
    totalInterest, totalStart,
    totalMonthly: budget,
    debtFreeDate: stalled ? null : _addMonths(new Date(), month),
    perDebt: work, order, series,
  };
}

// Pick the next debt to attack: avalanche = highest APR, snowball = smallest balance.
// Ties broken by the other metric so the order is always deterministic.
function _debtTarget(activeDebts, strategy) {
  if (!activeDebts.length) return null;
  const sorted = [...activeDebts].sort((a, b) => {
    if (strategy === "snowball") return a.bal - b.bal || b.apr - a.apr;
    return b.apr - a.apr || a.bal - b.bal; // avalanche default
  });
  return sorted[0];
}

function _addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
function _fmtMonths(n) {
  if (n == null) return "—";
  const y = Math.floor(n / 12), m = n % 12;
  if (y && m) return `${y}y ${m}m`;
  if (y) return `${y}y`;
  return `${m}m`;
}
function _fmtMonthYear(d) {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function renderDebt() {
  const debts = getDebts();
  const st = getDebtSettings();

  // Sync controls to saved settings
  const seg = document.getElementById("debt-strategy-seg");
  if (seg) seg.querySelectorAll("button").forEach(b =>
    b.setAttribute("aria-pressed", b.dataset.strategy === st.strategy ? "true" : "false"));
  const extraInp = document.getElementById("debt-extra");
  if (extraInp && document.activeElement !== extraInp) extraInp.value = st.extra || "";

  const hint = document.getElementById("debt-strategy-hint");
  if (hint) hint.textContent = st.strategy === "snowball"
    ? "Snowball: clears your smallest balance first for quick momentum."
    : "Avalanche: targets your highest interest rate first to minimise total interest.";

  const listSub = document.getElementById("debt-list-sub");
  const list = document.getElementById("debt-list");
  const kpis = document.getElementById("debt-kpis");
  const planSec = document.getElementById("debt-plan-section");
  const plan = document.getElementById("debt-plan");
  const chartSec = document.getElementById("debt-chart-section");

  if (!debts.length) {
    if (listSub) listSub.textContent = "";
    if (list) list.innerHTML = `<div class="page-stub"><h3>No debts added yet</h3><div>Add your credit cards, loans, or overdrafts to see your fastest route to debt-free.</div></div>`;
    if (kpis) kpis.innerHTML = "";
    if (planSec) planSec.hidden = true;
    if (chartSec) chartSec.hidden = true;
    return;
  }

  const totalBal = debts.reduce((s, d) => s + (+d.balance || 0), 0);
  const totalMin = debts.reduce((s, d) => s + (+d.min || 0), 0);
  if (listSub) listSub.textContent = `${debts.length} debt${debts.length > 1 ? "s" : ""} · ${fmtGBP(totalBal)} owed`;

  const sim = simulateDebtPayoff(debts, st.strategy, st.extra);
  // Compare with the other strategy + with mins-only, to show savings
  const minOnly = simulateDebtPayoff(debts, st.strategy, 0);
  const interestSaved = Math.max(0, minOnly.totalInterest - sim.totalInterest);
  const monthsSaved = (minOnly.stalled || sim.stalled) ? null : Math.max(0, minOnly.months - sim.months);

  // KPIs
  if (kpis) {
    const I = _debtKpiIcons();
    const cards = [
      { label: "Total debt", value: fmtGBP(totalBal, { dp: 0 }), sub: `${debts.length} account${debts.length > 1 ? "s" : ""}`, ic: I.coins, tone: "" },
      { label: "Debt-free", value: sim.stalled ? "Never" : _fmtMonthYear(sim.debtFreeDate), sub: sim.stalled ? "payments too low" : _fmtMonths(sim.months), cls: sim.stalled ? "neg" : "pos", ic: I.flag, tone: sim.stalled ? "neg" : "pos" },
      { label: "Total interest", value: fmtGBP(sim.totalInterest, { dp: 0 }), sub: "over the full plan", cls: "neg", ic: I.percent, tone: "neg" },
      { label: "Monthly payment", value: fmtGBP(sim.totalMonthly, { dp: 0 }), sub: `${fmtGBP(totalMin, { dp: 0 })} min + ${fmtGBP(+st.extra || 0, { dp: 0 })} extra`, ic: I.wallet, tone: "" },
    ];
    kpis.innerHTML = cards.map(c => `
      <div class="debt-kpi-card">
        <div class="debt-kpi-copy">
          <span>${c.label}</span>
          <b class="blur ${c.cls || ""}">${c.value}</b>
          <small>${c.sub}</small>
        </div>
        <span class="debt-kpi-ic ${c.tone}">${c.ic}</span>
      </div>`).join("");
  }

  // Payoff projection chart
  if (chartSec) {
    if (sim.stalled || sim.series.length < 2) {
      chartSec.hidden = true;
    } else {
      chartSec.hidden = false;
      const sub = document.getElementById("debt-chart-sub");
      if (sub) sub.textContent = `${fmtGBP(sim.totalMonthly, { dp: 0 })}/mo until ${_fmtMonthYear(sim.debtFreeDate)}`;
      document.getElementById("debt-chart").innerHTML = _debtPayoffChart(sim);
      _wireDebtChartHover(sim);
    }
  }

  // Debt cards (ordered by the active strategy's attack priority)
  const ordered = [...debts].sort((a, b) => {
    if (st.strategy === "snowball") return (+a.balance || 0) - (+b.balance || 0) || (+b.apr || 0) - (+a.apr || 0);
    return (+b.apr || 0) - (+a.apr || 0) || (+a.balance || 0) - (+b.balance || 0);
  });
  if (list) {
    list.innerHTML = ordered.map((d, idx) => {
      const r = sim.perDebt.find(x => x.id === d.id);
      const payoff = r && r.paidMonth ? _fmtMonths(r.paidMonth) : (r && r.bal > 0 ? "—" : "—");
      const color = d.color || "var(--accent)";
      const focus = idx === 0 ? `<span class="debt-focus-badge" title="Next to attack with your extra payment">focus</span>` : "";
      const safeId = String(d.id).replace(/'/g, "\\'");
      return `<div class="debt-card" style="--debt-color:${color}">
        <div class="debt-card-bar"></div>
        <div class="debt-card-main">
          <div class="debt-card-top">
            <span class="debt-card-name">${_esc(d.name)}</span>
            ${focus}
            <button class="debt-card-edit" onclick="openDebtModal('${safeId}')" title="Edit debt" aria-label="Edit ${_esc(d.name)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            </button>
          </div>
          <div class="debt-card-stats">
            <div class="debt-stat"><span class="debt-stat-v">${fmtGBP(+d.balance || 0)}</span><span class="debt-stat-l">balance</span></div>
            <div class="debt-stat"><span class="debt-stat-v">${(+d.apr || 0).toFixed(1)}%</span><span class="debt-stat-l">APR</span></div>
            <div class="debt-stat"><span class="debt-stat-v">${fmtGBP(+d.min || 0)}</span><span class="debt-stat-l">min/mo</span></div>
            <div class="debt-stat"><span class="debt-stat-v">${payoff}</span><span class="debt-stat-l">paid off in</span></div>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  // Payoff plan (order + savings callout)
  if (planSec && plan) {
    planSec.hidden = false;
    document.getElementById("debt-plan-sub").textContent =
      st.strategy === "snowball" ? "Smallest balance first" : "Highest interest first";
    let savingsHtml = "";
    if (interestSaved > 1 && (+st.extra || 0) > 0) {
      savingsHtml = `<div class="debt-savings">💡 Your ${fmtGBP(+st.extra)}/mo extra saves <b>${fmtGBP(interestSaved)}</b> in interest${monthsSaved ? ` and clears your debt <b>${_fmtMonths(monthsSaved)}</b> sooner` : ""}.</div>`;
    }
    let stallHtml = "";
    if (sim.stalled) {
      stallHtml = `<div class="debt-stall">⚠️ With these minimum payments, some debts never clear — the interest outpaces the payment. Increase a minimum or add an extra monthly payment above.</div>`;
    }
    const steps = sim.order.map((r, i) => {
      const d = debts.find(x => x.id === r.id) || r;
      const color = d.color || "var(--accent)";
      return `<div class="debt-step">
        <div class="debt-step-num" style="background:${color}">${i + 1}</div>
        <div class="debt-step-body">
          <div class="debt-step-name">${_esc(r.name)}</div>
          <div class="debt-step-meta">cleared by ${_fmtMonthYear(_addMonths(new Date(), r.paidMonth))} · ${_fmtMonths(r.paidMonth)} · ${fmtGBP(r.interestPaid)} interest</div>
        </div>
      </div>`;
    }).join("");
    plan.innerHTML = savingsHtml + stallHtml + `<div class="debt-steps">${steps}</div>`;
  }
}

function _debtKpiIcons() {
  return {
    coins:   `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>`,
    flag:    `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
    percent: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`,
    wallet:  `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19"/><path d="M16 14.5h3"/></svg>`,
  };
}
function _esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ── Payoff projection line chart ────────────────────────────────────────────
 * Plots total remaining balance declining month-by-month to zero. Mirrors the
 * Forecast chart's visual language (gradient fill, accent line, grid + ticks).
 * Each point's tooltip shows that month's remaining balance and amount paid.
 * ──────────────────────────────────────────────────────────────────────────── */
// Geometry shared between the chart renderer and its hover handler.
let _debtChartGeo = null;

function _debtPayoffChart(sim) {
  const series = sim.series;
  if (!series || series.length < 2) return "";
  const maxBal = Math.max(...series.map(p => p.remaining), 1);
  const yMax = maxBal * 1.08;
  const w = 920, h = 300, left = 64, right = 24, top = 18, bottom = 40;
  const plotW = w - left - right, plotH = h - top - bottom;
  const n = series.length;
  const x = i => left + (n <= 1 ? 0 : i / (n - 1) * plotW);
  const y = v => top + (yMax - v) / (yMax || 1) * plotH;
  const pts = series.map((p, i) => ({ ...p, x: x(i), y: y(p.remaining) }));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const baseY = y(0);
  const fill = `${path} L${pts[n-1].x.toFixed(1)},${baseY.toFixed(1)} L${pts[0].x.toFixed(1)},${baseY.toFixed(1)} Z`;
  const tickVals = [yMax, yMax / 2, 0];
  // Label roughly 6 points across the x-axis (plus the last one).
  const step = Math.max(1, Math.ceil(n / 6));
  // Stash geometry so the hover handler can map cursor → nearest point.
  _debtChartGeo = { pts, w, h, top, baseY };
  // Static marker dots on the labelled points; the hover layer adds an interactive
  // guide line, a highlight dot, and the rich tooltip.
  return `<svg class="debt-line-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Debt payoff projection: total balance declining to zero">
    <defs><linearGradient id="debt-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".26"/><stop offset="100%" stop-color="var(--accent)" stop-opacity=".02"/></linearGradient></defs>
    ${tickVals.map(v => `<g><line x1="${left}" x2="${w-right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line-2)"/><text class="debt-axis-y" x="${left-10}" y="${(y(v)+4).toFixed(1)}" text-anchor="end">${fmtGBP(v,{dp:0})}</text></g>`).join("")}
    <path d="${fill}" fill="url(#debt-fill)"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map((p, i) => (i % step === 0 || i === n - 1)
      ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--bg-elev)" stroke-width="1.5"/>`
      : "").join("")}
    ${pts.map((p, i) => (i % step === 0 || i === n - 1)
      ? `<text class="debt-axis-x" x="${p.x.toFixed(1)}" y="${h-12}" text-anchor="middle">${p.date.toLocaleDateString("en-GB",{month:"short",year:"2-digit"})}</text>`
      : "").join("")}
    <line id="debt-hover-line" x1="0" x2="0" y1="${top}" y2="${baseY.toFixed(1)}" stroke="var(--ink-3)" stroke-dasharray="2 3" stroke-width="1" opacity="0"/>
    <circle id="debt-hover-dot" r="5.5" fill="var(--accent)" stroke="var(--bg-elev)" stroke-width="2" opacity="0"/>
  </svg>
  <div class="debt-chart-tip" id="debt-chart-tip" style="display:none"></div>`;
}

// Wire mousemove over the chart → snap to nearest month, move guide line + dot,
// and show a rich tooltip (date, remaining, that month's payment + interest, progress).
function _wireDebtChartHover(sim) {
  const wrap = document.getElementById("debt-chart");
  const svg = wrap?.querySelector(".debt-line-chart");
  const line = document.getElementById("debt-hover-line");
  const dot = document.getElementById("debt-hover-dot");
  const tip = document.getElementById("debt-chart-tip");
  const geo = _debtChartGeo;
  if (!wrap || !svg || !geo || !line || !dot || !tip) return;
  const total = sim.totalStart;

  const move = e => {
    const r = svg.getBoundingClientRect();
    // Map cursor x into the SVG's viewBox coordinate space.
    const vx = ((e.clientX - r.left) / r.width) * geo.w;
    // Find nearest point by x.
    let idx = 0, best = Infinity;
    geo.pts.forEach((p, i) => { const d = Math.abs(p.x - vx); if (d < best) { best = d; idx = i; } });
    const p = geo.pts[idx];
    line.setAttribute("x1", p.x); line.setAttribute("x2", p.x); line.setAttribute("opacity", "1");
    dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); dot.setAttribute("opacity", "1");
    const paidPct = total > 0 ? Math.round((1 - p.remaining / total) * 100) : 0;
    const cleared = p.clearedNames && p.clearedNames.length
      ? `<div class="debt-tip-row debt-tip-cleared">✓ Paid off: ${p.clearedNames.map(_esc).join(", ")}</div>` : "";
    const rows = p.month === 0
      ? `<div class="debt-tip-row"><span>Starting balance</span><b>${fmtGBP(p.remaining,{dp:0})}</b></div>`
      : `<div class="debt-tip-row"><span>Paid this month</span><b>${fmtGBP(p.paid,{dp:2})}</b></div>
         <div class="debt-tip-row"><span>· of which interest</span><b>${fmtGBP(p.interest,{dp:2})}</b></div>
         <div class="debt-tip-row"><span>Balance left</span><b>${fmtGBP(p.remaining,{dp:0})}</b></div>
         <div class="debt-tip-row"><span>Paid off so far</span><b>${paidPct}%</b></div>
         <div class="debt-tip-row"><span>Debts remaining</span><b>${p.debtsLeft}</b></div>${cleared}`;
    tip.innerHTML = `<div class="debt-tip-head">${_fmtMonthYear(p.date)}${p.month ? ` · month ${p.month}` : " · today"}</div>${rows}`;
    tip.style.display = "block";
    // Position tooltip near the point, in pixel space, clamped within the chart.
    const px = (p.x / geo.w) * r.width;
    const py = (p.y / geo.h) * r.height;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let lx = px + 14; if (lx + tw > r.width) lx = px - tw - 14; if (lx < 0) lx = 4;
    let ly = py - th / 2; if (ly < 0) ly = 4; if (ly + th > r.height) ly = r.height - th - 4;
    tip.style.left = lx + "px";
    tip.style.top = ly + "px";
  };
  const hide = () => { line.setAttribute("opacity", "0"); dot.setAttribute("opacity", "0"); tip.style.display = "none"; };
  svg.addEventListener("mousemove", move);
  svg.addEventListener("mouseleave", hide);
}

/* ── Modal (create / edit) ──────────────────────────────────────────────── */
function openDebtModal(id) {
  _debtEditId = id || null;
  const debts = getDebts();
  const d = id ? debts.find(x => String(x.id) === String(id)) : null;
  document.getElementById("debt-modal-title").textContent = d ? "Edit debt" : "Add debt";
  document.getElementById("debt-m-name").value = d ? (d.name || "") : "";
  document.getElementById("debt-m-balance").value = d ? (d.balance ?? "") : "";
  document.getElementById("debt-m-apr").value = d ? (d.apr ?? "") : "";
  document.getElementById("debt-m-min").value = d ? (d.min ?? "") : "";
  document.getElementById("debt-m-color").value = d ? (d.color || "#d97757") : "#d97757";
  document.getElementById("debt-m-delete").style.display = d ? "" : "none";
  document.getElementById("debt-modal").hidden = false;
  setTimeout(() => document.getElementById("debt-m-name").focus(), 30);
}
function closeDebtModal() {
  document.getElementById("debt-modal").hidden = true;
  _debtEditId = null;
}
function saveDebtFromModal() {
  const name = document.getElementById("debt-m-name").value.trim();
  const balance = parseFloat(document.getElementById("debt-m-balance").value);
  const apr = parseFloat(document.getElementById("debt-m-apr").value);
  const min = parseFloat(document.getElementById("debt-m-min").value);
  const color = document.getElementById("debt-m-color").value;
  if (!name) { showToast("Give the debt a name"); return; }
  if (!(balance >= 0)) { showToast("Enter a valid balance"); return; }
  const debts = getDebts();
  if (_debtEditId) {
    const d = debts.find(x => String(x.id) === String(_debtEditId));
    if (d) { d.name = name; d.balance = balance; d.apr = apr || 0; d.min = min || 0; d.color = color; }
  } else {
    debts.push({ id: Date.now() + Math.floor(Math.random() * 1000), name, balance, apr: apr || 0, min: min || 0, color });
  }
  setDebts(debts);
  closeDebtModal();
  renderDebt();
}
function deleteDebtFromModal() {
  if (!_debtEditId) return;
  const run = () => {
    setDebts(getDebts().filter(x => String(x.id) !== String(_debtEditId)));
    closeDebtModal();
    renderDebt();
  };
  if (typeof confirmDialog === "function") {
    confirmDialog({ title: "Delete this debt?", message: "It will be removed from your payoff plan.", confirmLabel: "Delete", danger: true }, run);
  } else { run(); }
}

/* ── Wire UI ────────────────────────────────────────────────────────────── */
(function wireDebt() {
  const add = document.getElementById("debt-add-btn");
  if (add) add.addEventListener("click", () => openDebtModal(null));
  const save = document.getElementById("debt-m-save");
  if (save) save.addEventListener("click", saveDebtFromModal);
  const cancel = document.getElementById("debt-m-cancel");
  if (cancel) cancel.addEventListener("click", closeDebtModal);
  const del = document.getElementById("debt-m-delete");
  if (del) del.addEventListener("click", deleteDebtFromModal);
  const modal = document.getElementById("debt-modal");
  if (modal) modal.addEventListener("click", e => { if (e.target.id === "debt-modal") closeDebtModal(); });

  const seg = document.getElementById("debt-strategy-seg");
  if (seg) seg.addEventListener("click", e => {
    const b = e.target.closest("button[data-strategy]"); if (!b) return;
    const s = getDebtSettings(); s.strategy = b.dataset.strategy; setDebtSettings(s);
    renderDebt();
  });
  const extra = document.getElementById("debt-extra");
  if (extra) extra.addEventListener("input", () => {
    const s = getDebtSettings(); s.extra = Math.max(0, parseFloat(extra.value) || 0); setDebtSettings(s);
    renderDebt();
  });
})();
