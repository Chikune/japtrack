/* ════════════════════════════════════════
   SETTINGS TAB
════════════════════════════════════════ */
let _setCatType = "exp";

/* ════════════════════════════════════════
   APPEARANCE — DRAFT / SAVE-BAR
   Live preview is preserved (handlers still persist + apply immediately), but we
   snapshot the "last saved" state on Settings entry so the user can Save (commit)
   or Discard (rollback). Navigation guard prompts if dirty.
════════════════════════════════════════ */
const APPR_FIELDS = ["name","currency","avatarDataUrl","accentColor","posColor","negColor","radius","iconVariant","statsStart"];
let _apprSnapshot = null;

function captureApprSnapshot() {
  const s = getSettings();
  _apprSnapshot = {
    theme: localStorage.getItem("ledger_theme") || "light",
    density: localStorage.getItem("ledger_density") || "comfy",
  };
  APPR_FIELDS.forEach(k => { _apprSnapshot[k] = s[k]; });
}

function apprDirty() {
  if (!_apprSnapshot) return false;
  const s = getSettings();
  if ((localStorage.getItem("ledger_theme") || "light") !== _apprSnapshot.theme) return true;
  if ((localStorage.getItem("ledger_density") || "comfy") !== _apprSnapshot.density) return true;
  for (const k of APPR_FIELDS) {
    if ((s[k] ?? null) !== (_apprSnapshot[k] ?? null)) return true;
  }
  return false;
}

function updateApprSaveBar() {
  const bar = document.getElementById("set-appr-savebar");
  if (!bar) return;
  const dirty = apprDirty();
  bar.classList.toggle("is-dirty", dirty);
  document.getElementById("set-appr-save").disabled = !dirty;
  document.getElementById("set-appr-discard").disabled = !dirty;
  document.getElementById("set-appr-status").textContent = dirty ? "Unsaved changes" : "All changes saved";
}

function saveAppr() {
  captureApprSnapshot();
  updateApprSaveBar();
  showToast("Settings saved");
}

// After an import/restore the data is already persisted, so re-baseline the
// Appearance dirty-snapshot. Without this, an import that touches settings makes
// apprDirty() true and the navigation guard falsely prompts "save changes".
function resyncApprAfterImport() {
  if (typeof captureApprSnapshot === "function") captureApprSnapshot();
  if (typeof updateApprSaveBar === "function") updateApprSaveBar();
}

// Lazy capture: returns true if a snapshot was just taken.
// Called in CAPTURE phase before the change handlers persist anything, so the
// snapshot reflects the user's real current state — not stale post-hydration defaults.
function maybeCaptureApprSnapshot() {
  if (_apprSnapshot) return false;
  captureApprSnapshot();
  return true;
}

function discardAppr() {
  if (!_apprSnapshot) return;
  const snap = _apprSnapshot;
  const s = getSettings();
  APPR_FIELDS.forEach(k => {
    if (snap[k] === undefined || snap[k] === null) delete s[k];
    else s[k] = snap[k];
  });
  lsSet("fin_settings", s);
  // Re-apply visuals
  localStorage.setItem("ledger_theme", snap.theme);
  _dark = snap.theme === "dark";
  applyTheme();
  localStorage.setItem("ledger_density", snap.density);
  document.documentElement.dataset.density = snap.density;
  applyAccent(snap.accentColor || null);
  applyPosColor(snap.posColor || null);
  applyNegColor(snap.negColor || null);
  applyRadius(snap.radius);
  applyIconVariant(snap.iconVariant);
  applySidebarProfile();
  if (typeof renderGreeting === "function") renderGreeting();
  if (typeof renderHomeSummary === "function") renderHomeSummary();
  if (typeof renderSettings === "function") renderSettings();
  // Clear snapshot so the next interaction captures the now-fresh baseline.
  _apprSnapshot = null;
  updateApprSaveBar();
  showToast("Changes discarded");
}

// Called by switchPage + settings-tab click before they switch.
// If dirty, prompt; on confirm (discard), do the discard then proceed. Cancel = stay.
function apprNavGuard(onProceed) {
  if (!apprDirty()) { onProceed(); return; }
  confirmDialog({
    title: "Discard unsaved changes?",
    message: "You have unsaved appearance changes. Leaving without saving will revert them.",
    confirmLabel: "Discard & leave",
    cancelLabel: "Stay here",
    danger: true,
  }, () => { discardAppr(); onProceed(); });
}

// Pointer-event-based reorder for any list rendered with `data-drag-idx="N"` and a
// `.drag-handle` element inside each row. Replaces HTML5 drag-and-drop (which is unreliable
// in Tauri's WebView2 when rows contain inputs/toggles/buttons — those steal events).
// `onReorder(fromIdx, toIdx)` fires once on pointerup if the drop landed on a different row.
function wireDraggableList(container, onReorder) {
  if (!container) return;
  container.querySelectorAll(".drag-handle").forEach(handle => {
    const row = handle.closest("[data-drag-idx]");
    if (!row) return;
    handle.style.touchAction = "none";  // stop touch scroll on the handle
    handle.addEventListener("pointerdown", ev => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      const fromIdx = +row.dataset.dragIdx;
      handle.setPointerCapture?.(ev.pointerId);
      row.classList.add("dragging");
      let lastOverRow = null;
      const onMove = e => {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const overRow = target && target.closest("[data-drag-idx]");
        if (overRow !== lastOverRow) {
          if (lastOverRow) lastOverRow.classList.remove("drag-over");
          if (overRow && overRow !== row && container.contains(overRow)) {
            overRow.classList.add("drag-over");
            lastOverRow = overRow;
          } else {
            lastOverRow = null;
          }
        }
      };
      const onUp = e => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        row.classList.remove("dragging");
        if (lastOverRow) lastOverRow.classList.remove("drag-over");
        try { handle.releasePointerCapture?.(ev.pointerId); } catch {}
        if (lastOverRow) {
          const toIdx = +lastOverRow.dataset.dragIdx;
          if (toIdx !== fromIdx) onReorder(fromIdx, toIdx);
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  });
}

const DRAG_HANDLE_SVG = `<span class="drag-handle" title="Drag to reorder"><svg width="11" height="14" viewBox="0 0 11 14" fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="3" cy="7" r="1.4"/><circle cx="3" cy="11" r="1.4"/><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="7" r="1.4"/><circle cx="8" cy="11" r="1.4"/></svg></span>`;

function renderSettings() {
  const s = getSettings();
  const setName = document.getElementById("set-name");      if (setName)     setName.value = s.name || "";
  const setCcy  = document.getElementById("set-currency");  if (setCcy)      setCcy.value  = s.currency || "GBP";
  const setDf   = document.getElementById("set-datefmt");   if (setDf)       setDf.value   = s.dateFormat || "DMY";
  const ws = (s.weekStart == null ? 1 : +s.weekStart);
  document.querySelectorAll("#set-weekstart-seg button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.ws === ws));
  // Avatar preview + emoji input
  const prev = document.getElementById("set-av-preview");
  if (prev) {
    prev.innerHTML = avatarInner();
    prev.style.background = s.avatarDataUrl ? "transparent" : "";
  }
  const theme = localStorage.getItem("ledger_theme") || "light";
  document.querySelectorAll("#set-theme-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.theme === theme));
  const density = localStorage.getItem("ledger_density") || "comfy";
  document.querySelectorAll("#set-density-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.density === density));
  document.documentElement.dataset.density = density;
  // Accent
  const accInp = document.getElementById("set-accent");
  if (accInp) {
    const cur = s.accentColor || "#7fb069";
    accInp.value = cur;
    document.querySelectorAll("#set-accent-presets button").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.color.toLowerCase() === cur.toLowerCase());
    });
  }
  // Positive colour
  const posInp = document.getElementById("set-pos");
  if (posInp) {
    const cur = s.posColor || "#6aaa64";
    posInp.value = cur;
    document.querySelectorAll("#set-pos-presets button").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.color.toLowerCase() === cur.toLowerCase());
    });
  }
  // Negative colour
  const negInp = document.getElementById("set-neg");
  if (negInp) {
    const cur = s.negColor || "#e85a78";
    negInp.value = cur;
    document.querySelectorAll("#set-neg-presets button").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.color.toLowerCase() === cur.toLowerCase());
    });
  }
  // Border radius
  const radInp = document.getElementById("set-radius");
  if (radInp) {
    const cur = s.radius != null ? s.radius : 12;
    radInp.value = cur;
    const radVal = document.getElementById("set-radius-val");
    if (radVal) radVal.textContent = cur + "px";
  }
  // App-icon variant picker
  const ivCur = s.iconVariant || "auto";
  document.querySelectorAll("#set-icon-variant button").forEach(b => {
    b.setAttribute("aria-pressed", b.dataset.variant === ivCur);
  });
  // Stats-start date for dashboard summary cards
  const ssInp = document.getElementById("set-stats-start");
  if (ssInp) {
    const def = defaultStatsStart();
    ssInp.value = s.statsStart || def;
    const hint = document.getElementById("set-stats-start-hint");
    if (hint) hint.textContent = s.statsStart ? "" : `(default: ${ymLabel(def)})`;
  }
  // Refresh export-range bounds from live data
  const dates = getTxns().filter(t => t.date).map(t => t.date).sort();
  if (dates.length) {
    const f = document.getElementById("ie-from"), t = document.getElementById("ie-to");
    if (f && !f.value) f.value = dates[0].slice(0,7);
    if (t && !t.value) t.value = dates[dates.length-1].slice(0,7);
  }
  renderNWMgr();
  renderCatMgr();
  renderAcctMgr();
  if (typeof renderIEList === "function") renderIEList();
  if (typeof _ieWire === "function") _ieWire();
}

function renderCatMgr() {
  const s = getSettings();
  const hidden = new Set(s.hiddenDefaultCats || []);
  // Hide defaults that have been renamed (they live on as promoted customs with the new name).
  const defaults = (_setCatType === "exp" ? DEFAULT_EXP_CATS : DEFAULT_INC_CATS).filter(c => !hidden.has(c.id));
  const customs = (s.customCats || []).filter(c => c.type === _setCatType);
  const allCats = [...defaults, ...customs];
  // Apply persisted custom ordering, if any (s.catOrder = { exp: [ids], inc: [ids] })
  const orderKey = _setCatType;
  const orderArr = ((s.catOrder || {})[orderKey]) || [];
  const ordered  = (() => {
    if (!orderArr.length) return allCats;
    const byId = Object.fromEntries(allCats.map(c => [c.id, c]));
    const seen = new Set();
    const out  = [];
    for (const id of orderArr) if (byId[id]) { out.push(byId[id]); seen.add(id); }
    for (const c of allCats) if (!seen.has(c.id)) out.push(c); // append any new cats not yet ordered
    return out;
  })();
  const enabledKey = _setCatType === "exp" ? "expCats" : "incCats";
  const enabled = new Set(s[enabledKey] || allCats.map(c=>c.id));
  const overrides = s.catEmojis || {};
  const list = document.getElementById("set-cat-list");
  list.innerHTML = ordered.map((c, i) => {
    const on = enabled.has(c.id);
    const customRow = customs.find(cc => cc.id === c.id);
    // Promoted-from-default (renamed) entries are functionally identical to defaults — no CUSTOM badge.
    const isCustom = !!customRow && !customRow._fromDefault;
    const isPromotedDefault = !!(customRow && customRow._fromDefault);
    // Show whatever the dashboard will actually render — including the keyword-guess fallback for customs.
    const icon = overrides[c.id] || c.icon || (typeof guessCatEmoji === "function" ? guessCatEmoji(c.id) : "") || "";
    // Rename is available for both default and custom — defaults are auto-promoted to custom on rename so the change sticks across the app.
    const editBtn = `<button title="Rename" style="width:26px;height:26px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--ink-3);cursor:pointer" onclick="renameAnyCategory('${c.id.replace(/'/g,"\\'")}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>`;
    // Delete is available for every row. Defaults get hidden, customs get removed, promoted-defaults
    // remove the custom entry (the default stays hidden — use audit/orphan flow if you want it back).
    const delBtn = `<button title="Delete" style="width:26px;height:26px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--ink-3);cursor:pointer" onclick="deleteAnyCategory('${c.id.replace(/'/g,"\\'")}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>`;
    return `<div class="cat-mgr-row${isCustom?' custom':''}" data-drag-idx="${i}" style="grid-template-columns:22px 36px 1fr auto auto auto auto;gap:10px">
      ${DRAG_HANDLE_SVG}
      <input type="text" class="emoji-inp" value="${icon||''}" maxlength="2" title="Emoji (or short symbol)" onchange="setCatEmoji('${c.id.replace(/'/g,"\\'")}', this.value)" />
      <div class="name">${c.id}${isCustom?' <small style="font-size:10px;color:var(--accent-ink);font-weight:400;margin-left:6px;text-transform:uppercase;letter-spacing:0.06em">custom</small>':''}</div>
      ${editBtn}
      ${delBtn}
      <span class="toggle-lab">${on?'on':'off'}</span>
      <label class="toggle-switch"><input type="checkbox" ${on?'checked':''} onchange="toggleCatEnabled('${c.id.replace(/'/g,"\\'")}', this.checked)"><span class="slider"></span></label>
    </div>`;
  }).join("") + `
    <div class="set-add-row">
      <button class="btn-ghost" id="set-cat-add">+ Add custom category</button>
    </div>`;
  document.getElementById("set-cat-add").addEventListener("click", () => openCustomCatModal(null));
  if (typeof renderAuditBanner === "function") renderAuditBanner();
  // Drag-to-reorder — persists s.catOrder[type] = [ids]
  wireDraggableList(list, (from, to) => {
    const ids = ordered.map(c => c.id);
    const [m] = ids.splice(from, 1);
    ids.splice(to, 0, m);
    const sNow = getSettings();
    sNow.catOrder = sNow.catOrder || {};
    sNow.catOrder[orderKey] = ids;
    lsSet("fin_settings", sNow);
    rebuildCatBy();
    renderCatMgr();
    renderAll();
  });
}

function toggleCatEnabled(catId, on) {
  const s = getSettings();
  const key = _setCatType === "exp" ? "expCats" : "incCats";
  const allCats = _setCatType === "exp" ? DEFAULT_EXP_CATS : DEFAULT_INC_CATS;
  let enabled = new Set(s[key] || allCats.map(c=>c.id));
  if (on) enabled.add(catId); else enabled.delete(catId);
  s[key] = [...enabled];
  lsSet("fin_settings", s);
  renderCatMgr();
}

function renderNWMgr() {
  const list = document.getElementById("set-nw-list"); if (!list) return;
  // Always rebuild from current settings so the panel reflects truth on every open.
  rebuildNWCats();
  if (!NW_CATS.length) {
    list.innerHTML = `<div style="padding:14px;color:var(--ink-4);font-size:12.5px;background:var(--bg-sunk);border-radius:8px">
      No buckets — add one below or <a style="color:var(--accent-ink);cursor:pointer;text-decoration:underline" onclick="resetNWBuckets()">restore defaults</a>.
    </div>`;
    return;
  }
  // Header row (matches data-row grid)
  const header = `<div class="nw-mgr-row nw-mgr-head">
    <span></span>
    <span></span>
    <span>NAME</span>
    <span>COLOUR</span>
    <span style="text-align:right">ACTIONS</span>
  </div>`;
  list.innerHTML = header + NW_CATS.map((b, i) => {
    const safeName = (b.id || "").replace(/'/g, "\\'");
    const colorVal = /^#[0-9a-fA-F]{6}$/.test(b.color || "") ? b.color : (rgbHexFromAny(b.color) || "#7fb069");
    return `<div class="nw-mgr-row" data-idx="${i}" data-drag-idx="${i}">
      ${DRAG_HANDLE_SVG}
      <div class="swatch" style="background:${b.color || '#888'}"></div>
      <input type="text" value="${(b.id||'').replace(/"/g,'&quot;')}" data-idx="${i}" data-field="name" placeholder="Bucket name" />
      <input type="color" value="${colorVal}" data-idx="${i}" data-field="color" title="Pick colour" />
      <div class="acts">
        <button class="danger" title="Delete bucket" onclick="deleteNWBucket('${safeName}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>
      </div>
    </div>`;
  }).join("");
  // wire inline edits
  list.querySelectorAll('input[data-field="name"]').forEach(inp => {
    inp.addEventListener("change", () => updateNWBucket(+inp.dataset.idx, "name", inp.value.trim()));
  });
  list.querySelectorAll('input[data-field="color"]').forEach(inp => {
    inp.addEventListener("input", () => updateNWBucket(+inp.dataset.idx, "color", inp.value));
  });
  // Drag-to-reorder
  wireDraggableList(list, (from, to) => {
    const [moved] = NW_CATS.splice(from, 1);
    NW_CATS.splice(to, 0, moved);
    persistNWBuckets();
    renderNWMgr();
    renderAll();
  });
}

// Convert any CSS colour (oklch / var() / named) to hex for <input type="color"> compatibility.
function rgbHexFromAny(c) {
  if (!c) return null;
  try {
    const ctx = (rgbHexFromAny._ctx ||= document.createElement("canvas").getContext("2d"));
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    const m = String(ctx.fillStyle).match(/\d+/g);
    return m ? "#" + m.slice(0,3).map(n => Number(n).toString(16).padStart(2,"0")).join("") : null;
  } catch { return null; }
}
function persistNWBuckets() {
  const s = getSettings();
  s.nwBuckets = NW_CATS.slice();
  lsSet("fin_settings", s);
  rebuildNWCats();
  // Keep the unified accounts list in sync — new buckets become accounts immediately.
  if (typeof syncAccountsFromAllSources === "function") syncAccountsFromAllSources();
}
function updateNWBucket(idx, field, value) {
  if (!NW_CATS[idx]) return;
  if (field === "name") {
    if (!value) { showToast("Name can't be empty"); renderNWMgr(); return; }
    if (NW_CATS.some((b, i) => i !== idx && b.id === value)) { showToast("Name already used"); renderNWMgr(); return; }
    const oldName = NW_CATS[idx].id;
    NW_CATS[idx].id = value;
    // Use the unified cascade so transactions, recurring, rules, AND snapshots all rename together.
    if (typeof cascadeAccountRename === "function") cascadeAccountRename(oldName, value);
    else {
      // Fallback: just rename snapshots.
      const entries = getNWEntries();
      entries.forEach(e => e.allocations.forEach(a => { if (a.cat === oldName) a.cat = value; }));
      lsSet("fin_nw_entries", entries);
    }
  } else if (field === "color") {
    NW_CATS[idx].color = value;
  }
  persistNWBuckets();
  renderAll();
}
function addNWBucket() {
  const nameInp = document.getElementById("set-nw-new-name");
  const colInp = document.getElementById("set-nw-new-color");
  const name = nameInp.value.trim();
  if (!name) { showToast("Enter a name"); return; }
  if (NW_CATS.some(b => b.id === name)) { showToast("Already exists"); return; }
  NW_CATS.push({ id: name, color: colInp.value });
  persistNWBuckets();
  nameInp.value = "";
  showToast(`Added "${name}"`);
  renderAll();
}
function deleteNWBucket(name) {
  const entries = getNWEntries();
  const used = entries.some(e => e.allocations.some(a => a.cat === name && a.value > 0));
  const msg = used
    ? `"${name}" has values in your snapshots. Delete anyway? Past values stay in history but won't show.`
    : `Delete "${name}"?`;
  confirmDialog({ title:`Delete bucket?`, message: msg, confirmLabel:"Delete", danger:true }, () => {
    NW_CATS = NW_CATS.filter(b => b.id !== name);
    if (!NW_CATS.length) NW_CATS = DEFAULT_NW_CATS.slice();
    persistNWBuckets();
    showToast("Bucket deleted");
    renderAll();
  });
}
function resetNWBuckets() {
  confirmDialog({ title:"Reset buckets?", message:"Reset to default 5 buckets? Custom names you added will be removed (snapshot data is kept).", confirmLabel:"Reset", danger:true }, () => {
    const s = getSettings();
    delete s.nwBuckets;
    lsSet("fin_settings", s);
    rebuildNWCats();
    showToast("Reset to defaults");
    renderAll();
  });
}

function renderAcctMgr() {
  const s = getSettings();
  const accts = s.accounts || [];
  const list = document.getElementById("set-acct-list");
  if (!list) return;  // Accounts tab removed — Balances page is the account manager now.
  if (!accts.length) {
    list.innerHTML = cardEmpty(`No accounts yet — add one below.`);
    return;
  }
  const emojis = s.acctEmojis || {};
  list.innerHTML = accts.map((a, i) => {
    const emoji = emojis[a] || "";
    const note = (typeof getAcctNote === "function") ? getAcctNote(a) : "";
    return `<div class="acct-mgr-row" data-drag-idx="${i}" style="grid-template-columns:22px 36px 1fr auto;gap:12px">
      ${DRAG_HANDLE_SVG}
      <input type="text" class="emoji-inp" value="${emoji}" maxlength="2" placeholder="${a[0]}" title="Emoji (or short symbol)" onchange="setAcctEmoji('${a.replace(/'/g,"\\'")}', this.value)" />
      <div class="name">${a}${note?`<small style="font-size:11px;color:var(--ink-3);font-weight:400;margin-left:8px">${note.replace(/</g,'&lt;')}</small>`:''}</div>
      <div class="acts">
        <button title="Edit" onclick="openAcctEditModal('${a.replace(/'/g,"\\'")}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button class="danger" title="Delete" onclick="deleteAccount('${a.replace(/'/g,"\\'")}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </div>
    </div>`;
  }).join("");
  // Drag-to-reorder accounts
  wireDraggableList(list, (from, to) => {
    const sNow = getSettings();
    const arr  = (sNow.accounts || []).slice();
    const [m]  = arr.splice(from, 1);
    arr.splice(to, 0, m);
    sNow.accounts = arr;
    lsSet("fin_settings", sNow);
    renderAcctMgr();
    renderAll();
  });
}

function addAccount() {
  const inp = document.getElementById("set-acct-new");
  const name = inp.value.trim();
  if (!name) return;
  const s = getSettings();
  s.accounts = s.accounts || [];
  if (s.accounts.includes(name)) { showToast("Account already exists"); return; }
  s.accounts.push(name);
  lsSet("fin_settings", s);
  inp.value = "";
  renderAcctMgr();
  showToast("Account added");
}

// Wire the account-edit modal once.
(function wireAcctEditModal() {
  const m = document.getElementById("acct-edit-modal");
  if (!m) return;
  document.getElementById("acct-edit-cancel").addEventListener("click", () => closeAcctEditModal());
  document.getElementById("acct-edit-save").addEventListener("click", () => saveAcctEdit());
  m.addEventListener("click", e => { if (e.target.id === "acct-edit-modal") closeAcctEditModal(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && !m.hidden && document.activeElement?.id === "acct-edit-name") { e.preventDefault(); saveAcctEdit(); }
  });
})();

let _acctEditOldName = null;
function openAcctEditModal(name) {
  _acctEditOldName = name;
  document.getElementById("acct-edit-name").value = name;
  document.getElementById("acct-edit-note").value = (typeof getAcctNote === "function") ? getAcctNote(name) : "";
  document.getElementById("acct-edit-modal").hidden = false;
  setTimeout(() => document.getElementById("acct-edit-name").focus(), 30);
}
function closeAcctEditModal() {
  document.getElementById("acct-edit-modal").hidden = true;
  _acctEditOldName = null;
}
function saveAcctEdit() {
  const oldName = _acctEditOldName;
  if (!oldName) { closeAcctEditModal(); return; }
  const newName = document.getElementById("acct-edit-name").value.trim();
  const note    = document.getElementById("acct-edit-note").value;
  if (!newName) { showToast("Name can't be empty"); return; }
  // Rename — same merge / collision logic as the standalone renameAccount.
  const finalize = (resolvedName) => {
    if (typeof setAcctNote === "function") setAcctNote(resolvedName, note);
    closeAcctEditModal();
    renderAcctMgr();
    showToast("Account saved");
    renderAll();
  };
  if (newName === oldName) { finalize(oldName); return; }
  const accts = (typeof getAllAccounts === "function") ? getAllAccounts() : (getSettings().accounts || []);
  const target = accts.find(a => a !== oldName && a.toLowerCase() === newName.toLowerCase());
  if (target) {
    confirmDialog({
      title: "Merge accounts?",
      message: `"${target}" already exists. Merge "${oldName}" into "${target}"? All transactions, scheduled items, merchant rules, and snapshots will move.`,
      confirmLabel: "Merge",
      danger: false,
    }, () => { cascadeAccountRename(oldName, target); finalize(target); });
    return;
  }
  cascadeAccountRename(oldName, newName);
  finalize(newName);
}

function renameAccount(oldName) {
  promptDialog({
    title: "Rename account",
    message: `Rename "${oldName}" — every transaction, scheduled item, and merchant rule using it will update too.`,
    defaultValue: oldName,
    placeholder: "New account name",
    confirmLabel: "Rename",
  }, (raw) => {
    const newName = raw.trim();
    if (!newName || newName === oldName) return;
    // Strict-uniqueness check against the unified account list (settings + NW + observed)
    const accts = (typeof getAllAccounts === "function") ? getAllAccounts() : (getSettings().accounts || []);
    if (accts.some(a => a.toLowerCase() === newName.toLowerCase() && a !== oldName)) {
      showToast(`"${newName}" already exists — pick a different name`);
      return;
    }
    const r = cascadeAccountRename(oldName, newName);
    renderAcctMgr();
    const n = r.txns + r.recurring + r.rules;
    showToast(`Renamed${n ? ` · updated ${n} reference${n===1?'':'s'}` : ''}`);
    renderAll();
  });
}

function deleteAccount(name) {
  confirmDialog({ title:"Delete account?", message:`Delete account "${name}"? Existing transactions will keep the name as a label.`, confirmLabel:"Delete", danger:true }, () => {
    const s = getSettings();
    s.accounts = (s.accounts || []).filter(a => a !== name);
    lsSet("fin_settings", s);
    renderAcctMgr();
    showToast("Account deleted");
  });
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

// Marker written into every full backup so Restore can verify the file
// is genuinely a Japtrack backup before it replaces anything.
const BACKUP_MARKER = "japtrack-backup";

function exportJSON() {
  // Bundled-store export: one object that round-trips losslessly via Store.importAll.
  const data = Store.exportAll();
  const now = new Date();
  data.app = "Japtrack";
  data.backupMarker = BACKUP_MARKER;
  data.schemaVersion = data.version;          // explicit, human-readable
  data.exported_at = now.toISOString();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // japtrack-backup-2026-05-16-142530.json
  const stamp = now.toISOString().slice(0,19).replace(/[:T]/g, "-");
  a.download = `japtrack-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Backup exported");
}

// Decide whether a parsed object is a restorable Japtrack backup.
// Accepts: new marked backups, older bundled exports (version + txns),
// the original app:"ledger" exports, and legacy flat fin_*-keyed dumps.
function isRestorableBackup(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.backupMarker === BACKUP_MARKER) return true;
  if (obj.app === "Japtrack" || obj.app === "ledger") return true;
  if (obj.version !== undefined && Array.isArray(obj.txns)) return true; // bundled format
  if ("fin_txns" in obj || "fin_settings" in obj) return true;           // legacy flat
  return false;
}

/* ── Custom category modal ── */
let _catEditId = null;
let _catModalType = "exp";
function openCustomCatModal(id) {
  _catEditId = id;
  const s = getSettings();
  const existing = id ? (s.customCats || []).find(c => c.id === id) : null;
  document.getElementById("cat-modal-title").textContent = existing ? "Edit custom category" : "Add custom category";
  _catModalType = existing ? existing.type : (_setCatType || "exp");
  document.querySelectorAll("#cat-m-type-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === _catModalType));
  document.getElementById("cat-m-name").value = existing?.id || "";
  document.getElementById("cat-m-icon").value = existing?.icon || "";
  // colour - oklch -> hex round-trip is hard, so just keep last picked or default
  document.getElementById("cat-m-color").value = existing?._hex || "#7fb069";
  document.getElementById("cat-modal").hidden = false;
  setTimeout(() => document.getElementById("cat-m-name").focus(), 50);
}
function closeCustomCatModal() { document.getElementById("cat-modal").hidden = true; _catEditId = null; }
function saveCustomCat() {
  const name = document.getElementById("cat-m-name").value.trim();
  const icon = document.getElementById("cat-m-icon").value.trim() || "•";
  const hex = document.getElementById("cat-m-color").value;
  if (!name) { showToast("Please enter a name"); return; }
  const s = getSettings();
  s.customCats = s.customCats || [];
  // Uniqueness — only block if name conflicts with another non-hidden category
  const hidden = new Set(s.hiddenDefaultCats || []);
  const taken = new Set([
    ...DEFAULT_EXP_CATS.filter(c => !hidden.has(c.id)).map(c => c.id),
    ...DEFAULT_INC_CATS.filter(c => !hidden.has(c.id)).map(c => c.id),
    ...s.customCats.map(c => c.id),
  ]);
  if (name !== _catEditId && taken.has(name)) { showToast(`"${name}" is already taken`); return; }
  // RENAME path — cascade through all data so existing transactions/budgets/etc follow.
  if (_catEditId && _catEditId !== name) {
    cascadeCategoryRename(_catEditId, name);
    // cascade may have inserted a promoted-default custom; fetch fresh settings & merge icon/color.
    const sNow = getSettings();
    sNow.customCats = sNow.customCats || [];
    const idx = sNow.customCats.findIndex(c => c.id === name);
    if (idx >= 0) sNow.customCats[idx] = { ...sNow.customCats[idx], icon, color: hex, _hex: hex, type: _catModalType };
    else sNow.customCats.push({ id: name, icon, color: hex, _hex: hex, type: _catModalType });
    lsSet("fin_settings", sNow);
  } else if (_catEditId) {
    // No rename — just icon/colour/type change on an existing custom.
    const idx = s.customCats.findIndex(c => c.id === _catEditId);
    if (idx >= 0) s.customCats[idx] = { id: name, icon, color: hex, _hex: hex, type: _catModalType };
    else s.customCats.push({ id: name, icon, color: hex, _hex: hex, type: _catModalType });
    lsSet("fin_settings", s);
  } else {
    // Brand-new custom category.
    s.customCats.push({ id: name, icon, color: hex, _hex: hex, type: _catModalType });
    lsSet("fin_settings", s);
  }
  rebuildCatBy();
  closeCustomCatModal();
  showToast(_catEditId ? "Category updated" : "Category added");
  renderAll();
}
function editCustomCat(id) { openCustomCatModal(id); }

/* ════════════════════════════════════════
   DATA INTEGRITY BANNER + MODAL — surfaces orphan / duplicate cats & accounts.
════════════════════════════════════════ */
function renderAuditBanner() {
  const slot = document.getElementById("audit-banner-slot");
  if (!slot) return;
  const issues = auditDataIntegrity();
  if (!issues.total) { slot.innerHTML = ""; return; }
  const parts = [];
  if (issues.uncategorised > 0)  parts.push(`${issues.uncategorised} uncategorised txn${issues.uncategorised===1?'':'s'}`);
  if (issues.orphanCats.length)  parts.push(`${issues.orphanCats.length} orphan categor${issues.orphanCats.length===1?'y':'ies'}`);
  if (issues.orphanAccts.length) parts.push(`${issues.orphanAccts.length} orphan account${issues.orphanAccts.length===1?'':'s'}`);
  if (issues.dupCats.length)     parts.push(`${issues.dupCats.length} duplicate categor${issues.dupCats.length===1?'y':'ies'}`);
  if (issues.dupAccts.length)    parts.push(`${issues.dupAccts.length} duplicate account${issues.dupAccts.length===1?'':'s'}`);
  if (issues.warningCount)       parts.push(`${issues.warningCount} warning${issues.warningCount===1?'':'s'}`);
  slot.innerHTML = `<div class="audit-banner">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
    <span><b>Data integrity</b> · ${parts.join(' · ')}</span>
    <button onclick="openAuditModal()">Review</button>
  </div>`;
}

function openAuditModal() {
  renderAuditModal();
  document.getElementById("audit-modal").hidden = false;
}
function closeAuditModal() {
  document.getElementById("audit-modal").hidden = true;
  renderAuditBanner();
  if (typeof renderCatMgr === "function") renderCatMgr();
  if (typeof renderAcctMgr === "function") renderAcctMgr();
  renderAll();
}

function renderAuditModal() {
  const issues = auditDataIntegrity();
  document.getElementById("audit-summary").textContent = issues.total
    ? `${issues.total} issue${issues.total===1?'':'s'} found. Pick a target name for each and we'll cascade the rename through every transaction, budget, scheduled item, and merchant rule.`
    : `No issues found — your categories and accounts are clean.`;
  const body = document.getElementById("audit-body");
  if (!issues.total) { body.innerHTML = `<div class="audit-empty">🎉 Everything looks consistent.</div>`; return; }

  const expCats = (typeof getAllCats === "function") ? getAllCats("exp").map(c => c.id) : [];
  const incCats = (typeof getAllCats === "function") ? getAllCats("in").map(c => c.id) : [];
  // Unified accounts list — settings.accounts ∪ NW buckets ∪ observed-in-txns.
  const accts = (typeof getAllAccounts === "function") ? getAllAccounts() : (getSettings().accounts || []);
  // Build a category <select> with non-selectable headings for Expense / Income groups,
  // plus a leading "+ Add as new category" option and "Convert to transfer" for type changes.
  const catOptions = (selected = null) => {
    const opt = (v, label) => `<option value="${String(v).replace(/"/g,'&quot;')}"${selected===v?' selected':''}>${label}</option>`;
    return [
      `<option value="__add__">+ Add as new category</option>`,
      `<option value="__transfer__">↔ Convert to transfer (type change)</option>`,
      expCats.length ? `<optgroup label="── Expense ──">${expCats.map(c => opt(c, c)).join("")}</optgroup>` : "",
      incCats.length ? `<optgroup label="── Income ──">${incCats.map(c => opt(c, c)).join("")}</optgroup>` : "",
    ].join("");
  };

  const section = (title, html) => `<div class="audit-section"><h4>${title}</h4>${html}</div>`;

  let out = "";
  // Wrap helper: produces issue row + collapsible per-transaction detail panel.
  const issueWrap = ({ kind, key, dataAttr, body, primaryBtn }) => `
    <div class="audit-issue-wrap" data-detail-kind="${kind}" data-detail-key="${(key||'').replace(/"/g,'&quot;')}">
      <div class="audit-issue" ${dataAttr || ''}>
        ${body}
        ${primaryBtn}
        <button class="audit-expand" onclick="toggleAuditDetail(this)" title="View transactions">▸</button>
      </div>
      <div class="audit-detail" hidden></div>
    </div>`;

  if (issues.uncategorised > 0) {
    out += section("Uncategorised transactions", issueWrap({
      kind: "uncat", key: "",
      dataAttr: 'data-uncat',
      body: `<span class="audit-name">No category set</span>
        <span class="audit-count">${issues.uncategorised} txn${issues.uncategorised===1?'':'s'}</span>
        <select>${catOptions()}</select>`,
      primaryBtn: `<button class="primary" onclick="resolveAuditUncategorised(this)">Apply to all</button>`,
    }));
  }

  if (issues.dupCats.length) {
    out += section("Duplicate categories (case-insensitive)", issues.dupCats.map(group => {
      const names = group.map(g => g.name);
      const counts = group.map(g => `${g.name} (${g.count})`).join(", ");
      const opts = names.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join("");
      const key = names.join("|");
      return issueWrap({
        kind: "dup-cat", key,
        dataAttr: `data-dup-cat="${key.replace(/"/g,'&quot;')}"`,
        body: `<span class="audit-name" title="${counts}">${names.join(' · ')}</span>
          <span class="audit-count">${group.reduce((s,g)=>s+g.count,0)} uses</span>
          <select>${opts}</select>`,
        primaryBtn: `<button class="primary" onclick="resolveAuditDupCat(this)">Merge</button>`,
      });
    }).join(""));
  }

  if (issues.dupAccts.length) {
    out += section("Duplicate accounts (case-insensitive)", issues.dupAccts.map(group => {
      const names = group.map(g => g.name);
      const counts = group.map(g => `${g.name} (${g.count})`).join(", ");
      const opts = names.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join("");
      const key = names.join("|");
      return issueWrap({
        kind: "dup-acct", key,
        dataAttr: `data-dup-acct="${key.replace(/"/g,'&quot;')}"`,
        body: `<span class="audit-name" title="${counts}">${names.join(' · ')}</span>
          <span class="audit-count">${group.reduce((s,g)=>s+g.count,0)} uses</span>
          <select>${opts}</select>`,
        primaryBtn: `<button class="primary" onclick="resolveAuditDupAcct(this)">Merge</button>`,
      });
    }).join(""));
  }

  if (issues.orphanCats.length) {
    out += section("Orphan categories — used by transactions but not in your category list", issues.orphanCats.map(o => {
      return issueWrap({
        kind: "orphan-cat", key: o.name,
        dataAttr: `data-orphan-cat="${o.name.replace(/"/g,'&quot;')}"`,
        body: `<span class="audit-name">${o.name}</span>
          <span class="audit-count">${o.count} use${o.count===1?'':'s'}</span>
          <select>${catOptions()}</select>`,
        primaryBtn: `<button class="primary" onclick="resolveAuditOrphanCat(this)">Apply</button>`,
      });
    }).join(""));
  }

  if (issues.orphanAccts.length) {
    const targetOpts = ["__add__", ...accts];
    out += section("Orphan accounts — used by transactions but not in your accounts list", issues.orphanAccts.map(o => {
      const opts = targetOpts.map(t => `<option value="${t.replace(/"/g,'&quot;')}">${t === "__add__" ? "+ Add as new account" : t}</option>`).join("");
      return issueWrap({
        kind: "orphan-acct", key: o.name,
        dataAttr: `data-orphan-acct="${o.name.replace(/"/g,'&quot;')}"`,
        body: `<span class="audit-name">${o.name}</span>
          <span class="audit-count">${o.count} use${o.count===1?'':'s'}</span>
          <select>${opts}</select>`,
        primaryBtn: `<button class="primary" onclick="resolveAuditOrphanAcct(this)">Apply</button>`,
      });
    }).join(""));
  }

  if (issues.warnings && issues.warnings.length) {
    out += section("Warnings — review these manually", `<ul class="audit-warnlist">${
      issues.warnings.map(w => `<li>${w}</li>`).join("")
    }</ul><div class="audit-warnnote">These aren't auto-fixable. Open the relevant page (Budgets, Goals, Scheduled, Net worth, Transactions) to correct them.</div>`);
  }

  body.innerHTML = out;
}

// Toggle the per-transaction detail panel under an issue row.
function toggleAuditDetail(btn) {
  const wrap = btn.closest(".audit-issue-wrap");
  const detail = wrap.querySelector(".audit-detail");
  if (detail.hidden) {
    detail.innerHTML = renderAuditDetail(wrap.dataset.detailKind, wrap.dataset.detailKey);
    detail.hidden = false;
    wrap.classList.add("expanded");
    btn.textContent = "▾";
  } else {
    detail.hidden = true;
    wrap.classList.remove("expanded");
    btn.textContent = "▸";
  }
}

function renderAuditDetail(kind, key) {
  const txns = getTxns();
  const expCats = getAllCats("exp").map(c => c.id);
  const incCats = getAllCats("in").map(c => c.id);
  const accts   = (getSettings().accounts || []);
  // Filter transactions relevant to this issue
  let matching = [];
  if (kind === "uncat") matching = txns.filter(t => (t.type === "in" || t.type === "out") && !t.category);
  else if (kind === "orphan-cat") matching = txns.filter(t => t.category === key);
  else if (kind === "dup-cat")    matching = txns.filter(t => (key.split("|")).includes(t.category));
  else if (kind === "orphan-acct") matching = txns.filter(t => t.account === key || t.fromAccount === key || t.toAccount === key);
  else if (kind === "dup-acct") {
    const names = new Set(key.split("|"));
    matching = txns.filter(t => names.has(t.account) || names.has(t.fromAccount) || names.has(t.toAccount));
  }
  if (!matching.length) return `<div class="audit-detail-row"><div class="ad-empty">No transactions found.</div></div>`;
  matching.sort((a,b) => (a.date||"") > (b.date||"") ? -1 : 1);
  // Show at most ~50 most-recent — anything more becomes a wall of text.
  const showLimit = 50;
  const shown = matching.slice(0, showLimit);
  const isAcctIssue = kind === "orphan-acct" || kind === "dup-acct";
  const rows = shown.map(t => {
    const dt = (t.date || "").slice(0, 10);
    const desc = (t.description || "").replace(/</g, "&lt;").slice(0, 60) || "—";
    const sign = t.type === "in" ? "+" : t.type === "out" ? "−" : "↔";
    const amt = `${sign}${fmtGBP(Math.abs(t.amount||0), {dp:2}).replace(/^[£+\-]+/, "")}`;
    let sel;
    if (isAcctIssue) {
      // Account select: show all known accounts; default to current value of whichever field matches.
      const cur = (t.fromAccount && (kind === "orphan-acct" ? t.fromAccount === key : (key.split("|")).includes(t.fromAccount))) ? t.fromAccount
                : (t.toAccount   && (kind === "orphan-acct" ? t.toAccount   === key : (key.split("|")).includes(t.toAccount)))   ? t.toAccount
                : t.account;
      const opts = accts.map(a => `<option value="${a.replace(/"/g,'&quot;')}"${a===cur?' selected':''}>${a}</option>`).join("");
      sel = `<select>${opts}</select>`;
    } else {
      const cur = t.category || "";
      const isIn = t.type === "in";
      const cats = isIn ? incCats : expCats;
      // Use the same grouped style as the resolver dropdowns
      const expOpts = expCats.map(c => `<option value="${c.replace(/"/g,'&quot;')}"${c===cur?' selected':''}>${c}</option>`).join("");
      const incOpts = incCats.map(c => `<option value="${c.replace(/"/g,'&quot;')}"${c===cur?' selected':''}>${c}</option>`).join("");
      sel = `<select>${expOpts ? `<optgroup label="── Expense ──">${expOpts}</optgroup>` : ""}${incOpts ? `<optgroup label="── Income ──">${incOpts}</optgroup>` : ""}</select>`;
    }
    return `<div class="audit-detail-row" data-tx-id="${String(t.id).replace(/"/g,'&quot;')}">
      <span class="ad-date">${dt}</span>
      <span class="ad-desc" title="${desc}">${desc}</span>
      <span class="ad-amt ${t.type||'out'}">${amt}</span>
      ${sel}
      <button onclick="applyAuditTxnEdit(this, '${kind}', '${key.replace(/'/g,"\\'")}')">Save</button>
    </div>`;
  }).join("");
  const overflowNote = matching.length > showLimit
    ? `<div class="audit-detail-row"><div class="ad-empty">+ ${matching.length - showLimit} more — use the bulk action above to fix them all at once.</div></div>`
    : "";
  return rows + overflowNote;
}

// Apply a single-transaction edit from the detail panel.
function applyAuditTxnEdit(btn, kind, key) {
  const row = btn.closest(".audit-detail-row");
  const id = row.dataset.txId;
  const newVal = row.querySelector("select").value;
  const txns = getTxns();
  const t = txns.find(x => String(x.id) === String(id));
  if (!t) { showToast("Transaction not found"); return; }
  if (kind === "orphan-acct" || kind === "dup-acct") {
    const names = new Set(kind === "orphan-acct" ? [key] : key.split("|"));
    if (t.account     && names.has(t.account))     t.account = newVal;
    if (t.fromAccount && names.has(t.fromAccount)) t.fromAccount = newVal;
    if (t.toAccount   && names.has(t.toAccount))   t.toAccount = newVal;
  } else {
    t.category = newVal;
  }
  lsSet("fin_txns", txns);
  showToast("Transaction updated");
  // Refresh the modal so counts + lists reflect the change.
  renderAuditModal();
  renderAll();
}

function resolveAuditDupCat(btn) {
  const row = btn.closest("[data-dup-cat]");
  const names = row.dataset.dupCat.split("|");
  const canonical = row.querySelector("select").value;
  names.forEach(n => { if (n !== canonical) cascadeCategoryRename(n, canonical); });
  showToast(`Merged into "${canonical}"`);
  renderAuditModal();
}
function resolveAuditDupAcct(btn) {
  const row = btn.closest("[data-dup-acct]");
  const names = row.dataset.dupAcct.split("|");
  const canonical = row.querySelector("select").value;
  names.forEach(n => { if (n !== canonical) cascadeAccountRename(n, canonical); });
  showToast(`Merged into "${canonical}"`);
  renderAuditModal();
}
function resolveAuditUncategorised(btn) {
  const row = btn.closest("[data-uncat]");
  const choice = row.querySelector("select").value;
  if (choice === "__add__") {
    // Prompt for a new category name, then create + apply.
    promptDialog({
      title: "New category",
      message: "Name the category to use for all uncategorised transactions.",
      placeholder: "e.g. Uncategorised",
      confirmLabel: "Create & apply",
    }, (name) => {
      const id = name.trim();
      if (!id) return;
      const s = getSettings();
      s.customCats = s.customCats || [];
      if (!s.customCats.some(c => c.id === id)) {
        s.customCats.push({ id, icon: "•", color: "oklch(70% 0.04 250)", _hex: "#7fb069", type: "exp" });
        lsSet("fin_settings", s);
        rebuildCatBy();
      }
      const txns = getTxns();
      let n = 0;
      txns.forEach(t => { if ((t.type === "in" || t.type === "out") && !t.category) { t.category = id; n++; } });
      lsSet("fin_txns", txns);
      showToast(`Assigned ${n} txn${n===1?'':'s'} → "${id}"`);
      renderAuditModal();
    });
    return;
  }
  const txns = getTxns();
  let n = 0;
  txns.forEach(t => { if ((t.type === "in" || t.type === "out") && !t.category) { t.category = choice; n++; } });
  lsSet("fin_txns", txns);
  showToast(`Assigned ${n} txn${n===1?'':'s'} → "${choice}"`);
  renderAuditModal();
}

function resolveAuditOrphanCat(btn) {
  const row = btn.closest("[data-orphan-cat]");
  const orphan = row.dataset.orphanCat;
  const choice = row.querySelector("select").value;
  if (choice === "__add__") {
    const s = getSettings();
    s.customCats = s.customCats || [];
    if (!s.customCats.some(c => c.id === orphan)) {
      s.customCats.push({ id: orphan, icon: "•", color: "oklch(70% 0.04 250)", _hex: "#7fb069", type: "exp" });
      lsSet("fin_settings", s);
      rebuildCatBy();
    }
    showToast(`Added "${orphan}" as a custom category`);
  } else if (choice === "__transfer__") {
    // Convert all txns with this orphan category into transfer-type transactions.
    // The current `account` becomes fromAccount; toAccount is inferred from the description
    // when it case-insensitively matches a known account, otherwise the user is asked once.
    convertOrphanCatToTransfers(orphan);
    return; // convertOrphanCatToTransfers will re-render when done
  } else {
    cascadeCategoryRename(orphan, choice);
    showToast(`Renamed "${orphan}" → "${choice}"`);
  }
  renderAuditModal();
}

function convertOrphanCatToTransfers(orphan) {
  const txns = getTxns();
  const matching = txns.filter(t => t.category === orphan);
  if (!matching.length) { showToast("No transactions to convert"); return; }
  const accts = (typeof getAllAccounts === "function") ? getAllAccounts() : (getSettings().accounts || []);
  // Try to infer the destination account from each txn's description (case-insensitive substring).
  const inferToAccount = (desc) => {
    const up = (desc || "").toUpperCase();
    return accts.find(a => a && up.includes(a.toUpperCase())) || null;
  };
  const needsManualTo = matching.filter(t => !inferToAccount(t.description));
  const applyConversion = (manualToAccount) => {
    let n = 0;
    matching.forEach(t => {
      const inferred = inferToAccount(t.description);
      const toAcct = inferred || manualToAccount;
      if (!toAcct) return;
      t.type = "transfer";
      t.fromAccount = t.account || manualToAccount || toAcct;
      t.toAccount = toAcct;
      delete t.category;
      delete t.account;
      n++;
    });
    lsSet("fin_txns", txns);
    showToast(`Converted ${n} txn${n===1?'':'s'} → transfer`);
    renderAuditModal();
    renderAll();
  };
  if (needsManualTo.length) {
    // Build a dropdown for the user to pick a destination account, embedded in a prompt-style modal.
    const opts = accts.map(a => `<option value="${a.replace(/"/g,'&quot;')}">${a}</option>`).join("");
    // Reuse promptDialog-style flow: open the existing prompt modal, replace its input with a select.
    const m = document.getElementById("prompt-modal");
    if (!m) { applyConversion(accts[0] || null); return; }
    document.getElementById("prompt-title").textContent = "Pick destination account";
    document.getElementById("prompt-msg").textContent = `${needsManualTo.length} txn${needsManualTo.length===1?'':'s'} need a destination account (couldn't be inferred from descriptions). All converted transfers will land in this account.`;
    const inp = document.getElementById("prompt-input");
    const sel = document.createElement("select");
    sel.id = "prompt-input"; // takes over the id so the existing OK handler reads .value
    sel.style.cssText = inp.style.cssText;
    sel.innerHTML = opts;
    inp.replaceWith(sel);
    const ok = document.getElementById("prompt-ok");
    const cancel = document.getElementById("prompt-cancel");
    ok.textContent = "Convert all";
    m.hidden = false;
    const restore = () => {
      // Restore an <input> in place of the <select> so subsequent promptDialog calls work.
      const restoredInput = document.createElement("input");
      restoredInput.type = "text"; restoredInput.id = "prompt-input";
      restoredInput.style.cssText = sel.style.cssText;
      sel.replaceWith(restoredInput);
      m.hidden = true;
      ok.onclick = null; cancel.onclick = null;
    };
    ok.onclick = () => { const v = sel.value; restore(); applyConversion(v); };
    cancel.onclick = restore;
  } else {
    applyConversion(null);
  }
}
function resolveAuditOrphanAcct(btn) {
  const row = btn.closest("[data-orphan-acct]");
  const orphan = row.dataset.orphanAcct;
  const choice = row.querySelector("select").value;
  if (choice === "__add__") {
    const s = getSettings();
    s.accounts = s.accounts || [];
    if (!s.accounts.includes(orphan)) { s.accounts.push(orphan); lsSet("fin_settings", s); }
    showToast(`Added "${orphan}" as an account`);
  } else {
    cascadeAccountRename(orphan, choice);
    showToast(`Renamed "${orphan}" → "${choice}"`);
  }
  renderAuditModal();
}

// Auto-prompt: if integrity issues are found, surface the modal once at app boot.
function maybePromptAudit() {
  const lastPrompted = lsGet("ledger_audit_prompted", null);
  const issues = auditDataIntegrity();
  if (!issues.total) return;
  // Re-prompt only if the issue count changed since last dismissal.
  if (lastPrompted && lastPrompted.total === issues.total) return;
  lsSet("ledger_audit_prompted", { total: issues.total, at: new Date().toISOString() });
  confirmDialog({
    title: "Data inconsistencies detected",
    message: `Found ${issues.total} issue${issues.total===1?'':'s'} across your data (orphan or duplicate categories / accounts). Review now?`,
    confirmLabel: "Review",
    cancelLabel: "Later",
    danger: false,
  }, () => openAuditModal());
}

// Wire close + auto-render banner
(function wireAudit() {
  const closeBtn = document.getElementById("audit-close");
  if (closeBtn) closeBtn.addEventListener("click", closeAuditModal);
  const modal = document.getElementById("audit-modal");
  if (modal) modal.addEventListener("click", e => { if (e.target.id === "audit-modal") closeAuditModal(); });
  renderAuditBanner();
  // Defer until file hydration likely settled
  setTimeout(maybePromptAudit, 1500);
})();

// Rename ANY category (default or custom). Uses promptDialog + cascade.
function renameAnyCategory(oldName) {
  promptDialog({
    title: "Rename category",
    message: `Rename "${oldName}" — every transaction, budget, scheduled item, forecast, and merchant rule using it will update too.`,
    defaultValue: oldName,
    placeholder: "New category name",
    confirmLabel: "Rename",
  }, (raw) => {
    const newName = raw.trim();
    if (!newName || newName === oldName) return;
    const s = getSettings();
    const hidden = new Set(s.hiddenDefaultCats || []);
    const visible = [
      ...DEFAULT_EXP_CATS.filter(c => !hidden.has(c.id)).map(c => c.id),
      ...DEFAULT_INC_CATS.filter(c => !hidden.has(c.id)).map(c => c.id),
      ...(s.customCats || []).map(c => c.id),
    ];
    // Exact case-sensitive match (different from oldName) → ask to merge instead of reject.
    const exact = visible.find(n => n === newName && n !== oldName);
    // Case-insensitive but different casing → also offer merge with the existing casing.
    const ci = visible.find(n => n !== oldName && n !== newName && n.toLowerCase() === newName.toLowerCase());
    const target = exact || ci;
    const finalize = (mergeInto) => {
      const r = cascadeCategoryRename(oldName, mergeInto);
      renderCatMgr();
      const n = r.txns + r.recurring + r.budgets + r.forecast + r.rules;
      showToast(`${mergeInto === newName ? 'Renamed' : `Merged into "${mergeInto}"`}${n ? ` · updated ${n} reference${n===1?'':'s'}` : ''}`);
      renderAll();
    };
    if (target) {
      confirmDialog({
        title: "Merge categories?",
        message: `"${target}" already exists. Merge "${oldName}" into "${target}"? All transactions, budgets, scheduled items, forecasts, and rules will move to "${target}".`,
        confirmLabel: "Merge",
        cancelLabel: "Cancel",
        danger: false,
      }, () => finalize(target));
      return;
    }
    finalize(newName);
  });
}
function deleteCustomCat(id) { deleteAnyCategory(id); }

// Delete any category — default, custom, or promoted default. Surfaces a usage warning when applicable.
function deleteAnyCategory(id) {
  const usage = getTxns().filter(t => t.category === id).length
              + lsGet("fin_recurring", []).filter(r => r.category === id).length
              + getBudgets().filter(b => b.id === id || b.category === id).length;
  const usageMsg = usage
    ? `${usage} item${usage===1?'':'s'} reference this category — they'll keep the "${id}" label and show up as an orphan you can re-assign from the data integrity audit.`
    : `No transactions use this category.`;
  confirmDialog({
    title: `Delete "${id}"?`,
    message: usageMsg,
    confirmLabel: "Delete",
    danger: true,
  }, () => {
    const s = getSettings();
    const isCustom = (s.customCats || []).some(c => c.id === id);
    const isDefault = [...DEFAULT_EXP_CATS, ...DEFAULT_INC_CATS].some(c => c.id === id);
    if (isCustom) {
      s.customCats = (s.customCats || []).filter(c => c.id !== id);
    }
    if (isDefault) {
      s.hiddenDefaultCats = [...new Set([...(s.hiddenDefaultCats || []), id])];
    }
    lsSet("fin_settings", s);
    rebuildCatBy();
    if (typeof renderCatMgr === "function") renderCatMgr();
    showToast(usage ? `Deleted · ${usage} orphan${usage===1?'':'s'} flagged` : "Category deleted");
    renderAll();
  });
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i+1];
    if (inQ) {
      if (c === '"' && n === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ""; }
      else if (c === '\n' || c === '\r') {
        if (cell || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; }
        if (c === '\r' && n === '\n') i++;
      } else cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function mapCSVHeader(h) {
  const k = (h||"").toLowerCase().trim();
  if (/(^|\b)(date|posted|when|transaction\s*date)(\b|$)/.test(k)) return "date";
  if (/(^|\b)(amount|value|debit|credit|gbp|£)(\b|$)/.test(k)) return "amount";
  if (/(^|\b)(description|merchant|payee|memo|details|narrative|name)(\b|$)/.test(k)) return "description";
  if (/(^|\b)(category|tag|cat)(\b|$)/.test(k)) return "category";
  if (/(^|\b)(account)(\b|$)/.test(k) && !/from|to|destination|source/.test(k)) return "account";
  if (/(^|\b)(type)(\b|$)/.test(k)) return "type";
  if (/(^|\b)(to|destination)(\b|$)/.test(k)) return "toAccount";
  if (/(^|\b)(from|source)(\b|$)/.test(k)) return "fromAccount";
  if (/(^|\b)(notes?|annotation|comment|remarks?)(\b|$)/.test(k)) return "notes";
  return null;
}
function parseImportDate(s) {
  if (!s) return null;
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  let m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let [_, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y) < 50 ? "20" : "19") + y;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return null;
}
/* ════════════════════════════════════════
   BANK STATEMENT IMPORTER
   - Parses Santander HTML/.xls and generic CSV
   - Cleans noisy descriptions ("CARD PAYMENT TO X ON dd-mm-yyyy" → "X")
   - Canonicalises known merchants (Trading 212, Klarna, Uber…) + guesses categories
   - Opens a review modal so the user can edit/exclude rows before commit
════════════════════════════════════════ */

// Strip Santander wrappers to find the merchant. Order matters — more specific first.
const BANK_NOISE_RULES = [
  // "BILL PAYMENT VIA FASTER PAYMENT TO <X> REFERENCE <Y> , MANDATE NO ..."
  { re: /^BILL PAYMENT(?:\s+VIA FASTER PAYMENT)?\s+TO\s+(.+?)\s+REFERENCE\s+(.+?)\s*,?\s*MANDATE NO\b/i, fmt: (m) => `${m[1].trim()} (${m[2].trim()})` },
  // "FASTER PAYMENTS RECEIPT REF.<X> FROM <Y>"
  { re: /^FASTER PAYMENTS RECEIPT REF\.(.+?)\s+FROM\s+(.+)$/i, fmt: (m) => `${m[2].trim()} (${m[1].trim()})` },
  // "STANDING ORDER (VIA FASTER PAYMENT) TO <X> REFERENCE <Y>"
  { re: /^STANDING ORDER(?:\s+VIA FASTER PAYMENT)?\s+TO\s+(.+?)(?:\s+REFERENCE|\s*$)/i, fmt: (m) => m[1].trim() },
  // "DIRECT DEBIT PAYMENT TO <X> REF <Y>"
  { re: /^DIRECT DEBIT PAYMENT TO\s+(.+?)(?:\s+REF\b|\s*,|\s*$)/i, fmt: (m) => m[1].trim() },
  // "CARD PAYMENT TO <X> ON dd-mm-yyyy"
  { re: /^CARD PAYMENT TO\s+(.+?)\s+ON\s+\d{2}-\d{2}-\d{4}/i, fmt: (m) => m[1].trim() },
  // "<X> (VIA APPLE PAY), ON dd-mm-yyyy" / "<X> (VIA GOOGLE PAY)…"
  { re: /^(.+?)\s+\(VIA (?:APPLE|GOOGLE) PAY\),?\s*ON\s+\d{2}-\d{2}-\d{4}/i, fmt: (m) => m[1].trim() },
  // Trailing " ON dd-mm-yyyy" without a card-payment prefix
  { re: /^(.+?)\s+ON\s+\d{2}-\d{2}-\d{4}\s*$/i, fmt: (m) => m[1].trim() },
];

// Canonical merchant rules: regex → { name, cat, defaultType? }.
// `defaultType: "transfer"` flags merchants that are typically account-to-account moves
// (investments, other banks). User can still override per row.
const MERCHANT_RULES = [
  // Investments / transfers (default to transfer — money moves, not spent)
  { re: /TRADING\s*212/i,                  name: "Trading 212",    cat: "Savings", defaultType: "transfer" },
  { re: /\bREVOLUT\b/i,                    name: "Revolut",        cat: "Misc",    defaultType: "transfer" },
  { re: /\bMONZO\b/i,                      name: "Monzo",          cat: "Misc",    defaultType: "transfer" },
  { re: /\bSTARLING\b/i,                   name: "Starling",       cat: "Misc",    defaultType: "transfer" },
  { re: /\bWISE\b|TRANSFERWISE/i,          name: "Wise",           cat: "Misc",    defaultType: "transfer" },
  // BNPL / repayments
  { re: /KLARNA/i,                         name: "Klarna",         cat: "Repayments" },
  { re: /CLEARPAY/i,                       name: "Clearpay",       cat: "Repayments" },
  { re: /AFTERPAY/i,                       name: "Afterpay",       cat: "Repayments" },
  { re: /PAYPAL/i,                         name: "PayPal",         cat: "Misc" },
  // Subscriptions
  { re: /SPOTIFY/i,                        name: "Spotify",        cat: "Subscriptions" },
  { re: /NETFLIX/i,                        name: "Netflix",        cat: "Subscriptions" },
  { re: /DISNEY\s*\+|DISNEYPLUS/i,         name: "Disney+",        cat: "Subscriptions" },
  { re: /YOUTUBE/i,                        name: "YouTube",        cat: "Subscriptions" },
  { re: /APPLE\.COM|ICLOUD|ITUNES/i,       name: "Apple",          cat: "Subscriptions" },
  { re: /GOOGLE\s*\*|GOOGLE PAYMENT/i,     name: "Google",         cat: "Subscriptions" },
  { re: /AMAZON PRIME/i,                   name: "Amazon Prime",   cat: "Subscriptions" },
  { re: /CHATGPT|OPENAI/i,                 name: "OpenAI",         cat: "Subscriptions" },
  { re: /CLAUDE\.AI|ANTHROPIC/i,           name: "Anthropic",      cat: "Subscriptions" },
  { re: /\bNOW TV\b/i,                     name: "NOW TV",         cat: "Subscriptions" },
  // Transport
  { re: /UBER\s*EATS/i,                    name: "Uber Eats",      cat: "Dining" },
  { re: /\bUBER\b/i,                       name: "Uber",           cat: "Transport" },
  { re: /\bBOLT\b/i,                       name: "Bolt",           cat: "Transport" },
  { re: /TFL\.GOV|TFL TRAVEL|TRANSPORT FOR LONDON/i, name: "TfL",  cat: "Transport" },
  { re: /TRAINLINE/i,                      name: "Trainline",      cat: "Transport" },
  { re: /\bBP\b|SHELL|ESSO|TEXACO|TOTAL ENERGIES/i, name: "Petrol", cat: "Transport" },
  // Groceries
  { re: /TESCO/i,                          name: "Tesco",          cat: "Groceries" },
  { re: /SAINSBURY/i,                      name: "Sainsbury's",    cat: "Groceries" },
  { re: /LIDL/i,                           name: "Lidl",           cat: "Groceries" },
  { re: /\bALDI\b/i,                       name: "Aldi",           cat: "Groceries" },
  { re: /MORRISON/i,                       name: "Morrisons",      cat: "Groceries" },
  { re: /WAITROSE/i,                       name: "Waitrose",       cat: "Groceries" },
  { re: /\bASDA\b/i,                       name: "Asda",           cat: "Groceries" },
  { re: /\bICELAND\b/i,                    name: "Iceland",        cat: "Groceries" },
  { re: /\bCO[\s\-]?OP\b|COOPERATIVE/i,    name: "Co-op",          cat: "Groceries" },
  { re: /M&S|MARKS\s*&\s*SPENCER|MARKS AND SPENCER/i, name: "M&S", cat: "Groceries" },
  // Dining
  { re: /STARBUCKS/i,                      name: "Starbucks",      cat: "Dining" },
  { re: /\bCOSTA\b/i,                      name: "Costa",          cat: "Dining" },
  { re: /\bPRET\b/i,                       name: "Pret",           cat: "Dining" },
  { re: /GREGGS/i,                         name: "Greggs",         cat: "Dining" },
  { re: /MCDONALD/i,                       name: "McDonald's",     cat: "Dining" },
  { re: /NANDO/i,                          name: "Nando's",        cat: "Dining" },
  { re: /WAGAMAMA/i,                       name: "Wagamama",       cat: "Dining" },
  { re: /\bKFC\b/i,                        name: "KFC",            cat: "Dining" },
  { re: /DELIVEROO/i,                      name: "Deliveroo",      cat: "Dining" },
  { re: /JUST EAT/i,                       name: "Just Eat",       cat: "Dining" },
  // Clothing
  { re: /\bZARA\b/i,                       name: "Zara",           cat: "Clothing" },
  { re: /\bH&M\b|H\s*AND\s*M\b/i,          name: "H&M",            cat: "Clothing" },
  { re: /UNIQLO/i,                         name: "Uniqlo",         cat: "Clothing" },
  { re: /VINTED/i,                         name: "Vinted",         cat: "Clothing" },
  { re: /PRIMARK/i,                        name: "Primark",        cat: "Clothing" },
  { re: /ASOS/i,                           name: "ASOS",           cat: "Clothing" },
  // Catch-all generic
  { re: /AMAZON/i,                         name: "Amazon",         cat: "Misc" },
];

function titleCaseToken(s) {
  if (!s) return s;
  return s.toLowerCase().replace(/\b([a-z])([a-z0-9'’\-]*)/g, (_, a, b) => a.toUpperCase() + b);
}

function cleanMerchant(rawDesc) {
  if (!rawDesc) return { name: "", cat: null, defaultType: null, toAccount: null, userRule: false };
  const text = rawDesc.replace(/\s+/g, " ").trim();
  // 1. User-defined rules ALWAYS take precedence (saved from prior imports / edited in Settings).
  const userRule = findMerchantRule(text);
  if (userRule) {
    return {
      name: userRule.name || text.slice(0, 60),
      cat: userRule.category || null,
      defaultType: userRule.type || null,
      toAccount: userRule.toAccount || null,
      userRule: true,
    };
  }
  // 2. Strip bank-noise wrappers
  let extracted = text;
  for (const r of BANK_NOISE_RULES) {
    const m = text.match(r.re);
    if (m) { extracted = r.fmt(m); break; }
  }
  // 3. Built-in canonical rules
  for (const rule of MERCHANT_RULES) {
    if (rule.re.test(extracted) || rule.re.test(text)) {
      return { name: rule.name, cat: rule.cat, defaultType: rule.defaultType || null, toAccount: null, userRule: false };
    }
  }
  // 4. Fallback: title-case + suffix trim
  let name = extracted;
  if (name === name.toUpperCase()) name = titleCaseToken(name);
  name = name.replace(/\s+(FSUK|LTD|LIMITED|UK|GB)$/i, "").trim();
  return { name, cat: null, defaultType: null, toAccount: null, userRule: false };
}

// Derive a stable "fingerprint" pattern from raw description, used when auto-learning rules.
// Strips dates, wallet wrappers, references — what's left is the merchant signature.
function deriveRulePattern(rawDesc) {
  if (!rawDesc) return "";
  let s = rawDesc.toUpperCase();
  s = s.replace(/\s+ON\s+\d{2}-\d{2}-\d{4}/g, "");
  s = s.replace(/\(VIA (?:APPLE|GOOGLE) PAY\),?/g, "");
  s = s.replace(/^(?:CARD PAYMENT TO|BILL PAYMENT(?:\s+VIA FASTER PAYMENT)?\s+TO|DIRECT DEBIT PAYMENT TO|STANDING ORDER(?:\s+VIA FASTER PAYMENT)?\s+TO)\s+/, "");
  s = s.replace(/\s+REFERENCE\b.*$/i, "");
  s = s.replace(/\s+,?\s*MANDATE NO\s+\d+/i, "");
  s = s.replace(/^FASTER PAYMENTS RECEIPT REF\..*?FROM\s+/i, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Fuzzy-match a guessed category against the user's actual category list.
function matchCat(guess, type) {
  const cats = (typeof getAllCats === "function" ? getAllCats(type) : []).map(c => c.id);
  if (!cats.length) return type === "in" ? "Other Income" : "Misc";
  if (!guess) return type === "in" ? (cats.find(c => /income|wage|salary|other/i.test(c)) || cats[0]) : (cats.find(c => /misc|other/i.test(c)) || cats[0]);
  const g = guess.toLowerCase();
  let m = cats.find(c => c.toLowerCase() === g);
  if (m) return m;
  m = cats.find(c => c.toLowerCase().includes(g) || g.includes(c.toLowerCase()));
  if (m) return m;
  // Hand-pick fallbacks for common guesses
  const aliases = { Repayments: /repay|subscript|debt|loan/i, Subscriptions: /subscript|repay/i, Groceries: /grocer|food/i, Dining: /dining|eating|food|restaur/i, Transport: /transport|travel|commut/i, Clothing: /cloth|lifestyle|wear/i, Savings: /saving|invest/i, Misc: /misc|other|expense/i };
  if (aliases[guess]) {
    m = cats.find(c => aliases[guess].test(c));
    if (m) return m;
  }
  return type === "in" ? (cats[0]) : (cats.find(c => /misc|other/i.test(c)) || cats[0]);
}

// Parse Santander HTML/.xls — extracts rows of {date, rawDesc, amount, type}.
function parseSantanderHTML(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  const out = [];
  doc.querySelectorAll("tr").forEach(tr => {
    const cells = tr.querySelectorAll("td");
    if (cells.length < 7) return;
    const dateTxt = (cells[1]?.textContent || "").trim();
    const dm = dateTxt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dm) return;
    const desc = (cells[3]?.textContent || "").replace(/\s+/g, " ").trim();
    const numFor = (cell) => {
      const s = (cell?.textContent || "").replace(/[^\d.\-]/g, "");
      const n = parseFloat(s);
      return isFinite(n) ? n : 0;
    };
    const moneyIn  = numFor(cells[5]);
    const moneyOut = numFor(cells[6]);
    if (!desc || (!moneyIn && !moneyOut)) return;
    const [, dd, mm, yyyy] = dm;
    out.push({
      date: `${yyyy}-${mm}-${dd}`,
      rawDesc: desc,
      amount: moneyIn || moneyOut,
      signedAmount: moneyIn > 0 ? moneyIn : -moneyOut, // positive=in, negative=out
      type: moneyIn > 0 ? "in" : "out",
    });
  });
  return out;
}

// Lightweight generic CSV → rows of {date, rawDesc, amount, type}. Used as a fallback for non-Santander files.
function parseGenericBankCSV(text) {
  const rows = parseCSV(text).filter(r => r.length && r.some(c => (c||"").trim()));
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => (h||"").toLowerCase().trim());
  const idxOf = (...keys) => headers.findIndex(h => keys.some(k => h.includes(k)));
  const dIdx = idxOf("date");
  const desIdx = idxOf("descript","narrative","details","payee","memo","reference");
  const inIdx = idxOf("money in","credit","paid in");
  const outIdx = idxOf("money out","debit","paid out","withdrawal");
  const amtIdx = idxOf("amount","value");
  if (dIdx < 0 || (desIdx < 0 && amtIdx < 0)) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseImportDate((r[dIdx]||"").trim());
    if (!date) continue;
    const desc = ((desIdx >= 0 ? r[desIdx] : "") || "").trim();
    // Preserve the SIGNED amount so the import modal can re-classify on the fly
    // (e.g. flipping bank ↔ credit card statement type). type is just an initial guess.
    let signedAmount = 0, type = "out";
    if (inIdx >= 0 || outIdx >= 0) {
      const mi = parseFloat(((r[inIdx]||"").replace(/[^\d.\-]/g, ""))) || 0;
      const mo = parseFloat(((r[outIdx]||"").replace(/[^\d.\-]/g, ""))) || 0;
      signedAmount = mi > 0 ? mi : -mo; // money-in positive, money-out negative
      type = mi > 0 ? "in" : "out";
    } else if (amtIdx >= 0) {
      signedAmount = parseFloat(((r[amtIdx]||"").replace(/[^\d.\-]/g, ""))) || 0;
      type = signedAmount < 0 ? "out" : "in";
    }
    if (!desc && !signedAmount) continue;
    out.push({ date, rawDesc: desc, amount: Math.abs(signedAmount), signedAmount, type });
  }
  return out;
}

let _bankImpRows = []; // [{date, rawDesc, amount, type, name, category, include, isDupe}]

function dedupeKey(date, amount, name) {
  return `${date}|${(+amount).toFixed(2)}|${(name||"").toLowerCase().trim()}`;
}

// Heuristic for the initial Statement-type guess: if every parsed row has a non-negative
// signedAmount AND every row was classified "in", it's almost certainly a credit-card export
// (where every line is a charge with no minus sign).
function _guessSourceType(parsed) {
  if (!parsed.length) return "bank";
  const allPositive = parsed.every(r => (r.signedAmount ?? r.amount) >= 0);
  const allIn = parsed.every(r => r.type === "in");
  return (allPositive && allIn) ? "credit" : "bank";
}

// Re-derive type / category / toAccount for every row based on the current source type
// and any matching merchant rule. Idempotent — safe to call on Statement-type changes.
function _classifyBankImportRows(parsed, sourceType, existingKeys, issuer) {
  issuer = issuer || "other";
  return parsed.map(r => {
    const cleaned = cleanMerchant(r.rawDesc);
    // Base type from sign + source. Bank: positive=in, negative=out. Credit card: positive=out (charge),
    // negative=transfer (paying down the card from another account).
    const signed = (r.signedAmount !== undefined) ? r.signedAmount : (r.type === "in" ? r.amount : -r.amount);
    let baseType;
    if (sourceType === "credit") {
      baseType = signed < 0 ? "transfer" : "out";
    } else {
      baseType = signed < 0 ? "out" : "in";
    }
    // User-defined merchant rule wins, then built-in canonical, then the base type from the sign rule.
    let type = baseType;
    if (cleaned.defaultType) {
      if (cleaned.defaultType === "transfer") {
        // Only apply transfer-by-default for outflows so income-side rules don't get clobbered.
        if (baseType === "out") type = "transfer";
      } else {
        type = cleaned.defaultType;
      }
    }
    // Amex-specific overrides:
    //  - "Payment received" / credit adjustment / debit adjustment rows are the
    //    bank-side settlement and would double-count with the Santander side.
    //    Auto-exclude by default; user can re-include via the banner toggle.
    //  - Negative amounts that AREN'T payments are merchant refunds → "in".
    let amexPayment = false;
    if (issuer === "amex") {
      if (isAmexBankPaymentRow(r.rawDesc)) {
        amexPayment = true;
        type = "transfer"; // it's logically a transfer from your bank
      } else if (signed < 0) {
        type = "in"; // refund
      } else {
        type = "out"; // charge
      }
    }
    const category = type === "transfer" ? null : matchCat(cleaned.cat, type === "in" ? "in" : "exp");
    const toAccount = type === "transfer" ? (cleaned.toAccount || cleaned.name || "") : "";
    const name = cleaned.name || r.rawDesc.slice(0, 60);
    const key = dedupeKey(r.date, r.amount, name);
    const dupe = existingKeys.has(key);
    return {
      date: r.date, rawDesc: r.rawDesc, amount: r.amount, signedAmount: signed,
      type, name, category, toAccount,
      // Amex bank-payment rows start excluded; everything else uses the dupe rule.
      include: !dupe && !amexPayment,
      isDupe: dupe,
      fromUserRule: cleaned.userRule,
      amexPayment, // tag so the banner + toggle can find these rows
      note: "",    // user-attached annotation, per row (e.g. PayPal → "shoes for Tom")
    };
  });
}

// Merchants that are really payment processors / middlemen — every charge usually
// represents a different real-world purchase. We can't safely apply group edits to
// them, so they're routed to the "Detailed review" pass.
const PAYMENT_PROCESSOR_RE = /paypal|klarna|clearpay|afterpay|laybuy|amazon|amzn|ebay|sumup|zettle|dojo|stripe|square|wise|revolut\b|paypal\s*credit/i;

// A group is "complex" (needs per-row attention) if its merchant is a payment
// processor OR the same merchant has wildly different amounts across rows.
function _isComplexGroup(g) {
  if (g.count <= 1) return false;
  if (PAYMENT_PROCESSOR_RE.test(g.name || "")) return true;
  if (g.indices && g.indices.length >= 2) {
    const amts = g.indices.map(i => _bankImpRows[i] ? _bankImpRows[i].amount : 0).filter(Boolean);
    if (amts.length >= 2) {
      const mean = amts.reduce((s,a)=>s+a,0) / amts.length;
      const max = Math.max(...amts), min = Math.min(...amts);
      // Spread > 50% of mean → likely different purposes per row.
      if (mean > 0 && (max - min) / mean > 0.5) return true;
    }
  }
  return false;
}

let _bankImpSourceType = "bank";
let _bankImpParsed = []; // raw parsed rows preserved for re-classification
let _bankImpIssuer = "other"; // "amex" | "santander" | "other" — set by the issuer-pick modal

// On Amex statements, "PAYMENT RECEIVED" + adjustment rows are the bank-side
// settlement of charges that already live in your Santander export. Importing
// them would double-count. The bank-side payments come in via the Santander
// statement as a transfer to Amex (which IS what we want recorded). These
// patterns get auto-excluded for Amex by default — user can toggle them back on.
const AMEX_PAYMENT_RE = /payment received|credit adjustment|debit adjustment|credit for disputed/i;
function isAmexBankPaymentRow(rawDesc) {
  return AMEX_PAYMENT_RE.test(rawDesc || "");
}
let _bankImpGrouped = true; // default: collapse identical merchants into one editable row
let _bankImpGroupView = []; // last rendered group list — handlers index into this snapshot
// Set of group keys whose detailed child rows are currently expanded. Complex
// groups default to COLLAPSED so a 167-row TfL group doesn't push every other
// detail merchant offscreen — user expands the ones they want to work on.
let _bankImpExpandedGroups = new Set();
// Tracks whether an import is in progress (the review modal is open with pending
// rows). Used to guard against an accidental backdrop/Cancel click wiping the
// session — we always confirm before dropping an in-progress import.
let _bankImpActive = false;
function _snapshotBankImp() { _bankImpActive = true; }
// Actually dismiss the review modal and drop the pending rows.
function _closeBankImpModal() {
  document.getElementById("bankimp-modal").hidden = true;
  _bankImpRows = [];
  _bankImpActive = false;
}
// Dismiss path used by Cancel / backdrop: always confirm while an import is in
// progress, regardless of whether the user has edited any rows.
function _tryCloseBankImpModal() {
  if (_bankImpActive && typeof confirmDialog === "function") {
    confirmDialog({
      title: "Discard this import?",
      message: "These imported transactions haven't been saved yet. Exit without importing them?",
      confirmLabel: "Discard import",
      cancelLabel: "Keep reviewing",
      danger: true,
    }, _closeBankImpModal);
  } else {
    _closeBankImpModal();
  }
}

// Key used to collapse identical merchants. Same name + same type = same group.
// Amount intentionally excluded so e.g. a £4 and a £4.20 Tesco trip group together —
// the goal is "edit once, apply to every Tesco transaction".
// Refund rows are keyed separately so a mixed merchant (e.g. PayPal with both
// real income AND paired refunds) splits into a normal group + a refund-only
// group — the latter then sinks to the Refunds section instead of being stranded
// inside detailed review.
function _bankImpGroupKey(r) {
  return (r.name || "").toLowerCase().trim() + "|" + r.type + (r.isRefund ? "|refund" : "");
}

// Build the grouped view from _bankImpRows. Each group exposes:
//   { key, name, type, category, toAccount, count, total, indices, allIncluded, anyDupe }
// Editing a group field propagates to every underlying row via `indices`.
function _computeBankImpGroups() {
  const map = new Map();
  _bankImpRows.forEach((r, i) => {
    // The original charge of an in-import refund pair is shown beneath its
    // refund (↑ ORIGINAL), not as a standalone group — skip it here.
    if (r.pairedAsOriginal) return;
    const k = _bankImpGroupKey(r);
    if (!map.has(k)) {
      map.set(k, {
        key: k, name: r.name, type: r.type,
        category: r.category, toAccount: r.toAccount,
        count: 0, total: 0, indices: [],
        includedCount: 0, dupeCount: 0,
        anyFromUserRule: false, minConfidence: 100,
      });
    }
    const g = map.get(k);
    g.count++;
    g.total += r.amount;
    g.indices.push(i);
    if (r.include) g.includedCount++;
    if (r.isDupe)  g.dupeCount++;
    if (r.fromUserRule) g.anyFromUserRule = true;
    g.minConfidence = Math.min(g.minConfidence, bankImpConfidence(r));
  });
  const groups = [...map.values()];
  groups.forEach(g => {
    // Every row in this group is a paired refund → already-resolved, push to the bottom.
    g.isRefundOnly = g.indices.every(i => _bankImpRows[i] && _bankImpRows[i].isRefund);
    g.isComplex = !g.isRefundOnly && _isComplexGroup(g);
  });
  // Mark groups whose every row is a duplicate so they can sink to the very bottom —
  // the user almost never needs to touch already-imported rows.
  groups.forEach(g => { g.isAllDupe = g.count > 0 && g.dupeCount === g.count; });
  // Sort order (top → bottom): new/easy → complex (detailed review) → refund-only
  // → all-duplicate. Non-duplicates float to the top so the rows that actually need
  // attention are seen first; fully-duplicate groups drop below everything.
  const rank = g => g.isAllDupe ? 3 : (g.isRefundOnly ? 2 : (g.isComplex ? 1 : 0));
  return groups.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return b.count - a.count || b.total - a.total;
  });
}

function openBankImportModal(parsed, opts = {}) {
  if (!parsed.length) { showToast("No transactions found in file"); return; }
  _bankImpParsed = parsed;
  _bankImpIssuer = opts.issuer || "other";
  // Issuer locks the source-type when known. "Other" still uses the heuristic.
  if (_bankImpIssuer === "amex") _bankImpSourceType = "credit";
  else if (_bankImpIssuer === "santander") _bankImpSourceType = "bank";
  else _bankImpSourceType = _guessSourceType(parsed);
  const existing = new Set(getTxns().map(t => dedupeKey(t.date, t.amount, t.description)));
  _bankImpRows = _classifyBankImportRows(parsed, _bankImpSourceType, existing, _bankImpIssuer);
  // Reflect the guess / issuer-driven choice in the dropdown.
  const sourceSel = document.getElementById("bankimp-source-type");
  if (sourceSel) sourceSel.value = _bankImpSourceType;
  // Populate account selector — pre-select the issuer's matching account if it exists.
  const acctSel = document.getElementById("bankimp-acct");
  const accts = [...new Set([...(typeof getTxAccts==="function"?getTxAccts():[]), ...(getSettings().accounts || [])])].filter(Boolean);
  if (!accts.length) accts.push(_bankImpIssuer === "amex" ? "Amex" : "Santander");
  const issuerRe = _bankImpIssuer === "amex" ? /amex|american\s*express/i
                  : _bankImpIssuer === "santander" ? /santander/i
                  : /santander/i;
  acctSel.innerHTML = accts.map(a => `<option value="${a}"${issuerRe.test(a)?' selected':''}>${a}</option>`).join("");
  updateBankImpSummary();
  renderBankImpList();
  _snapshotBankImp();
  document.getElementById("bankimp-modal").hidden = false;
}

// The banner-in-modal helpers used to live here. Their behaviour now happens
// up-front in the import pipeline (Step 2: Amex payments prompt), so the modal
// itself stays focused on row review.

function updateBankImpSummary() {
  const totalIn  = _bankImpRows.filter(r => r.type==="in" ).reduce((s,r)=>s+r.amount,0);
  const totalOut = _bankImpRows.filter(r => r.type==="out").reduce((s,r)=>s+r.amount,0);
  const totalTfr = _bankImpRows.filter(r => r.type==="transfer").reduce((s,r)=>s+r.amount,0);
  const parts = [`${_bankImpRows.length} rows`, `${fmtGBP(totalIn,{dp:0})} in`, `${fmtGBP(totalOut,{dp:0})} out`];
  if (totalTfr > 0) parts.push(`${fmtGBP(totalTfr,{dp:0})} transfer`);
  document.getElementById("bankimp-summary").textContent = parts.join(" · ");
}

// Collect all accounts we know about (settings + transaction history + any row-pending toAccounts).
function _allKnownAccounts() {
  const fromSettings = getSettings().accounts || [];
  const fromTxns = (typeof getTxAccts === "function" ? getTxAccts() : []);
  const fromRows = _bankImpRows.map(r => r.toAccount).filter(Boolean);
  return [...new Set([...fromSettings, ...fromTxns, ...fromRows].filter(Boolean))].sort();
}
function bankImpConfidence(row) {
  if (row.fromUserRule) return 98;
  if (row.type === "transfer" && row.toAccount) return 90;
  if (row.category && !/misc|other/i.test(row.category)) return 86;
  return 64;
}

function renderBankImpList() {
  if (_bankImpGrouped) { renderBankImpGroupedList(); return; }
  const expCats = getAllCats("exp").map(c => c.id);
  const incCats = getAllCats("in").map(c => c.id);
  const accts = _allKnownAccounts();
  const allStateF = _bankImpAllState();
  const masterCbF = `<input type="checkbox" class="bankimp-master-cb" ${allStateF==="all"?"checked":""} ${allStateF==="partial"?'data-partial="1"':''} onchange="toggleBankImpAll(this.checked)" title="Select all / none" aria-label="Select all transactions" />`;
  const head = `<div class="bankimp-head">${masterCbF}<span>Merchant</span><span>Amount</span><span>Suggested category / account</span><span>Type</span><span>Confidence</span><span></span></div>`;
  const rows = _bankImpRows.map((r, i) => {
    // Hide the original charge of an in-import refund pair — it's shown beneath
    // its refund row (↑ ORIGINAL), not as a standalone line in the main list.
    if (r.pairedAsOriginal) return "";
    const dupCls = r.isDupe ? " is-dupe" : "";
    const skipCls = !r.include ? " is-skipped" : "";
    const ruleCls = r.fromUserRule ? " has-rule" : "";
    // Type dropdown — drives the third column's meaning
    const typeOpts = ["out","in","transfer"].map(t => `<option value="${t}"${t===r.type?' selected':''}>${t}</option>`).join("");
    let midCol;
    if (r.type === "transfer") {
      // Strict dropdown of known accounts + the row's current target (if new) + "Add new…"
      const cur = r.toAccount || "";
      const opts = [
        ...accts.map(a => `<option value="${a.replace(/"/g,'&quot;')}"${a===cur?' selected':''}>${a}</option>`),
        (cur && !accts.includes(cur)) ? `<option value="${cur.replace(/"/g,'&quot;')}" selected>${cur} (new)</option>` : "",
        `<option value="__new__">+ Add new account…</option>`,
      ].join("");
      midCol = `<select onchange="updateBankImpToAcct(${i}, this.value)" title="Destination account">${opts}</select>`;
    } else {
      const cats = r.type === "in" ? incCats : expCats;
      const opts = cats.map(c => `<option value="${c.replace(/"/g,'&quot;')}"${c===r.category?' selected':''}>${c}</option>`).join("");
      midCol = `<select onchange="updateBankImpCat(${i}, this.value)">${opts}</select>`;
    }
    const sign = r.type === "in" ? "+" : "−";
    const amtCls = r.type === "in" ? "in" : "out";
    const ruleTag = r.fromUserRule ? '<span class="rule-tag" title="Already a saved merchant rule">✓ Saved rule</span>' : '';
    const dupTag = r.isDupe ? '<span class="dupe-tag">dup</span>' : '';
    const refundTagFlat = r.isRefund ? '<span class="refund-tag" title="Paired with an original charge — cancels in spending breakdown">↩ refund</span>' : '';
    const confidence = bankImpConfidence(r);
    const pairHtml = r.isRefund && r.refundPair ? _renderRefundPairRow(r, i) : "";
    return `<div class="bankimp-row${dupCls}${skipCls}${ruleCls}" data-idx="${i}">
      <input type="checkbox" ${r.include?'checked':''} onchange="toggleBankImpRow(${i}, this.checked)" />
      <div class="bankimp-child-merch">
        <input type="text" value="${r.name.replace(/"/g,'&quot;')}" oninput="updateBankImpName(${i}, this.value)" title="${r.rawDesc.replace(/"/g,'&quot;')} · ${r.date}" />
        <input type="text" class="bankimp-note-input" placeholder="Add a note…" value="${(r.note||'').replace(/"/g,'&quot;')}" oninput="updateBankImpNote(${i}, this.value)" />
      </div>
      <span class="amt ${amtCls}">${sign}${fmtGBP(r.amount,{dp:2}).replace(/^[£+\-]+/,"")}</span>
      ${midCol}
      <select onchange="updateBankImpType(${i}, this.value)">${typeOpts}</select>
      <span class="confidence">${confidence}%</span>
      <span style="display:flex;gap:3px;justify-content:flex-end">${refundTagFlat}${ruleTag}${dupTag}</span>
    </div>${pairHtml}`;
  }).join("");
  document.getElementById("bankimp-list").innerHTML = head + rows;
  _applyBankImpMasterState();
  updateBankImpCounts();
}
// Reflect partial selection on the header master checkbox (—) after each render.
function _applyBankImpMasterState() {
  const cb = document.querySelector(".bankimp-master-cb");
  if (cb) cb.indeterminate = _bankImpAllState() === "partial";
}

function updateBankImpCounts() {
  const sel = _bankImpRows.filter(r => r.include).length;
  const dup = _bankImpRows.filter(r => r.isDupe).length;
  const gN = _bankImpGrouped ? (_bankImpGroupView.length || _computeBankImpGroups().length) : 0;
  const groupNote = _bankImpGrouped ? ` · ${gN} unique merchant${gN===1?'':'s'}` : '';
  document.getElementById("bankimp-counts").textContent = `${sel} selected · ${dup} duplicate${dup===1?'':'s'}${groupNote}`;
}

/* ── Grouped review ─────────────────────────────────────────────────────────
 * Collapses the parsed rows by merchant + type so the user can edit one row
 * (rename, recategorise, retype, exclude) and have every matching transaction
 * inherit the change. Underlying _bankImpRows is still what we import — these
 * are just lensed views that propagate edits on change.
 * ──────────────────────────────────────────────────────────────────────────── */
function renderBankImpGroupedList() {
  const expCats = getAllCats("exp").map(c => c.id);
  const incCats = getAllCats("in").map(c => c.id);
  const accts = _allKnownAccounts();
  const groups = _computeBankImpGroups();
  _bankImpGroupView = groups; // snapshot so propagation handlers don't shift after a rename
  const allState = _bankImpAllState();
  const masterCb = `<input type="checkbox" class="bankimp-master-cb" ${allState==="all"?"checked":""} ${allState==="partial"?'data-partial="1"':''} onchange="toggleBankImpAll(this.checked)" title="Select all / none" aria-label="Select all transactions" />`;
  const head = `<div class="bankimp-head bankimp-head-grouped">${masterCb}<span>Merchant</span><span>Count</span><span>Total</span><span>Suggested category / account</span><span>Type</span><span>Confidence</span><span></span></div>`;
  const easyCount = groups.filter(g => !g.isComplex && !g.isRefundOnly).length;
  const complexCount = groups.filter(g => g.isComplex).length;
  const refundCount = groups.filter(g => g.isRefundOnly).length;
  let insertedDetailSep = false;
  let insertedRefundSep = false;
  const rows = groups.map((g, gi) => {
    const allOn = g.includedCount === g.count;
    const noneOn = g.includedCount === 0;
    const partial = !allOn && !noneOn;
    const skipCls = noneOn ? " is-skipped" : "";
    const dupCls  = g.dupeCount === g.count && g.count ? " is-dupe" : "";
    const ruleCls = g.anyFromUserRule ? " has-rule" : "";
    const typeOpts = ["out","in","transfer"].map(t => `<option value="${t}"${t===g.type?' selected':''}>${t}</option>`).join("");
    let midCol, typeCol;
    if (g.isRefundOnly) {
      // Paired refunds are locked: both legs go to the hidden Refunds category and
      // cancel out. The user can rename them, but category & type are fixed so they
      // can't be re-classified into real spending/income. Show read-only labels.
      midCol  = `<span class="bankimp-locked" title="Both sides of a paired refund are filed under the hidden Refunds category and excluded from totals — not editable">↩ Refunds</span>`;
      typeCol = `<span class="bankimp-locked" title="Locked — paired refund">in</span>`;
    } else {
      if (g.type === "transfer") {
        const cur = g.toAccount || "";
        const opts = [
          ...accts.map(a => `<option value="${a.replace(/"/g,'&quot;')}"${a===cur?' selected':''}>${a}</option>`),
          (cur && !accts.includes(cur)) ? `<option value="${cur.replace(/"/g,'&quot;')}" selected>${cur} (new)</option>` : "",
          `<option value="__new__">+ Add new account…</option>`,
        ].join("");
        midCol = `<select onchange="updateBankImpGroupToAcct(${gi}, this.value)" title="Destination account (applies to all ${g.count})">${opts}</select>`;
      } else {
        const cats = g.type === "in" ? incCats : expCats;
        const cur = g.category || "";
        const opts = [
          ...cats.map(c => `<option value="${c.replace(/"/g,'&quot;')}"${c===cur?' selected':''}>${c}</option>`),
          (cur && !cats.includes(cur)) ? `<option value="${cur.replace(/"/g,'&quot;')}" selected>${cur} (new)</option>` : "",
          `<option value="__newcat__">+ Add new category…</option>`,
        ].join("");
        midCol = `<select onchange="updateBankImpGroupCat(${gi}, this.value)" title="Category (applies to all ${g.count})">${opts}</select>`;
      }
      typeCol = `<select onchange="updateBankImpGroupType(${gi}, this.value)" title="Type (applies to all ${g.count})">${typeOpts}</select>`;
    }
    const sign = g.type === "in" ? "+" : "−";
    const amtCls = g.type === "in" ? "in" : "out";
    const ruleTag = g.anyFromUserRule ? '<span class="rule-tag" title="Already a saved merchant rule">✓ Saved rule</span>' : '';
    // Per-group "remember as rule" toggle. Only shown when the global learn checkbox
    // is on and this isn't a paired-refund group (those never create rules). A row's
    // noRule flag opts it out of rule-learning at import time.
    const learnOn = document.getElementById("bankimp-learn")?.checked;
    const grpNoRule = g.indices.some(i => _bankImpRows[i] && _bankImpRows[i].noRule);
    const ruleToggle = (learnOn && !g.isRefundOnly)
      ? `<button class="bankimp-rule-toggle${grpNoRule ? ' off' : ''}" onclick="toggleBankImpGroupRule(${gi})" title="${grpNoRule ? "Won't be remembered as a rule — click to remember" : "Will be remembered as a rule — click to skip"}">${grpNoRule ? '⊘ rule' : '✓ rule'}</button>`
      : '';
    const dupTag = g.dupeCount ? `<span class="dupe-tag" title="${g.dupeCount} of ${g.count} look like duplicates">dup ${g.dupeCount}</span>` : '';
    const refundCount = g.indices.filter(i => _bankImpRows[i] && _bankImpRows[i].isRefund).length;
    const refundTag = refundCount ? `<span class="refund-tag" title="${refundCount} of ${g.count} paired with an original charge">↩ refund${refundCount>1?' '+refundCount:''}</span>` : '';
    const checkAttrs = allOn ? 'checked' : (partial ? 'data-partial="1"' : '');
    // Inject section separators between the three blocks (easy / detailed / refunds).
    let sep = "";
    if (g.isComplex && !insertedDetailSep) {
      insertedDetailSep = true;
      sep += `<div class="bankimp-detail-sep">
        <div class="bankimp-detail-sep-h">Detailed review · ${complexCount} merchant${complexCount===1?'':'s'} with mixed purposes</div>
        <div class="bankimp-detail-sep-sub">PayPal, Amazon and other payment processors — each row likely funds something different. Click a row to expand it, then edit the individual transactions and add notes.</div>
      </div>`;
    }
    if (g.isRefundOnly && !insertedRefundSep) {
      insertedRefundSep = true;
      sep += `<div class="bankimp-detail-sep bankimp-refund-sep">
        <div class="bankimp-detail-sep-h">Refunds · ${refundCount} already paired</div>
        <div class="bankimp-detail-sep-sub">Both sides of each pair are filed under a hidden “Refunds” category so they cancel out — they won't count as spending or income. Nothing to do here.</div>
      </div>`;
    }
    // Collapse state: complex groups start collapsed; refund-only & easy stay flat.
    const expanded = _bankImpExpandedGroups.has(g.key);
    const chevron = g.isComplex
      ? `<button class="bankimp-expand" onclick="toggleBankImpGroupExpand(${gi})" title="${expanded ? 'Collapse details' : 'Expand individual rows'}" aria-expanded="${expanded}">${expanded ? '▼' : '▶'}</button>`
      : "";
    const groupRowCls = `bankimp-row bankimp-row-grouped${dupCls}${skipCls}${ruleCls}${g.isComplex ? ' is-complex' : ''}${g.isRefundOnly ? ' is-refund-only' : ''}${g.isComplex && expanded ? ' is-expanded' : ''}`;
    // Group note: applies to every row in the group. Pre-fill from the first row
    // that already carries a note (they're kept in sync by updateBankImpGroupNote).
    const grpNote = (g.indices.map(i => _bankImpRows[i] && _bankImpRows[i].note).find(n => n)) || "";
    const groupRow = `<div class="${groupRowCls}" data-grp="${gi}">
      <input type="checkbox" ${checkAttrs} onchange="toggleBankImpGroup(${gi}, this.checked)" title="Include all ${g.count}" />
      <div class="bankimp-grp-merch">${chevron}<div class="bankimp-merch-stack"><input type="text" value="${(g.name||'').replace(/"/g,'&quot;')}" oninput="updateBankImpGroupName(${gi}, this.value)" title="Renames all ${g.count} matching transactions" /><input type="text" class="bankimp-note-input" placeholder="Add a note…" value="${grpNote.replace(/"/g,'&quot;')}" oninput="updateBankImpGroupNote(${gi}, this.value)" title="Note (applies to all ${g.count})" /></div></div>
      <span class="bankimp-count" title="${g.count} matching transactions">×${g.count}</span>
      <span class="amt ${amtCls}">${sign}${fmtGBP(g.total,{dp:2}).replace(/^[£+\-]+/,"")}</span>
      ${midCol}
      ${typeCol}
      <span class="confidence">${g.minConfidence}%</span>
      <span style="display:flex;gap:3px;justify-content:flex-end;align-items:center;flex-wrap:wrap">${ruleToggle}${refundTag}${ruleTag}${dupTag}</span>
    </div>`;
    // Complex groups: render each child row individually only when expanded.
    // Refund-only groups: render a paired-charge sub-row under each refund.
    let childrenHtml = "";
    if (g.isComplex && expanded) {
      childrenHtml = g.indices.map(i => _renderBankImpDetailedRow(i, expCats, incCats, accts)).join("");
    } else if (g.isRefundOnly) {
      childrenHtml = g.indices.map(i => {
        const row = _bankImpRows[i];
        if (!row || !row.refundPair) return "";
        return _renderRefundPairRow(row, i);
      }).join("");
    }
    return sep + groupRow + childrenHtml;
  }).join("");
  document.getElementById("bankimp-list").innerHTML = head + rows;
  // After render, set the indeterminate property on partial-included group checkboxes.
  document.querySelectorAll('.bankimp-row-grouped input[type="checkbox"][data-partial="1"]').forEach(cb => { cb.indeterminate = true; });
  _applyBankImpMasterState();
  updateBankImpCounts();
}

// Group-edit propagation. Each "update" applies to every underlying _bankImpRows
// in the group's `indices`, so the user only edits once.
function _bankImpGroupAt(gi) { return _bankImpGroupView[gi]; }

function updateBankImpGroupName(gi, v) {
  const g = _bankImpGroupAt(gi); if (!g) return;
  g.indices.forEach(i => { if (_bankImpRows[i]) _bankImpRows[i].name = v; });
  // No re-render — would steal focus from the input mid-typing.
}
// Group note: write the same note onto every underlying row in the group, so it
// imports on each transaction. No re-render — keeps focus in the input.
function updateBankImpGroupNote(gi, v) {
  const g = _bankImpGroupAt(gi); if (!g) return;
  g.indices.forEach(i => { if (_bankImpRows[i]) _bankImpRows[i].note = v; });
}
// Toggle whether this group's rows are remembered as merchant rules on import.
function toggleBankImpGroupRule(gi) {
  const g = _bankImpGroupAt(gi); if (!g) return;
  const turningOff = !g.indices.some(i => _bankImpRows[i] && _bankImpRows[i].noRule);
  g.indices.forEach(i => { if (_bankImpRows[i]) _bankImpRows[i].noRule = turningOff; });
  renderBankImpList();
}
function updateBankImpGroupCat(gi, v) {
  const g = _bankImpGroupAt(gi); if (!g) return;
  if (v === "__newcat__") {
    const wantType = g.type === "in" ? "in" : "exp";
    promptDialog({
      title: "New category",
      message: `Name a new ${wantType === "in" ? "income" : "expense"} category — applies to all ${g.count} matching transactions.`,
      placeholder: "e.g. Pet care, Side hustle",
      confirmLabel: "Create",
    }, (name) => {
      const created = _addImportCustomCat(name, wantType);
      if (created) g.indices.forEach(i => { if (_bankImpRows[i]) _bankImpRows[i].category = created; });
      renderBankImpList();
    });
    renderBankImpList(); // roll the select back if cancelled
    return;
  }
  g.indices.forEach(i => { if (_bankImpRows[i]) _bankImpRows[i].category = v; });
}
// Create a custom category on the fly during import. Returns the category id used
// (existing or new), or null if the name was blank. Reuses the same customCats
// schema as the Settings category editor so it shows up everywhere afterwards.
function _addImportCustomCat(rawName, type) {
  const name = (rawName || "").trim();
  if (!name) return null;
  const s = getSettings();
  const hidden = new Set(s.hiddenDefaultCats || []);
  const existing = [
    ...DEFAULT_EXP_CATS.filter(c => !hidden.has(c.id)).map(c => c.id),
    ...DEFAULT_INC_CATS.filter(c => !hidden.has(c.id)).map(c => c.id),
    ...((s.customCats || []).map(c => c.id)),
  ];
  // If the name already exists (case-insensitive), just reuse it.
  const match = existing.find(id => id.toLowerCase() === name.toLowerCase());
  if (match) return match;
  s.customCats = s.customCats || [];
  const icon = (typeof guessCatEmoji === "function" ? guessCatEmoji(name) : "") || "🏷️";
  s.customCats.push({ id: name, icon, type });
  lsSet("fin_settings", s);
  if (typeof rebuildCatBy === "function") rebuildCatBy();
  showToast(`Added category “${name}”`);
  return name;
}
function updateBankImpGroupToAcct(gi, v) {
  const g = _bankImpGroupAt(gi); if (!g) return;
  if (v === "__new__") {
    promptDialog({
      title: "New account",
      message: `Name the destination account — applies to all ${g.count} matching transactions.`,
      placeholder: "e.g. Trading 212, S&S ISA",
      confirmLabel: "Use account",
    }, (name) => {
      const trimmed = (name || "").trim();
      g.indices.forEach(i => { if (_bankImpRows[i]) _bankImpRows[i].toAccount = trimmed; });
      renderBankImpList();
    });
    renderBankImpList(); // roll the select back if cancelled
    return;
  }
  g.indices.forEach(i => { if (_bankImpRows[i]) _bankImpRows[i].toAccount = v; });
}
function updateBankImpGroupType(gi, v) {
  const g = _bankImpGroupAt(gi); if (!g) return;
  g.indices.forEach(i => {
    const r = _bankImpRows[i]; if (!r) return;
    r.type = v;
    if (v === "transfer" && !r.toAccount) r.toAccount = r.name || "";
    if (v !== "transfer") {
      const wanted = r.type === "in" ? "in" : "exp";
      const ids = getAllCats(wanted).map(c => c.id);
      if (!ids.includes(r.category)) r.category = matchCat(null, wanted);
    }
  });
  renderBankImpList(); // type change reshapes the middle column
}
// Per-row detail renderer for "complex" groups. Adds a note input and
// individual category/type/include controls — child edits override the group's bulk defaults.
function _renderBankImpDetailedRow(i, expCats, incCats, accts) {
  const r = _bankImpRows[i]; if (!r) return "";
  const skipCls = !r.include ? " is-skipped" : "";
  const dupCls  = r.isDupe   ? " is-dupe" : "";
  const typeOpts = ["out","in","transfer"].map(t => `<option value="${t}"${t===r.type?' selected':''}>${t}</option>`).join("");
  let midCol;
  if (r.type === "transfer") {
    const cur = r.toAccount || "";
    const opts = [
      ...accts.map(a => `<option value="${a.replace(/"/g,'&quot;')}"${a===cur?' selected':''}>${a}</option>`),
      (cur && !accts.includes(cur)) ? `<option value="${cur.replace(/"/g,'&quot;')}" selected>${cur} (new)</option>` : "",
      `<option value="__new__">+ Add new account…</option>`,
    ].join("");
    midCol = `<select onchange="updateBankImpToAcct(${i}, this.value)" title="Destination account">${opts}</select>`;
  } else {
    const cats = r.type === "in" ? incCats : expCats;
    const opts = cats.map(c => `<option value="${c.replace(/"/g,'&quot;')}"${c===r.category?' selected':''}>${c}</option>`).join("");
    midCol = `<select onchange="updateBankImpCat(${i}, this.value)">${opts}</select>`;
  }
  const sign = r.type === "in" ? "+" : "−";
  const amtCls = r.type === "in" ? "in" : "out";
  const dateShort = (r.date || "").slice(5).replace("-", "/"); // mm/dd
  return `<div class="bankimp-row bankimp-row-child${dupCls}${skipCls}" data-idx="${i}">
    <input type="checkbox" ${r.include?'checked':''} onchange="toggleBankImpRow(${i}, this.checked)" />
    <div class="bankimp-child-merch">
      <input type="text" value="${(r.name||'').replace(/"/g,'&quot;')}" oninput="updateBankImpName(${i}, this.value)" title="${(r.rawDesc||'').replace(/"/g,'&quot;')}" />
      <input type="text" class="bankimp-note-input" placeholder="Note (e.g. shoes for Tom)" value="${(r.note||'').replace(/"/g,'&quot;')}" oninput="updateBankImpNote(${i}, this.value)" />
    </div>
    <span class="bankimp-date" title="${r.date}">${dateShort || r.date || ""}</span>
    <span class="amt ${amtCls}">${sign}${fmtGBP(r.amount,{dp:2}).replace(/^[£+\-]+/,"")}</span>
    ${midCol}
    <select onchange="updateBankImpType(${i}, this.value)">${typeOpts}</select>
    <span class="confidence">${bankImpConfidence(r)}%</span>
    <span></span>
  </div>`;
}

// Renders the "paired original charge" ghost row shown beneath each refund row.
// Gives the user context — "this refund cancels that specific expense."
function _renderRefundPairRow(row, idx) {
  const p = row.refundPair;
  if (!p) return "";
  const dateStr = p.date ? p.date.slice(5).replace("-", "/") : "—"; // MM/DD
  const srcLbl = p.source === "batch" ? "in this import" : "from your history";
  const amtStr = "−" + fmtGBP(p.amount, { dp: 2 }).replace(/^[£+\-]+/, "");
  const name = (p.name || row.name || "").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const cat = (p.category || "").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return `<div class="bankimp-pair-row" data-pair-for="${idx}" title="Original charge this refund cancels">
    <span class="bankimp-pair-label">↑ original</span>
    <span class="bankimp-pair-merch">${name}</span>
    <span class="bankimp-pair-date">${dateStr}</span>
    <span class="bankimp-pair-amt">${amtStr}</span>
    <span class="bankimp-pair-cat">${cat}</span>
    <span class="bankimp-pair-src">${srcLbl}</span>
  </div>`;
}

// Expand / collapse the children of a complex group. Keyed by g.key so the
// state survives a re-render (rename / cat / type changes).
function toggleBankImpGroupExpand(gi) {
  const g = _bankImpGroupAt(gi); if (!g) return;
  if (_bankImpExpandedGroups.has(g.key)) _bankImpExpandedGroups.delete(g.key);
  else _bankImpExpandedGroups.add(g.key);
  renderBankImpList();
}

function updateBankImpNote(i, v) {
  if (!_bankImpRows[i]) return;
  _bankImpRows[i].note = v;
  // No re-render — keep focus on the input mid-typing.
}

function toggleBankImpGroup(gi, checked) {
  const g = _bankImpGroupAt(gi); if (!g) return;
  g.indices.forEach(i => { if (_bankImpRows[i]) _bankImpRows[i].include = !!checked; });
  // Re-render this row's class without redoing the whole list (keeps scroll position).
  const row = document.querySelector(`.bankimp-row-grouped[data-grp="${gi}"]`);
  if (row) row.classList.toggle("is-skipped", !checked);
  updateBankImpCounts();
}

function toggleBankImpRow(i, checked) {
  if (!_bankImpRows[i]) return;
  _bankImpRows[i].include = !!checked;
  const row = document.querySelector(`.bankimp-row[data-idx="${i}"]`);
  if (row) row.classList.toggle("is-skipped", !checked);
  updateBankImpCounts();
}
// Master "select all / none" toggle in the import header. Flips every row's
// include flag and re-renders so all checkboxes + the counts update at once.
function toggleBankImpAll(checked) {
  _bankImpRows.forEach(r => { r.include = !!checked; });
  renderBankImpList();
}
// Compute the master-checkbox state: all on, all off, or partial (indeterminate).
function _bankImpAllState() {
  const total = _bankImpRows.length;
  const on = _bankImpRows.filter(r => r.include).length;
  return on === 0 ? "none" : (on === total ? "all" : "partial");
}
function updateBankImpName(i, v) { if (_bankImpRows[i]) _bankImpRows[i].name = v; }
function updateBankImpCat(i, v) { if (_bankImpRows[i]) _bankImpRows[i].category = v; }
function updateBankImpToAcct(i, v) {
  const r = _bankImpRows[i];
  if (!r) return;
  if (v === "__new__") {
    promptDialog({
      title: "New account",
      message: "Name the destination account (it'll be added on import).",
      placeholder: "e.g. Trading 212, S&S ISA",
      confirmLabel: "Use account",
    }, (name) => {
      r.toAccount = name.trim();
      renderBankImpList();
    });
    // Roll the select back so it doesn't show "+ Add…" if the prompt is cancelled.
    renderBankImpList();
    return;
  }
  r.toAccount = v;
}
function updateBankImpType(i, v) {
  const r = _bankImpRows[i];
  if (!r) return;
  r.type = v;
  // Seed sensible defaults when flipping to transfer / back
  if (v === "transfer" && !r.toAccount) r.toAccount = r.name || "";
  if (v !== "transfer") {
    const wanted = r.type === "in" ? "in" : "exp";
    const ids = getAllCats(wanted).map(c => c.id);
    if (!ids.includes(r.category)) r.category = matchCat(null, wanted);
  }
  renderBankImpList();
}

function commitBankImport() {
  const account = document.getElementById("bankimp-acct").value;
  const skipDupes = document.getElementById("bankimp-skip-dupes").checked;
  const learnRules = document.getElementById("bankimp-learn").checked;
  const txns = getTxns();
  const settings = getSettings();
  settings.accounts = settings.accounts || [];
  const knownAccts = new Set(settings.accounts);
  const learnedKeys = new Set();
  let added = 0, skipped = 0, learned = 0;
  const addedTxns = [];
  _bankImpRows.forEach((r, i) => {
    if (!r.include) { skipped++; return; }
    if (skipDupes && r.isDupe) { skipped++; return; }
    const tx = {
      id: Date.now() + Math.floor(Math.random()*100000) + i,
      type: r.type,
      amount: Math.abs(r.amount),
      date: r.date,
      description: r.name,
    };
    if (r.note && r.note.trim()) tx.notes = r.note.trim();
    if (r.isRefund) tx.isRefund = true;
    if (r.type === "transfer") {
      tx.fromAccount = account;
      tx.toAccount = (r.toAccount || r.name || "").trim() || account;
      // Auto-create the destination account if it's new
      if (tx.toAccount && !knownAccts.has(tx.toAccount)) {
        settings.accounts.push(tx.toAccount);
        knownAccts.add(tx.toAccount);
      }
    } else {
      tx.category = r.category;
      tx.account = account;
    }
    txns.push(tx);
    addedTxns.push(tx);
    added++;
    // Auto-learn merchant rule from this row (one per unique pattern).
    // Skipped globally (checkbox off) OR per-row when the user opted this one out.
    if (learnRules && !r.noRule) {
      const pattern = deriveRulePattern(r.rawDesc);
      if (pattern && !learnedKeys.has(pattern)) {
        learnedKeys.add(pattern);
        const rule = { pattern, name: r.name, type: r.type };
        if (r.type === "transfer") rule.toAccount = tx.toAccount;
        else rule.category = r.category;
        upsertMerchantRule(rule);
        learned++;
      }
    }
  });
  lsSet("fin_settings", settings);
  lsSet("fin_txns", txns);
  const newBills = (typeof ensureBillsFromTxns === "function") ? ensureBillsFromTxns(addedTxns) : 0;
  document.getElementById("bankimp-modal").hidden = true;
  _bankImpRows = [];
  _bankImpActive = false;
  const ruleMsg = learned ? ` · learned ${learned} rule${learned===1?'':'s'}` : '';
  const billMsg = newBills ? ` · ${newBills} new bill${newBills===1?'':'s'}` : '';
  showToast(`Imported ${added} transaction${added===1?'':'s'}${skipped?`, skipped ${skipped}`:''}${ruleMsg}${billMsg}`);
  if (typeof renderMerchantRules === "function") renderMerchantRules();
  renderAll();
}

function importBankStatement(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const lower = file.name.toLowerCase();
    let parsed = [];
    try {
      if (lower.endsWith(".csv")) {
        parsed = parseGenericBankCSV(text);
      } else {
        // HTML / .xls (Santander). If looks like CSV, fall back.
        if (/<html|<table|<tr/i.test(text.slice(0, 4000))) parsed = parseSantanderHTML(text);
        else parsed = parseGenericBankCSV(text);
      }
    } catch (err) {
      showToast("Couldn't parse file — " + (err.message||"unknown error"));
      return;
    }
    // Best-effort first-guess from the filename so the user mostly only has to confirm.
    const fname = (file.name || "").toLowerCase();
    const guess = /amex|american|activity/.test(fname) ? "amex"
                 : /santander/.test(fname) ? "santander"
                 : null;
    runBankImportPipeline(parsed, guess);
  };
  reader.readAsText(file);
}

/* ── Multi-stage import pipeline ─────────────────────────────────────────────
 * Each step is a function that takes a `ctx` and a `next` callback. Cancelling
 * a step aborts the whole import (no review modal opens, no data written).
 * The pipeline runs:
 *   1. Issuer pick (#bankissuer-modal)
 *   2. Amex payments exclude/include (#amexpayments-modal)  — only when relevant
 *   3. Refund pairing (#refundpair-modal)                  — only when relevant
 *   4. Open the review modal with all decisions baked in.
 * ──────────────────────────────────────────────────────────────────────────── */
function runBankImportPipeline(parsed, guess) {
  if (!parsed || !parsed.length) { showToast("No transactions found in file"); return; }
  const ctx = { parsed, guess, issuer: "other", rows: [] };
  const steps = [
    stepPickIssuer,
    stepClassifyRows, // not a modal — derives _bankImpRows so later steps can inspect them
    stepAmexPayments,
    stepRefundPairs,
    stepOpenReview,
  ];
  const run = (i) => {
    if (i >= steps.length) return;
    steps[i](ctx, () => run(i + 1));
  };
  run(0);
}

function stepPickIssuer(ctx, next) {
  askStatementIssuer(ctx.parsed, ctx.guess, (issuer) => {
    ctx.issuer = issuer;
    next();
  });
}

// Run the row classifier early so step 2 / 3 have access to amexPayment + signedAmount.
// This duplicates a chunk of openBankImportModal's setup; the modal call later is a no-op
// for these fields (it re-classifies with the same inputs).
function stepClassifyRows(ctx, next) {
  _bankImpParsed = ctx.parsed;
  _bankImpIssuer = ctx.issuer;
  if (ctx.issuer === "amex") _bankImpSourceType = "credit";
  else if (ctx.issuer === "santander") _bankImpSourceType = "bank";
  else _bankImpSourceType = _guessSourceType(ctx.parsed);
  const existing = new Set(getTxns().map(t => dedupeKey(t.date, t.amount, t.description)));
  _bankImpRows = _classifyBankImportRows(ctx.parsed, _bankImpSourceType, existing, ctx.issuer);
  ctx.rows = _bankImpRows;
  next();
}

function stepAmexPayments(ctx, next) {
  if (ctx.issuer !== "amex") { next(); return; }
  const payments = ctx.rows.filter(r => r.amexPayment);
  if (!payments.length) { next(); return; }
  const modal = document.getElementById("amexpayments-modal");
  if (!modal) { next(); return; }
  document.getElementById("amexpayments-count").textContent = payments.length;
  document.getElementById("amexpayments-list").innerHTML = payments.map(p =>
    `<div>${p.date} · ${(p.rawDesc||'').slice(0,60)} · ${p.amount < 0 ? '−' : '+'}£${Math.abs(p.amount).toFixed(2)}</div>`
  ).join("");
  modal.hidden = false;
  const exclude = document.getElementById("amexpayments-exclude");
  const include = document.getElementById("amexpayments-include");
  const cancel  = document.getElementById("amexpayments-cancel");
  const cleanup = () => {
    modal.hidden = true;
    exclude.onclick = null; include.onclick = null; cancel.onclick = null;
    modal.removeEventListener("click", onBackdrop);
  };
  const onBackdrop = (e) => { if (e.target === modal) { cleanup(); /* dismiss = abort */ } };
  const pickInclude = (yes) => {
    ctx.rows.forEach(r => { if (r.amexPayment) r.include = !!yes; });
    cleanup();
    next();
  };
  exclude.onclick = () => pickInclude(false);
  include.onclick = () => pickInclude(true);
  cancel.onclick  = cleanup;
  modal.addEventListener("click", onBackdrop);
}

function stepRefundPairs(ctx, next) {
  const pairs = findRefundPairs(ctx.rows, getTxns());
  if (!pairs.length) { next(); return; }
  ctx.pairs = pairs;
  const modal = document.getElementById("refundpair-modal");
  if (!modal) { next(); return; }
  document.getElementById("refundpair-list").innerHTML = pairs.map((p, i) => {
    const r = ctx.rows[p.refundIdx];
    const origDateStr = p.originalDate || "—";
    const origLab = p.originalSource === "batch" ? `this import` : `your existing data`;
    return `<div class="refundpair-row" data-i="${i}">
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line-2);cursor:pointer">
        <input type="checkbox" checked data-i="${i}" style="width:15px;height:15px;accent-color:var(--accent);flex-shrink:0" />
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--ink)"><b>${r.name||'—'}</b></div>
          <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px">
            Charged ${origDateStr} for <b>${p.originalCategory||'—'}</b> · refunded ${r.date} (${origLab})
          </div>
        </div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:var(--pos);text-align:right">
          +£${Math.abs(r.amount).toFixed(2)}<div style="color:var(--ink-3);font-size:11px">↩ refund</div>
        </div>
      </label>
    </div>`;
  }).join("");
  modal.hidden = false;
  const apply  = document.getElementById("refundpair-apply");
  const skip   = document.getElementById("refundpair-skip");
  const cancel = document.getElementById("refundpair-cancel");
  const cleanup = () => {
    modal.hidden = true;
    apply.onclick = null; skip.onclick = null; cancel.onclick = null;
    modal.removeEventListener("click", onBackdrop);
  };
  const onBackdrop = (e) => { if (e.target === modal) cleanup(); };
  apply.onclick = () => {
    const accepted = [...modal.querySelectorAll('input[type="checkbox"][data-i]')]
      .filter(cb => cb.checked).map(cb => pairs[+cb.dataset.i]).filter(Boolean);
    applyRefundPairings(accepted);
    cleanup();
    next();
  };
  skip.onclick  = () => { cleanup(); next(); }; // none applied
  cancel.onclick = cleanup; // abort
  modal.addEventListener("click", onBackdrop);
}

function stepOpenReview(ctx, next) {
  // openBankImportModal re-classifies, but our ctx.rows are the source of truth
  // (Step 2/3 mutations live on them). Temporarily preserve their state across
  // the modal-open path by skipping the re-classify and just rendering.
  _bankImpExpandedGroups = new Set(); // fresh import → start everything collapsed
  _bankImpParsed = ctx.parsed;
  _bankImpIssuer = ctx.issuer;
  if (ctx.issuer === "amex") _bankImpSourceType = "credit";
  else if (ctx.issuer === "santander") _bankImpSourceType = "bank";
  // _bankImpRows is already ctx.rows from Step 2/3.
  const sourceSel = document.getElementById("bankimp-source-type");
  if (sourceSel) sourceSel.value = _bankImpSourceType;
  const acctSel = document.getElementById("bankimp-acct");
  const accts = [...new Set([...(typeof getTxAccts==="function"?getTxAccts():[]), ...(getSettings().accounts || [])])].filter(Boolean);
  if (!accts.length) accts.push(ctx.issuer === "amex" ? "Amex" : "Santander");
  const issuerRe = ctx.issuer === "amex" ? /amex|american\s*express/i
                  : ctx.issuer === "santander" ? /santander/i
                  : /santander/i;
  acctSel.innerHTML = accts.map(a => `<option value="${a}"${issuerRe.test(a)?' selected':''}>${a}</option>`).join("");
  updateBankImpSummary();
  renderBankImpList();
  _snapshotBankImp();
  document.getElementById("bankimp-modal").hidden = false;
}

/* ── Refund pairing helpers ─────────────────────────────────────────────────
 * A "refund pair" is a row with signedAmount < 0 (and not an Amex bank-payment)
 * matched against a positive row of the same cleaned-merchant + same |amount|
 * within ±30 days. The match can be in the same import batch OR in the user's
 * existing transactions. If we find one, we propose tagging the refund with
 * the original's expense category so the two cancel out in the breakdowns.
 * ──────────────────────────────────────────────────────────────────────────── */
function findRefundPairs(rows, existingTxns) {
  const pairs = [];
  const cleanName = (raw) => (cleanMerchant(raw).name || "").toLowerCase().trim();
  // Index existing expense txns by merchant for fast lookup.
  const expByName = new Map();
  (existingTxns || []).forEach(t => {
    if (normType(t) !== "out") return;
    const key = (t.description || "").toLowerCase().trim();
    if (!key) return;
    if (!expByName.has(key)) expByName.set(key, []);
    expByName.get(key).push(t);
  });
  rows.forEach((r, i) => {
    const signed = r.signedAmount != null ? r.signedAmount : (r.type === "in" ? r.amount : -r.amount);
    if (signed >= 0) return;
    if (r.amexPayment) return;
    const refundAmt = Math.abs(r.amount);
    const refundName = cleanName(r.rawDesc);
    if (!refundName) return;
    // 1. Same-batch match (positive row, same merchant, same amount, within ±30 days).
    let best = null, bestSrc = null, bestJ = null;
    rows.forEach((c, j) => {
      if (j === i) return;
      const cSigned = c.signedAmount != null ? c.signedAmount : (c.type === "in" ? c.amount : -c.amount);
      if (cSigned <= 0) return;
      if (Math.abs(Math.abs(c.amount) - refundAmt) > 0.01) return;
      if (cleanName(c.rawDesc) !== refundName) return;
      if (!_within30Days(c.date, r.date)) return;
      if (!best || (c.date || "") > (best.date || "")) { best = c; bestSrc = "batch"; bestJ = j; }
    });
    // 2. Existing-txn match (most recent matching expense within ±30 days).
    if (!best) {
      const candidates = expByName.get(refundName) || [];
      candidates.forEach(t => {
        if (Math.abs(t.amount - refundAmt) > 0.01) return;
        if (!_within30Days(t.date, r.date)) return;
        if (!best || (t.date || "") > (best.date || "")) { best = t; bestSrc = "existing"; bestJ = null; }
      });
    }
    if (best) {
      const cat = best.category || matchCat(cleanMerchant(best.description || best.rawDesc || r.rawDesc).cat, "exp");
      const origName = bestSrc === "batch"
        ? (cleanMerchant(best.rawDesc).name || best.rawDesc || "")
        : (best.description || "");
      pairs.push({
        refundIdx: i,
        originalCategory: cat,
        originalDate: best.date,
        originalSource: bestSrc,
        originalName: origName,
        originalAmount: best.amount,
        batchIdx: bestJ,
      });
    }
  });
  return pairs;
}
function _within30Days(a, b) {
  if (!a || !b) return false;
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  if (isNaN(da) || isNaN(db)) return false;
  return Math.abs(da - db) <= 30 * 24 * 60 * 60 * 1000;
}
function applyRefundPairings(pairs) {
  let existingTouched = false;
  const existingTxns = getTxns();
  const REF = (typeof REFUND_CAT !== "undefined") ? REFUND_CAT : "Refunds";
  const _cn = (raw) => (cleanMerchant(raw).name || "").toLowerCase().trim();
  (pairs || []).forEach(p => {
    const r = _bankImpRows[p.refundIdx];
    if (!r) return;
    r.type = "in";
    // Both legs of a paired refund go into the hidden "Refunds" category so they
    // net to zero and never count as real spending or income (nothing actually
    // left the account). We remember the original's real category only for the
    // informational ↑ ORIGINAL sub-row in the review list.
    r.category = (typeof REFUND_CAT !== "undefined") ? REFUND_CAT : "Refunds";
    r.isRefund = true;
    // Store the paired original charge so renderers can show both sides.
    r.refundPair = {
      source: p.originalSource,        // "batch" | "existing"
      name: p.originalName || r.name,
      date: p.originalDate || "",
      amount: p.originalAmount || r.amount,
      category: p.originalCategory || "",
    };
    // When the original charge is in THIS import too, also file it under Refunds
    // and hide its standalone row from the main review list — it's already shown
    // beneath the refund as the ↑ ORIGINAL sub-row. Both legs import (so the
    // pair is preserved) but both are excluded from totals.
    if (p.originalSource === "batch" && p.batchIdx != null) {
      const orig = _bankImpRows[p.batchIdx];
      if (orig) {
        orig.pairedAsOriginal = true;
        orig.pairedRefundIdx = p.refundIdx;
        orig.category = REF;
        orig.isRefund = true;
      }
    } else if (p.originalSource === "existing") {
      // The matched original charge is already in the user's saved data. Reclassify
      // THAT charge into Refunds too, so the pair fully cancels (otherwise the older
      // expense keeps counting as real spending — the Misc-leak bug). Match the same
      // way findRefundPairs did: out-txn, same cleaned merchant, |amount| within 1p,
      // and the captured original date. Reclassify the single best (most recent) hit.
      const wantName = _cn(p.originalName || r.rawDesc || r.name);
      const wantAmt = Math.abs(p.originalAmount != null ? p.originalAmount : r.amount);
      let bestT = null;
      existingTxns.forEach(t => {
        if (normType(t) !== "out") return;
        if (t.category === REF) return; // already filed
        if (Math.abs((t.amount || 0) - wantAmt) > 0.01) return;
        if (_cn(t.description || "") !== wantName) return;
        if (p.originalDate && t.date && !_within30Days(t.date, p.originalDate)) return;
        if (!bestT || (t.date || "") > (bestT.date || "")) bestT = t;
      });
      if (bestT) { bestT.category = REF; bestT.isRefund = true; existingTouched = true; }
    }
  });
  if (existingTouched) lsSet("fin_txns", existingTxns);
}

// Show the issuer-pick modal. Calls back with "amex" | "santander" | "other".
function askStatementIssuer(parsed, guess, cb) {
  const modal = document.getElementById("bankissuer-modal");
  if (!modal) { cb("other"); return; } // graceful fallback
  document.getElementById("bankissuer-rowcount").textContent =
    `${parsed.length} row${parsed.length===1?'':'s'} parsed from the file.`;
  // Subtle visual hint for the guessed option.
  modal.querySelectorAll(".btn-issuer").forEach(b => {
    const matches = guess && b.dataset.issuer === guess;
    b.style.borderColor = matches ? "var(--accent)" : "var(--line)";
    b.style.boxShadow   = matches ? "0 0 0 2px color-mix(in oklch, var(--accent) 30%, transparent)" : "none";
  });
  modal.hidden = false;
  const pick = (issuer) => { cleanup(); cb(issuer); };
  const onClickBtn = (e) => {
    const b = e.target.closest(".btn-issuer"); if (!b) return;
    pick(b.dataset.issuer);
  };
  const onCancel = () => { cleanup(); }; // dismiss = abort import
  const onBackdrop = (e) => { if (e.target === modal) cleanup(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); cleanup(); }
    else if (guess && e.key === "Enter") { e.preventDefault(); pick(guess); }
  };
  const cleanup = () => {
    modal.hidden = true;
    modal.removeEventListener("click", onClickBtn, true);
    modal.removeEventListener("click", onBackdrop);
    document.getElementById("bankissuer-cancel").removeEventListener("click", onCancel);
    document.removeEventListener("keydown", onKey);
  };
  modal.addEventListener("click", onClickBtn, true);
  modal.addEventListener("click", onBackdrop);
  document.getElementById("bankissuer-cancel").addEventListener("click", onCancel);
  document.addEventListener("keydown", onKey);
}

// Wire UI
(function wireBankImport() {
  const btn = document.getElementById("set-import-bank");
  const file = document.getElementById("set-import-bank-file");
  if (!btn || !file) return;
  btn.addEventListener("click", () => file.click());
  file.addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importBankStatement(f); });
  document.getElementById("bankimp-cancel").addEventListener("click", _tryCloseBankImpModal);
  document.getElementById("bankimp-import").addEventListener("click", commitBankImport);
  const groupChk = document.getElementById("bankimp-group");
  if (groupChk) groupChk.addEventListener("change", () => {
    _bankImpGrouped = groupChk.checked;
    renderBankImpList();
  });
  // Re-render so the per-row "remember as rule" toggles show/hide with the global checkbox.
  const learnChk = document.getElementById("bankimp-learn");
  if (learnChk) learnChk.addEventListener("change", () => renderBankImpList());
  document.getElementById("bankimp-modal").addEventListener("click", e => { if (e.target.id === "bankimp-modal") _tryCloseBankImpModal(); });
  // Statement-type toggle — re-classify all rows when the user flips bank ↔ credit card.
  const sourceSel = document.getElementById("bankimp-source-type");
  if (sourceSel) sourceSel.addEventListener("change", () => {
    _bankImpSourceType = sourceSel.value;
    const existing = new Set(getTxns().map(t => dedupeKey(t.date, t.amount, t.description)));
    _bankImpRows = _classifyBankImportRows(_bankImpParsed, _bankImpSourceType, existing, _bankImpIssuer);
    updateBankImpSummary();
      renderBankImpList();
    showToast(_bankImpSourceType === "credit" ? "Reclassified as credit card statement" : "Reclassified as bank statement");
  });
})();

/* ════════════════════════════════════════
   MERCHANT RULES — list / edit / delete UI
════════════════════════════════════════ */
let _ruleEditId = null;

// Tracks which rule ids are ticked for bulk delete. Cleared on every full render
// so it can't hold ids of rules that no longer exist.
let _rulesSelected = new Set();

function renderMerchantRules() {
  const list = document.getElementById("rules-list");
  if (!list) return;
  const rules = getMerchantRules();
  // Drop any selected ids that no longer exist, then reflect count on the toolbar.
  const liveIds = new Set(rules.map(r => String(r.id)));
  _rulesSelected = new Set([..._rulesSelected].filter(id => liveIds.has(id)));
  const deleteAllBtn = document.getElementById("rules-delete-all");
  if (deleteAllBtn) deleteAllBtn.style.display = rules.length ? "" : "none";

  if (!rules.length) {
    list.innerHTML = `<div class="rules-empty">No rules yet. Import a bank statement and confirm any row — the merchant pattern is saved automatically.</div>`;
    _updateRulesBulkBar();
    return;
  }
  const allOn = _rulesSelected.size === rules.length && rules.length > 0;
  const partial = _rulesSelected.size > 0 && !allOn;
  const masterCb = `<input type="checkbox" class="rules-master-cb" ${allOn?'checked':''} ${partial?'data-partial="1"':''} onchange="toggleAllRulesSelected(this.checked)" title="Select all / none" aria-label="Select all rules" />`;
  const head = `<div class="rules-head">${masterCb}<span>Pattern</span><span>Display name</span><span>Type</span><span>Category / To account</span><span></span></div>`;
  const rows = rules.map(r => {
    const target = r.type === "transfer" ? (r.toAccount || "—") : (r.category || "—");
    const id = String(r.id).replace(/'/g, "\\'");
    const checked = _rulesSelected.has(String(r.id)) ? "checked" : "";
    return `<div class="rules-row${checked?' is-selected':''}" data-id="${id}">
      <input type="checkbox" class="rules-row-cb" ${checked} onchange="toggleRuleSelected('${id}', this.checked)" aria-label="Select rule ${(r.name||r.pattern||'').replace(/"/g,'&quot;')}" />
      <span class="rule-pattern" title="${(r.pattern||'').replace(/"/g,'&quot;')}">${r.pattern || ''}</span>
      <span>${r.name || ''}</span>
      <span class="rule-type">${r.type || 'out'}</span>
      <span>${target}</span>
      <span class="rule-acts">
        <button title="Edit" onclick="openRuleModal('${id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button class="danger" title="Delete" onclick="deleteRule('${id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </span>
    </div>`;
  }).join("");
  list.innerHTML = head + rows;
  const mcb = list.querySelector(".rules-master-cb");
  if (mcb) mcb.indeterminate = partial;
  _updateRulesBulkBar();
}

// Show/update the "N selected · Delete selected" bar above the list.
function _updateRulesBulkBar() {
  let bar = document.getElementById("rules-bulk-bar");
  const n = _rulesSelected.size;
  if (!n) { if (bar) bar.remove(); return; }
  const list = document.getElementById("rules-list");
  if (!list) return;
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "rules-bulk-bar";
    bar.className = "rules-bulk-bar";
    list.parentNode.insertBefore(bar, list);
  }
  bar.innerHTML = `<span>${n} rule${n===1?'':'s'} selected</span>
    <div class="rules-bulk-acts">
      <button class="btn-ghost" onclick="toggleAllRulesSelected(false)">Clear</button>
      <button class="btn-ghost danger" onclick="deleteSelectedRules()">Delete selected</button>
    </div>`;
}

function toggleRuleSelected(id, on) {
  if (on) _rulesSelected.add(String(id)); else _rulesSelected.delete(String(id));
  renderMerchantRules();
}
function toggleAllRulesSelected(on) {
  if (on) _rulesSelected = new Set(getMerchantRules().map(r => String(r.id)));
  else _rulesSelected = new Set();
  renderMerchantRules();
}
function deleteSelectedRules() {
  const ids = [..._rulesSelected];
  if (!ids.length) return;
  confirmDialog({
    title: `Delete ${ids.length} rule${ids.length===1?'':'s'}?`,
    message: `This permanently removes the selected merchant rule${ids.length===1?'':'s'}. Your transactions aren't affected.`,
    confirmLabel: `Delete ${ids.length}`,
    danger: true,
  }, () => {
    const keep = getMerchantRules().filter(r => !_rulesSelected.has(String(r.id)));
    setMerchantRules(keep);
    _rulesSelected = new Set();
    renderMerchantRules();
    showToast(`Deleted ${ids.length} rule${ids.length===1?'':'s'}`);
  });
}
function deleteAllRules() {
  const n = getMerchantRules().length;
  if (!n) return;
  confirmDialog({
    title: `Delete all ${n} rules?`,
    message: `This permanently removes every saved merchant rule. Your transactions aren't affected — future imports just won't auto-fill from these patterns.`,
    confirmLabel: "Delete all",
    danger: true,
  }, () => {
    setMerchantRules([]);
    _rulesSelected = new Set();
    renderMerchantRules();
    showToast(`Deleted ${n} rule${n===1?'':'s'}`);
  });
}

function _ruleModalSyncCols() {
  const t = document.getElementById("rule-m-type").value;
  document.getElementById("rule-m-cat-row").style.display    = (t === "transfer") ? "none" : "";
  document.getElementById("rule-m-toacct-row").style.display = (t === "transfer") ? "" : "none";
}

function _populateRuleModalSelects(rule) {
  const t = document.getElementById("rule-m-type").value;
  const catSel = document.getElementById("rule-m-cat");
  const cats = (t === "in" ? getAllCats("in") : getAllCats("exp")).map(c => c.id);
  catSel.innerHTML = cats.map(c => `<option value="${c.replace(/"/g,'&quot;')}"${rule && rule.category === c ? ' selected' : ''}>${c}</option>`).join("");
  const accSel = document.getElementById("rule-m-toacct");
  const accts = _allKnownAccounts();
  const cur = rule && rule.toAccount ? rule.toAccount : "";
  accSel.innerHTML = [
    ...accts.map(a => `<option value="${a.replace(/"/g,'&quot;')}"${a === cur ? ' selected' : ''}>${a}</option>`),
    (cur && !accts.includes(cur)) ? `<option value="${cur.replace(/"/g,'&quot;')}" selected>${cur} (new)</option>` : "",
  ].join("");
}

function openRuleModal(id = null) {
  _ruleEditId = id;
  const rule = id ? getMerchantRules().find(r => String(r.id) === String(id)) : null;
  document.getElementById("rule-modal-title").textContent = id ? "Edit merchant rule" : "Add merchant rule";
  document.getElementById("rule-m-pattern").value = rule ? (rule.pattern || "") : "";
  document.getElementById("rule-m-name").value = rule ? (rule.name || "") : "";
  document.getElementById("rule-m-type").value = rule ? (rule.type || "out") : "out";
  _populateRuleModalSelects(rule);
  _ruleModalSyncCols();
  document.getElementById("rule-modal").hidden = false;
  setTimeout(() => document.getElementById("rule-m-pattern").focus(), 30);
}
function closeRuleModal() { document.getElementById("rule-modal").hidden = true; _ruleEditId = null; }

function saveRuleFromModal() {
  const pattern = document.getElementById("rule-m-pattern").value.trim();
  const name = document.getElementById("rule-m-name").value.trim();
  const type = document.getElementById("rule-m-type").value;
  if (!pattern) { showToast("Pattern is required"); return; }
  if (!name) { showToast("Name is required"); return; }
  const rule = { pattern, name, type };
  if (type === "transfer") rule.toAccount = document.getElementById("rule-m-toacct").value || "";
  else rule.category = document.getElementById("rule-m-cat").value || "";
  if (_ruleEditId) {
    // Replace existing by id (preserves id; pattern may have been changed by user).
    const rules = getMerchantRules();
    const idx = rules.findIndex(r => String(r.id) === String(_ruleEditId));
    if (idx >= 0) rules[idx] = { ...rules[idx], ...rule };
    setMerchantRules(rules);
  } else {
    upsertMerchantRule(rule);
  }
  closeRuleModal();
  renderMerchantRules();
  showToast("Rule saved");
}

function deleteRule(id) {
  const rule = getMerchantRules().find(r => String(r.id) === String(id));
  if (!rule) return;
  confirmDialog({
    title: "Delete rule?",
    message: `Delete the rule for "${rule.name || rule.pattern}"?`,
    confirmLabel: "Delete",
    danger: true,
  }, () => {
    deleteMerchantRule(id);
    renderMerchantRules();
    showToast("Rule deleted");
  });
}

// Wire rules UI + modal
(function wireMerchantRulesUI() {
  const addBtn = document.getElementById("rules-add");
  if (!addBtn) return;
  addBtn.addEventListener("click", () => openRuleModal(null));
  document.getElementById("rule-m-cancel").addEventListener("click", closeRuleModal);
  document.getElementById("rule-m-save").addEventListener("click", saveRuleFromModal);
  document.getElementById("rule-m-type").addEventListener("change", () => { _populateRuleModalSelects(null); _ruleModalSyncCols(); });
  document.getElementById("rule-modal").addEventListener("click", e => { if (e.target.id === "rule-modal") closeRuleModal(); });
  // Export / import the rules list as JSON
  document.getElementById("rules-export").addEventListener("click", () => {
    const rules = getMerchantRules();
    if (!rules.length) { showToast("No rules to export"); return; }
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `japtrack-merchant-rules-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    showToast("Rules exported");
  });
  const delAllBtn = document.getElementById("rules-delete-all");
  if (delAllBtn) delAllBtn.addEventListener("click", deleteAllRules);
  document.getElementById("rules-import").addEventListener("click", () => document.getElementById("rules-import-file").click());
  document.getElementById("rules-import-file").addEventListener("change", e => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const arr = JSON.parse(ev.target.result);
        if (!Array.isArray(arr)) throw new Error("expected array");
        confirmDialog({ title: "Import rules?", message: `This will REPLACE your current ${getMerchantRules().length} rule(s) with ${arr.length} from the file.`, confirmLabel: "Replace", danger: true }, () => {
          setMerchantRules(arr);
          renderMerchantRules();
          showToast(`Imported ${arr.length} rule${arr.length===1?'':'s'}`);
        });
      } catch { showToast("Import failed — invalid JSON"); }
    };
    reader.readAsText(file);
  });
  renderMerchantRules();
})();

function importCSVText(text) {
  const rows = parseCSV(text).filter(r => r.length && r.some(c => c.trim()));
  if (!rows.length) return { ok: 0, fail: 0, error: "Empty file" };
  const headers = rows[0].map(mapCSVHeader);
  if (!headers.includes("date") || !headers.includes("amount")) {
    return { ok: 0, fail: 0, error: "Could not detect 'date' or 'amount' columns. Expected headers: date, amount, description, category, account, type." };
  }
  const txns = getTxns();
  const addedTxns = [];
  let ok = 0, fail = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const obj = {};
    headers.forEach((h, idx) => { if (h && row[idx] !== undefined) obj[h] = (row[idx]||"").trim(); });
    const date = parseImportDate(obj.date);
    if (!date) { fail++; continue; }
    const rawAmt = (obj.amount||"").replace(/[£$€,]/g, "").trim();
    const amt = parseFloat(rawAmt);
    if (isNaN(amt)) { fail++; continue; }
    let type = (obj.type||"").toLowerCase();
    if (!["in","out","transfer","income","expense"].includes(type)) {
      type = amt < 0 ? "out" : "in";
    }
    if (type === "income") type = "in";
    if (type === "expense") type = "out";
    const tx = {
      id: Date.now() + Math.floor(Math.random()*100000) + i,
      type, amount: Math.abs(amt), date,
      description: obj.description || "",
      category: obj.category || (type === "in" ? "Other Income" : "Misc"),
      account: obj.account || ""
    };
    if (obj.notes && obj.notes.trim()) tx.notes = obj.notes.trim();
    if (type === "transfer") {
      tx.fromAccount = obj.fromAccount || obj.account || "";
      tx.toAccount = obj.toAccount || "";
      delete tx.account;
    }
    txns.push(tx);
    addedTxns.push(tx);
    ok++;
  }
  lsSet("fin_txns", txns);
  const newBills = (typeof ensureBillsFromTxns === "function") ? ensureBillsFromTxns(addedTxns) : 0;
  return { ok, fail, newBills };
}
function importJSONText(text) {
  // Routes both new bundled exports and legacy flat fin_*-keyed exports
  // through the Store, which figures out which format it is.
  const before = new Set(getTxns().map(t => t && t.id));
  Store.importAll(JSON.parse(text));
  // After a restore, scan the new txns set for any Repayments/Subscriptions that
  // don't already have a matching scheduled item — auto-create them.
  if (typeof ensureBillsFromTxns === "function") {
    const newOnes = getTxns().filter(t => t && !before.has(t.id));
    ensureBillsFromTxns(newOnes);
  }
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const isCSV = file.name.toLowerCase().endsWith(".csv") || /^[^{[\n]*[Dd]ate.*[,]/.test(text.slice(0, 200));
    if (isCSV) {
      confirmDialog({ title:"Import CSV?", message:`Import CSV transactions from "${file.name}"? Rows will be ADDED to your existing data (not replaced).`, confirmLabel:"Import", danger:false }, () => {
        const r = importCSVText(text);
        if (r.error) { showToast("Import failed — " + r.error); return; }
        const billMsg = r.newBills ? ` · ${r.newBills} new bill${r.newBills===1?'':'s'}` : '';
        showToast(`Imported ${r.ok} transaction${r.ok!==1?'s':''}${r.fail?`, skipped ${r.fail}`:''}${billMsg}`);
        rebuildCatBy();
        renderAll();
        resyncApprAfterImport();
      });
    } else {
      // Validate BEFORE asking to confirm — never let a non-Japtrack file
      // get anywhere near a destructive replace.
      let parsed;
      try { parsed = JSON.parse(text); }
      catch { showToast(`"${file.name}" isn't valid JSON`); return; }
      if (!isRestorableBackup(parsed)) {
        showToast(`"${file.name}" isn't a Japtrack backup`);
        return;
      }
      confirmDialog({
        title: "Restore backup?",
        message: `This REPLACES all current data with the contents of "${file.name}". Export a backup first if you're unsure — this can't be undone.`,
        confirmLabel: "Replace all data",
        danger: true,
      }, () => {
        try {
          Store.importAll(parsed);
          rebuildCatBy();
          showToast("Backup restored");
          renderAll();
          resyncApprAfterImport();
        } catch (err) {
          console.error("Restore failed", err);
          showToast("Restore failed — file may be corrupt");
        }
      });
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  confirmDialog({
    title: "Delete ALL data?",
    message: "This wipes transactions, budgets, snapshots, scheduled items, goals, and settings. Cannot be undone.",
    confirmLabel: "Delete everything",
    danger: true,
  }, () => {
    Store.resetAll();
    [STORE_KEY, ...STORE_BACKUPS,
     "fin_txns","fin_budgets","fin_nw_entries","fin_recurring","fin_goals","fin_settings","fin_forecast","fin_plans","fin_alloc_plan","fin_debts","fin_holidays",
     "ledger_theme","ledger_density","ledger_nav_expanded"
    ].forEach(k => localStorage.removeItem(k));
    showToast("All data reset");
    setTimeout(() => location.reload(), 800);
  });
}

/* ── Budget: copy last month's actuals ──
   Button temporarily removed from the topbar (to be relocated); guard with ?. so its
   absence doesn't throw at load. Handler kept for when the control is re-added. */
document.getElementById("bud-copy-prev")?.addEventListener("click", () => {
  const [py, pm] = prevMonth(_viewMonth.y, _viewMonth.m);
  const prevMs = mStat(getTxns(), py, pm);
  const cats = {};
  prevMs.txns.filter(t => normType(t)==="out" && t.category).forEach(t => {
    cats[t.category] = (cats[t.category]||0) + t.amount;
  });
  if (!Object.keys(cats).length) { showToast(`No expenses in ${monthLabel(py,pm)}`); return; }
  confirmDialog({ title:"Copy budgets?", message:`Set budget amounts from ${monthLabel(py,pm)} actuals? Existing budget amounts will be updated.`, confirmLabel:"Copy", danger:false }, () => {
    let buds = getBudgets();
    Object.entries(cats).forEach(([cat, amt]) => {
      const existing = buds.find(b => budCatOf(b) === cat && b.type === "out");
      if (existing) { existing.amount = Math.round(amt * 10) / 10; }
      else { buds.push({ id: cat, type: "out", amount: Math.round(amt * 10) / 10 }); }
    });
    lsSet("fin_budgets", buds);
    showToast(`Budgets set from ${monthLabel(py,pm)}`);
    renderAll();
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   Import & Export — unified ticklist
   One checklist of data sections + a shared Export / Import / Reset toolbar,
   replacing the old ~30 per-section buttons. Format (JSON combined vs CSV
   per-file) and an optional date range are global toggles that apply to the
   ticked sections. Accounts live under settings.accounts, so they're special-
   cased everywhere a localStorage key is written.
   ────────────────────────────────────────────────────────────────────────── */
const IE_SECTIONS = [
  { id: "txns",      label: "Transactions",          key: "fin_txns",                   getter: () => getTxns(),                    dated: "date"  },
  { id: "accounts",  label: "Accounts",              key: "fin_settings.accounts",      getter: () => (getSettings().accounts || []) },
  { id: "snapshots", label: "Balance snapshots",     key: "fin_nw_entries",             getter: () => getNWEntries(),               dated: "month" },
  { id: "budgets",   label: "Budgets",               key: "fin_budgets",                getter: () => getBudgets()                  },
  { id: "sched",     label: "Bills & Subscriptions", key: "fin_recurring",              getter: () => getRecurring()                },
  { id: "debts",     label: "Balance projection",    key: "fin_debts",                  getter: () => getDebts()                    },
  { id: "goals",     label: "Goals",                 key: "fin_goals",                  getter: () => getGoals()                    },
  { id: "projects",  label: "Projects",              key: "fin_holidays",               getter: () => getHolidays()                 },
  { id: "forecast",  label: "Forecast",              key: "fin_forecast",               getter: () => getForecasts()                },
  { id: "plans",     label: "Forecast plans",        key: "fin_plans",                  getter: () => getPlans()                    },
  { id: "rules",     label: "Merchant rules",        key: "fin_settings.merchantRules", getter: () => getMerchantRules()            },
];
let _ieFormat = "json";   // "json" | "csv"

function _ieSelected() {
  return IE_SECTIONS.filter(s => document.querySelector(`.ie-sec[data-sec="${s.id}"]`)?.checked);
}
// {all, ok, fromMs, toMs} from the All-time checkbox + From/To month inputs.
function _ieRange() {
  if (document.getElementById("ie-all-time")?.checked) return { all: true, ok: true };
  const from = document.getElementById("ie-from")?.value;
  const to   = document.getElementById("ie-to")?.value;
  if (!from || !to) return { all: false, ok: false };
  const fromMs = new Date(from + "-01T00:00:00").getTime();
  const [ty, tm] = to.split("-").map(Number);
  const toMs = new Date(ty, tm, 1).getTime();   // exclusive — start of the month after "to"
  return { all: false, ok: true, fromMs, toMs };
}
// A section's data, date-filtered when it's a dated section and a range is set.
function _ieData(s, range) {
  const arr = (s.getter() || []).slice();
  if (range.all || !s.dated) return arr;
  return arr.filter(it => {
    const t = s.dated === "date"
      ? (it.date ? new Date(it.date + "T00:00:00").getTime() : NaN)
      : (it.month ? monthToTime(it.month) : NaN);
    return !isNaN(t) && t >= range.fromMs && t < range.toMs;
  });
}
function _ieDownload(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
/* ── CSV builders (tailored for txns/snapshots, generic for the rest) ── */
function _ieTxnsCSV(list) {
  const cols = ["date","type","description","category","account","fromAccount","toAccount","amount","notes"];
  return [cols.join(","), ...list.map(t => cols.map(c => csvEscape(t[c])).join(","))].join("\r\n");
}
function _ieSnapshotsCSV(list) {
  const cats = [...new Set(list.flatMap(e => (e.allocations || []).map(a => a.cat)))];
  const rows = [["month", ...cats, "total"].join(",")];
  list.forEach(e => {
    const m = {}; (e.allocations || []).forEach(a => m[a.cat] = a.value);
    const total = cats.reduce((sum, c) => sum + (Number(m[c]) || 0), 0);
    rows.push([csvEscape(e.month), ...cats.map(c => csvEscape(m[c] ?? "")), csvEscape(total)].join(","));
  });
  return rows.join("\r\n");
}
function _ieGenericCSV(arr) {
  if (!arr.length) return "";
  if (arr.every(x => typeof x !== "object" || x === null)) {   // primitives, e.g. account-name strings
    return ["value", ...arr.map(v => csvEscape(v))].join("\r\n");
  }
  const keys = [...new Set(arr.flatMap(o => Object.keys(o || {})))];
  const cell = v => (v && typeof v === "object") ? csvEscape(JSON.stringify(v)) : csvEscape(v);
  return [keys.join(","), ...arr.map(o => keys.map(k => cell((o || {})[k])).join(","))].join("\r\n");
}
function _ieSectionCSV(s, data) {
  if (s.id === "txns")      return _ieTxnsCSV(data);
  if (s.id === "snapshots") return _ieSnapshotsCSV(data);
  return _ieGenericCSV(data);
}

function ieExport() {
  const sel = _ieSelected();
  if (!sel.length) { showToast("Tick at least one section to export"); return; }
  const range = _ieRange();
  if (!range.ok) { showToast("Pick a From and To month, or tick All time"); return; }
  const stamp = new Date().toISOString().slice(0,10);
  if (_ieFormat === "json") {
    const out = { app: "Japtrack", kind: "partial-export", exported_at: new Date().toISOString(), sections: {} };
    sel.forEach(s => { out.sections[s.id] = _ieData(s, range); });
    _ieDownload(`ledger-export-${stamp}.json`, JSON.stringify(out, null, 2), "application/json");
    showToast(`Exported ${sel.length} section${sel.length > 1 ? "s" : ""}`);
  } else {
    let n = 0;
    sel.forEach(s => {
      const csv = _ieSectionCSV(s, _ieData(s, range));
      if (csv) { _ieDownload(`ledger-${s.id}-${stamp}.csv`, csv, "text/csv;charset=utf-8"); n++; }
    });
    showToast(n ? `Exported ${n} CSV file${n > 1 ? "s" : ""}` : "Nothing to export in that range");
  }
}

function ieImport(file) {
  // A bank-style CSV only makes sense for transactions — hand it to the adder.
  if (file.name.toLowerCase().endsWith(".csv")) { importData(file); return; }
  const reader = new FileReader();
  reader.onload = e => {
    let parsed;
    try { parsed = JSON.parse(e.target.result); }
    catch { showToast(`"${file.name}" isn't valid JSON`); return; }
    // A full backup (Store export) → whole-app restore.
    if (typeof isRestorableBackup === "function" && isRestorableBackup(parsed) && !parsed.sections) {
      confirmDialog({ title: "Restore full backup?", message: `This REPLACES ALL current data with "${file.name}". Can't be undone.`, confirmLabel: "Replace all", danger: true }, () => {
        try { Store.importAll(parsed); rebuildCatBy(); showToast("Backup restored"); renderAll(); resyncApprAfterImport(); }
        catch { showToast("Restore failed — file may be corrupt"); }
      });
      return;
    }
    // Otherwise a partial export ({sections:{…}}) or a bare {id:[…]} map.
    const sections = parsed && parsed.sections ? parsed.sections
                   : (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
    const present = sections ? IE_SECTIONS.filter(s => Array.isArray(sections[s.id])) : [];
    if (!present.length) { showToast(`No known sections found in "${file.name}"`); return; }
    const ticked = new Set(_ieSelected().map(s => s.id));
    const target = ticked.size ? present.filter(s => ticked.has(s.id)) : present;
    if (!target.length) { showToast("None of the ticked sections are in that file"); return; }
    confirmDialog({ title: "Import sections?", message: `This REPLACES your ${target.map(s => s.label).join(", ")} with the file's contents.`, confirmLabel: "Replace", danger: true }, () => {
      let extra = "";
      target.forEach(s => {
        const data = sections[s.id];
        if (s.key.startsWith("fin_settings.")) { const sub = s.key.slice(13); const st = getSettings(); st[sub] = data; lsSet("fin_settings", st); }
        else {
          lsSet(s.key, data);
          if (s.id === "txns" && typeof ensureBillsFromTxns === "function") { const nb = ensureBillsFromTxns(data); if (nb) extra = ` · ${nb} new bill${nb === 1 ? "" : "s"}`; }
        }
      });
      rebuildCatBy();
      showToast(`Imported ${target.length} section${target.length > 1 ? "s" : ""}${extra}`);
      renderAll(); resyncApprAfterImport();
    });
  };
  reader.readAsText(file);
}

function ieReset() {
  const sel = _ieSelected();
  if (!sel.length) { showToast("Tick at least one section to reset"); return; }
  confirmDialog({
    title: `Reset ${sel.length} section${sel.length > 1 ? "s" : ""}?`,
    message: `This deletes: ${sel.map(s => s.label).join(", ")}. Other data is kept. Can't be undone — export first if you might need it back.`,
    confirmLabel: "Delete", danger: true,
  }, () => {
    sel.forEach(s => {
      if (s.key.startsWith("fin_settings.")) { const sub = s.key.slice(13); const st = getSettings(); st[sub] = []; lsSet("fin_settings", st); }
      else lsSet(s.key, []);
    });
    showToast(`Reset ${sel.length} section${sel.length > 1 ? "s" : ""}`);
    renderAll();
    if (typeof resyncApprAfterImport === "function") resyncApprAfterImport();
  });
}

// Populate the section ticklist with live item counts. Re-run whenever Settings opens.
function renderIEList() {
  const list = document.getElementById("ie-list"); if (!list) return;
  const checked = new Set([...list.querySelectorAll(".ie-sec:checked")].map(c => c.dataset.sec)); // preserve ticks across re-render
  list.innerHTML = IE_SECTIONS.map(s => {
    const n = (s.getter() || []).length;
    return `<label class="ie-row">
      <input type="checkbox" class="ie-sec" data-sec="${s.id}"${checked.has(s.id) ? " checked" : ""}>
      <span class="ie-name">${s.label}</span>
      <span class="ie-count">${n} item${n === 1 ? "" : "s"}</span>
      ${s.dated ? '<span class="ie-flag" title="Honours the date range above">dated</span>' : ""}
    </label>`;
  }).join("");
  const all = document.getElementById("ie-select-all"); if (all) all.checked = false;
}

// Wire the toolbar once (the #sec-data block persists in the DOM).
function _ieWire() {
  const root = document.getElementById("sec-data"); if (!root || root._ieWired) return; root._ieWired = true;
  document.getElementById("ie-format")?.addEventListener("click", e => {
    const b = e.target.closest("[data-fmt]"); if (!b) return;
    _ieFormat = b.dataset.fmt;
    document.querySelectorAll("#ie-format button").forEach(x => x.setAttribute("aria-pressed", x.dataset.fmt === _ieFormat));
  });
  const allTime = document.getElementById("ie-all-time");
  const rangeWrap = document.getElementById("ie-range");
  const syncRange = () => { const on = !!allTime?.checked; if (rangeWrap) { rangeWrap.style.opacity = on ? "0.45" : "1"; rangeWrap.style.pointerEvents = on ? "none" : "auto"; } };
  allTime?.addEventListener("change", syncRange); syncRange();
  document.getElementById("ie-select-all")?.addEventListener("change", e => {
    document.querySelectorAll(".ie-sec").forEach(c => { c.checked = e.target.checked; });
  });
  // Keep the header "select all" box in sync with individual ticks.
  document.getElementById("ie-list")?.addEventListener("change", () => {
    const boxes = [...document.querySelectorAll(".ie-sec")];
    const all = document.getElementById("ie-select-all");
    if (all) all.checked = boxes.length > 0 && boxes.every(c => c.checked);
  });
  document.getElementById("ie-export")?.addEventListener("click", ieExport);
  document.getElementById("ie-import")?.addEventListener("click", () => document.getElementById("ie-import-file").click());
  document.getElementById("ie-import-file")?.addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) ieImport(f); });
  document.getElementById("ie-reset")?.addEventListener("click", ieReset);
  document.getElementById("ie-reset-all")?.addEventListener("click", resetAll);
}


/* ── Appearance: save bar wiring ──
   Snapshotting is LAZY: we capture in the capture phase of the first interaction,
   so the snapshot reflects the user's actual current state — not whatever defaults
   were in localStorage before file hydration. This is what Discard rolls back to. */
(function wireApprSaveBar() {
  const sec = document.getElementById('sec-appearance');
  if (!sec) return;
  // Skip snapshotting for elements that aren't real "settings" — Save/Discard buttons
  // are inside the section but shouldn't trigger a snapshot themselves.
  const skipSnapshot = (target) => !!(target && target.closest && target.closest('#set-appr-savebar'));

  document.getElementById('set-appr-save').addEventListener('click', saveAppr);
  document.getElementById('set-appr-discard').addEventListener('click', () => {
    confirmDialog({
      title: 'Discard changes?',
      message: 'Revert appearance back to before your unsaved changes.',
      confirmLabel: 'Discard',
      danger: true,
    }, discardAppr);
  });

  // Capture phase: snapshot BEFORE the per-input handlers persist changes.
  const captureBefore = (e) => { if (!skipSnapshot(e.target)) maybeCaptureApprSnapshot(); };
  sec.addEventListener('input',  captureBefore, true);
  sec.addEventListener('change', captureBefore, true);
  sec.addEventListener('click',  captureBefore, true);

  // Bubble phase: after the handler persisted, recompute dirty state for the save bar.
  const refresh = () => setTimeout(updateApprSaveBar, 0);
  sec.addEventListener('input',  refresh);
  sec.addEventListener('change', refresh);
  sec.addEventListener('click',  refresh);
  updateApprSaveBar();
})();

