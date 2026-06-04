/* ════════════════════════════════════════
   INSIGHTS TAB
════════════════════════════════════════ */
function renderInsightsTab() {
  if (!document.getElementById("ins-trend")) return;
  const txns = getTxns();
  const now = new Date();
  renderInsTrend(txns, now);
  renderInsYTD(txns, now);
  renderInsMovers(txns, now);
  renderInsBig(txns, now);
  renderInsDOW(txns, now);
  renderInsIncome(txns, now);
}

function renderInsTrend(txns, now) {
  const rows = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ms = mStat(txns, d.getFullYear(), d.getMonth());
    rows.push({ m: MONTHS[d.getMonth()], y: d.getFullYear() % 100, ...ms });
  }
  const max = Math.max(...rows.flatMap(r => [r.income, r.spent]), 1);
  document.getElementById("ins-trend").innerHTML = rows.map(r => {
    const inPct = (r.income/max*100).toFixed(0);
    const outPct = (r.spent/max*100).toFixed(0);
    const net = r.income - r.spent;
    return `<div class="ins-trend-row">
      <div class="lab">${r.m} '${String(r.y).padStart(2,'0')}</div>
      <div class="bar-pair">
        <div class="bar"><i style="width:${inPct}%;background:var(--pos)"></i></div>
        <div class="bar"><i style="width:${outPct}%;background:var(--neg)"></i></div>
      </div>
      <div class="net ${net>=0?'pos':'neg'} blur">${(net>=0?'+':'−')+fmtGBP(Math.abs(net),{dp:0})}</div>
    </div>`;
  }).join("");
  const totalIn = rows.reduce((s,r)=>s+r.income,0);
  const totalOut = rows.reduce((s,r)=>s+r.spent,0);
  document.getElementById("ins-trend-range").innerHTML = `<span class="blur">in ${fmtGBP(totalIn,{dp:0})} · out ${fmtGBP(totalOut,{dp:0})}</span>`;
}

function renderInsYTD(txns, now) {
  const yStart = new Date(now.getFullYear(), 0, 1).getTime();
  const inRange = txns.filter(t => t.date && new Date(t.date+"T00:00:00").getTime() >= yStart);
  const inSum = inRange.filter(t => normType(t)==="in").reduce((s,t)=>s+t.amount, 0);
  const outSum = inRange.filter(t => normType(t)==="out").reduce((s,t)=>s+t.amount, 0);
  const net = inSum - outSum;
  const rate = inSum > 0 ? (net/inSum*100) : 0;
  const trSum = inRange.filter(t => normType(t)==="transfer").reduce((s,t)=>s+t.amount, 0);
  document.getElementById("ins-ytd").innerHTML = `
    <div class="ins-ytd-stat"><span class="lab">Income</span><span class="val pos blur">${fmtGBP(inSum,{dp:0})}</span></div>
    <div class="ins-ytd-stat"><span class="lab">Spent</span><span class="val neg blur">${fmtGBP(outSum,{dp:0})}</span></div>
    <div class="ins-ytd-stat"><span class="lab">Net saved</span><span class="val ${net>=0?'pos':'neg'} blur">${(net>=0?'+':'−')+fmtGBP(Math.abs(net),{dp:0})}</span></div>
    <div class="ins-ytd-stat"><span class="lab">Savings rate</span><span class="val">${inSum>0?rate.toFixed(0)+'%':'—'}</span></div>
    <div class="ins-ytd-stat"><span class="lab">Transfers</span><span class="val blur" style="color:var(--c-lisa)">${fmtGBP(trSum,{dp:0})}</span></div>`;
  const monthsElapsed = now.getMonth() + (now.getDate() / 30);
  document.getElementById("ins-ytd-range").textContent = `${monthsElapsed.toFixed(1)} months in`;
}

function renderInsMovers(txns, now) {
  const cur = mStat(txns, now.getFullYear(), now.getMonth());
  const [py, pm] = prevMonth(now.getFullYear(), now.getMonth());
  const prev = mStat(txns, py, pm);
  // Net refunds (income tagged with an expense category) against the matching
  // expense bucket so a cancel-refund pair shows £0 movement, not +£369.
  const cMap = netSpendByCategory(cur.txns);
  const pMap = netSpendByCategory(prev.txns);
  const allCats = new Set([...Object.keys(cMap), ...Object.keys(pMap)]);
  const rows = [...allCats].map(cat => {
    const c = cMap[cat]||0, p = pMap[cat]||0;
    const delta = c - p;
    const pct = p > 0 ? (delta/p*100) : (c > 0 ? 999 : 0);
    return { cat, c, p, delta, pct };
  }).filter(r => Math.abs(r.delta) > 1).sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  if (!rows.length) {
    document.getElementById("ins-movers").innerHTML = `<div style="color:var(--ink-4);font-size:13px;padding:24px 0;text-align:center">Need expense data in two consecutive months.</div>`;
    return;
  }
  document.getElementById("ins-movers").innerHTML = rows.map(r => {
    const cat = CAT_BY[r.cat] || {};
    const pctStr = r.pct >= 999 ? "new" : `${r.pct>=0?'+':'−'}${Math.abs(r.pct).toFixed(0)}%`;
    return `<div class="ins-mover-row">
      <div class="ic" style="background:color-mix(in oklch,${cat.color||'var(--ink-3)'} 30%,var(--bg-sunk))">${iconFor(r.cat)}</div>
      <div class="name">${r.cat}</div>
      <div class="delta ${r.delta>=0?'neg':'pos'} blur">${r.delta>=0?'+':'−'}${fmtGBP(Math.abs(r.delta),{dp:0})}</div>
      <div class="pct">${pctStr}</div>
    </div>`;
  }).join("");
}

function renderInsBig(txns, now) {
  const yStart = new Date(now.getFullYear(), now.getMonth()-2, 1).getTime();
  const recent = txns.filter(t => t.date && new Date(t.date+"T00:00:00").getTime() >= yStart);
  const top = recent.filter(t => normType(t)==="out").sort((a,b) => b.amount - a.amount).slice(0, 5);
  document.getElementById("ins-big-range").textContent = "last 3 months";
  if (!top.length) {
    document.getElementById("ins-big").innerHTML = `<div style="color:var(--ink-4);font-size:13px;padding:24px 0;text-align:center">No expenses yet.</div>`;
    return;
  }
  document.getElementById("ins-big").innerHTML = top.map(t => {
    const cat = CAT_BY[t.category] || {};
    const dateStr = t.date ? new Date(t.date+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short"}) : "—";
    return `<div class="ins-big-row">
      <div class="ic" style="background:color-mix(in oklch,${cat.color||'var(--ink-3)'} 30%,var(--bg-sunk))">${iconFor(t.category)}</div>
      <div><b>${t.description||'—'}</b><span>${dateStr} · ${t.category||'—'}</span></div>
      <div class="amt blur">−${fmtGBP(t.amount,{dp:0})}</div>
    </div>`;
  }).join("");
}

function renderInsDOW(txns, now) {
  const labels = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const start = new Date(now.getFullYear(), now.getMonth()-5, 1).getTime();
  const totals = [0,0,0,0,0,0,0];
  const counts = [0,0,0,0,0,0,0];
  txns.filter(t => normType(t)==="out" && t.date).forEach(t => {
    const d = new Date(t.date+"T00:00:00");
    if (d.getTime() < start) return;
    const idx = (d.getDay() + 6) % 7;  // Mon-first
    totals[idx] += t.amount;
    counts[idx]++;
  });
  const max = Math.max(...totals, 1);
  document.getElementById("ins-dow").innerHTML = labels.map((l, i) => {
    const v = totals[i];
    const pct = (v/max*100).toFixed(0);
    return `<div class="ins-dow-grid">
      <div class="lab">${l}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="v blur">${fmtGBP(v,{dp:0})}</div>
    </div>`;
  }).join("");
}

function renderInsIncome(txns, now) {
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    monthly.push(mStat(txns, d.getFullYear(), d.getMonth()).income);
  }
  const nonZero = monthly.filter(v => v > 0);
  if (nonZero.length < 2) {
    document.getElementById("ins-income").innerHTML = `<div style="color:var(--ink-4);font-size:13px;padding:24px 0;text-align:center">Need income data in 2+ months.</div>`;
    return;
  }
  const mean = nonZero.reduce((s,v)=>s+v,0) / nonZero.length;
  const variance = nonZero.reduce((s,v)=>s+(v-mean)**2,0) / nonZero.length;
  const sd = Math.sqrt(variance);
  const cv = mean > 0 ? sd/mean : 0;  // coefficient of variation
  const verdict = cv < 0.1 ? "steady" : cv < 0.25 ? "varied" : "erratic";
  const verdictText = cv < 0.1 ? "Steady" : cv < 0.25 ? "Varied" : "Erratic";
  const desc = cv < 0.1 ? "Your income is highly consistent month to month."
             : cv < 0.25 ? "Some month-to-month variation."
             : "Income varies a lot between months.";
  document.getElementById("ins-income").innerHTML = `
    <div class="ins-stab">
      <div class="verdict ${verdict}">${verdictText}</div>
      <div class="desc">${desc}</div>
      <div class="stats">
        <div><div class="lab">Avg / month</div><div class="v blur">${fmtGBP(mean,{dp:0})}</div></div>
        <div><div class="lab">Variation</div><div class="v">±${(cv*100).toFixed(0)}%</div></div>
      </div>
    </div>`;
}

