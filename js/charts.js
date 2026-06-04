function drawStackedArea(slice, bucketFilter, opts = {}) {
  const targetId = opts.targetId || "hero-chart";
  const H = opts.chartH || 280;
  const chartEl = document.getElementById(targetId);
  if (!chartEl) return;
  const W = 1000;
  const pad = { l: 14, r: 64, t: 18, b: 32 };

  const visibles = bucketFilter === "all" ? NW_CATS : NW_CATS.filter(c => c.id === bucketFilter);
  const totals   = slice.map(e => visibles.reduce((s,c) => s + (e.allocations.find(a=>a.cat===c.id)?.value||0), 0));
  const max = Math.max(...totals, 1);
  const min = bucketFilter === "all" ? 0 : Math.min(...totals);
  const span = (max - min) || 1;

  const xi = i => pad.l + (i / Math.max(slice.length-1,1)) * (W - pad.l - pad.r);
  const yi = v => pad.t + (1-(v-min)/span)*(H-pad.t-pad.b);

  // Build stacked paths
  let cum = slice.map(() => 0);
  const paths = visibles.map(c => {
    const top = slice.map((e,i) => cum[i] + (e.allocations.find(a=>a.cat===c.id)?.value||0));
    const bot = [...cum];
    const area = top.map((v,i) => (i?"L":"M")+xi(i).toFixed(1)+","+yi(v).toFixed(1)).join(" ")
      + " " + bot.map((v,i) => "L"+xi(slice.length-1-i).toFixed(1)+","+yi(bot[slice.length-1-i]).toFixed(1)).join(" ") + " Z";
    cum = top;
    return { c, area };
  });

  // Y ticks
  const ticks = 4;
  const tickLines = Array.from({length:ticks},(_,i) => {
    const v = min + span*i/(ticks-1);
    return `<line x1="${pad.l}" x2="${W-pad.r}" y1="${yi(v).toFixed(1)}" y2="${yi(v).toFixed(1)}" stroke="var(--line-2)" stroke-dasharray="2 4"/>
    <text x="${W-pad.r+6}" y="${(yi(v)+3).toFixed(1)}" style="font-family:'IBM Plex Mono',monospace;font-size:10;fill:var(--ink-4)">£${(v/1000).toFixed(0)}k</text>`;
  }).join("");

  const xLabels = slice.map((e,i) => (i%2===0||i===slice.length-1)
    ? `<text x="${xi(i).toFixed(1)}" y="${H-8}" text-anchor="middle" style="font-family:Inter;font-size:10;fill:var(--ink-4)">${(e.month||"").split(" ")[0]}</text>`
    : "").join("");

  const areasSVG = paths.map(p => `<path d="${p.area}" fill="${p.c.color}" opacity="0.85"/>`).join("");

  const svgId = `area-svg-${targetId}`;
  const lineId = `hover-line-${targetId}`;
  const tipId = `area-tip-${targetId}`;
  chartEl.innerHTML = `
    <svg id="${svgId}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" style="display:block">
      ${tickLines}${xLabels}${areasSVG}
      <line id="${lineId}" x1="0" x2="0" y1="${pad.t}" y2="${H-pad.b}" stroke="var(--ink-3)" stroke-dasharray="2 3" stroke-width="1" opacity="0"/>
    </svg>
    <div class="chart-tooltip" id="${tipId}" style="display:none"></div>`;

  const svg = document.getElementById(svgId);
  svg.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.round(((px-pad.l)/(W-pad.l-pad.r))*(slice.length-1));
    if (idx < 0 || idx >= slice.length) { hideTip(); return; }
    const lx = xi(idx);
    document.getElementById(lineId).setAttribute("x1",lx);
    document.getElementById(lineId).setAttribute("x2",lx);
    document.getElementById(lineId).setAttribute("opacity","1");
    const tip = document.getElementById(tipId);
    tip.style.display = "block";
    tip.style.left = ((lx / W) * r.width) + "px";
    tip.style.top  = ((yi(totals[idx]) / H) * r.height) + "px";
    tip.innerHTML  = `<b>${slice[idx].month}</b> · ${fmtGBP(Math.round(totals[idx]),{dp:0})}`;
  });
  svg.addEventListener("mouseleave", hideTip);
  function hideTip() {
    document.getElementById(lineId)?.setAttribute("opacity","0");
    const t = document.getElementById(tipId); if(t) t.style.display="none";
  }
}

let _catPopTarget = null;
function buildCatPill(txId, catId) {
  const cat = CAT_BY[catId] || {};
  return `<button class="cat-pill" data-txid="${txId}" onclick="openCatPop(this, '${txId}')">
    <i class="swatch" style="background:${cat.color||"var(--ink-4)"}"></i>
    ${catId}
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
  </button>`;
}

function openCatPop(btn, txId) {
  closeAllPops();
  const pop = document.createElement("div");
  pop.className = "cat-pop";
  pop.id = "cat-pop-"+txId;
  pop.innerHTML = getAllCats("exp").map(c =>
    `<button onclick="recategorise('${txId}','${c.id}')"><i class="swatch" style="background:${c.color};display:inline-block;width:8px;height:8px;border-radius:2px"></i>${c.icon||''} ${c.id}</button>`
  ).join("");
  btn.appendChild(pop);
  _catPopTarget = pop;
  setTimeout(() => document.addEventListener("mousedown", closePopsOnOutside), 0);
}

function closePopsOnOutside(e) {
  if (_catPopTarget && !_catPopTarget.contains(e.target)) closeAllPops();
}
function closeAllPops() {
  document.querySelectorAll(".cat-pop").forEach(p => p.remove());
  _catPopTarget = null;
  document.removeEventListener("mousedown", closePopsOnOutside);
}

function recategorise(txId, newCat) {
  const txns = getTxns();
  const t = txns.find(t => String(t.id) === String(txId));
  if (t) { t.category = newCat; lsSet("fin_txns", txns); }
  closeAllPops();
  showToast(`Re-categorised to ${newCat}`);
  renderTxAll();
}

