// Spending card is locked to treemap; income card is locked to list — the view toggle
// has been removed (was clutter and the user only ever picks one view per card).
const _dashView = { spend: "bars", income: "bars" };

/* Nice axis ticks. Picks a step of 1/2/2.5/5 × 10^k so labels land on round
   values, then rounds the bounds out to that step. Returns enough ticks to
   roughly hit `desired` (typ. 5–7). Handles the small-range case (rawMax<1)
   gracefully by snapping to a 1-step domain. */
function _niceScale(rawMin, rawMax, desired = 6) {
  if (!isFinite(rawMin) || !isFinite(rawMax) || rawMax === rawMin) {
    return { yLo: rawMin, yHi: rawMin + 1, ticks: [rawMin, rawMin + 1] };
  }
  const range = rawMax - rawMin;
  const rough = range / Math.max(1, desired - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 4) step = 2.5 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const yLo = Math.floor(rawMin / step) * step;
  const yHi = Math.ceil(rawMax / step) * step;
  const ticks = [];
  for (let v = yLo; v <= yHi + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return { yLo, yHi, ticks };
}

/* Compact axis label: £0 / £2k / £4k / £1.5M — drops trailing .0 so 2.0k → 2k. */
function _fmtAxisGBP(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e6) return `${sign}£${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1e3) return `${sign}£${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `${sign}£${Math.round(abs)}`;
}

/* Squarified treemap (Bruls/Huijsen/van Wijk).
   - Items must be pre-sorted DESCENDING by value
   - Lays each row along the SHORT side of the remaining rect for near-square tiles
   - Returns [{ x, y, w, h, item }] in container-space coordinates (0..W, 0..H). */
function squarifiedTreemap(items, W, H) {
  const total = items.reduce((s, i) => s + (i.value || 0), 0);
  if (!total || !items.length) return [];
  const scaled = items.map(it => ({ ...it, _area: (it.value / total) * W * H }));
  const out = [];
  let rem = scaled, cx = 0, cy = 0, cw = W, ch = H;

  // Worst aspect ratio for a candidate row given current short side.
  const worstAspect = (row, shortSide) => {
    const sum = row.reduce((s, it) => s + it._area, 0);
    if (!sum || !shortSide) return Infinity;
    const rowDepth = sum / shortSide;
    let worst = 1;
    for (const it of row) {
      const itLen = (it._area / sum) * shortSide;
      if (itLen <= 0 || rowDepth <= 0) continue;
      const r = Math.max(rowDepth / itLen, itLen / rowDepth);
      if (r > worst) worst = r;
    }
    return worst;
  };

  while (rem.length) {
    const shortSide = Math.min(cw, ch);
    // Greedy row-building: add items while aspect ratio doesn't get worse.
    let row = [rem[0]];
    let i = 1;
    while (i < rem.length) {
      const tryRow = row.concat(rem[i]);
      if (worstAspect(tryRow, shortSide) <= worstAspect(row, shortSide)) {
        row = tryRow; i++;
      } else break;
    }
    const sum = row.reduce((s, it) => s + it._area, 0);
    const rowDepth = sum / shortSide;

    if (cw >= ch) {
      // Rect is wider than tall → row sits on the LEFT, items stack TOP to BOTTOM.
      // Row uses rowDepth × ch slice; remaining rect shrinks on the long (x) side.
      let pos = cy;
      for (const it of row) {
        const itLen = (it._area / sum) * shortSide; // = ch slice for this item
        out.push({ x: cx, y: pos, w: rowDepth, h: itLen, item: it });
        pos += itLen;
      }
      cx += rowDepth; cw -= rowDepth;
    } else {
      // Rect is taller than wide → row sits at the TOP, items go LEFT to RIGHT.
      let pos = cx;
      for (const it of row) {
        const itLen = (it._area / sum) * shortSide; // = cw slice for this item
        out.push({ x: pos, y: cy, w: itLen, h: rowDepth, item: it });
        pos += itLen;
      }
      cy += rowDepth; ch -= rowDepth;
    }
    rem = rem.slice(row.length);
  }
  return out;
}

// Auto-assigned palette for categories/sources that don't have an explicit colour.
const _AUTO_PALETTE = [
  "oklch(72% 0.13 30)",   // warm orange
  "oklch(70% 0.12 150)",  // green
  "oklch(70% 0.12 240)",  // blue
  "oklch(72% 0.13 320)",  // pink
  "oklch(74% 0.12 80)",   // amber
  "oklch(70% 0.10 200)",  // teal
  "oklch(68% 0.14 0)",    // red
  "oklch(72% 0.11 270)",  // violet
  "oklch(74% 0.10 110)",  // lime
  "oklch(70% 0.11 350)",  // magenta
  "oklch(72% 0.09 60)",   // sand
  "oklch(70% 0.10 180)",  // cyan
];
function autoColor(id, idx) {
  if (CAT_BY[id] && CAT_BY[id].color) return CAT_BY[id].color;
  // Stable per-id hash so the same category always gets the same colour across renders.
  let h = 0;
  const key = String(id);
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return _AUTO_PALETTE[Math.abs(h) % _AUTO_PALETTE.length];
}

/* Pick readable text colour (dark vs light) for a coloured tile background.
   Handles oklch(...), #hex and rgb(...) — the only forms our category/auto palette emits.
   Falls back to dark text for anything unparseable (safe on light surfaces). */
function tileTextColor(bg) {
  if (!bg) return "rgba(0,0,0,0.82)";
  const s = String(bg).trim();
  let lum = 1; // 0 = black, 1 = white-ish; >0.55 → use dark text
  let m;
  if ((m = s.match(/oklch\(\s*([\d.]+)%/i))) {
    lum = parseFloat(m[1]) / 100;                 // oklch L is already perceptual lightness
  } else if ((m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const r = parseInt(hex.slice(0,2),16)/255, g = parseInt(hex.slice(2,4),16)/255, b = parseInt(hex.slice(4,6),16)/255;
    lum = 0.2126*r + 0.7152*g + 0.0722*b;         // relative luminance
  } else if ((m = s.match(/rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/i))) {
    lum = (0.2126*+m[1] + 0.7152*+m[2] + 0.0722*+m[3]) / 255;
  }
  return lum > 0.55 ? "rgba(0,0,0,0.82)" : "rgba(255,255,255,0.96)";
}

function renderHomeAll() {
  // Per-renderer isolation: one card crashing must not blank the rest of the
  // dashboard (a missing #dateline once took out the entire page this way).
  const run = (typeof safeRun === "function")
    ? safeRun
    : (name, fn) => { try { fn(); } catch (e) { console.error("home." + name + " failed:", e); } };
  run("greeting",   renderGreeting);
  run("homeHeader", renderHomeHeader);
  run("summary",    renderHomeSummary);
  run("attention",  renderHomeNeedsAttention);
  run("nwProj",     renderHomeNWProjection);
  run("cashflow",   renderHomeCashFlow);
  run("calendar",   renderHomeCalendar);
  run("accounts",   renderHomeAccountsDonut);
  run("upcoming",   renderHomeUpcoming);
  run("thisMonth",  renderHomeThisMonth);
  run("insKpis",    renderInsKpis);
  run("repTrends",  renderRepTrends);
  run("repInsights", renderRepInsights);
  run("spend",      renderHomeSpend);
  run("topSpend",   renderHomeTopSpend);
  run("recent",     renderHomeRecent);
  run("budget",     renderHomeBudget);
}

// Stroke-only SVG glyphs for the redesigned dashboard (no emoji — SVG only).
const _HI = {
  income:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>`,
  spent:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 7L7 17"/><path d="M7 8v9h9"/></svg>`,
  pct:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></svg>`,
  trend:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 16 9 10 13 14 21 6"/><polyline points="15 6 21 6 21 12"/></svg>`,
  bill:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/></svg>`,
  gauge:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 18a8 8 0 1 1 14 0"/><line x1="12" y1="14" x2="15.5" y2="9.5"/></svg>`,
  bank:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10h16"/><path d="M5 10v8M19 10v8M9 10v8M15 10v8"/><path d="M3 20h18"/><path d="M12 3l8 5H4z"/></svg>`,
  info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>`,
};

// Dashboard period state (drives KPI deltas + Cash flow). Reuses the global
// _viewMonth so it stays in sync with the Insights month picker.
function renderHomeHeader() {
  const el = document.getElementById("home-period-label");
  if (el) el.textContent = monthLabel(_viewMonth.y, _viewMonth.m);
}

// Trailing n-month series ending at _viewMonth (oldest → newest) for sparklines.
function _homeMonthSeries(txns, n = 6) {
  const out = { income: [], spent: [], net: [] };
  for (let k = n - 1; k >= 0; k--) {
    let y = _viewMonth.y, m = _viewMonth.m - k;
    while (m < 0) { m += 12; y--; }
    const s = mStat(txns, y, m);
    out.income.push(s.income);
    out.spent.push(s.spent);
    out.net.push(s.income - s.spent);
  }
  return out;
}

// ── Dashboard row 2: forward-looking summaries ──────────────────────────────

// Top goals by progress — reuses goals.js getGoalCurrent().
function renderHomeGoals() {
  const el = document.getElementById("home-goals-list"); if (!el) return;
  const goals = getGoals();
  if (!goals.length) {
    el.innerHTML = cardEmpty(`No goals — <a onclick="switchPage('goals')">add one</a>`);
    return;
  }
  const rows = goals.map(g => {
    const cur = typeof getGoalCurrent === "function" ? getGoalCurrent(g) : (g.currentValue || 0);
    const pct = g.target > 0 ? Math.min(100, (cur / g.target) * 100) : 0;
    return { g, cur, pct };
  }).sort((a,b) => b.pct - a.pct).slice(0, 5);
  el.innerHTML = rows.map(({ g, cur, pct }) => {
    const done = pct >= 100;
    const fill = done ? "var(--pos)" : (g.color || "var(--accent)");
    return `<div class="catbar">
      <div class="top">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.name}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--ink-4)">${pct.toFixed(0)}%</span>
          <span class="v blur">${fmtGBP(cur,{dp:0})}<small style="color:var(--ink-4)"> / ${fmtGBP(g.target||0,{dp:0})}</small></span>
        </div>
      </div>
      <div class="bar"><i class="bar-fill" style="display:block;width:${pct.toFixed(0)}%;background:${fill}"></i></div>
    </div>`;
  }).join("");
}

// Next recurring payments this month not yet posted, soonest first.
function renderHomeUpcoming() {
  const el = document.getElementById("home-upcoming-list"); if (!el) return;
  const totalEl = document.getElementById("home-upcoming-total");
  const setTotal = (html) => { if (totalEl) totalEl.innerHTML = html; };
  const recs = getRecurring().filter(r => (r.period || "monthly") === "monthly");
  if (!recs.length) {
    el.innerHTML = cardEmpty(`No recurring items — <a onclick="switchPage('scheduled')">add some</a>`);
    setTotal("");
    return;
  }
  const txns = getTxns();
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const posted = (typeof recIsPosted === "function") ? recIsPosted : () => false;
  const all = recs.map(r => {
    const day = Math.min(r.day || 1, dim);
    return { r, day, due: posted(r, txns, y, m) ? null : day };
  }).filter(x => x.due !== null && x.day >= today.getDate())
    .sort((a,b) => a.day - b.day);
  if (!all.length) {
    el.innerHTML = cardEmpty(`All recurring items posted this month`);
    setTotal("");
    return;
  }
  const upcoming = all.slice(0, 6);
  const totOut = all.filter(x => x.r.type !== "in").reduce((s, x) => s + (x.r.amount || 0), 0);
  setTotal(`<span>Total due (${all.length})</span><span class="num blur">−${fmtGBP(totOut,{dp:0})}</span>`);
  el.innerHTML = upcoming.map(({ r, day }) => {
    const isIn = r.type === "in";
    const inDays = day - today.getDate();
    const when = inDays === 0 ? "today" : `in ${inDays}d`;
    return `<div class="tx-line">
      <span class="tx-desc">${r.description || "—"}</span>
      <span class="tx-meta">${day}${ordinal(day)} · ${when}</span>
      <span class="tx-amt ${isIn ? "pos" : "neg"} blur">${isIn ? "+" : "−"}${fmtGBP(r.amount,{dp:0})}</span>
    </div>`;
  }).join("");
}

// "This month" summary rail: total bills, paid progress, next payday, est. after bills.
function renderHomeThisMonth() {
  const el = document.getElementById("home-thismonth"); if (!el) return;
  const recs = getRecurring().filter(r => (r.period || "monthly") === "monthly");
  const txns = getTxns();
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const posted = (typeof recIsPosted === "function") ? recIsPosted : () => false;
  const outRecs = recs.filter(r => r.type !== "in");
  const inRecs  = recs.filter(r => r.type === "in");
  const totalBills = outRecs.reduce((s, r) => s + (r.amount || 0), 0);
  const paidCount  = outRecs.filter(r => posted(r, txns, y, m)).length;
  const totalCount = outRecs.length;
  const pct = totalCount ? Math.round(paidCount / totalCount * 100) : 0;
  let nextPay = null;
  inRecs.forEach(r => {
    const day = Math.min(r.day || 1, dim);
    if (posted(r, txns, y, m) || day < today.getDate()) return;
    if (!nextPay || day < nextPay.day) nextPay = { r, day };
  });
  let payMain = "—", paySub = "";
  if (nextPay) {
    const d = new Date(y, m, nextPay.day);
    payMain = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const inD = nextPay.day - today.getDate();
    paySub = inD === 0 ? "today" : `In ${inD} day${inD === 1 ? "" : "s"}`;
  }
  const totalIncome = inRecs.reduce((s, r) => s + (r.amount || 0), 0);
  const estAfter = totalIncome > 0 ? totalIncome - totalBills : null;

  const chev = `<svg class="tm-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>`;
  const calIc = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
  const checkIc = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>`;

  el.innerHTML = `
    <button class="home-tm-row" onclick="switchPage('scheduled')">
      <span class="tm-ic">${_HI.bill}</span>
      <span class="tm-body"><span class="tm-lab">Total bills due</span></span>
      <span class="tm-val"><b class="num blur">${fmtGBP(totalBills,{dp:2})}</b></span>${chev}
    </button>
    <button class="home-tm-row" onclick="switchPage('scheduled')">
      <span class="tm-ic">${checkIc}</span>
      <span class="tm-body"><span class="tm-lab">${paidCount} of ${totalCount} paid</span><span class="tm-bar"><span style="width:${pct}%"></span></span></span>
      <span class="tm-val"><b>${pct}%</b></span>${chev}
    </button>
    <button class="home-tm-row" onclick="switchPage('scheduled')">
      <span class="tm-ic">${calIc}</span>
      <span class="tm-body"><span class="tm-lab">Next payday</span></span>
      <span class="tm-val"><b>${payMain}</b>${paySub ? `<span class="tm-sub">${paySub}</span>` : ""}</span>${chev}
    </button>
    ${estAfter != null ? `<button class="home-tm-row tm-hilite" onclick="switchPage('forecast')">
      <span class="tm-ic">${_HI.bank}</span>
      <span class="tm-body"><span class="tm-lab">Estimated after bills</span></span>
      <span class="tm-val"><b class="num blur pos">${fmtGBP(estAfter,{dp:2})}</b></span>${chev}
    </button>` : ""}`;
}

// Current net-worth snapshot split by bucket — complements the NW trend chart.
function renderHomeNWBuckets() {
  const el = document.getElementById("home-nwbuckets-list"); if (!el) return;
  const subEl = document.getElementById("home-nwbuckets-sub");
  const entries = nwSnapshotsSorted();
  if (!entries.length) {
    if (subEl) subEl.textContent = "";
    el.innerHTML = cardEmpty(`No snapshots — <a onclick="switchPage('networth')">add one</a>`);
    return;
  }
  const last = entries[entries.length - 1];
  const allocs = (last.allocations || []).slice().sort((a,b) => (b.value||0) - (a.value||0));
  const total = allocs.reduce((s,a) => s + (a.value || 0), 0);
  if (subEl) subEl.textContent = total ? fmtGBP(total,{dp:0}) : "";
  if (!allocs.length || total <= 0) {
    el.innerHTML = cardEmpty(`Latest snapshot is empty`);
    return;
  }
  const max = allocs[0].value || 1;
  el.innerHTML = allocs.filter(a => (a.value||0) > 0).slice(0, 6).map((a, i) => {
    const color = autoColor(a.cat, i);
    const pct = (a.value / max * 100).toFixed(0);
    const pctOfTotal = (a.value / total * 100).toFixed(0);
    return `<div class="catbar">
      <div class="top">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.cat}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--ink-4)">${pctOfTotal}%</span>
          <span class="v blur">${fmtGBP(a.value,{dp:0})}</span>
        </div>
      </div>
      <div class="bar"><i class="bar-fill" style="display:block;width:${pct}%;background:${color}"></i></div>
    </div>`;
  }).join("");
}

// Financial alerts + a data-integrity row. Severity-ordered, capped.
function renderHomeNeedsAttention() {
  const el = document.getElementById("home-attention-list"); if (!el) return;
  const subEl = document.getElementById("home-attention-sub");
  const txns = getTxns();
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const td = today.getDate();
  const posted = (typeof recIsPosted === "function") ? recIsPosted : () => false;
  const rows = [];

  // 1. Recurring bills due within the next 7 days, not yet posted.
  getRecurring()
    .filter(r => (r.period || "monthly") === "monthly" && r.type !== "in")
    .forEach(r => {
      const day = Math.min(r.day || 1, dim);
      if (day < td || posted(r, txns, y, m)) return;
      const inDays = day - td;
      if (inDays > 7) return;
      rows.push({ sev: inDays <= 2 ? 3 : 2, ic: _HI.bill, c: "var(--warn)",
        title: r.description || "Recurring payment",
        meta: inDays === 0 ? "due today" : `due in ${inDays}d`,
        amt: `−${fmtGBP(r.amount || 0, { dp: 0 })}` });
    });

  // 2. Budgets at or over 80% of their limit this period.
  const cur = mStat(txns, _viewMonth.y, _viewMonth.m);
  const actuals = {};
  cur.txns.filter(t => normType(t) === "out").forEach(t => { actuals[t.category] = (actuals[t.category] || 0) + t.amount; });
  getBudgets().filter(b => b.type === "out" && b.amount > 0).forEach(b => {
    const c = b.id || b.category;
    const pct = (actuals[c] || 0) / b.amount;
    if (pct < 0.8) return;
    const over = pct >= 1;
    rows.push({ sev: over ? 3 : 2, ic: _HI.gauge, c: over ? "var(--neg)" : "var(--warn)",
      title: c, meta: over ? "over budget" : "near budget limit",
      amt: `${(pct * 100).toFixed(0)}%` });
  });

  // 3. Latest snapshot buckets with a low positive balance.
  const entries = nwSnapshotsSorted();
  if (entries.length) {
    const LOW = 100;
    (entries[entries.length - 1].allocations || []).forEach(a => {
      if ((a.value || 0) > 0 && a.value < LOW) {
        rows.push({ sev: 1, ic: _HI.bank, c: "var(--warn)",
          title: a.cat, meta: "low balance", amt: fmtGBP(a.value, { dp: 0 }) });
      }
    });
  }

  rows.sort((a, b) => b.sev - a.sev);

  // 4. One data-integrity row, linking to the Settings audit modal.
  let auditRow = "";
  try {
    const a = auditDataIntegrity();
    if (a && a.warningCount > 0) {
      auditRow = `<div class="attn-row" data-act="audit" onclick="openAuditModal()">
        <span class="ic" style="color:var(--ink-3)">${_HI.info}</span>
        <span class="attn-txt"><b>${a.warningCount} data warning${a.warningCount === 1 ? '' : 's'}</b><small>review in Settings</small></span>
        <span class="attn-amt">Review →</span></div>`;
    }
  } catch (e) { /* audit is best-effort */ }

  const count = rows.length + (auditRow ? 1 : 0);
  if (subEl) subEl.textContent = count ? String(count) : "";
  if (!count) { el.innerHTML = cardEmpty("All clear — nothing needs attention"); return; }

  const CAP = 6;
  const shown = rows.slice(0, CAP);
  const moreN = rows.length - shown.length;
  el.innerHTML = shown.map(r => `<div class="attn-row">
      <span class="ic" style="color:${r.c}">${r.ic}</span>
      <span class="attn-txt"><b>${r.title}</b><small>${r.meta}</small></span>
      <span class="attn-amt">${r.amt}</span>
    </div>`).join("")
    + (moreN > 0 ? `<div class="attn-more">+${moreN} more</div>` : "")
    + auditRow;
}

// Cash flow for the selected period + a 6-month balance projection.
function renderHomeCashFlow() {
  const el = document.getElementById("home-cashflow"); if (!el) return;
  const subEl = document.getElementById("home-cashflow-sub");
  const ms = mStat(getTxns(), _viewMonth.y, _viewMonth.m);
  const income = ms.income, expenses = ms.spent, net = income - expenses;
  if (subEl) subEl.textContent = monthLabel(_viewMonth.y, _viewMonth.m);

  const row = (lab, val, cls) => `<div class="cf-row"><span>${lab}</span><span class="v ${cls || ''}">${val}</span></div>`;
  let html =
    row("Income", `+${fmtGBP(income, { dp: 0 })}`, "pos") +
    row("Expenses", `−${fmtGBP(expenses, { dp: 0 })}`, "neg") +
    `<div class="cf-row cf-net"><span>Net cash flow</span><span class="v ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmtGBP(Math.abs(net), { dp: 0 })}</span></div>`;

  try {
    const entries = nwSnapshotsSorted();
    const start = entries.length ? nwTotalE(entries[entries.length - 1]) : 0;
    const fmonths = (typeof buildForecastMonths === "function") ? buildForecastMonths(new Date(), 6) : [];
    let running = start;
    const ser = [start];
    fmonths.forEach(mo => { running += (mo.income || 0) - (mo.expenses || 0); ser.push(running); });
    const endBal = running, d = endBal - start;
    if (fmonths.length) {
      html += `<div class="cf-forecast">
        <div class="cf-fc-head"><span>Forecast · ${fmonths.length} mo</span><span class="cf-fc-delta ${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : '−'}${fmtGBP(Math.abs(d), { dp: 0 })}</span></div>
        <div class="cf-fc-val num blur">${fmtGBP(endBal, { dp: 0 })}</div>
        <div class="cf-fc-spark">${sparkline(ser, { stroke: d >= 0 ? "var(--pos)" : "var(--neg)" }) || ''}</div>
      </div>`;
    } else {
      html += `<div class="cf-forecast"><div class="cf-fc-head"><span>Forecast</span></div><div class="empty-note" style="padding:10px 0">Add forecast or scheduled items to project ahead.</div></div>`;
    }
  } catch (e) { /* forecast optional */ }

  el.innerHTML = html;
}

// Accounts overview — donut + legend from the latest net-worth snapshot.
function renderHomeAccountsDonut() {
  const el = document.getElementById("home-accounts"); if (!el) return;
  const entries = nwSnapshotsSorted();
  if (!entries.length) {
    el.innerHTML = cardEmpty(`No snapshots — <a onclick="switchPage('networth')">add one</a>`);
    return;
  }
  const last = entries[entries.length - 1];
  const rows = (last.allocations || [])
    .filter(a => Math.abs(a.value || 0) > 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .map((a, i) => ({ label: a.cat, value: a.value || 0,
      color: (NW_CATS.find(c => c.id === a.cat) || {}).color || autoColor(a.cat, i) }));
  if (!rows.length) { el.innerHTML = cardEmpty("Latest snapshot is empty"); return; }
  el.innerHTML = rows.map(r => `
    <button class="home-acct-row" onclick="switchPage('accounts')" title="${r.label}">
      <span class="ha-ic" style="background:color-mix(in oklch,${r.color} 26%,var(--bg-sunk));color:${r.color}">${(r.label||'?').trim().charAt(0).toUpperCase()}</span>
      <span class="ha-name">${r.label}</span>
      <span class="ha-bal num blur ${r.value < 0 ? 'neg' : ''}">${fmtGBP(r.value,{dp:0})}</span>
      <svg class="ha-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
    </button>`).join("");
}

// Insights KPI strip — updates value/delta cells in place so the docked month-picker stays put.
// Reports KPI strip: Total spend (+sparkline) · Top riser · Largest category · Budget pace.
// All four tiles are scoped to the picker month (_viewMonth). Refund-netting is applied
// throughout so cancel-refund pairs don't inflate a category.
function renderInsKpis() {
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const txns = getTxns();
  const ms = mStat(txns, _viewMonth.y, _viewMonth.m);
  const prevD = new Date(_viewMonth.y, _viewMonth.m - 1, 1);
  const pms = mStat(txns, prevD.getFullYear(), prevD.getMonth());
  const prevLab = MONTHS[prevD.getMonth()].slice(0,3);

  // ── Tile 1: Total spend (net of refunds) + delta vs prev + 6-month sparkline ──
  const spentGross = ms.txns.filter(t => normType(t)==="out").reduce((s,t) => s+t.amount, 0);
  const spent  = ms.netSpent != null ? ms.netSpent : spentGross;
  const pSpent = pms.netSpent != null ? pms.netSpent : pms.txns.filter(t => normType(t)==="out").reduce((s,t) => s+t.amount, 0);
  set("ins-kpi-spend", spent > 0 ? `−${fmtGBP(spent,{dp:0})}` : "—");
  const dEl = document.getElementById("ins-kpi-spend-d");
  if (dEl) {
    const pct = pSpent > 0 ? ((spent - pSpent) / pSpent) * 100 : null;
    if (pct === null || !isFinite(pct)) { dEl.textContent = ""; dEl.className = "delta"; }
    else {
      const dir = pct === 0 ? "→" : (pct > 0 ? "↑" : "↓");   // lower spend is better → green when down
      dEl.textContent = `${dir} ${Math.abs(pct).toFixed(0)}% vs ${prevLab}`;
      dEl.className = `delta ${pct < 0 ? "pos" : (pct === 0 ? "" : "neg")}`;
    }
  }
  const series = _homeMonthSeries(txns, 6).spent;
  set("ins-kpi-spend-spark", sparkline(series, { w: 96, h: 30, stroke: "var(--neg)", strokeWidth: 1.8 }) || "");

  // ── Tiles 2 & 3: category movers — current vs previous month, refund-netted ──
  const cMap = netSpendByCategory(ms.txns);
  const pMap = netSpendByCategory(pms.txns);
  const totalSpend = Object.values(cMap).reduce((s,v) => s + Math.max(0, v), 0);

  // Top riser: biggest positive month-over-month increase.
  const risers = Object.keys({ ...cMap, ...pMap }).map(cat => {
    const c = cMap[cat] || 0, p = pMap[cat] || 0;
    return { cat, c, p, delta: c - p, pct: p > 0 ? ((c - p) / p) * 100 : (c > 0 ? 999 : 0) };
  }).filter(r => r.delta > 1).sort((a,b) => b.delta - a.delta);
  const top = risers[0];
  if (top) {
    const color = (CAT_BY[top.cat] && CAT_BY[top.cat].color) || "var(--accent)";
    set("ins-kpi-riser", `<span class="ik-name">${top.cat}</span>`);
    set("ins-kpi-riser-ic", _catBadge(top.cat, color));
    const pctStr = top.pct >= 999 ? "new" : `+${top.pct.toFixed(0)}%`;
    const rd = document.getElementById("ins-kpi-riser-d");
    if (rd) { rd.textContent = `+${fmtGBP(top.delta,{dp:0})} · ${pctStr}`; rd.className = "delta neg"; }
  } else {
    set("ins-kpi-riser", `<span class="ik-name muted">None</span>`);
    set("ins-kpi-riser-ic", "");
    const rd = document.getElementById("ins-kpi-riser-d"); if (rd) { rd.textContent = "No increase vs " + prevLab; rd.className = "delta"; }
  }

  // Largest category this month + single-arc ring showing its share of total spend.
  const largest = Object.entries(cMap).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1])[0];
  const ld = document.getElementById("ins-kpi-largest-d");
  if (largest) {
    const [cat, amt] = largest;
    const share = totalSpend > 0 ? amt / totalSpend : 0;
    const color = (CAT_BY[cat] && CAT_BY[cat].color) || "var(--accent)";
    set("ins-kpi-largest", `<span class="ik-name">${cat}</span>`);
    if (ld) { ld.textContent = `${(share*100).toFixed(0)}% · ${fmtGBP(amt,{dp:0})}`; ld.className = "delta"; }
    set("ins-kpi-largest-ring", _miniRing(share, color));
  } else {
    set("ins-kpi-largest", `<span class="ik-name muted">No spend</span>`);
    if (ld) { ld.textContent = ""; ld.className = "delta"; }
    set("ins-kpi-largest-ring", _miniRing(0, "var(--ink-4)"));
  }

  // ── Tile 4: Budget pace — total spent vs total budgeted (out) this month ──
  const buds = getBudgets().filter(b => b.type === "out");
  const limit = buds.reduce((s,b) => s + (b.amount || 0), 0);
  const budCats = new Set(buds.map(b => b.id || b.category));
  const usedAll = ms.txns.filter(t => normType(t)==="out").reduce((acc,t) => {
    if (budCats.has(t.category)) acc += t.amount; return acc;
  }, 0);
  const pace = limit > 0 ? usedAll / limit : null;
  const paceColor = pace == null ? "var(--ink-4)" : (pace > 1 ? "var(--neg)" : (pace > 0.8 ? "var(--warn)" : "var(--accent)"));
  const paceEl = document.getElementById("ins-kpi-pace");
  if (paceEl) {
    paceEl.classList.remove("pos","neg");
    if (pace == null) paceEl.textContent = "—";
    else {
      paceEl.textContent = `${(pace*100).toFixed(0)}%`;
      paceEl.classList.add(pace > 1 ? "neg" : "pos");
    }
  }
  const pd = document.getElementById("ins-kpi-pace-d");
  if (pd) {
    if (pace == null) { pd.textContent = "No budgets set"; pd.className = "delta"; }
    else { pd.textContent = `${fmtGBP(usedAll,{dp:0})} of ${fmtGBP(limit,{dp:0})}`; pd.className = `delta ${pace > 1 ? "neg" : (pace > 0.8 ? "warn" : "")}`; }
  }
  set("ins-kpi-pace-ring", _miniRing(pace == null ? 0 : pace, paceColor));
}

// Small tinted circular badge holding a category's emoji icon — the right-hand
// visual for KPI tiles that don't carry a ring/sparkline. Tint derives from the
// category colour so the badge reads as that category at a glance.
function _catBadge(cat, color) {
  return `<span class="ik-badge" style="background:color-mix(in srgb, ${color} 16%, transparent);">${iconFor(cat)}</span>`;
}

// Tiny single-arc progress ring (~36px) for a 0..1 fraction. Pure SVG, no listeners.
function _miniRing(frac, color) {
  const r = 14, c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, frac)) * c;
  return `<svg viewBox="0 0 36 36" width="40" height="40" aria-hidden="true">
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="var(--line-2)" stroke-width="4"/>
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 18 18)"/>
  </svg>`;
}

// Reports "Insights" panel — a few plain-English takeaways for the picker month.
function renderRepInsights() {
  const el = document.getElementById("rep-insights-list"); if (!el) return;
  const txns = getTxns();
  const ms = mStat(txns, _viewMonth.y, _viewMonth.m);
  const prevD = new Date(_viewMonth.y, _viewMonth.m - 1, 1);
  const pms = mStat(txns, prevD.getFullYear(), prevD.getMonth());
  const prevLab = MONTHS[prevD.getMonth()].slice(0,3);
  const ml = monthLabel(_viewMonth.y, _viewMonth.m);

  const spent  = ms.netSpent != null ? ms.netSpent : ms.txns.filter(t => normType(t)==="out").reduce((s,t)=>s+t.amount,0);
  const pSpent = pms.netSpent != null ? pms.netSpent : pms.txns.filter(t => normType(t)==="out").reduce((s,t)=>s+t.amount,0);
  const income = ms.txns.filter(t => normType(t)==="in").reduce((s,t)=>s+t.amount,0);
  const refunds = ms.refunds || 0;
  const net = (income - refunds) - spent;

  const out = [];
  const row = (glyph, html) => out.push(`<div class="rep-insight"><span class="ri-ic">${glyph}</span><span class="ri-txt">${html}</span></div>`);

  // 1. Spend vs last month
  if (pSpent > 0 && spent > 0) {
    const pct = ((spent - pSpent) / pSpent) * 100;
    const up = pct >= 0;
    row(_HI.trend, `Spending is <b class="${up?'neg':'pos'}">${up?'up':'down'} ${Math.abs(pct).toFixed(0)}%</b> vs ${prevLab} (<span class="blur">${fmtGBP(spent,{dp:0})}</span>).`);
  } else if (spent > 0) {
    row(_HI.spent, `You spent <b class="blur">${fmtGBP(spent,{dp:0})}</b> in ${ml}.`);
  }

  // 2. Top riser
  const cMap = netSpendByCategory(ms.txns), pMap = netSpendByCategory(pms.txns);
  const riser = Object.keys({ ...cMap, ...pMap }).map(cat => ({ cat, delta: (cMap[cat]||0) - (pMap[cat]||0) }))
    .filter(r => r.delta > 1).sort((a,b) => b.delta - a.delta)[0];
  if (riser) row(_HI.pct, `<b>${riser.cat}</b> rose the most — <span class="blur">+${fmtGBP(riser.delta,{dp:0})}</span> vs ${prevLab}.`);

  // 3. Biggest single expense
  const big = ms.txns.filter(t => normType(t)==="out").sort((a,b) => b.amount - a.amount)[0];
  if (big) row(_HI.bill, `Largest expense: <b>${big.description || big.category || '—'}</b> at <span class="blur">${fmtGBP(big.amount,{dp:0})}</span>.`);

  // 4. Net / savings this month
  if (income > 0) {
    const rate = Math.max(0, net / income) * 100;
    row(_HI.gauge, net >= 0
      ? `You saved <b class="pos blur">${fmtGBP(net,{dp:0})}</b> (${rate.toFixed(0)}% of income).`
      : `You overspent income by <b class="neg blur">${fmtGBP(Math.abs(net),{dp:0})}</b>.`);
  }

  // 5. Budgets over / near limit
  const buds = getBudgets().filter(b => b.type === "out");
  if (buds.length) {
    const actuals = {};
    ms.txns.filter(t => normType(t)==="out").forEach(t => { actuals[t.category] = (actuals[t.category]||0) + t.amount; });
    let over = 0, near = 0;
    buds.forEach(b => { const c = b.id || b.category; const p = b.amount ? (actuals[c]||0)/b.amount : 0; if (p > 1) over++; else if (p > 0.8) near++; });
    if (over) row(_HI.info, `<b class="neg">${over}</b> budget${over>1?'s are':' is'} over limit${near?`, ${near} near it`:''}.`);
    else if (near) row(_HI.info, `<b class="warn">${near}</b> budget${near>1?'s are':' is'} close to its limit.`);
    else row(_HI.info, `All budgets are on track this month.`);
  }

  el.innerHTML = out.length ? out.join("") : cardEmpty(`Not enough data for ${ml} yet.`);
}



/* ════════════════════════════════════════
   MINI CALENDAR (next to the NW chart)
   - Renders a month grid with transaction-day dots
   - Click a day → shows that day's transactions inline
   - Arrow controls navigate months
════════════════════════════════════════ */
const _homeCalState = {
  month: new Date().getMonth(),
  year: new Date().getFullYear(),
  selectedDate: null, // yyyy-mm-dd
};

// Net-worth chart view state: time range + asset/liability filter.
const _homeNW = { range: "1Y", filt: "all", series: "nw" };
const _NW_RANGE_PTS = { "1M": 2, "3M": 4, "6M": 7, "1Y": 13, "ALL": Infinity };
function _isLiabilityBucket(b, lastE) {
  const v = lastE ? (lastE.allocations.find(a => a.cat === b.id)?.value || 0) : 0;
  return v < 0 || /loan|debt|credit|mortgage|owed|liab/i.test(b.id);
}

function renderHomeCalendar() {
  const titleEl = document.getElementById("home-cal-title");
  const gridEl  = document.getElementById("home-cal-grid");
  const subEl   = document.getElementById("home-cal-sub");
  const detailEl = document.getElementById("home-cal-day-detail");
  if (!gridEl) return;

  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const { year, month } = _homeCalState;
  titleEl.textContent = `${months[month]} ${year}`;

  // Build counts of transactions per ISO date within this month
  const txns = getTxns();
  const dayCounts = {}; const daySum = {};
  txns.forEach(t => {
    if (!t.date) return;
    const d = new Date(t.date + "T00:00:00");
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const iso = t.date.slice(0,10);
    dayCounts[iso] = (dayCounts[iso] || 0) + 1;
    daySum[iso] = (daySum[iso] || 0) + ((t.type === "in" ? 1 : -1) * (t.amount || 0));
  });

  const totalTxns = Object.values(dayCounts).reduce((s,n) => s+n, 0);
  if (subEl) subEl.textContent = totalTxns ? `${totalTxns} txn${totalTxns===1?'':'s'} this month` : "No transactions";

  // First day of month + leading blanks, honouring the week-start setting.
  const ws = (typeof weekStartPref === "function") ? weekStartPref() : 1; // 1=Mon, 0=Sun
  const firstDow = (new Date(year, month, 1).getDay() - ws + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0,10);

  const dowLabels = ws === 0 ? ["S","M","T","W","T","F","S"] : ["M","T","W","T","F","S","S"];
  const headRow = dowLabels.map(d => `<div class="cal-head">${d}</div>`).join("");
  const blanks  = Array(firstDow).fill(`<div class="cal-cell empty"></div>`).join("");
  const cells   = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const count = dayCounts[iso] || 0;
    const isToday = iso === todayIso;
    const isSelected = iso === _homeCalState.selectedDate;
    const cls = ["cal-cell"];
    if (count) cls.push("has-tx");
    if (isToday) cls.push("today");
    if (isSelected) cls.push("selected");
    const dotColor = count
      ? ((daySum[iso] || 0) > 0 ? "var(--pos)" : "var(--neg)")
      : "transparent";
    cells.push(`<button class="${cls.join(' ')}" data-iso="${iso}" title="${count} txn${count===1?'':'s'}">
      <span class="day-num">${d}</span>
      <span class="day-dot" style="background:${dotColor}"></span>
    </button>`);
  }
  gridEl.innerHTML = `<div class="cal-grid">${headRow}${blanks}${cells.join("")}</div>`;
  gridEl.querySelectorAll(".cal-cell[data-iso]").forEach(btn => {
    btn.addEventListener("click", () => {
      const iso = btn.dataset.iso;
      _homeCalState.selectedDate = (_homeCalState.selectedDate === iso) ? null : iso;
      renderHomeCalendar();
    });
  });
  renderHomeCalDetail();
}

function renderHomeCalDetail() {
  const detailEl = document.getElementById("home-cal-day-detail");
  if (!detailEl) return;
  if (!_homeCalState.selectedDate) { detailEl.innerHTML = ""; return; }
  const iso = _homeCalState.selectedDate;
  const dayTxns = getTxns().filter(t => (t.date||"").slice(0,10) === iso);
  const dt = new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (!dayTxns.length) {
    detailEl.innerHTML = `<div class="cal-detail-empty">${dt} — no transactions</div>`;
    return;
  }
  // Just a summary: highest spend + total spend, highest income + total income, day count.
  const outs = dayTxns.filter(t => t.type === "out").sort((a,b) => b.amount - a.amount);
  const ins  = dayTxns.filter(t => t.type === "in").sort((a,b) => b.amount - a.amount);
  const totalOut = outs.reduce((s,t) => s + t.amount, 0);
  const totalIn  = ins.reduce((s,t)  => s + t.amount, 0);
  const topOut = outs[0];
  const topIn  = ins[0];
  const desc = (t) => (t.description || t.category || "—").replace(/</g,'&lt;');

  const sections = [];
  if (topOut) {
    sections.push(`<div class="cal-sum-row out">
      <div class="cal-sum-lab">Top spend</div>
      <div class="cal-sum-name" title="${desc(topOut)}">${desc(topOut)}</div>
      <div class="cal-sum-amt">−${fmtGBP(topOut.amount,{dp:0})}</div>
    </div>`);
    if (outs.length > 1) sections.push(`<div class="cal-sum-rest">+${outs.length-1} more · total −${fmtGBP(totalOut,{dp:0})}</div>`);
  }
  if (topIn) {
    sections.push(`<div class="cal-sum-row in">
      <div class="cal-sum-lab">Top income</div>
      <div class="cal-sum-name" title="${desc(topIn)}">${desc(topIn)}</div>
      <div class="cal-sum-amt">+${fmtGBP(topIn.amount,{dp:0})}</div>
    </div>`);
    if (ins.length > 1) sections.push(`<div class="cal-sum-rest">+${ins.length-1} more · total +${fmtGBP(totalIn,{dp:0})}</div>`);
  }
  detailEl.innerHTML = `<div class="cal-detail-head">
    <div class="cal-detail-date">${dt}</div>
    <div class="cal-detail-net">${dayTxns.length} txn${dayTxns.length===1?'':'s'}</div>
  </div>${sections.join("")}`;
}

// Reusable donut renderer for an [{label, value, color}] dataset.
// Returns an HTML string with SVG donut on the left and a colour-key list on the right.
function renderDonut(slices, opts = {}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return cardEmpty(opts.empty || "Nothing to show");
  const cx = 50, cy = 50, rOuter = 42, rInner = 26;
  const toXY = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  let acc = -Math.PI / 2;
  const paths = slices.map(s => {
    const sweep = (s.value / total) * Math.PI * 2;
    const start = acc, end = acc + sweep;
    acc = end;
    const large = (end - start) > Math.PI ? 1 : 0;
    const [x1, y1] = toXY(start, rOuter);
    const [x2, y2] = toXY(end,   rOuter);
    const [x3, y3] = toXY(end,   rInner);
    const [x4, y4] = toXY(start, rInner);
    const d = `M${x1.toFixed(2)},${y1.toFixed(2)} A${rOuter},${rOuter} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${rInner},${rInner} 0 ${large} 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z`;
    return `<path d="${d}" fill="${s.color}" stroke="var(--bg-elev)" stroke-width="0.6"/>`;
  }).join("");
  // Top 8 in legend, rest collapsed
  const TOP = 8;
  const top = slices.slice(0, TOP);
  const rest = slices.slice(TOP);
  const restTotal = rest.reduce((s, x) => s + x.value, 0);
  const legendRows = top.map(s => `
    <div class="donut-leg-row">
      <span class="donut-leg-label"><i style="background:${s.color}"></i>${s.icon ? s.icon + " " : ""}${s.label}</span>
      <span class="donut-leg-vals"><span class="num blur">${fmtGBP(s.value,{dp:0})}</span><small>${(s.value/total*100).toFixed(0)}%</small></span>
    </div>`).join("") + (rest.length ? `
    <div class="donut-leg-row" style="opacity:0.7">
      <span class="donut-leg-label"><i style="background:var(--ink-4)"></i>+${rest.length} more</span>
      <span class="donut-leg-vals"><span class="num blur">${fmtGBP(restTotal,{dp:0})}</span><small>${(restTotal/total*100).toFixed(0)}%</small></span>
    </div>` : "");
  const centreLabel = opts.centreLabel || "total";
  return `
    <div class="donut-layout">
      <div class="donut-svg-wrap">
        <svg viewBox="0 0 100 100" width="100%" height="auto" style="display:block">
          ${paths}
          <text x="50" y="46" text-anchor="middle" style="font-family:Inter;font-size:5px;fill:var(--ink-3);text-transform:uppercase;letter-spacing:0.06em">${centreLabel}</text>
          <text x="50" y="56" text-anchor="middle" style="font-family:'Fraunces',serif;font-size:10px;fill:var(--ink);font-weight:500" class="blur">${fmtGBP(total,{dp:0,compact:true})}</text>
        </svg>
      </div>
      <div class="donut-legend">${legendRows}</div>
    </div>`;
}

function renderHomeSummary() {
  const el = document.getElementById("home-summary"); if (!el) return;
  // KPI cards now use a CONFIGURABLE DATE RANGE (Settings → Appearance → "Stats start").
  // The range is from settings.statsStart → current month inclusive — independent of the
  // month picker below the chart, which only affects the cards in the masonry section.
  const txns = getTxns();
  const startYM = getStatsStart();
  const r = rangeStat(txns, startYM);

  const entries = nwSnapshotsSorted();
  const nwCur  = entries.length ? nwTotalE(entries[entries.length-1]) : null;
  const nwPrev = entries.length >= 2 ? nwTotalE(entries[entries.length-2]) : null;
  const nwDelta = (nwCur != null && nwPrev != null) ? nwCur - nwPrev : null;

  const inc = r.income, spt = r.spent;
  const saved = inc - spt;
  const rate  = inc > 0 ? saved / inc : null;
  const sinceLab = `since ${ymLabel(r.startYM)}`;

  // Month-over-month momentum (selected period vs the month before it).
  const cur  = mStat(txns, _viewMonth.y, _viewMonth.m);
  const [py, pm] = prevMonth(_viewMonth.y, _viewMonth.m);
  const prev = mStat(txns, py, pm);
  const prevLab = MONTHS[pm];
  const cRate = cur.income  > 0 ? Math.max(0, (cur.income  - cur.spent)  / cur.income)  : null;
  const pRate = prev.income > 0 ? Math.max(0, (prev.income - prev.spent) / prev.income) : null;

  // Pct-change delta span. goodIsDown=true → a decrease is the good (green) direction.
  const delta = (curV, prevV, goodIsDown) => {
    if (!(Math.abs(prevV) > 0)) return `<span class="kpi-delta"></span>`;
    const pct = ((curV - prevV) / Math.abs(prevV)) * 100;
    if (!isFinite(pct)) return `<span class="kpi-delta"></span>`;
    const dir = pct === 0 ? "→" : (pct > 0 ? "↑" : "↓");
    const good = pct === 0 ? null : (goodIsDown ? pct < 0 : pct > 0);
    const cls = good === null ? "" : (good ? "pos" : "neg");
    return `<span class="kpi-delta ${cls}">${dir} ${Math.abs(pct).toFixed(1)}% vs last month</span>`;
  };
  // Savings rate compares in percentage-points, not relative %.
  const rateDelta = () => {
    if (cRate == null || pRate == null) return `<span class="kpi-delta"></span>`;
    const pp = (cRate - pRate) * 100;
    const dir = pp === 0 ? "→" : (pp > 0 ? "↑" : "↓");
    const cls = pp === 0 ? "" : (pp > 0 ? "pos" : "neg");
    return `<span class="kpi-delta ${cls}">${dir} ${Math.abs(pp).toFixed(0)}pp vs last month</span>`;
  };
  const nwDeltaSpan = () => {
    if (nwDelta == null) return `<span class="kpi-delta"></span>`;
    const dir = nwDelta === 0 ? "→" : (nwDelta > 0 ? "↑" : "↓");
    const cls = nwDelta === 0 ? "" : (nwDelta > 0 ? "pos" : "neg");
    return `<span class="kpi-delta ${cls}">${dir} ${fmtGBP(Math.abs(nwDelta),{dp:0,compact:true})} vs last</span>`;
  };

  // KPI values reflect the selected month (matches the "vs last month" delta);
  const mInc = cur.income, mSpt = cur.spent, mNet = mInc - mSpt;
  const netIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h7l2-5 2 10 2-5h5"/></svg>`;

  el.innerHTML = `
    <div class="kpi in">
      <div class="kpi-badge">${_HI.income}</div>
      <div class="kpi-lab">Income</div>
      <div class="kpi-val num blur">${mInc > 0 ? fmtGBP(mInc,{dp:2}) : "—"}</div>
      ${delta(cur.income, prev.income, false)}
    </div>
    <div class="kpi out">
      <div class="kpi-badge">${_HI.spent}</div>
      <div class="kpi-lab">Spending</div>
      <div class="kpi-val num blur">${mSpt > 0 ? fmtGBP(mSpt,{dp:2}) : "—"}</div>
      ${delta(cur.spent, prev.spent, true)}
    </div>
    <div class="kpi net">
      <div class="kpi-badge">${netIcon}</div>
      <div class="kpi-lab">Net</div>
      <div class="kpi-val num blur ${mNet < 0 ? 'neg' : ''}">${(mNet >= 0 ? '' : '−') + fmtGBP(Math.abs(mNet),{dp:2})}</div>
      ${delta(cur.income - cur.spent, prev.income - prev.spent, false)}
    </div>
    <div class="kpi pct">
      <div class="kpi-badge">${_HI.pct}</div>
      <div class="kpi-lab">Savings rate</div>
      <div class="kpi-val num">${cRate !== null ? (cRate*100).toFixed(0)+'%' : "—"}</div>
      ${rateDelta()}
    </div>`;
}

// Monthly income/expense totals across all transactions — for the dashboard graph's
// Income / Spending series. Returns [{ym, income, expenses}] sorted ascending.
function monthlyTxnSeries() {
  const by = {};
  getTxns().forEach(t => {
    if (typeof isRefundLeg === "function" && isRefundLeg(t)) return; // paired refunds net to zero
    const ym = (t.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    if (!by[ym]) by[ym] = { ym, income: 0, expenses: 0 };
    if (normType(t) === "in") by[ym].income += t.amount;
    else if (normType(t) === "out") by[ym].expenses += t.amount;
  });
  return Object.values(by).sort((a, b) => a.ym.localeCompare(b.ym));
}

function renderHomeNWProjection() {
  const el = document.getElementById("home-nw-proj"); if (!el) return;
  const titleEl = document.getElementById("home-nw-proj-title");
  const subEl = document.getElementById("home-nw-proj-sub");
  const pts = _NW_RANGE_PTS[_homeNW.range] ?? 13;
  const mode = _homeNW.series || "nw";

  // Generic series: entries = [{label, value}]. Net worth uses snapshots; income/spending use monthly txn totals.
  let entries = [];
  let cfgColor = "var(--accent)", cfgTitle = "Net worth", cfgSub = "Over time",
      cfgDeltaSuffix = "vs last snapshot",
      cfgEmpty = "Add a net worth snapshot in Net Worth → Snapshots to see your history";
  if (mode === "income" || mode === "spending") {
    let rows = monthlyTxnSeries();
    if (pts !== Infinity && rows.length > pts) rows = rows.slice(-pts);
    entries = rows.map(r => ({ label: r.ym, value: mode === "income" ? r.income : r.expenses }));
    if (mode === "income") { cfgColor = "var(--pos)"; cfgTitle = "Income"; cfgSub = "Monthly history"; cfgDeltaSuffix = "vs last month"; cfgEmpty = "No income recorded yet"; }
    else { cfgColor = "var(--neg)"; cfgTitle = "Spending"; cfgSub = "Monthly history"; cfgDeltaSuffix = "vs last month"; cfgEmpty = "No spending recorded yet"; }
  } else {
    let snaps = nwSnapshotsSorted();
    if (pts !== Infinity && snaps.length > pts) { const s = snaps.slice(-pts); if (s.length >= 2) snaps = s; }
    entries = snaps.map(e => ({ label: e.month, value: nwTotalE(e) }));
  }

  if (titleEl) titleEl.textContent = cfgTitle;
  if (subEl) subEl.textContent = cfgSub;
  if (!entries.length) { el.innerHTML = cardEmpty(cfgEmpty); return; }

  const totals = entries.map(e => e.value);
  const nwCur = totals[totals.length - 1];
  const nwPrev = totals.length >= 2 ? totals[totals.length - 2] : null;
  const nwDelta = nwPrev != null ? nwCur - nwPrev : null;
  const nwPct = (nwDelta != null && nwPrev) ? (nwDelta / Math.abs(nwPrev)) * 100 : null;

  // Match the viewBox to the chart area's real aspect ratio so it fills the whole box
  // (meet then scales with no letterbox/stretch). The hero value sits above the chart,
  // so subtract its height from the container to size the plot area accurately.
  const W = 1200;
  const heroH = el.querySelector(".nw-hero")?.offsetHeight || 34;
  const cw = el.clientWidth || 1200;
  const ch = Math.max((el.clientHeight || 240) - heroH, 120);
  const H = Math.round(W * (ch / Math.max(cw, 1))) || 240;
  const pad = { l: 60, r: 16, t: 16, b: 32 };
  const rawMin = Math.min(0, ...totals);
  const rawMax = Math.max(...totals, 1);
  // niceScale: pick a round step (1, 2, 2.5, 5 × 10^k) so axis labels land on
  // £0 / £2k / £4k instead of £3.18k. Returns the rounded bounds + tick array.
  const { yLo: ymin, yHi: ymax, ticks: yTicks } = _niceScale(rawMin, rawMax, 6);
  const xi = i => pad.l + (i / Math.max(entries.length - 1, 1)) * (W - pad.l - pad.r);
  const yi = v => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);

  // Smooth path through points using monotone-ish cubic-bezier — gives a soft curve
  function smoothPath(pts) {
    if (pts.length < 2) return "";
    if (pts.length === 2) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`;
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
      const t = 0.18; // tension — lower = smoother but flatter
      const c1x = p1[0] + (p2[0] - p0[0]) * t;
      const c1y = p1[1] + (p2[1] - p0[1]) * t;
      const c2x = p2[0] - (p3[0] - p1[0]) * t;
      const c2y = p2[1] - (p3[1] - p1[1]) * t;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  // Y grid + ticks — values come from niceScale so they land on round numbers
  // (£0, £2k, £4k…) instead of the raw min..max range.
  const gridLines = yTicks.map(v => {
    const y = yi(v).toFixed(1);
    const isZero = Math.abs(v) < 1e-6;
    return `<line x1="${pad.l}" x2="${W-pad.r}" y1="${y}" y2="${y}" stroke="${isZero ? 'var(--line)' : 'var(--line-2)'}" stroke-dasharray="${isZero ? '0' : '2 4'}" stroke-width="1" vector-effect="non-scaling-stroke"/>
            <text x="${pad.l-10}" y="${(+y+3.5).toFixed(1)}" text-anchor="end" style="font-family:Inter,sans-serif;font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;fill:var(--ink-4)">${_fmtAxisGBP(v)}</text>`;
  }).join("");

  // Label formatter: "2026-05" → "May", "May 2026" → "May"; long form adds the year.
  const fmtNWLabel = (raw, long) => {
    const m = (raw || "").match(/^(\d{4})-(\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2]-1, 1).toLocaleDateString("en-GB", long ? { month:"long", year:"numeric" } : { month:"short" });
    return long ? raw : (raw || "").split(" ")[0];
  };
  // X labels — thin out if many points; first/last anchored to the side so they don't clip
  const step = entries.length <= 8 ? 1 : entries.length <= 16 ? 2 : Math.ceil(entries.length / 8);
  const xLabels = entries.map((e,i) => {
    if (!(i === 0 || i === entries.length-1 || i % step === 0)) return "";
    const anchor = i === 0 ? "start" : i === entries.length-1 ? "end" : "middle";
    return `<text x="${xi(i).toFixed(1)}" y="${H-10}" text-anchor="${anchor}" style="font-family:Inter,sans-serif;font-size:11px;font-weight:500;fill:var(--ink-4)">${fmtNWLabel(e.label)}</text>`;
  }).join("");

  // Single smooth area + line for the aggregate net-worth series.
  const linePts = totals.map((v,i) => [xi(i), yi(v)]);
  const linePath = smoothPath(linePts);
  const areaPath = `${linePath} L${xi(entries.length-1).toFixed(1)},${yi(ymin).toFixed(1)} L${xi(0).toFixed(1)},${yi(ymin).toFixed(1)} Z`;
  const bands = `<defs><linearGradient id="nw-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${cfgColor}" stop-opacity="0.30"/><stop offset="100%" stop-color="${cfgColor}" stop-opacity="0"/></linearGradient></defs><path class="nw-band" d="${areaPath}" fill="url(#nw-grad)" stroke="none"/>`;
  const lines = `<path d="${linePath}" fill="none" stroke="${cfgColor}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  const allDots = totals.map((v, i) => `<circle data-i="${i}" cx="${xi(i).toFixed(1)}" cy="${yi(v).toFixed(1)}" r="${i === entries.length-1 ? 3.6 : 0}" fill="${cfgColor}" stroke="var(--bg-elev)" stroke-width="1.6"/>`).join("");

  const heroDelta = nwDelta != null
    ? `<span class="nw-hero-delta ${nwDelta>=0?'pos':'neg'}">${nwDelta>=0?'▲':'▼'} ${fmtGBP(Math.abs(nwDelta),{dp:2})}${nwPct!=null?` (${Math.abs(nwPct).toFixed(2)}%)`:''} ${cfgDeltaSuffix}</span>`
    : "";
  el.innerHTML = `
    <div class="nw-hero"><span class="nw-hero-val num blur">${fmtGBP(nwCur,{dp:2})}</span>${heroDelta}</div>
    <div style="position:relative">
      <svg id="home-nw-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" width="100%" style="display:block">
        ${gridLines}${xLabels}${bands}${lines}
        <line id="home-nw-cross" x1="0" x2="0" y1="${pad.t}" y2="${H-pad.b}" stroke="var(--ink-3)" stroke-dasharray="3 3" stroke-width="1" opacity="0" vector-effect="non-scaling-stroke"/>
        ${allDots}
      </svg>
      <div id="home-nw-tip" style="position:absolute;display:none;background:var(--bg-elev);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,0.10);pointer-events:none;z-index:5;min-width:170px"></div>
    </div>`;

  // Hover: show vertical crosshair + tooltip with per-bucket breakdown for that snapshot
  const svg = document.getElementById("home-nw-svg");
  const tip = document.getElementById("home-nw-tip");
  const cross = document.getElementById("home-nw-cross");
  if (svg && tip && cross) {
    svg.addEventListener("mousemove", e => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const idx = Math.max(0, Math.min(entries.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (entries.length - 1))));
      const lx = xi(idx);
      cross.setAttribute("x1", lx);
      cross.setAttribute("x2", lx);
      cross.setAttribute("opacity", "1");
      // dim non-hovered dots; emphasise the column being hovered
      svg.querySelectorAll("circle[data-i]").forEach(c => {
        const ci = +c.getAttribute("data-i");
        c.setAttribute("opacity", ci === idx ? 1 : 0.18);
        c.setAttribute("r", ci === idx ? 4 : 2.2);
      });
      const e0 = entries[idx];
      const ePrev = idx > 0 ? entries[idx - 1] : null;
      const total = totals[idx];
      const totalPrev = ePrev ? totals[idx - 1] : null;
      const fmtDelta = (delta) => {
        if (delta === null || delta === undefined) return "";
        if (Math.abs(delta) < 0.5) return `<small style="margin-left:8px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink-4)">±0</small>`;
        const cls = delta >= 0 ? 'var(--pos)' : 'var(--neg)';
        const sign = delta >= 0 ? '+' : '−';
        return `<small style="margin-left:8px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:${cls};font-weight:500">${sign}${fmtGBP(Math.abs(delta),{dp:0,compact:true}).replace('£','£')}</small>`;
      };
      const totalDelta = totalPrev !== null ? total - totalPrev : null;
      const headerDate = fmtNWLabel(e0.label, true);
      tip.innerHTML = `<div style="display:flex;justify-content:space-between;gap:14px;align-items:center">
        <span style="font-weight:600;color:var(--ink-2)">${headerDate}</span><span style="font-family:'IBM Plex Mono',monospace;white-space:nowrap">${fmtGBP(total,{dp:0})}${fmtDelta(totalDelta)}</span>
      </div>`;
      tip.style.display = "block";
      // Position tooltip; flip to left side if it would overflow the right
      const tipW = tip.offsetWidth || 200;
      const xPx = (lx / W) * rect.width;
      const left = xPx + 12 + tipW > rect.width ? xPx - tipW - 12 : xPx + 12;
      tip.style.left = Math.max(0, left) + "px";
      tip.style.top  = "8px";
    });
    svg.addEventListener("mouseleave", () => {
      cross.setAttribute("opacity", "0");
      tip.style.display = "none";
      svg.querySelectorAll("circle[data-i]").forEach(c => {
        const ci = +c.getAttribute("data-i");
        c.setAttribute("opacity", ci === entries.length - 1 ? 1 : 0.55);
        c.setAttribute("r", ci === entries.length - 1 ? 3.4 : 2.4);
      });
    });
  }
}

/* Reports page · "Category trends" multi-line chart.
   X = last 6 months ending on the currently-viewed month.
   Y = total spend per category that month (refund-netted).
   Each top category gets its own smooth line + final-point dot + colour-keyed
   inline label. Hover shows a per-category breakdown for that month. */
function renderRepTrends() {
  const el = document.getElementById("rep-trends"); if (!el) return;
  const txns = getTxns();
  const expCatSet = new Set(getAllCats("exp").map(c => c.id));
  // Build months: last 6 ending with current viewMonth.
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(_viewMonth.y, _viewMonth.m - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), ym: monthKey(d.getFullYear(), d.getMonth()), label: MONTHS[d.getMonth()] + " " + d.getFullYear() });
  }
  // Per-month, per-category totals (refund netting: income tagged with an expense
  // cat subtracts from that bucket — same rule the treemap uses).
  const catTotals = {}; // overall total per cat across the window — for ranking
  const monthCat  = months.map(() => ({})); // per-month dict
  months.forEach((mo, mi) => {
    txns.filter(t => monthKeyStr(t.date) === mo.ym).forEach(t => {
      const cat = t.category || "Uncategorised";
      const ty = normType(t);
      let delta = 0;
      if (ty === "out") delta = t.amount;
      else if (ty === "in" && expCatSet.has(cat)) delta = -t.amount;
      else return;
      monthCat[mi][cat] = (monthCat[mi][cat] || 0) + delta;
      catTotals[cat]    = (catTotals[cat]    || 0) + delta;
    });
  });
  const topCats = Object.entries(catTotals).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).slice(0, 6).map(([c]) => c);
  if (!topCats.length) { el.innerHTML = cardEmpty("Not enough spending history yet — add transactions across a few months to see trends."); return; }
  // Series matrix: [cat][month] = monthly spend (clamped to 0)
  const series = topCats.map(cat => months.map((_, mi) => Math.max(0, monthCat[mi][cat] || 0)));
  const flat = series.flat();
  const rawMax = Math.max(...flat, 1);
  const { yLo: ymin, yHi: ymax, ticks: yTicks } = _niceScale(0, rawMax, 5);

  // Match the viewBox to the card's real aspect ratio so the chart fills the box
  // (preserveAspectRatio="meet" then scales it up with no letterboxing or stretch).
  const W = 1200;
  const cw = el.clientWidth || 1200, ch = el.clientHeight || 320;
  const H = Math.round(W * (ch / Math.max(cw, 1))) || 320;
  const pad = { l: 60, r: 56, t: 16, b: 48 };
  const xi = i => pad.l + (i / Math.max(months.length - 1, 1)) * (W - pad.l - pad.r);
  const yi = v => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);

  function smoothPath(pts) {
    if (pts.length < 2) return "";
    if (pts.length === 2) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`;
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
      const t = 0.18;
      const c1x = p1[0] + (p2[0] - p0[0]) * t, c1y = p1[1] + (p2[1] - p0[1]) * t;
      const c2x = p2[0] - (p3[0] - p1[0]) * t, c2y = p2[1] - (p3[1] - p1[1]) * t;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  const colorFor = (cat, i) => (CAT_BY[cat] && CAT_BY[cat].color) || autoColor(cat, i);

  const gridLines = yTicks.map(v => {
    const y = yi(v).toFixed(1);
    return `<line x1="${pad.l}" x2="${W-pad.r}" y1="${y}" y2="${y}" stroke="var(--line-2)" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>
            <text x="${pad.l-10}" y="${(+y+3.5).toFixed(1)}" text-anchor="end" style="font-family:Inter,sans-serif;font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;fill:var(--ink-4)">${_fmtAxisGBP(v)}</text>`;
  }).join("");

  const xLabels = months.map((mo, i) => {
    const anchor = i === 0 ? "start" : i === months.length - 1 ? "end" : "middle";
    return `<text x="${xi(i).toFixed(1)}" y="${H-22}" text-anchor="${anchor}" style="font-family:Inter,sans-serif;font-size:11px;font-weight:500;fill:var(--ink-4)">${MONTHS[mo.m]} ${String(mo.y).slice(2)}</text>`;
  }).join("");

  // Lines + dots for each category. Each line gets a class for hover dimming.
  const linesSvg = topCats.map((cat, ci) => {
    const color = colorFor(cat, ci);
    const pts = series[ci].map((v, i) => [xi(i), yi(v)]);
    const path = smoothPath(pts);
    const dots = pts.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === pts.length - 1 ? 3.4 : 2}" fill="${color}" stroke="var(--bg-elev)" stroke-width="1.4"/>`).join("");
    return `<g class="rt-series" data-cat-i="${ci}"><path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${dots}</g>`;
  }).join("");

  // Right-edge inline labels: print "£amt" at the line's last point, vertically
  // de-collide so two close categories don't overlap.
  const rightLabels = (() => {
    const items = topCats.map((cat, ci) => ({ cat, ci, y: yi(series[ci][series[ci].length - 1]), v: series[ci][series[ci].length - 1] }));
    items.sort((a, b) => a.y - b.y);
    const minGap = 14;
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i-1].y < minGap) items[i].y = items[i-1].y + minGap;
    }
    return items.map(({ cat, ci, y, v }) => {
      const color = colorFor(cat, ci);
      return `<text x="${(W-pad.r+8).toFixed(1)}" y="${y.toFixed(1)}" dominant-baseline="middle" style="font-family:Inter,sans-serif;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;fill:${color}">${_fmtAxisGBP(v)}</text>`;
    }).join("");
  })();

  // Legend below the chart — small pills with colour swatch + name.
  const legend = topCats.map((cat, ci) => `<span class="rt-legend-pill"><i style="background:${colorFor(cat, ci)}"></i>${cat}</span>`).join("");

  const svgId = "rep-trends-svg", lineId = "rep-trends-cross", tipId = "rep-trends-tip";
  el.innerHTML = `
    <div class="rt-wrap">
      <svg id="${svgId}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" width="100%" style="display:block">
        ${gridLines}${xLabels}${linesSvg}${rightLabels}
        <line id="${lineId}" x1="0" x2="0" y1="${pad.t}" y2="${H-pad.b}" stroke="var(--ink-3)" stroke-dasharray="3 3" stroke-width="1" opacity="0" vector-effect="non-scaling-stroke"/>
      </svg>
      <div id="${tipId}" class="rt-tip" style="display:none"></div>
    </div>
    <div class="rt-legend">${legend}</div>`;

  const svg = document.getElementById(svgId);
  const tip = document.getElementById(tipId);
  const cross = document.getElementById(lineId);
  svg.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (months.length - 1));
    if (idx < 0 || idx >= months.length) { cross.setAttribute("opacity", "0"); tip.style.display = "none"; return; }
    cross.setAttribute("x1", xi(idx)); cross.setAttribute("x2", xi(idx)); cross.setAttribute("opacity", "1");
    const rows = topCats.map((cat, ci) => ({ cat, color: colorFor(cat, ci), v: series[ci][idx] })).filter(r => r.v > 0).sort((a,b) => b.v - a.v);
    const monthTotal = rows.reduce((s, r) => s + r.v, 0);
    const head = `<div class="rt-tip-head">${months[idx].label}</div>`;
    const body = rows.map(r => `<div class="rt-tip-row"><span class="rt-tip-sw" style="background:${r.color}"></span><span class="rt-tip-cat">${r.cat}</span><span class="rt-tip-amt">${_fmtAxisGBP(r.v)}</span></div>`).join("");
    const foot = `<div class="rt-tip-foot"><span>Total</span><span>${_fmtAxisGBP(monthTotal)}</span></div>`;
    tip.innerHTML = head + body + foot;
    tip.style.display = "block";
    // Position tooltip near the crosshair; flip to the left if it would clip the right edge.
    const px2 = (xi(idx) / W) * r.width;
    const tipW = tip.offsetWidth;
    tip.style.left = (px2 + tipW + 16 > r.width ? Math.max(8, px2 - tipW - 12) : px2 + 12) + "px";
    tip.style.top  = "12px";
  });
  svg.addEventListener("mouseleave", () => { cross.setAttribute("opacity", "0"); tip.style.display = "none"; });
}

function renderHomeSpend() {
  // Dashboard "Spending by category" panel only. (Reports dropped its treemap in
  // favour of the Category trends hero + Insights panel.)
  _renderSpendInto("home");
}
function _renderSpendInto(prefix) {
  const el = document.getElementById(`${prefix}-cats`); if (!el) return;
  const mode = _dashView.spend;
  const txns = getTxns();
  const ms = mStat(txns, _viewMonth.y, _viewMonth.m);
  const ml = monthLabel(_viewMonth.y, _viewMonth.m);
  const titleEl = document.getElementById(`${prefix}-spend-title`);
  if (titleEl) titleEl.textContent = `Spending by category`;
  // Build catMap with REIMBURSEMENT NETTING: income transactions tagged with an expense category
  // (e.g. friend paid you back for shoes — tagged "Clothing") reduce the corresponding category total.
  const expCatSet = new Set(getAllCats("exp").map(c => c.id));
  const catMap = {};
  ms.txns.forEach(t => {
    const cat = t.category || "Uncategorised";
    if (normType(t) === "out") catMap[cat] = (catMap[cat]||0) + t.amount;
    else if (normType(t) === "in" && expCatSet.has(cat)) catMap[cat] = (catMap[cat]||0) - t.amount;
  });
  // Drop categories that net to zero or negative (over-reimbursed).
  let sorted = Object.entries(catMap).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
  const max = sorted[0]?.[1] || 1;
  const totalSpent = sorted.reduce((s,[,v]) => s+v, 0);
  const txCount = ms.txns.filter(t => normType(t)==="out").length;
  if (!sorted.length) {
    el.innerHTML = cardEmpty(`No expenses for ${ml}`);
    return;
  }
  if (mode === "pie") {
    const slices = sorted.map(([id, amt], i) => ({
      label: id,
      value: amt,
      color: autoColor(id, i),
      icon: iconFor(id),
    }));
    el.innerHTML = renderDonut(slices, { centreLabel: "spent", empty: `No expenses for ${ml}` });
    return;
  }
  const totalEl = document.getElementById(`${prefix}-spend-total`);
  if (totalEl) totalEl.textContent = totalSpent > 0 ? `−${fmtGBP(totalSpent,{dp:0})}` : "—";
  const header = "";
  if (mode === "treemap") {
    // Squarified rectangles sized by amount — quick pictorial overview of where the money went.
    const W = 600, H = 340;
    const items = sorted.map(([id, amt], i) => ({ id, value: amt, color: autoColor(id, i), icon: iconFor(id) }));
    const layout = squarifiedTreemap(items, W, H);
    const tiles = layout.map(({ x, y, w, h, item }) => {
      const pct = totalSpent ? Math.round(item.value/totalSpent*100) : 0;
      // Label fit heuristic: progressively hide details as tile shrinks so small slivers stay clean.
      const showName = w > 80 && h > 30;
      const showAmt  = w > 60 && h > 26;
      const showIcon = w > 40 && h > 40;
      const ic   = showIcon ? `<span class="tm-ic">${item.icon || ''}</span>` : "";
      const lab  = showName ? `<span class="tm-name">${item.id}</span>` : "";
      const amts = showAmt  ? `<span class="tm-amt">${fmtGBP(item.value,{dp:0})}<small>${pct}%</small></span>` : "";
      const txt = tileTextColor(item.color);
      return `<div class="tm-tile" style="left:${(x/W*100).toFixed(3)}%;top:${(y/H*100).toFixed(3)}%;width:${(w/W*100).toFixed(3)}%;height:${(h/H*100).toFixed(3)}%;background:${item.color};color:${txt}" title="${item.id} · ${fmtGBP(item.value,{dp:0})} (${pct}%)">
        ${ic}${lab}${amts}
      </div>`;
    }).join("");
    el.innerHTML = header + `<div class="tm-wrap" style="aspect-ratio:${W}/${H}">${tiles}</div>`;
    return;
  }
  // Compact single-line rows (icon + name + inline bar + % + amount). Fold the long
  // tail into "Other" so the card never needs scrolling — dynamically reduce the cap
  // until the rows fit the available height. Full breakdown lives behind "View all".
  const compactRow = (id, amt, isOther, i, dmax) => {
    const color = isOther ? "var(--ink-4)" : autoColor(id, i);
    const pct = (amt / dmax * 100).toFixed(0);
    const pctOfTotal = totalSpent ? (amt / totalSpent * 100).toFixed(0) : 0;
    const icon = isOther ? "•" : iconFor(id);
    const name = isOther ? "Other" : id;
    return `<div class="catbar-c">
      <span class="cc-label"><span class="cc-ic">${icon}</span><span class="cc-name">${name}</span></span>
      <span class="cc-bar"><i style="width:${pct}%;background:${color}"></i></span>
      <span class="cc-pct">${pctOfTotal}%</span>
      <span class="cc-amt blur">${fmtGBP(amt,{dp:0})}</span>
    </div>`;
  };
  const paint = (cap) => {
    let disp;
    if (cap >= sorted.length) disp = sorted.map(([id, v]) => [id, v, false]);
    else {
      const rest = sorted.slice(cap).reduce((s, [, v]) => s + v, 0);
      disp = [...sorted.slice(0, cap).map(([id, v]) => [id, v, false]), ["__other__", rest, true]];
    }
    const dmax = Math.max(...disp.map(d => d[1]), 1);
    el.innerHTML = header + disp.map((d, i) => compactRow(d[0], d[1], d[2], i, dmax)).join("");
  };
  paint(sorted.length);
  // Shrink-to-fit: if the rows overflow the card body, fold more into "Other".
  if (el.clientHeight > 0) {
    let cap = sorted.length;
    while (cap > 3 && el.scrollHeight > el.clientHeight + 1) { cap--; paint(cap); }
  }
}

function renderHomeIncome() {
  const el = document.getElementById("home-income-list"); if (!el) return;
  const txns = getTxns();
  const ms = mStat(txns, _viewMonth.y, _viewMonth.m);
  const ml = monthLabel(_viewMonth.y, _viewMonth.m);
  const incTxns = ms.txns.filter(t => normType(t)==="in").sort((a,b) => b.amount - a.amount);
  const total = incTxns.reduce((s,t) => s+t.amount, 0);
  const titleEl = document.getElementById("home-income-title");
  if (titleEl) titleEl.textContent = `Income by source`;
  if (!incTxns.length) {
    el.innerHTML = cardEmpty(`No income for ${ml}`);
    return;
  }
  if (_dashView.income === "pie") {
    // Group by description (income source) for the pie
    const palette = ["oklch(70% 0.10 150)","oklch(70% 0.10 240)","oklch(72% 0.12 320)","oklch(72% 0.12 50)","oklch(70% 0.05 75)","oklch(72% 0.13 130)","oklch(72% 0.12 30)","oklch(65% 0.10 280)"];
    const grp = {};
    incTxns.forEach(t => {
      const k = t.description || t.category || "—";
      grp[k] = (grp[k] || 0) + t.amount;
    });
    const slices = Object.entries(grp)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
    el.innerHTML = renderDonut(slices, { centreLabel: "income", empty: `No income for ${ml}` });
    return;
  }
  // Show top 6 income sources by amount; collapse the rest into an "Other" line
  const TOP_N = 6;
  const top = incTxns.slice(0, TOP_N);
  const rest = incTxns.slice(TOP_N);
  const restTotal = rest.reduce((s,t) => s+t.amount, 0);

  const rows = top.map(t => {
    const acct = t.account || '—';
    const dateStr = t.date ? fmtDate(t.date) : '—';
    return `<div class="tx-line">
      <span class="tx-desc">${t.description || t.category || '—'}</span>
      <span class="tx-meta">${dateStr} · ${acct}</span>
      <span class="tx-amt pos blur">+${fmtGBP(t.amount,{dp:0})}</span>
    </div>`;
  }).join("");

  const moreRow = rest.length ? `<div class="tx-line tx-line-more" onclick="switchPage('income')">
    <span class="tx-desc muted">+${rest.length} other source${rest.length>1?'s':''}</span>
    <span class="tx-meta">tap to view all</span>
    <span class="tx-amt pos blur">+${fmtGBP(restTotal,{dp:0})}</span>
  </div>` : "";

  el.innerHTML = rows + moreRow;
}

function renderHomeByAccount() {
  const el = document.getElementById("home-by-account-list"); if (!el) return;
  const txns = getTxns();
  const ms = mStat(txns, _viewMonth.y, _viewMonth.m);
  const ml = monthLabel(_viewMonth.y, _viewMonth.m);
  // Sum outflows per source account. For transfers we deliberately skip — they're not "spending".
  const map = {};
  ms.txns.forEach(t => {
    if (normType(t) !== "out") return;
    const acct = t.account || "—";
    map[acct] = (map[acct] || 0) + t.amount;
  });
  const sorted = Object.entries(map).sort((a,b) => b[1] - a[1]);
  const total = sorted.reduce((s,[,v]) => s+v, 0);
  if (!sorted.length) {
    el.innerHTML = cardEmpty(`No spending for ${ml}`);
    return;
  }
  const max = sorted[0][1];
  // The account view shares the header total with the category view; only set it when active.
  if (_spendTab.v === "account") {
    ["home", "rep"].forEach(p => {
      const totalEl = document.getElementById(`${p}-spend-total`);
      if (totalEl) totalEl.textContent = total > 0 ? `−${fmtGBP(total,{dp:0})}` : "—";
    });
  }
  el.innerHTML = sorted.map(([name, amt], i) => {
    const color = autoColor(name, i);
    const pct = (amt/max*100).toFixed(0);
    const pctOfTotal = total ? (amt/total*100).toFixed(0) : 0;
    return `<div class="catbar">
      <div class="top"><span>${name}</span><div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--ink-4)">${pctOfTotal}%</span><span class="v blur">−${fmtGBP(amt,{dp:0})}</span></div></div>
      <div class="bar"><i class="bar-fill" style="display:block;width:${pct}%;background:${color}"></i></div>
    </div>`;
  }).join("");
}

// Merged Top spend card — toggle between individual transactions and rolled-up merchants.
const _topSpendTab = { v: "items" };
function renderHomeTopSpend() {
  const el = document.getElementById("home-topspend-body"); if (!el) return;
  const txns = getTxns();
  const ms = mStat(txns, _viewMonth.y, _viewMonth.m);
  const ml = monthLabel(_viewMonth.y, _viewMonth.m);
  const empty = cardEmpty(`No expenses for ${ml}`);

  if (_topSpendTab.v === "accounts") {
    const map = {};
    ms.txns.filter(t => normType(t)==="out").forEach(t => {
      const acct = t.account || "—";
      map[acct] = (map[acct] || 0) + t.amount;
    });
    const sorted = Object.entries(map).sort((a,b) => b[1] - a[1]);
    const total = sorted.reduce((s,[,v]) => s+v, 0);
    if (!sorted.length) { el.innerHTML = empty; return; }
    const max = sorted[0][1];
    el.innerHTML = sorted.map(([name, amt], i) => {
      const color = autoColor(name, i);
      const pct = (amt/max*100).toFixed(0);
      const pctOfTotal = total ? (amt/total*100).toFixed(0) : 0;
      return `<div class="catbar">
        <div class="top"><span>${name}</span><div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--ink-4)">${pctOfTotal}%</span><span class="v blur">−${fmtGBP(amt,{dp:0})}</span></div></div>
        <div class="bar"><i class="bar-fill" style="display:block;width:${pct}%;background:${color}"></i></div>
      </div>`;
    }).join("");
    return;
  }
  if (_topSpendTab.v === "merchants") {
    const map = {};
    ms.txns.filter(t => normType(t)==="out").forEach(t => {
      const key = (t.description||'').trim() || '(no description)';
      if (!map[key]) map[key] = { total: 0, count: 0, catId: t.category };
      map[key].total += t.amount;
      map[key].count++;
    });
    const sorted = Object.entries(map).sort((a,b) => b[1].total - a[1].total).slice(0, 8);
    if (!sorted.length) { el.innerHTML = empty; return; }
    const max = sorted[0][1].total;
    el.innerHTML = sorted.map(([name, {total, count, catId}]) => {
      const cat = CAT_BY[catId] || {};
      const pct = (total/max*100).toFixed(0);
      return `<div class="catbar">
        <div class="top">
          <span style="display:flex;align-items:center;gap:6px">
            <span style="font-size:13px">${iconFor(catId)}</span>
            <span>${name}</span>
            ${count > 1 ? `<span style="font-size:11px;color:var(--ink-4)">${count}×</span>` : ''}
          </span>
          <span class="v blur">−${fmtGBP(total,{dp:0})}</span>
        </div>
        <div class="bar"><i class="bar-fill" style="display:block;width:${pct}%;background:${cat.color||'var(--ink-3)'}"></i></div>
      </div>`;
    }).join("");
    return;
  }
  // Items
  const topTxns = ms.txns.filter(t => normType(t)==="out").sort((a,b) => b.amount - a.amount).slice(0, 8);
  if (!topTxns.length) { el.innerHTML = empty; return; }
  const max = topTxns[0].amount;
  el.innerHTML = topTxns.map(t => {
    const cat = CAT_BY[t.category] || {};
    const pct = (t.amount/max*100).toFixed(0);
    return `<div class="catbar">
      <div class="top">
        <span style="display:flex;align-items:center;gap:6px">
          ${t.category ? `<span style="font-size:10.5px;background:color-mix(in oklch,${cat.color||'var(--ink-4)'} 22%,var(--bg-sunk));color:var(--ink-2);padding:1px 6px;border-radius:4px">${iconFor(t.category)} ${t.category}</span>` : ''}
          <span>${t.description || '—'}</span>
        </span>
        <span class="v blur">−${fmtGBP(t.amount,{dp:0})}</span>
      </div>
      <div class="bar"><i class="bar-fill" style="display:block;width:${pct}%;background:${cat.color||'var(--neg)'}"></i></div>
    </div>`;
  }).join("");
}
// Delegated click handler for the Top spend card's tab pills.
document.addEventListener("click", e => {
  const btn = e.target.closest("#home-topspend-tabs [data-tab]");
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (_topSpendTab.v === tab) return;
  _topSpendTab.v = tab;
  document.querySelectorAll("#home-topspend-tabs [data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  renderHomeTopSpend();
});

function renderHomeRecent() {
  const el = document.getElementById("home-recent-list"); if (!el) return;
  const txns = getTxns();
  const ms = mStat(txns, _viewMonth.y, _viewMonth.m);
  const ml = monthLabel(_viewMonth.y, _viewMonth.m);
  const list = ms.txns.slice().sort((a,b) => (a.date||"") < (b.date||"") ? 1 : -1).slice(0, 10);
  const titleEl = document.getElementById("home-recent-title");
  if (titleEl) titleEl.textContent = `Recent`;
  if (!list.length) {
    el.innerHTML = cardEmpty(`No transactions for ${ml} — <a onclick="openTxModal(null,'out')">add one</a>`);
    return;
  }
  el.innerHTML = list.map(t => {
    const ty = normType(t);
    const isIn = ty === 'in', isTfr = ty === 'transfer';
    const desc = t.description || (isTfr ? `${t.fromAccount||''} → ${t.toAccount||''}` : '—');
    const acct = t.account || t.fromAccount || '—';
    const dateStr = t.date ? fmtDate(t.date) : '—';
    const amtCls = isTfr ? 'tfr' : (isIn ? 'pos' : 'neg');
    const metaCat = t.category ? ` · ${t.category}` : '';
    const amtStr = isTfr ? fmtGBP(t.amount,{dp:0}) : fmtGBP(isIn ? t.amount : -t.amount, {dp:0, sign:isIn});
    return `<div class="tx-line">
      <span class="tx-desc">${desc}</span>
      <span class="tx-meta">${dateStr} · ${acct}${metaCat}</span>
      <span class="tx-amt ${amtCls} blur">${amtStr}</span>
    </div>`;
  }).join("");
}

function renderHomeBudget() {
  const el = document.getElementById("home-bud-list"); if (!el) return;
  const buds = getBudgets().filter(b => b.type === 'out');
  const ml = monthLabel(_viewMonth.y, _viewMonth.m);
  const titleEl = document.getElementById("home-bud-title");
  if (titleEl) titleEl.textContent = `Budgets`;
  if (!buds.length) {
    el.innerHTML = cardEmpty(`No budgets — <a onclick="switchPage('budgets')">add some</a>`);
    return;
  }
  const txns = getTxns();
  const cur = mStat(txns, _viewMonth.y, _viewMonth.m);
  const actuals = {};
  cur.txns.filter(t => normType(t)==='out').forEach(t => { actuals[t.category] = (actuals[t.category]||0) + t.amount; });
  const rows = buds.map(b => {
    const c = b.id || b.category;
    const spent = actuals[c] || 0;
    return { b, c, spent, pct: b.amount ? spent/b.amount : 0 };
  }).sort((a,b) => b.pct - a.pct).slice(0, 4);
  el.innerHTML = rows.map(({b, c, spent, pct}) => {
    const cat = CAT_BY[c] || {};
    const over = pct > 1;
    const fill = over ? 'var(--neg)' : (pct > 0.8 ? 'var(--warn)' : (cat.color || 'var(--ink-3)'));
    return `<div class="bud-mini-row">
      <div class="bm-ic" style="background:color-mix(in oklch,${cat.color||'var(--ink-3)'} 30%,var(--bg-sunk))">${iconFor(c)}</div>
      <div class="info">
        <b>${c}</b>
        <div class="track"><div class="fill" style="width:${Math.min(100, pct*100).toFixed(0)}%;background:${fill}"></div></div>
      </div>
      <div class="pct${over?' over':''}">${(pct*100).toFixed(0)}%</div>
    </div>`;
  }).join("");
}


// Re-fit the dashboard cards (category "Other" rollup depends on card height) on resize.
let _homeFitTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_homeFitTimer);
  _homeFitTimer = setTimeout(() => {
    if (document.getElementById("page-home")?.classList.contains("active")) {
      try { renderHomeSpend(); renderHomeAccountsDonut(); } catch (e) {}
    }
  }, 160);
});

// Home period nav + NW chart range/filter — delegated so they survive innerHTML rebuilds.
document.addEventListener("click", e => {
  const pv = e.target.closest("#home-period-prev, #home-period-next");
  if (pv) {
    if (pv.id === "home-period-prev") { const [y, m] = prevMonth(_viewMonth.y, _viewMonth.m); _viewMonth = { y, m }; }
    else { let { y, m } = _viewMonth; m++; if (m > 11) { m = 0; y++; } _viewMonth = { y, m }; }
    renderHomeAll();
    return;
  }
  const rg = e.target.closest("#home-nw-range [data-range]");
  if (rg) {
    _homeNW.range = rg.dataset.range;
    rg.parentElement.querySelectorAll("[data-range]").forEach(b => b.classList.toggle("active", b === rg));
    renderHomeNWProjection();
    return;
  }
  const sr = e.target.closest("#home-nw-series [data-series]");
  if (sr) {
    _homeNW.series = sr.dataset.series;
    sr.parentElement.querySelectorAll("[data-series]").forEach(b => b.setAttribute("aria-pressed", b === sr ? "true" : "false"));
    renderHomeNWProjection();
    return;
  }
});

// Dashboard chart-mode toggle (bars ↔ pie). Delegated click handler.
document.addEventListener("click", e => {
  const btn = e.target.closest(".view-toggle [data-mode]");
  if (!btn) return;
  const wrap = btn.closest(".view-toggle");
  const card = wrap.dataset.card;     // "spend" or "income"
  const mode = btn.dataset.mode;      // "bars" or "pie"
  if (!card || _dashView[card] === mode) return;
  _dashView[card] = mode;
  wrap.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  if (card === "spend")  renderHomeSpend();
  if (card === "income") renderHomeIncome();
});
