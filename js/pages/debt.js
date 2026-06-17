/* ════════════════════════════════════════
   DEBT PAYOFF PLANNER
   Snowball (smallest balance first) vs Avalanche (highest APR first).
   Debts persist in fin_debts; strategy + extra payment in fin_debt_settings.
════════════════════════════════════════ */
let _debtEditId = null;
let _debtEditMode = false;   // table Edit toggle — reveals edit/bill/delete buttons on rows

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
// Strategy + extra-payment controls were removed from the page; the projection
// is always Avalanche (highest-APR first) on the minimum payments alone.
const DEBT_STRATEGY = "avalanche";
const DEBT_EXTRA = 0;

// Each item is one of three kinds. Colour is derived from the kind everywhere
// (debt = red, transfer = purple, income = green) — there is no per-item colour.
// Only "debt" items feed the payoff projection / KPIs / breakdown; transfers and
// income are tracked-only planned line items shown in their own table sections.
const KIND_ORDER = ["debt", "transfer", "income"];
const KIND_LABEL = { debt: "Debt", transfer: "Transfers", income: "Income" };
const KIND_COLORS = { debt: "var(--neg)", transfer: "#a06cd5", income: "var(--pos)" };
function _debtKind(d) { return d.kind || "debt"; }

function renderDebt() {
  const items = getDebts();
  const debts = items.filter(d => _debtKind(d) === "debt");

  const listSub = document.getElementById("debt-list-sub");
  const list = document.getElementById("debt-list");
  const kpis = document.getElementById("debt-kpis");
  const grid = document.getElementById("debt-grid");
  const tblHead = document.querySelector("#page-debt .debt-table-head");

  // Full empty state: nothing planned at all.
  if (!items.length) {
    if (listSub) listSub.textContent = "Add debts, planned transfers or income";
    if (tblHead) tblHead.style.display = "none";
    if (list) list.innerHTML = `<div class="page-stub"><h3>Nothing planned yet</h3><div>Add debts, planned transfers to savings, or income to build your projection.</div></div>`;
    if (kpis) { kpis.innerHTML = ""; kpis.style.display = "none"; }
    const totRow0 = document.getElementById("debt-total-row");
    if (totRow0) totRow0.hidden = true;
    if (grid) grid.classList.add("no-viz");
    return;
  }
  if (tblHead) tblHead.style.display = "";

  // Both fixed boxes stay put whenever there is any data — the right pane is only
  // hidden in the fully-empty state above. The projection / chips / breakdown are
  // debt-only; when there are no debts the chart renders an empty placeholder rather
  // than hiding (which previously reflowed the layout and ballooned a stale chart).
  const hasDebts = debts.length > 0;
  if (grid) grid.classList.remove("no-viz");
  if (kpis) kpis.style.display = "";

  const totalBal = debts.reduce((s, d) => s + (+d.balance || 0), 0);
  const totalMin = debts.reduce((s, d) => s + (+d.min || 0), 0);
  if (listSub) {
    const nInc = items.filter(d => _debtKind(d) === "income").length;
    const nTfr = items.filter(d => _debtKind(d) === "transfer").length;
    const parts = [];
    if (hasDebts) parts.push(`${debts.length} debt${debts.length > 1 ? "s" : ""} · ${fmtGBP(totalBal)} owed · ${fmtGBP(totalMin)}/mo min`);
    if (nTfr) parts.push(`${nTfr} transfer${nTfr > 1 ? "s" : ""}`);
    if (nInc) parts.push(`${nInc} income`);
    listSub.textContent = parts.join(" · ");
  }

  // Net monthly cashflow pinned to the card bottom: income − transfers − debt minimums.
  const totIncome = items.filter(d => _debtKind(d) === "income").reduce((s, d) => s + (+d.amount || 0), 0);
  const totTransfer = items.filter(d => _debtKind(d) === "transfer").reduce((s, d) => s + (+d.amount || 0), 0);
  const net = totIncome - totTransfer - totalMin;
  const totRow = document.getElementById("debt-total-row");
  const netEl = document.getElementById("debt-net-val");
  const netSub = document.getElementById("debt-total-sub");
  if (totRow) totRow.hidden = false;
  if (netEl) {
    netEl.className = "debt-total-val blur " + (net > 0 ? "pos" : net < 0 ? "neg" : "");
    netEl.textContent = `${net >= 0 ? "+" : "−"}${fmtGBP(Math.abs(net), { dp: 0 })}/mo`;
  }
  if (netSub) netSub.textContent = `${fmtGBP(totIncome, { dp: 0 })} in · ${fmtGBP(totTransfer + totalMin, { dp: 0 })} out`;

  // Debt-only payoff simulation (null when there are no debts).
  const sim = hasDebts ? simulateDebtPayoff(debts, DEBT_STRATEGY, DEBT_EXTRA) : null;

  // KPI chips — always shown; zeroed when there are no debts.
  if (kpis) {
    const chips = [
      { label: "Total debt", value: fmtGBP(totalBal, { dp: 0 }), cls: "" },
      { label: "Debt-free", value: !sim ? "—" : (sim.stalled ? "Never" : _fmtMonthYear(sim.debtFreeDate)), cls: !sim ? "" : (sim.stalled ? "neg" : "pos") },
      { label: "Total interest", value: fmtGBP(sim ? sim.totalInterest : 0, { dp: 0 }), cls: "neg" },
      { label: "Monthly payment", value: fmtGBP(sim ? sim.totalMonthly : 0, { dp: 0 }), cls: "" },
    ];
    kpis.innerHTML = chips.map(c =>
      `<div class="debt-chip"><span>${c.label}</span><b class="blur ${c.cls}">${c.value}</b></div>`).join("");
  }

  // Projection chart — always rendered into its fixed box. With debts it draws the
  // payoff line; without debts it shows a muted placeholder (this also clears any
  // stale SVG, which is the actual fix for the "exploding chart" bug).
  const chartEl = document.getElementById("debt-chart");
  const chartSub = document.getElementById("debt-chart-sub");
  if (chartEl) {
    if (sim && sim.series.length >= 2) {
      if (chartSub) chartSub.textContent = sim.stalled
        ? `${fmtGBP(sim.totalMonthly, { dp: 0 })}/mo · some debts never clear`
        : `${fmtGBP(sim.totalMonthly, { dp: 0 })}/mo until ${_fmtMonthYear(sim.debtFreeDate)}`;
      chartEl.innerHTML = (sim.stalled
        ? `<div class="debt-stall-note">⚠️ At these minimum payments, some debts never clear — interest outpaces the payment.</div>`
        : "") + _debtPayoffChart(sim);
      _wireDebtChartHover(sim);
    } else {
      if (chartSub) chartSub.textContent = "";
      chartEl.innerHTML = `<div class="debt-chart-empty">Add a debt to project your payoff</div>`;
    }
  }

  // Balance-by-debt breakdown — populated with debts, cleared otherwise.
  if (hasDebts) renderDebtBreakdown(debts, totalBal);
  else { const bd = document.getElementById("debt-breakdown"); if (bd) bd.innerHTML = ""; }

  // Sectioned table: Debt / Transfers / Income, each shown only when non-empty.
  if (list) {
    let html = "";
    KIND_ORDER.forEach(kind => {
      let inKind = items.filter(d => _debtKind(d) === kind);
      if (!inKind.length) return;
      inKind = (kind === "debt")
        ? inKind.sort((a, b) => (+b.apr || 0) - (+a.apr || 0) || (+a.balance || 0) - (+b.balance || 0))
        : inKind.sort((a, b) => (+b.amount || 0) - (+a.amount || 0));
      html += `<div class="debt-group-head">${KIND_LABEL[kind]}</div>`;
      html += inKind.map((d, i) => _debtRowHtml(d, i, kind, sim)).join("");
    });
    list.innerHTML = html;
  }
}

// One table row. Debt rows keep the full payoff columns; income/transfer rows show
// their monthly amount in the Balance column and a muted — for the debt-only columns.
function _debtRowHtml(d, idx, kind, sim) {
  const color = KIND_COLORS[kind] || "var(--accent)";
  const safeId = String(d.id).replace(/'/g, "\\'");
  const isDebt = kind === "debt";
  const EDIT_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
  const TRASH_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;
  // Bill tie-in stays debt-only.
  const billBtn = isDebt
    ? `<button title="Add to Bills &amp; Subscriptions (monthly repayment bill)" onclick="debtCreateBill('${safeId}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 13v5M9.5 15.5h5"/></svg></button>`
    : "";
  const acts = _debtEditMode ? `<span class="acts">
      <button title="Edit" onclick="openDebtModal('${safeId}')">${EDIT_SVG}</button>
      ${billBtn}
      <button class="danger" title="Delete" onclick="deleteDebtRow('${safeId}')">${TRASH_SVG}</button>
    </span>` : `<span class="acts"></span>`;

  if (isDebt) {
    const r = sim ? sim.perDebt.find(x => x.id === d.id) : null;
    const cleared = r && r.paidMonth
      ? `<b>${_fmtMonthYear(_addMonths(new Date(), r.paidMonth))}</b><small>${_fmtMonths(r.paidMonth)}</small>`
      : `<b class="neg">never</b><small>payment too low</small>`;
    const focus = idx === 0 ? `<span class="debt-focus-badge" title="Next to clear with the freed-up payments">focus</span>` : "";
    return `<div class="debt-row">
      <span class="debt-row-name"><i class="debt-dot" style="background:${color}"></i><b>${_esc(d.name)}</b>${focus}</span>
      <span class="num blur">${fmtGBP(+d.balance || 0)}</span>
      <span class="num">${(+d.apr || 0).toFixed(1)}%</span>
      <span class="num blur">${fmtGBP(+d.min || 0)}</span>
      <span class="debt-row-cleared">${cleared}</span>
      <span class="num blur neg">${r ? fmtGBP(r.interestPaid, { dp: 0 }) : "—"}</span>
      ${acts}
    </div>`;
  }
  // Income / transfer: monthly amount in the Balance column, muted — elsewhere.
  return `<div class="debt-row">
    <span class="debt-row-name"><i class="debt-dot" style="background:${color}"></i><b>${_esc(d.name)}</b></span>
    <span class="num blur">${fmtGBP(+d.amount || 0, { dp: 0 })}/mo</span>
    <span class="num na">—</span>
    <span class="num na">—</span>
    <span class="debt-row-cleared na">—</span>
    <span class="num na">—</span>
    ${acts}
  </div>`;
}

/* ── Balance-by-debt mini breakdown (right pane, under the chart) ─────────────
 * One proportional bar per debt so the right pane always shows something useful,
 * even when the projection is degenerate (e.g. a single small debt). */
function renderDebtBreakdown(debts, totalBal) {
  const el = document.getElementById("debt-breakdown");
  if (!el) return;
  const color = KIND_COLORS.debt;
  const rows = [...debts].sort((a, b) => (+b.balance || 0) - (+a.balance || 0)).map(d => {
    const bal = Math.max(0, +d.balance || 0);
    const pct = totalBal > 0 ? (bal / totalBal) * 100 : 0;
    return `<div class="debt-mini-row">
      <div class="debt-mini-top">
        <span class="debt-mini-name"><i class="debt-dot" style="background:${color}"></i>${_esc(d.name)}</span>
        <span class="debt-mini-val blur">${fmtGBP(bal, { dp: 0 })} · ${pct.toFixed(0)}%</span>
      </div>
      <div class="debt-mini-bar"><span class="debt-mini-fill" style="width:${pct.toFixed(1)}%;background:${color}"></span></div>
    </div>`;
  }).join("");
  el.innerHTML = `<div class="debt-mini-title">Balance by debt</div>${rows}`;
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
  // Portrait-ish geometry tuned for the narrow right-hand column.
  const w = 480, h = 320, left = 62, right = 30, top = 16, bottom = 34;
  const plotW = w - left - right, plotH = h - top - bottom;
  const n = series.length;
  const x = i => left + (n <= 1 ? 0 : i / (n - 1) * plotW);
  const y = v => top + (yMax - v) / (yMax || 1) * plotH;
  const pts = series.map((p, i) => ({ ...p, x: x(i), y: y(p.remaining) }));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const baseY = y(0);
  const fill = `${path} L${pts[n-1].x.toFixed(1)},${baseY.toFixed(1)} L${pts[0].x.toFixed(1)},${baseY.toFixed(1)} Z`;
  const tickVals = [yMax, yMax / 2, 0];
  // Label roughly 4 points across the narrower x-axis (plus the last one).
  const step = Math.max(1, Math.ceil(n / 4));
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
// Show/hide the kind-specific field rows + retitle, based on the Type select.
function _debtSyncModalFields() {
  const kind = document.getElementById("debt-m-kind").value;
  const isDebt = kind === "debt";
  document.querySelectorAll("#debt-modal .debt-m-debtfield").forEach(el => { el.style.display = isDebt ? "" : "none"; });
  document.querySelectorAll("#debt-modal .debt-m-amtfield").forEach(el => { el.style.display = isDebt ? "none" : ""; });
  document.getElementById("debt-modal-title").textContent =
    (_debtEditId ? "Edit " : "Add ") + (KIND_LABEL[kind] || "item").toLowerCase().replace(/s$/, "");
}
function openDebtModal(id) {
  _debtEditId = id || null;
  const d = id ? getDebts().find(x => String(x.id) === String(id)) : null;
  const kind = d ? _debtKind(d) : "debt";
  document.getElementById("debt-m-kind").value = kind;
  document.getElementById("debt-m-name").value = d ? (d.name || "") : "";
  document.getElementById("debt-m-balance").value = d ? (d.balance ?? "") : "";
  document.getElementById("debt-m-apr").value = d ? (d.apr ?? "") : "";
  document.getElementById("debt-m-min").value = d ? (d.min ?? "") : "";
  document.getElementById("debt-m-amount").value = d ? (d.amount ?? "") : "";
  document.getElementById("debt-m-delete").style.display = d ? "" : "none";
  _debtSyncModalFields();
  document.getElementById("debt-modal").hidden = false;
  setTimeout(() => document.getElementById("debt-m-name").focus(), 30);
}
function closeDebtModal() {
  document.getElementById("debt-modal").hidden = true;
  _debtEditId = null;
}
function saveDebtFromModal() {
  const kind = document.getElementById("debt-m-kind").value;
  const name = document.getElementById("debt-m-name").value.trim();
  if (!name) { showToast("Give it a name"); return; }
  let fields;
  if (kind === "debt") {
    const balance = parseFloat(document.getElementById("debt-m-balance").value);
    if (!(balance >= 0)) { showToast("Enter a valid balance"); return; }
    fields = { balance, apr: parseFloat(document.getElementById("debt-m-apr").value) || 0, min: parseFloat(document.getElementById("debt-m-min").value) || 0, amount: 0 };
  } else {
    const amount = parseFloat(document.getElementById("debt-m-amount").value);
    if (!(amount > 0)) { showToast("Enter a monthly amount"); return; }
    fields = { balance: 0, apr: 0, min: 0, amount };
  }
  const debts = getDebts();
  if (_debtEditId) {
    const d = debts.find(x => String(x.id) === String(_debtEditId));
    if (d) { d.name = name; d.kind = kind; Object.assign(d, fields); delete d.color; }
  } else {
    debts.push({ id: Date.now() + Math.floor(Math.random() * 1000), name, kind, ...fields });
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
    confirmDialog({ title: "Delete this item?", message: "It will be removed from your plan.", confirmLabel: "Delete", danger: true }, run);
  } else { run(); }
}
// Inline delete from the table's Edit mode (no modal round-trip).
function deleteDebtRow(id) {
  confirmDialog({ title: "Delete this item?", message: "It will be removed from your plan.", confirmLabel: "Delete", danger: true }, () => {
    setDebts(getDebts().filter(x => String(x.id) !== String(id)));
    renderDebt();
  });
}
function toggleDebtEditMode() {
  _debtEditMode = !_debtEditMode;
  const btn = document.getElementById("debt-edit-toggle");
  if (btn) { btn.classList.toggle("editing", _debtEditMode); btn.setAttribute("aria-pressed", String(_debtEditMode)); }
  renderDebt();
}

/* ── Bills & Subscriptions tie-in ───────────────────────────────────────────
   Creates a monthly "Repayments" bill from a debt: amount = the debt's minimum
   payment, total = current balance (so the Bills repayment progress bar tracks
   it as you post each month). Dedupe by description. */
function debtCreateBill(id) {
  const d = getDebts().find(x => String(x.id) === String(id));
  if (!d) return;
  if (!(+d.min > 0)) { showToast("Set a minimum monthly payment on this debt first"); return; }
  const recs = getRecurring();
  if (recs.some(r => (r.description || "").toLowerCase() === (d.name || "").toLowerCase())) {
    showToast(`A bill called "${d.name}" already exists`); return;
  }
  confirmDialog({
    title: "Add to Bills & Subscriptions?",
    message: `Creates a monthly Repayments bill: "${d.name}" · ${fmtGBP(+d.min, { dp: 2, minDp: 0 })}/mo on the 1st, tracking ${fmtGBP(+d.balance, { dp: 0 })} outstanding. You can edit the due day on the Bills tab.`,
    confirmLabel: "Create bill",
  }, () => {
    recs.push({
      id: Date.now() + Math.floor(Math.random() * 1000),
      description: d.name, type: "out", amount: +d.min, day: 1,
      period: "monthly", category: "Repayments", account: "",
      total: Math.max(0, +d.balance || 0), paid: 0,
    });
    lsSet("fin_recurring", recs);
    showToast(`"${d.name}" added to Bills & Subscriptions`);
    renderAll();
  });
}

/* ── Wire UI ────────────────────────────────────────────────────────────── */
(function wireDebt() {
  const add = document.getElementById("debt-add-btn");
  if (add) add.addEventListener("click", () => openDebtModal(null));
  document.getElementById("debt-edit-toggle")?.addEventListener("click", toggleDebtEditMode);
  const save = document.getElementById("debt-m-save");
  if (save) save.addEventListener("click", saveDebtFromModal);
  const cancel = document.getElementById("debt-m-cancel");
  if (cancel) cancel.addEventListener("click", closeDebtModal);
  const del = document.getElementById("debt-m-delete");
  if (del) del.addEventListener("click", deleteDebtFromModal);
  document.getElementById("debt-m-kind")?.addEventListener("change", _debtSyncModalFields);
  const modal = document.getElementById("debt-modal");
  if (modal) modal.addEventListener("click", e => { if (e.target.id === "debt-modal") closeDebtModal(); });
})();
