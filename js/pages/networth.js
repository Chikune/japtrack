/* ════════════════════════════════════════
   SEGMENT CONTROLS (legacy dashboard handlers — guarded)
════════════════════════════════════════ */
// Topbar search routes to the Tx tab filter (Expenses page by default)
document.getElementById("search-inp").addEventListener("input", e => {
  _txAllSearchQ = e.target.value; _txAllPage = 0;
  if (!TX_PAGE_TYPES[_activePage]) switchPage("transactions");
  const txInp = document.getElementById("tx-all-search"); if (txInp) txInp.value = e.target.value;
  renderTxAll();
});

document.getElementById("privacy-btn").addEventListener("click", () => {
  _privacy = !_privacy;
  applyPrivacy();
});

document.getElementById("theme-btn").addEventListener("click", () => {
  _dark = !_dark;
  applyTheme();
});

document.getElementById("add-btn").addEventListener("click", () => {
  closeAddMenu();
  // Context-aware: open the right modal for the active tab
  switch (_activePage) {
    case "networth":
    case "accounts":     openNWModal(null); break;
    case "budgets":      openBudModal(null); break;
    case "scheduled":    openSchedModal(null); break;
    case "expenses":
    case "transactions": openTxModal(null, "out"); break;
    case "income":       openTxModal(null, "in"); break;
    case "transfers":    openTxModal(null, "transfer"); break;
    case "holidays":     openHolModal(null); break;
    case "goals":        openGoalModal(null); break;
    case "debt":         openDebtModal(null); break;
    default:             openTxModal(null, "out");
  }
});

function closeAddMenu() {
  const menu = document.getElementById("add-menu");
  const btn = document.getElementById("add-menu-btn");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}
function txShortcutType() {
  if (_activePage === "income") return "in";
  if (_activePage === "transfers") return "transfer";
  return "out";
}
(function wireAddShortcut() {
  // "n" keyboard shortcut → add an entry of the type appropriate to the active page.
  document.addEventListener("keydown", e => {
    if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
    e.preventDefault();
    openTxModal(null, txShortcutType());
  });
})();

/* ════════════════════════════════════════
   NET WORTH TAB
════════════════════════════════════════ */
let _nwRange = "1Y";
let _nwBucket = "all";
let _nwEditIdx = null;

function monthToTime(s) {
  if (!s) return 0;
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(s+"-01T00:00:00").getTime();
  const parts = s.split(" ");
  if (parts.length === 2) {
    const mi = MONTHS.indexOf(parts[0]);
    if (mi >= 0) return new Date(+parts[1], mi, 1).getTime();
  }
  const d = new Date(s); return isNaN(d) ? 0 : d.getTime();
}
function nwSnapshotsSorted() { return getNWEntries().slice().sort((a,b)=> monthToTime(a.month) - monthToTime(b.month)); }
const nwTotalE = (e) => e.allocations.reduce((s,a)=>s+a.value,0);
const safeId = (s) => s.replace(/[^a-z0-9]/gi,'');

function renderNW() {
  const entries = nwSnapshotsSorted();
  renderNWSummary(entries);
  renderNWAllocToday(entries);
  renderNWSnapshots(entries);
}

function renderNWSummary(entries) {
  const amtEl = document.getElementById("nw-amount"); if (!amtEl) return;
  if (!entries.length) {
    amtEl.textContent = "—";
    document.getElementById("nw-delta").innerHTML = "";
    document.getElementById("nw-best").textContent = "—";
    document.getElementById("nw-count").textContent = "0";
    return;
  }
  const totals = entries.map(nwTotalE);
  const last = totals[totals.length-1];
  const prev = totals.length>1 ? totals[totals.length-2] : last;
  const delta = last - prev;
  const deltas = totals.slice(1).map((v,i) => ({ month: entries[i+1].month, d: v - totals[i] }));
  const best = deltas.length ? deltas.reduce((a,b) => b.d > a.d ? b : a) : null;
  amtEl.textContent = fmtGBP(last,{dp:0});
  const dEl = document.getElementById("nw-delta");
  if (totals.length > 1) {
    dEl.className = "hero-delta" + (delta < 0 ? " neg" : "");
    dEl.innerHTML = `<span class="num">${delta>=0?'+':'−'}${fmtGBP(Math.abs(delta),{dp:0})}</span><span style="color:var(--ink-3);font-weight:500;margin-left:4px">vs prior</span>`;
  } else { dEl.innerHTML = ""; }
  document.getElementById("nw-best").textContent = best ? `${best.month} · ${best.d>=0?'+':'−'}${fmtGBP(Math.abs(best.d),{dp:0})}` : "—";
  document.getElementById("nw-count").textContent = entries.length;
}

function renderNWAllocToday(entries) {
  const el = document.getElementById("nw-donut");
  const lEl = document.getElementById("nw-legend");
  if (!entries.length) { el.innerHTML = ""; lEl.innerHTML = `<span style="color:var(--ink-4);font-size:13px">No data</span>`; return; }
  const last = entries[entries.length-1].allocations;
  const total = last.reduce((s,a)=>s+Math.max(0,a.value),0) || 1;
  const size=160, sw=30, r=(size-sw)/2, circ=2*Math.PI*r;
  let acc=0;
  const slices = NW_CATS.map(c=>({cat:c, value: last.find(a=>a.cat===c.id)?.value||0})).filter(s=>s.value>0);
  const arcs = slices.map(s => {
    const len=(s.value/total)*circ, off=circ*0.25-acc; acc+=len;
    return `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${s.cat.color}" stroke-width="${sw}" stroke-dasharray="${len} ${circ-len}" stroke-dashoffset="${off}"/>`;
  }).join("");
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--bg-sunk)" stroke-width="${sw}"/>${arcs}</svg>`;
  lEl.innerHTML = slices.map(s => `<div class="alloc-row"><div class="alloc-dot" style="background:${s.cat.color}"></div><span>${s.cat.id}</span><span class="alloc-pct">${(s.value/total*100).toFixed(1)}%</span><span class="alloc-val blur">${fmtGBP(s.value,{dp:0})}</span></div>`).join("");
}

function renderNWSnapshots(entries) {
  document.getElementById("nw-count").textContent = entries.length ? `${entries.length} entr${entries.length>1?'ies':'y'}` : "";
  const tbody = document.getElementById("nw-rows");
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px 0;color:var(--ink-4)">No snapshots — click <b>Add snapshot</b> to begin.</td></tr>`;
    return;
  }
  const display = entries.slice().reverse();
  tbody.innerHTML = display.map((e, di) => {
    const total = nwTotalE(e);
    const idx = entries.length - 1 - di;
    const prev = idx > 0 ? entries[idx-1] : null;
    const delta = prev ? total - nwTotalE(prev) : 0;
    const dCls = delta > 0 ? "nw-delta-pos" : delta < 0 ? "nw-delta-neg" : "";
    const dStr = !prev ? "—" : (delta>=0?'+':'−')+fmtGBP(Math.abs(delta),{dp:0});
    const segs = NW_CATS.map(c => {
      const v = e.allocations.find(a=>a.cat===c.id)?.value || 0;
      const w = total ? (v/total*100) : 0;
      return w > 0 ? `<i style="background:${c.color};flex:${w.toFixed(2)} 0 0" title="${c.id}: ${fmtGBP(v,{dp:0})}"></i>` : "";
    }).join("");
    return `<tr>
      <td><b style="font-weight:500">${e.month}</b></td>
      <td class="num blur">${fmtGBP(total,{dp:0})}</td>
      <td class="${dCls}">${dStr}</td>
      <td><div class="nw-bucket-bar">${segs}</div></td>
      <td style="text-align:right"><div class="nw-act">
        <button title="Edit" onclick="openNWModal(${idx})"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button class="danger" title="Delete" onclick="deleteNWSnapshot(${idx})"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </div></td>
    </tr>`;
  }).join("");
}

function openNWModal(idx = null) {
  _nwEditIdx = idx;
  const entries = nwSnapshotsSorted();
  const entry = idx !== null ? entries[idx] : null;
  document.getElementById("nw-modal-title").textContent = idx !== null ? "Edit snapshot" : "Add snapshot";
  let monthVal;
  if (entry) {
    const t = monthToTime(entry.month);
    const d = new Date(t);
    monthVal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  } else {
    const d = new Date();
    monthVal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  document.getElementById("nw-m-month").value = monthVal;
  document.getElementById("nw-m-buckets").innerHTML = NW_CATS.map(c => {
    const v = entry?.allocations.find(a=>a.cat===c.id)?.value || 0;
    return `<div class="row">
      <label><span style="background:${c.color};display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px"></span>${c.id}</label>
      <input type="number" step="0.01" id="nw-m-${safeId(c.id)}" value="${v}" oninput="updateNWModalTotal()" />
    </div>`;
  }).join("");
  updateNWModalTotal();
  document.getElementById("nw-modal").hidden = false;
  setTimeout(() => document.getElementById("nw-m-month").focus(), 50);
}

function updateNWModalTotal() {
  const total = NW_CATS.reduce((s,c) => s + (parseFloat(document.getElementById("nw-m-"+safeId(c.id))?.value)||0), 0);
  document.getElementById("nw-m-total").textContent = fmtGBP(total,{dp:0});
}

function closeNWModal() { document.getElementById("nw-modal").hidden = true; _nwEditIdx = null; }

function saveNWSnapshot() {
  const monthVal = document.getElementById("nw-m-month").value;
  if (!monthVal) { showToast("Please pick a month"); return; }
  const [y, m] = monthVal.split("-").map(Number);
  const monthStr = `${MONTHS[m-1]} ${y}`;
  const allocations = NW_CATS.map(c => ({
    cat: c.id,
    value: parseFloat(document.getElementById("nw-m-"+safeId(c.id)).value) || 0
  }));
  let entries = getNWEntries();
  if (_nwEditIdx !== null) {
    const sorted = nwSnapshotsSorted();
    const target = sorted[_nwEditIdx];
    if (target?.locked) { showToast("Snapshot is locked"); return; }
    const realIdx = entries.findIndex(e => e === target || (e.month === target.month));
    if (realIdx >= 0) entries[realIdx] = { ...entries[realIdx], month: monthStr, allocations };
  } else {
    const existingIdx = entries.findIndex(e => e.month === monthStr);
    if (existingIdx >= 0 && entries[existingIdx]?.locked) { showToast("Snapshot is locked"); return; }
    if (existingIdx >= 0) entries[existingIdx] = { ...entries[existingIdx], month: monthStr, allocations };
    else entries.push({ month: monthStr, allocations });
  }
  lsSet("fin_nw_entries", entries);
  closeNWModal();
  showToast(_nwEditIdx !== null ? "Snapshot updated" : "Snapshot added");
  // renderAll refreshes the dashboard chart, accounts tab, and every other consumer —
  // renderNW() alone only updates the Net worth tab and would leave stale UI elsewhere.
  renderAll();
}

function deleteNWSnapshot(idx) {
  confirmDialog({ title:"Delete snapshot?", message:"This can't be undone.", confirmLabel:"Delete", danger:true }, () => {
    const sorted = nwSnapshotsSorted();
    const target = sorted[idx];
    if (target?.locked) { showToast("Snapshot is locked"); return; }
    let entries = getNWEntries();
    const realIdx = entries.findIndex(e => e === target || e.month === target.month);
    if (realIdx >= 0) entries.splice(realIdx, 1);
    lsSet("fin_nw_entries", entries);
    showToast("Snapshot deleted");
    renderAll();
  });
}

// No page-local Add button on the Balances page — the context-aware topbar
// Add button (handler above) opens the NW snapshot modal for both sub-tabs.
document.getElementById("nw-m-cancel").addEventListener("click", closeNWModal);
document.getElementById("nw-m-save").addEventListener("click", saveNWSnapshot);
document.getElementById("nw-modal").addEventListener("click", e => { if (e.target.id === "nw-modal") closeNWModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !document.getElementById("nw-modal").hidden) closeNWModal(); });
// (NW range/bucket controls removed — trend chart no longer on this tab)

