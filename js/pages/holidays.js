/* ════════════════════════════════════════
   HOLIDAYS — planning view: each holiday is a card with line items + per-category subtotals.
   Data shape: { id, name, startDate, endDate, notes, items: [{ id, description, amount, category }] }
   Stored at fin_holidays.
════════════════════════════════════════ */
let _holEditId = null;       // holiday currently being edited via the header modal
let _holItemEditCtx = null;  // { holidayId, itemId? } — context for the line-item modal
const _holExpanded = new Set(); // ids of holidays whose item list is currently expanded

function _holCatMeta(id) {
  // Project expenses now use the app's real transaction categories.
  if (typeof CAT_BY !== "undefined" && CAT_BY[id]) {
    const c = CAT_BY[id];
    return { id, icon: c.icon || (typeof iconFor === "function" ? iconFor(id) : "•"), color: c.color || "var(--ink-3)" };
  }
  // Legacy fallback for any not-yet-migrated holiday categories.
  const legacy = (typeof HOLIDAY_CATEGORIES !== "undefined" ? HOLIDAY_CATEGORIES : []).find(c => c.id === id);
  if (legacy) return legacy;
  return { id, icon: (typeof iconFor === "function" ? iconFor(id) : "•"), color: "var(--ink-3)" };
}

function _holDateRangeLabel(h) {
  const fmt = (s) => s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }) : "";
  if (!h.startDate && !h.endDate) return "Dates not set";
  if (h.startDate && h.endDate)   return `${fmt(h.startDate)} → ${fmt(h.endDate)}`;
  return fmt(h.startDate || h.endDate);
}

function _holDaysUntil(h) {
  if (!h.startDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(h.startDate + "T00:00:00");
  const diff = Math.round((start - today) / 86400000);
  if (diff > 0) return `in ${diff} day${diff===1?'':'s'}`;
  if (h.endDate) {
    const end = new Date(h.endDate + "T00:00:00");
    if (today <= end) return "happening now";
  } else if (diff === 0) return "today";
  return `${-diff} day${diff===-1?'':'s'} ago`;
}

// One-time migration: project expenses used to use a separate HOLIDAY_CATEGORIES
// list. Remap any legacy category to a real transaction category and preserve the
// old value as the sub-label, so existing data maps cleanly to Transactions.
let _holMigrated = false;
const _LEGACY_CAT_MAP = {
  "Food & Drink": "Dining", "Transport": "Transport", "Insurance": "Insurance",
  "Shopping": "Clothing", "Flights": "Holiday", "Accommodation": "Holiday",
  "Activities": "Holiday", "Other": "Holiday",
};
function migrateHolidayItems() {
  if (_holMigrated) return;
  _holMigrated = true;
  const legacyIds = new Set((typeof HOLIDAY_CATEGORIES !== "undefined" ? HOLIDAY_CATEGORIES : []).map(c => c.id));
  const hols = getHolidays();
  let changed = false;
  hols.forEach(h => (h.items || []).forEach(it => {
    const isReal = (typeof CAT_BY !== "undefined") && !!CAT_BY[it.category];
    if (!isReal && legacyIds.has(it.category)) {
      if (!it.subLabel) it.subLabel = it.category;
      it.category = _LEGACY_CAT_MAP[it.category] || "Holiday";
      changed = true;
    }
  }));
  if (changed) setHolidays(hols);
}

// Build a transaction from a project expense and open the Add-transaction modal
// prefilled — the user picks account + date (defaults today) and saves.
function sendHolItemToTx(holId, itemId) {
  const h = getHolidays().find(x => String(x.id) === String(holId)); if (!h) return;
  const it = (h.items || []).find(x => String(x.id) === String(itemId)); if (!it) return;
  const desc = it.subLabel ? `${it.description} (${it.subLabel})` : it.description;
  if (typeof openTxModal === "function") {
    openTxModal(null, "out", { description: desc, amount: it.amount, category: it.category });
  }
}

function renderHolidays() {
  const grid = document.getElementById("proj-grid"); if (!grid) return;
  migrateHolidayItems();
  const holidays = getHolidays();
  const sub = document.getElementById("proj-sub-count");
  if (sub) sub.textContent = holidays.length
    ? `${holidays.length} project${holidays.length===1?'':'s'}`
    : "";
  if (!holidays.length) {
    grid.innerHTML = `<div class="page-stub"><h3>No projects yet</h3><div>Plan anything with multiple costs — a holiday, room furniture, a wedding — by adding expected expenses and watching the subtotals add up.</div></div>`;
    return;
  }
  grid.innerHTML = holidays.map(h => renderHolidayCard(h)).join("");
}

function renderHolidayCard(h) {
  const safeId = String(h.id).replace(/'/g, "\\'");
  const items = h.items || [];
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  // Subtotals by category, preserving the canonical order from HOLIDAY_CATEGORIES.
  const byCat = {};
  items.forEach(it => { byCat[it.category] = (byCat[it.category] || 0) + (Number(it.amount) || 0); });
  const orderedCats = (typeof HOLIDAY_CATEGORIES !== "undefined" ? HOLIDAY_CATEGORIES : []).map(c => c.id).filter(id => id in byCat);
  // Any unknown categories (legacy / edited) get appended at the end.
  Object.keys(byCat).forEach(id => { if (!orderedCats.includes(id)) orderedCats.push(id); });
  const subtotalPills = orderedCats.map(id => {
    const meta = _holCatMeta(id);
    const pct = total > 0 ? (byCat[id] / total * 100).toFixed(0) : 0;
    return `<div class="hol-sub-pill" style="--pill-color:${meta.color}">
      <span class="ic">${meta.icon}</span>
      <div class="info">
        <div class="lab">${id}</div>
        <div class="amt">${fmtGBP(byCat[id], {dp:0})} <small>${pct}%</small></div>
      </div>
    </div>`;
  }).join("");

  const isExpanded = _holExpanded.has(String(h.id));
  const itemRows = items.length
    ? items.map(it => {
        const meta = _holCatMeta(it.category);
        const itemSafe = String(it.id).replace(/'/g, "\\'");
        // Optional flight line — only when category is Flights and we have at least depart/arrive.
        let flightLine = "";
        if (it.flight && (it.flight.depart || it.flight.arrive)) {
          const fmtDT = (s) => {
            if (!s) return "—";
            try {
              const d = new Date(s);
              if (isNaN(d.getTime())) return s;
              return d.toLocaleString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
            } catch { return s; }
          };
          const arrow = (it.flight.depart && it.flight.arrive) ? "→" : "";
          const parts = [];
          if (it.flight.depart) parts.push(fmtDT(it.flight.depart));
          if (arrow) parts.push(arrow);
          if (it.flight.arrive) parts.push(fmtDT(it.flight.arrive));
          if (it.flight.number) parts.push(`· ${it.flight.number.replace(/</g,'&lt;')}`);
          flightLine = `<div class="hol-item-flight">✈ ${parts.join(" ")}</div>`;
        }
        const noteSuffix = it.notes ? ' · ' + (it.notes).replace(/</g,'&lt;') : '';
        // Render a compact link chip (rather than the raw URL) so long booking URLs don't blow up the row.
        let linkChip = "";
        if (it.link) {
          let host = "";
          try { host = new URL(it.link).hostname.replace(/^www\./, ""); } catch { host = "Open link"; }
          const safeUrl = it.link.replace(/"/g, '&quot;');
          linkChip = ` <a class="hol-item-link" href="${safeUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${safeUrl}">↗ ${host.replace(/</g,'&lt;')}</a>`;
        }
        return `<div class="hol-item-row">
          <div class="hol-item-ic" style="background:color-mix(in oklch, ${meta.color} 30%, var(--bg-sunk))">${meta.icon}</div>
          <div>
            <div class="hol-item-desc">${(it.description || "").replace(/</g, "&lt;") || "—"}${it.subLabel ? ` <span class="hol-item-sub">${it.subLabel.replace(/</g,'&lt;')}</span>` : ''}${linkChip}</div>
            <div class="hol-item-cat">${it.category}${noteSuffix}</div>
            ${flightLine}
          </div>
          <div class="hol-item-amt">${fmtGBP(Number(it.amount) || 0, {dp:2})}</div>
          <div class="hol-item-acts">
            <button title="Send to transactions" onclick="sendHolItemToTx('${safeId}','${itemSafe}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg></button>
            <button title="Edit"   onclick="openHolItemModal('${safeId}','${itemSafe}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
            <button title="Delete" class="danger" onclick="deleteHolItem('${safeId}','${itemSafe}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
          </div>
        </div>`;
      }).join("")
    : `<div class="hol-empty">No expenses yet — add your first one below.</div>`;

  const countdown = _holDaysUntil(h);
  return `<div class="hol-card">
    <div class="hol-card-head">
      <div>
        <div class="hol-name">${(h.name || "Untitled").replace(/</g,"&lt;")}</div>
        <div class="hol-meta">${_holDateRangeLabel(h)}${countdown ? ` · ${countdown}` : ''}${h.notes ? ` · ${(h.notes).replace(/</g,"&lt;")}` : ''}</div>
      </div>
      <div class="hol-total">
        <div class="lab">TOTAL EXPECTED</div>
        <div class="amt blur">${fmtGBP(total, {dp:0})}</div>
      </div>
      <div class="hol-card-acts">
        <button title="Edit project"   onclick="openHolModal('${safeId}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button title="Delete project" class="danger" onclick="deleteHoliday('${safeId}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </div>
    </div>
    ${subtotalPills ? `<div class="hol-subtotals">${subtotalPills}</div>` : ''}
    <button class="hol-toggle" onclick="toggleHolExpanded('${safeId}')">
      ${isExpanded ? '▾ Hide expenses' : `▸ Show ${items.length} expense${items.length===1?'':'s'}`}
    </button>
    ${isExpanded ? `<div class="hol-items">${itemRows}</div>
      <div class="hol-add-row">
        <button class="btn-ghost" onclick="openHolItemModal('${safeId}')">+ Add expense</button>
      </div>` : ''}
  </div>`;
}

function toggleHolExpanded(id) {
  const k = String(id);
  if (_holExpanded.has(k)) _holExpanded.delete(k); else _holExpanded.add(k);
  renderHolidays();
}

/* ── Holiday CRUD ── */
function openHolModal(id = null) {
  _holEditId = id;
  const h = id ? getHolidays().find(x => String(x.id) === String(id)) : null;
  document.getElementById("hol-modal-title").textContent = h ? "Edit project" : "New project";
  document.getElementById("hol-m-name").value  = h?.name  || "";
  document.getElementById("hol-m-start").value = h?.startDate || "";
  document.getElementById("hol-m-end").value   = h?.endDate   || "";
  document.getElementById("hol-m-notes").value = h?.notes || "";
  document.getElementById("hol-modal").hidden = false;
  setTimeout(() => document.getElementById("hol-m-name").focus(), 30);
}
function closeHolModal() { document.getElementById("hol-modal").hidden = true; _holEditId = null; }
function saveHoliday() {
  const name  = document.getElementById("hol-m-name").value.trim();
  if (!name) { showToast("Name is required"); return; }
  const startDate = document.getElementById("hol-m-start").value || "";
  const endDate   = document.getElementById("hol-m-end").value || "";
  const notes     = document.getElementById("hol-m-notes").value.trim();
  if (startDate && endDate && endDate < startDate) { showToast("End date is before start date"); return; }
  const holidays = getHolidays();
  if (_holEditId) {
    const idx = holidays.findIndex(h => String(h.id) === String(_holEditId));
    if (idx >= 0) holidays[idx] = { ...holidays[idx], name, startDate, endDate, notes };
  } else {
    holidays.push({ id: Date.now() + Math.floor(Math.random()*100000), name, startDate, endDate, notes, items: [] });
  }
  setHolidays(holidays);
  closeHolModal();
  showToast(_holEditId ? "Holiday updated" : "Holiday added");
  // Auto-expand newly created holiday so the user lands on the empty state ready to add items.
  if (!_holEditId) _holExpanded.add(String(holidays[holidays.length-1].id));
  renderAll();
}
function deleteHoliday(id) {
  const h = getHolidays().find(x => String(x.id) === String(id));
  if (!h) return;
  confirmDialog({
    title: "Delete holiday?",
    message: `Delete "${h.name || 'this holiday'}" and all its line items? This can't be undone.`,
    confirmLabel: "Delete",
    danger: true,
  }, () => {
    setHolidays(getHolidays().filter(x => String(x.id) !== String(id)));
    _holExpanded.delete(String(id));
    showToast("Holiday deleted");
    renderAll();
  });
}

/* ── Line-item CRUD ── */
function openHolItemModal(holidayId, itemId = null) {
  _holItemEditCtx = { holidayId, itemId };
  const h = getHolidays().find(x => String(x.id) === String(holidayId));
  const it = h && itemId ? (h.items || []).find(x => String(x.id) === String(itemId)) : null;
  document.getElementById("hol-item-modal-title").textContent = it ? "Edit expense" : "Add expense";
  document.getElementById("hol-it-desc").value = it?.description || "";
  document.getElementById("hol-it-amt").value  = (it && it.amount !== undefined) ? it.amount : "";
  document.getElementById("hol-it-link").value  = it?.link || "";
  document.getElementById("hol-it-notes").value = it?.notes || "";
  const sel = document.getElementById("hol-it-cat");
  const cats = (typeof getAllCats === "function") ? getAllCats("exp") : [];
  sel.innerHTML = cats.map(c => `<option value="${String(c.id).replace(/"/g,'&quot;')}"${it && it.category === c.id ? ' selected' : ''}>${c.icon || ''} ${c.id}</option>`).join("");
  document.getElementById("hol-it-sublabel").value = it?.subLabel || "";
  // Flight fields — prefill + show/hide based on the sub-type label.
  const flight = (it && it.flight) || {};
  document.getElementById("hol-it-flight-depart").value = flight.depart || "";
  document.getElementById("hol-it-flight-arrive").value = flight.arrive || "";
  document.getElementById("hol-it-flight-number").value = flight.number || "";
  sel.onchange = null;
  document.getElementById("hol-it-sublabel").oninput = _holUpdateFlightFieldsVisibility;
  _holUpdateFlightFieldsVisibility();
  document.getElementById("hol-item-modal").hidden = false;
  setTimeout(() => document.getElementById("hol-it-desc").focus(), 30);
}
function closeHolItemModal() { document.getElementById("hol-item-modal").hidden = true; _holItemEditCtx = null; }
function _holIsFlight() { return (document.getElementById("hol-it-sublabel").value || "").toLowerCase().includes("flight"); }
function _holUpdateFlightFieldsVisibility() {
  document.getElementById("hol-it-flight-fields").style.display = _holIsFlight() ? "" : "none";
}
function saveHolItem() {
  if (!_holItemEditCtx) return;
  const { holidayId, itemId } = _holItemEditCtx;
  const desc   = document.getElementById("hol-it-desc").value.trim();
  const amount = parseFloat(document.getElementById("hol-it-amt").value) || 0;
  const category = document.getElementById("hol-it-cat").value;
  const subLabel = document.getElementById("hol-it-sublabel").value.trim();
  const notes  = document.getElementById("hol-it-notes").value.trim();
  // Normalise the link: auto-prepend https:// if the user typed a bare domain.
  let link = document.getElementById("hol-it-link").value.trim();
  if (link && !/^[a-z][a-z0-9+.\-]*:\/\//i.test(link)) link = "https://" + link;
  // Flight-only metadata. Only persisted when the sub-type mentions a flight AND at least one field is set.
  const isFlight = subLabel.toLowerCase().includes("flight");
  const flightRaw = {
    depart: document.getElementById("hol-it-flight-depart").value || "",
    arrive: document.getElementById("hol-it-flight-arrive").value || "",
    number: document.getElementById("hol-it-flight-number").value.trim(),
  };
  const flight = (isFlight && (flightRaw.depart || flightRaw.arrive || flightRaw.number))
    ? flightRaw : null;
  if (!desc) { showToast("Description is required"); return; }
  if (amount <= 0) { showToast("Amount must be greater than zero"); return; }
  const holidays = getHolidays();
  const h = holidays.find(x => String(x.id) === String(holidayId));
  if (!h) return;
  h.items = h.items || [];
  // Always include link + subLabel in baseFields so that clearing them actually removes the value on edit
  // (otherwise the spread merge would keep the old value). We delete falsy ones below.
  const baseFields = { description: desc, amount, category, subLabel, notes, link };
  if (flight) baseFields.flight = flight; // preserve only when present
  if (itemId) {
    const idx = h.items.findIndex(x => String(x.id) === String(itemId));
    if (idx >= 0) {
      const merged = { ...h.items[idx], ...baseFields };
      if (!isFlight) delete merged.flight;
      if (!merged.link) delete merged.link;
      if (!merged.subLabel) delete merged.subLabel;
      h.items[idx] = merged;
    }
  } else {
    const newItem = { id: Date.now() + Math.floor(Math.random()*100000), ...baseFields };
    if (!newItem.link) delete newItem.link;
    if (!newItem.subLabel) delete newItem.subLabel;
    h.items.push(newItem);
  }
  setHolidays(holidays);
  _holExpanded.add(String(holidayId)); // keep the section open so user sees the saved item
  closeHolItemModal();
  showToast(itemId ? "Expense updated" : "Expense added");
  renderAll();
}
function deleteHolItem(holidayId, itemId) {
  confirmDialog({
    title: "Delete expense?",
    message: "This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
  }, () => {
    const holidays = getHolidays();
    const h = holidays.find(x => String(x.id) === String(holidayId));
    if (!h) return;
    h.items = (h.items || []).filter(x => String(x.id) !== String(itemId));
    setHolidays(holidays);
    showToast("Expense deleted");
    renderAll();
  });
}

/* ── Wire UI ── */
(function wireHolidays() {
  document.getElementById("proj-add-btn")?.addEventListener("click", () => openHolModal(null));
  document.getElementById("hol-m-cancel").addEventListener("click", closeHolModal);
  document.getElementById("hol-m-save").addEventListener("click", saveHoliday);
  document.getElementById("hol-modal").addEventListener("click", e => { if (e.target.id === "hol-modal") closeHolModal(); });
  document.getElementById("hol-it-cancel").addEventListener("click", closeHolItemModal);
  document.getElementById("hol-it-save").addEventListener("click", saveHolItem);
  document.getElementById("hol-item-modal").addEventListener("click", e => { if (e.target.id === "hol-item-modal") closeHolItemModal(); });
})();
