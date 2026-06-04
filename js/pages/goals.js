/* ════════════════════════════════════════
   GOALS TAB
════════════════════════════════════════ */
let _goalEditId = null;
let _goalModalType = "manual";

function getGoalCurrent(g) {
  if (g.type === "bucket" && g.bucket) {
    const entries = nwSnapshotsSorted();
    if (!entries.length) return g.startValue || 0;
    const last = entries[entries.length-1];
    const v = last.allocations.find(a => a.cat === g.bucket)?.value || 0;
    return Math.max(0, v - (g.startValue || 0));
  }
  return g.currentValue || 0;
}

function renderGoals() {
  const goals = getGoals();
  const subEl = document.getElementById("goals-sub-count");
  if (subEl) subEl.textContent = goals.length
    ? `${goals.length} goal${goals.length>1?'s':''}`
    : "";
  const grid = document.getElementById("goals-grid");
  if (!grid) return;
  if (!goals.length) {
    grid.innerHTML = `<div class="page-stub"><h3>No savings goals yet</h3><div>Set a savings target — track it manually or pin it to one of your net-worth buckets.</div></div>`;
    return;
  }
  const today = new Date();
  grid.innerHTML = goals.map(g => {
    const cur = getGoalCurrent(g);
    const pct = g.target > 0 ? (cur / g.target) * 100 : 0;
    const complete = pct >= 100;
    let deadlineHtml = "", overdue = false, daysLeft = null;
    if (g.deadline) {
      const dl = new Date(g.deadline + "T23:59:59");
      const ms = dl - today;
      daysLeft = Math.ceil(ms / 86400000);
      overdue = daysLeft < 0 && !complete;
      const cls = complete ? "" : (daysLeft < 0 ? "overdue" : daysLeft <= 30 ? "urgent" : "");
      const dlText = complete ? "" : (daysLeft < 0 ? `${-daysLeft}d overdue` : daysLeft === 0 ? "due today" : `${daysLeft}d left`);
      deadlineHtml = dlText ? `<span class="deadline ${cls}">${dlText}</span>` : "";
    }
    const fillColor = complete ? 'var(--pos)' : (overdue ? 'var(--neg)' : (g.color || 'var(--accent)'));
    const cardCls = complete ? 'complete' : (overdue ? 'overdue' : '');
    const sub = g.type === "bucket"
      ? `Tracks ${g.bucket} bucket`
      : `Manual${g.deadline ? ` · target ${new Date(g.deadline+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}` : ''}`;
    const safeId = String(g.id).replace(/'/g,"\\'");
    return `<div class="goal-card ${cardCls}">
      <div class="goal-card-head">
        <div class="goal-ic" style="background:color-mix(in oklch,${g.color||'var(--accent)'} 30%,var(--bg-sunk))">${g.icon || '🎯'}</div>
        <div class="goal-info">
          <h4>${g.name}${complete ? ' <span style="font-size:11px;font-weight:500;color:var(--pos);background:var(--pos-soft);padding:2px 7px;border-radius:999px;margin-left:6px">DONE ✓</span>' : ''}</h4>
          <div class="sub">${sub}</div>
        </div>
        <div class="goal-acts">
          <button title="Edit" onclick="openGoalModal('${safeId}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="danger" title="Delete" onclick="deleteGoal('${safeId}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
        </div>
      </div>
      <div class="goal-amount num blur">${fmtGBP(cur,{dp:0})} <span class="of">/ ${fmtGBP(g.target,{dp:0})}</span></div>
      <div class="goal-track"><div class="goal-fill" style="width:${Math.min(100,pct).toFixed(1)}%;background:${fillColor}"></div></div>
      <div class="goal-foot">
        <span class="pct">${pct.toFixed(0)}%</span>
        ${deadlineHtml}
      </div>
      ${g.type === "manual" && !complete ? `
      <div class="goal-manual-input">
        <input type="number" step="0.01" placeholder="Add amount" id="goal-add-${safeId}" />
        <button onclick="addToManualGoal('${safeId}')">+ Add</button>
      </div>` : ''}
    </div>`;
  }).join("");
}

function openGoalModal(id) {
  _goalEditId = id;
  const goals = getGoals();
  const g = id ? goals.find(x => String(x.id) === String(id)) : null;
  document.getElementById("goal-modal-title").textContent = id ? "Edit goal" : "Add goal";
  _goalModalType = g?.type || "manual";
  document.querySelectorAll("#goal-m-type-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === _goalModalType));
  document.getElementById("goal-m-name").value = g?.name || "";
  document.getElementById("goal-m-target").value = g?.target || "";
  document.getElementById("goal-m-deadline").value = g?.deadline || "";
  document.getElementById("goal-m-icon").value = g?.icon || "🎯";
  document.getElementById("goal-m-color").value = g?.color || "#7fb069";
  document.getElementById("goal-m-current").value = g?.currentValue ?? 0;
  document.getElementById("goal-m-start").value = g?.startValue ?? "";
  document.getElementById("goal-m-bucket").innerHTML = NW_CATS.map(c => `<option value="${c.id}"${g?.bucket===c.id?' selected':''}>${c.id}</option>`).join("");
  syncGoalModalType();
  document.getElementById("goal-modal").hidden = false;
  setTimeout(() => document.getElementById("goal-m-name").focus(), 50);
}
function syncGoalModalType() {
  document.querySelectorAll("#goal-modal .row[data-only]").forEach(r => {
    r.dataset.hidden = r.dataset.only !== _goalModalType;
  });
}
function closeGoalModal() { document.getElementById("goal-modal").hidden = true; _goalEditId = null; }
function saveGoal() {
  const name = document.getElementById("goal-m-name").value.trim();
  const target = parseFloat(document.getElementById("goal-m-target").value);
  if (!name) { showToast("Please enter a name"); return; }
  if (!target || target <= 0) { showToast("Please enter a target"); return; }
  const goal = {
    id: _goalEditId || (Date.now() + Math.floor(Math.random()*1000)),
    name, target,
    deadline: document.getElementById("goal-m-deadline").value || null,
    type: _goalModalType,
    icon: document.getElementById("goal-m-icon").value || "🎯",
    color: document.getElementById("goal-m-color").value
  };
  if (_goalModalType === "bucket") {
    goal.bucket = document.getElementById("goal-m-bucket").value;
    const startInput = document.getElementById("goal-m-start").value;
    if (startInput !== "") goal.startValue = parseFloat(startInput);
    else {
      // Default to current bucket value so progress starts at zero
      const entries = nwSnapshotsSorted();
      const last = entries.length ? entries[entries.length-1] : null;
      goal.startValue = last ? (last.allocations.find(a=>a.cat===goal.bucket)?.value||0) : 0;
    }
  } else {
    goal.currentValue = parseFloat(document.getElementById("goal-m-current").value) || 0;
  }
  let goals = getGoals();
  if (_goalEditId) {
    const idx = goals.findIndex(x => String(x.id) === String(_goalEditId));
    if (idx >= 0) goals[idx] = goal;
  } else {
    goals.push(goal);
  }
  lsSet("fin_goals", goals);
  closeGoalModal();
  showToast(_goalEditId ? "Goal updated" : "Goal added");
  renderAll();
}
function deleteGoal(id) {
  confirmDialog({ title:"Delete goal?", message:"This can't be undone.", confirmLabel:"Delete", danger:true }, () => {
    const goals = getGoals().filter(g => String(g.id) !== String(id));
    lsSet("fin_goals", goals);
    showToast("Goal deleted");
    renderAll();
  });
}
function addToManualGoal(id) {
  const inp = document.getElementById("goal-add-" + id);
  if (!inp) return;
  const add = parseFloat(inp.value);
  if (!add || add <= 0) { showToast("Enter an amount"); return; }
  const goals = getGoals();
  const g = goals.find(x => String(x.id) === String(id));
  if (!g) return;
  g.currentValue = (g.currentValue || 0) + add;
  lsSet("fin_goals", goals);
  inp.value = "";
  showToast(`+${fmtGBP(add,{dp:0})} added to ${g.name}`);
  renderAll();
}

document.getElementById("goals-add-btn")?.addEventListener("click", () => openGoalModal(null));
document.getElementById("goal-m-cancel").addEventListener("click", closeGoalModal);
document.getElementById("goal-m-save").addEventListener("click", saveGoal);
document.getElementById("goal-modal").addEventListener("click", e => { if (e.target.id === "goal-modal") closeGoalModal(); });
document.getElementById("goal-m-type-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-type]"); if (!b) return;
  _goalModalType = b.dataset.type;
  document.querySelectorAll("#goal-m-type-seg button").forEach(btn => btn.setAttribute("aria-pressed", btn.dataset.type === _goalModalType));
  syncGoalModalType();
});

