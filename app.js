// ── Constants ─────────────────────────────────────────────────────────────────

const STATUSES = ['Not started', 'In progress', 'Coffee chat & TY', 'TY', 'Done', '-'];

// SOM/Yale field helpers
function parseSomYale(val) {
  const v = String(val || '').trim();
  if (!v || v.toLowerCase() === 'false') return { affiliated: false, year: '' };
  const m = v.match(/['']?(\d{2,4})/);
  if (m) {
    const y = m[1].length === 4 ? m[1].slice(2) : m[1];
    return { affiliated: true, year: y };
  }
  return { affiliated: true, year: '' };
}

function buildSomYale(affiliated, yearInput) {
  if (!affiliated) return 'false';
  const y = String(yearInput || '').trim().replace(/^['']/, '').replace(/^20/, '');
  return y ? `SOM '${y}` : 'SOM';
}

const STATUS_CLASS = {
  'Not started': 's-none',
  'In progress': 's-prog',
  'Coffee chat & TY': 's-coffee',
  'TY': 's-ty',
  'Done': 's-done',
  '-': 's-dash',
};

const COLS = [
  { key: 'name',          label: 'Name',         w: 170, locked: true },
  { key: 'firm',          label: 'Firm',         w: 150 },
  { key: 'role',          label: 'Role',         w: 150 },
  { key: 'office',        label: 'Office',       w: 110 },
  { key: 'email',         label: 'Email',        w: 180 },
  { key: 'status',        label: 'Status',       w: 145 },
  { key: 'last_contact',  label: 'Last Contact', w: 110 },
  { key: 'event',         label: 'Event',        w: 160 },
  { key: 'follow_up_date',label: 'Follow Up',    w: 170 },
  { key: 'notes',         label: 'Notes',        w: 260 },
];

// ── State ─────────────────────────────────────────────────────────────────────

const S = {
  contacts:     [],
  filtered:     [],
  search:       '',
  statusFilter: '',
  eventFilter:  '',
  yaleOnly:     false,
  sortKeys:     [{ key: 'follow_up_date', asc: true }],
  selectedId:   null,
  editing:      false,
  editData:     null,
  isNew:        false,
  selected:     new Set(),
  hiddenCols:   new Set(JSON.parse(localStorage.getItem('hiddenCols') || '["office","email","event"]')),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function h(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fuClass(d) {
  if (!d) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return '';
  const days = Math.round((dt - today) / 86400000);
  if (days < 0) return 'fu-overdue';
  if (days <= 7) return 'fu-soon';
  return '';
}

function somBadge(val) {
  const v = String(val || '').trim();
  if (!v || v.toLowerCase() === 'false' || v.toLowerCase() === 'true') {
    return v.toLowerCase() === 'true' ? '<span class="yale-badge">SOM</span>' : '';
  }
  return `<span class="yale-badge">${h(v)}</span>`;
}

function isSom(val) {
  const v = String(val || '').trim().toLowerCase();
  return v && v !== 'false';
}

function firmChip(name) {
  if (!name) return '';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `<span class="firm-chip" style="background:hsl(${hue},55%,91%);color:hsl(${hue},50%,28%)">${h(name)}</span>`;
}

function sbadge(status) {
  const cls = STATUS_CLASS[status] || 's-none';
  return `<span class="sbadge ${cls}">${h(status || '—')}</span>`;
}

// ── Local data layer (static site — no server) ─────────────────────────────────
// data/contacts.json is the source of truth: every page load re-reads it and
// replaces the browser's localStorage copy. Edits made in the browser (and
// undo/redo) last only until the next reload — to permanently add/update
// contacts, edit data/contacts.json and redeploy.

const LS_CONTACTS_KEY = 'crm_contacts_v1';
const MAX_HISTORY = 30;
let localUndoStack = [];
let localRedoStack = [];

function readLocalContacts() {
  const raw = localStorage.getItem(LS_CONTACTS_KEY);
  return raw ? JSON.parse(raw) : null;
}

function writeLocalContacts(contacts) {
  localStorage.setItem(LS_CONTACTS_KEY, JSON.stringify(contacts));
}

let contactsLoaded = false;

async function ensureContactsSeeded() {
  if (contactsLoaded) return readLocalContacts();
  try {
    const r = await fetch('data/contacts.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    writeLocalContacts(await r.json());
  } catch (e) {
    if (!readLocalContacts()) throw e;
  }
  contactsLoaded = true;
  return readLocalContacts();
}

function pushUndoSnapshot(contacts) {
  localUndoStack.push(JSON.parse(JSON.stringify(contacts)));
  if (localUndoStack.length > MAX_HISTORY) localUndoStack.shift();
  localRedoStack = [];
}

function localHistoryState() {
  return { canUndo: localUndoStack.length > 0, canRedo: localRedoStack.length > 0 };
}

async function api(method, path, body) {
  const contacts = await ensureContactsSeeded();

  if (method === 'GET' && path === '/contacts') return contacts;

  if (method === 'GET' && path === '/events') {
    return [...new Set(contacts.map(c => (c.event || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }

  if (method === 'GET' && path === '/history-state') return localHistoryState();

  if (method === 'POST' && path === '/contacts') {
    pushUndoSnapshot(contacts);
    const maxId = contacts.reduce((m, c) => Math.max(m, parseInt(c.id) || 0), 0);
    const contact = { ...body, id: String(maxId + 1) };
    contacts.push(contact);
    writeLocalContacts(contacts);
    return contact;
  }

  const idMatch = path.match(/^\/contacts\/(.+)$/);
  if (method === 'PUT' && idMatch) {
    pushUndoSnapshot(contacts);
    const i = contacts.findIndex(c => c.id === idMatch[1]);
    if (i === -1) throw new Error('Not found');
    contacts[i] = { ...contacts[i], ...body, id: idMatch[1] };
    writeLocalContacts(contacts);
    return contacts[i];
  }

  if (method === 'DELETE' && idMatch) {
    pushUndoSnapshot(contacts);
    const next = contacts.filter(c => c.id !== idMatch[1]);
    writeLocalContacts(next);
    return { ok: true };
  }

  if (method === 'POST' && path === '/undo') {
    if (!localUndoStack.length) throw new Error('Nothing to undo');
    localRedoStack.push(JSON.parse(JSON.stringify(contacts)));
    const prev = localUndoStack.pop();
    writeLocalContacts(prev);
    return { contacts: prev, ...localHistoryState() };
  }

  if (method === 'POST' && path === '/redo') {
    if (!localRedoStack.length) throw new Error('Nothing to redo');
    localUndoStack.push(JSON.parse(JSON.stringify(contacts)));
    const next = localRedoStack.pop();
    writeLocalContacts(next);
    return { contacts: next, ...localHistoryState() };
  }

  throw new Error('Unknown endpoint: ' + method + ' ' + path);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Load contacts ─────────────────────────────────────────────────────────────

function setHistoryButtons(canUndo, canRedo) {
  document.getElementById('undo-btn').disabled = !canUndo;
  document.getElementById('redo-btn').disabled = !canRedo;
}

async function refreshHistory() {
  try {
    const s = await api('GET', '/history-state');
    setHistoryButtons(s.canUndo, s.canRedo);
  } catch {}
}

async function applyHistoryResult(result) {
  S.contacts = result.contacts;
  applyFilters(); renderTable(); renderCount(); renderBulkBar();
  if (S.selectedId) {
    if (!S.contacts.find(c => c.id === S.selectedId)) closePanel();
    else if (!S.editing) renderPanel();
  }
  setHistoryButtons(result.canUndo, result.canRedo);
}

async function loadContacts() {
  try {
    S.contacts = await api('GET', '/contacts');
    applyFilters();
    renderTable();
    renderCount();
    renderBulkBar();
    refreshHistory();
    refreshEventFilter();
  } catch (e) {
    toast('Failed to load: ' + e.message, true);
  }
}

// ── Filter & sort ─────────────────────────────────────────────────────────────

function applyFilters() {
  const q = S.search.toLowerCase();
  S.filtered = S.contacts.filter(c => {
    if (S.statusFilter && c.status !== S.statusFilter) return false;
    if (S.eventFilter && (c.event || '') !== S.eventFilter) return false;
    if (S.yaleOnly && !isSom(c.som_yale)) return false;
    if (q && !Object.values(c).some(v => String(v).toLowerCase().includes(q))) return false;
    return true;
  });

  S.filtered.sort((a, b) => {
    for (const { key, asc } of S.sortKeys) {
      const av = (a[key] || '').toLowerCase();
      const bv = (b[key] || '').toLowerCase();
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return asc ? cmp : -cmp;
    }
    return 0;
  });
}

// ── Table render ──────────────────────────────────────────────────────────────

function renderTable() {
  const thead = document.getElementById('table-head');
  const tbody = document.getElementById('table-body');

  const allSel = S.filtered.length > 0 && S.filtered.every(c => S.selected.has(c.id));
  const someSel = S.filtered.some(c => S.selected.has(c.id));
  const multi = S.sortKeys.length > 1;
  thead.innerHTML = '<tr><th style="width:36px;padding:9px 8px;text-align:center">' +
    `<input type="checkbox" class="sel-all" ${allSel ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent)">` +
    '</th>' + COLS.map(col => {
      const idx = S.sortKeys.findIndex(s => s.key === col.key);
      const sorted = idx !== -1;
      const arrow = sorted ? (S.sortKeys[idx].asc ? ' ↑' : ' ↓') : '';
      const badge = sorted && multi ? `<span class="sort-badge">${idx + 1}</span>` : '';
      return `<th data-key="${col.key}" class="${sorted ? 'sorted' : ''}" style="min-width:${col.w}px" title="${sorted ? 'Click to toggle · Shift+click to add/remove from sort' : 'Click to sort · Shift+click to add to sort'}">
        ${col.label}${badge}<span class="sort-arrow">${arrow}</span>
      </th>`;
    }).join('') + '</tr>';
  const selAllEl = thead.querySelector('.sel-all');
  if (selAllEl) selAllEl.indeterminate = someSel && !allSel;
  applyColVisibility();

  if (!S.filtered.length) {
    const msg = S.contacts.length === 0 ? 'No contacts yet — add one below' : 'No contacts match your filters';
    tbody.innerHTML = `<tr class="state-row"><td colspan="${COLS.length}">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>
      </svg>${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = S.filtered.map(c => {
    const sel = c.id === S.selectedId ? ' selected' : '';
    const bulk = S.selected.has(c.id) ? ' bulk-selected' : '';
    return `<tr class="${sel}${bulk}" data-id="${c.id}">
      <td style="width:36px;padding:10px 8px;text-align:center">
        <input type="checkbox" class="row-sel" data-id="${c.id}" ${S.selected.has(c.id) ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent)">
      </td>
      <td class="cell-name" data-field="name" style="min-width:170px">
        <strong>${h(c.name)}</strong>${somBadge(c.som_yale)}
      </td>
      <td data-field="firm" style="min-width:150px">${firmChip(c.firm)}</td>
      <td class="cell-trunc cell-muted" data-field="role" style="min-width:150px">${h(c.role)}</td>
      <td class="cell-trunc cell-muted" data-field="office" style="min-width:110px">${h(c.office)}</td>
      <td class="cell-trunc" data-field="email" style="min-width:180px">${h(c.email)}</td>
      <td data-field="status" style="min-width:145px">${sbadge(c.status)}</td>
      <td class="cell-muted" data-field="last_contact" style="min-width:110px">${fmtDate(c.last_contact)}</td>
      <td class="cell-trunc" data-field="event" style="min-width:160px">${c.event ? `<span class="event-badge">${h(c.event)}</span>` : ''}</td>
      <td data-field="follow_up_date" style="min-width:170px">
        ${c.follow_up_date
          ? `<div class="fu-cell">
               <div class="fu-top">
                 <span class="fu-date ${fuClass(c.follow_up_date)}">${fmtDate(c.follow_up_date)}</span>
                 ${c.next_step ? `<span class="fu-step" title="${h(c.next_step)}">${h(c.next_step)}</span>` : ''}
               </div>
               <div class="fu-btns">
                 <button class="fu-done-btn"   data-id="${c.id}" title="Done — stamps today as last contact">✓ Done</button>
                 <button class="fu-snooze-btn" data-id="${c.id}" title="Not yet — push back 1 week">+1w</button>
                 <button class="fu-skip-btn"   data-id="${c.id}" title="Never mind — remove this follow-up">✕</button>
               </div>
             </div>`
          : `<button class="fu-add-btn" data-id="${c.id}">+ Set date</button>`}
      </td>
      <td class="notes-cell cell-muted" data-field="notes" style="min-width:260px" title="${h(c.notes)}"><div class="notes-clamp">${c.notes ? h(c.notes.slice(0, 600)).replace(/\n/g, '<br>') : ''}</div></td>
    </tr>`;
  }).join('');
}

async function refreshEventFilter() {
  try {
    const events = await api('GET', '/events');
    const sel = document.getElementById('event-filter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All events</option>' +
      events.map(e => `<option value="${h(e)}"${e === cur ? ' selected' : ''}>${h(e)}</option>`).join('');
  } catch {}
}

function applyColVisibility() {
  const table = document.getElementById('contacts-table');
  if (!table) return;
  COLS.forEach(col => table.classList.remove('hide-' + col.key));
  S.hiddenCols.forEach(key => table.classList.add('hide-' + key));
}

function renderCount() {
  const el = document.getElementById('count-label');
  if (S.filtered.length === S.contacts.length) {
    el.textContent = `${S.contacts.length} contact${S.contacts.length !== 1 ? 's' : ''}`;
  } else {
    el.textContent = `${S.filtered.length} / ${S.contacts.length}`;
  }
}

// ── Side panel ────────────────────────────────────────────────────────────────

function openPanel(id) {
  S.selectedId = id;
  S.isNew = false;
  S.editing = false;
  S.editData = null;
  renderPanel();
  renderTable(); // update row highlight
}

function openNewPanel(prefill = {}) {
  S.selectedId = null;
  S.isNew = true;
  S.editing = true;
  S.editData = { ...prefill };
  renderPanel();
}

function closePanel() {
  S.selectedId = null;
  S.isNew = false;
  S.editing = false;
  S.editData = null;
  document.getElementById('side-panel').classList.remove('open');
  renderTable();
}

function renderPanel() {
  const panel = document.getElementById('side-panel');
  if (!S.selectedId && !S.isNew) { closePanel(); return; }
  panel.classList.add('open');

  const contact = S.isNew
    ? (S.editData || {})
    : (S.contacts.find(c => c.id === S.selectedId) || {});

  document.getElementById('panel-title').textContent = S.editing
    ? (S.isNew ? 'New Contact' : 'Edit Contact')
    : (contact.name || 'Details');

  if (S.editing) renderEditForm(contact);
  else renderViewDetails(contact);
}

// ── View mode ─────────────────────────────────────────────────────────────────

function fv(label, value) {
  const empty = !value;
  return `<div class="field-row">
    <div class="field-label">${label}</div>
    <div class="field-value${empty ? ' empty' : ''}">${empty ? '—' : h(value)}</div>
  </div>`;
}

function fvLink(label, value, scheme) {
  if (!value) return fv(label, '');
  return `<div class="field-row">
    <div class="field-label">${label}</div>
    <div class="field-value"><a href="${scheme}:${h(value)}">${h(value)}</a></div>
  </div>`;
}

function renderViewDetails(c) {
  document.getElementById('panel-body').innerHTML = `
    <div class="detail-hero">
      <div class="detail-name">${h(c.name) || '<em style="color:var(--text-subtle);font-weight:400">No name</em>'}${somBadge(c.som_yale)}</div>
      ${c.role || c.firm ? `<div class="detail-sub">${[c.role, c.firm].filter(Boolean).map(h).join(' · ')}</div>` : ''}
      ${c.office ? `<div class="detail-sub">${h(c.office)}</div>` : ''}
    </div>

    <div class="panel-section">
      <h4>Contact</h4>
      ${fvLink('Email', c.email, 'mailto')}
      ${fvLink('Phone', c.phone, 'tel')}
    </div>

    <div class="panel-section">
      <h4>Meeting</h4>
      ${fv('How Met', c.how_met)}
      ${c.event ? `<div class="field-row"><div class="field-label">Event</div><div class="field-value"><span class="event-badge">${h(c.event)}</span></div></div>` : ''}
      ${fv('Date Met', fmtDate(c.date_met))}
      ${fv('Last Contact', fmtDate(c.last_contact))}
      <div class="field-row">
        <div class="field-label">Status</div>
        <div class="field-value">${c.status ? sbadge(c.status) : '<span class="empty">—</span>'}</div>
      </div>
    </div>

    <div class="panel-section">
      <h4>Follow-up</h4>
      ${fv('Next Step', c.next_step)}
      ${fv('Follow-up Date', fmtDate(c.follow_up_date))}
    </div>

    <div class="panel-section">
      <h4>Notes</h4>
      ${c.notes
        ? `<div class="notes-block">${h(c.notes)}</div>`
        : '<div class="field-value empty">No notes</div>'}
    </div>
  `;

  document.getElementById('panel-footer').innerHTML = `
    <button class="btn btn-ghost-blue" id="edit-btn">Edit</button>
    <button class="btn btn-danger" id="delete-btn">Delete</button>
  `;

  document.getElementById('edit-btn').onclick = () => {
    S.editing = true;
    S.editData = { ...(S.contacts.find(c2 => c2.id === S.selectedId) || {}) };
    renderPanel();
  };
  document.getElementById('delete-btn').onclick = () => {
    if (confirm(`Delete ${c.name || 'this contact'}? This cannot be undone.`)) {
      deleteContact(c.id);
    }
  };
}

// ── Edit form ─────────────────────────────────────────────────────────────────

function inp(id, label, value, type = 'text', opts = '') {
  return `<div class="form-group">
    <label class="form-label" for="f-${id}">${label}</label>
    <input id="f-${id}" class="form-input" type="${type}" value="${h(value)}" ${opts}>
  </div>`;
}

function renderEditForm(c) {
  const statusOptions = STATUSES.map(s =>
    `<option value="${h(s)}"${c.status === s ? ' selected' : ''}>${h(s === '-' ? '— (none)' : s)}</option>`
  ).join('');

  const somData = parseSomYale(c.som_yale);

  document.getElementById('panel-body').innerHTML = `
    <div class="form-section-title">Basic</div>
    <div class="form-grid">
      ${inp('name', 'Name', c.name)}
      ${inp('firm', 'Firm', c.firm)}
      ${inp('office', 'Office / Location', c.office)}
      ${inp('role', 'Role / Title', c.role)}
    </div>

    <div class="form-section-title">Contact Info</div>
    <div class="form-grid">
      ${inp('email', 'Email', c.email, 'email')}
      ${inp('phone', 'Phone', c.phone, 'tel')}
    </div>

    <div class="form-section-title">Meeting</div>
    <div class="form-grid">
      ${inp('how_met', 'How Met', c.how_met, 'text', 'placeholder="e.g. panel, coffee chat, info session"')}
      <div class="form-group span2">
        <div class="event-field-row">
          <label class="form-check-row">
            <input type="checkbox" id="f-event-check" ${c.event ? 'checked' : ''}
              onchange="document.getElementById('event-picker-wrap').style.display=this.checked?'flex':'none'">
            Conference / Event
          </label>
          <div id="event-picker-wrap" class="event-picker-wrap" style="display:${c.event ? 'flex' : 'none'}">
            <input type="text" id="f-event" class="form-input event-input" list="event-datalist"
              value="${h(c.event || '')}" placeholder="e.g. Yale Innovation Summit 2025" autocomplete="off">
            <datalist id="event-datalist"></datalist>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-status">Status</label>
        <select id="f-status" class="form-select">${statusOptions}</select>
      </div>
      ${inp('date_met', 'Date Met', c.date_met, 'date')}
      ${inp('last_contact', 'Last Contact', c.last_contact, 'date')}
    </div>

    <div class="form-section-title">Follow-up</div>
    <div class="form-grid">
      <div class="form-group span2">
        <label class="form-label" for="f-next_step">Next Step</label>
        <input id="f-next_step" class="form-input" type="text" value="${h(c.next_step)}" placeholder="e.g. Send TY email">
      </div>
      ${inp('follow_up_date', 'Follow-up Date', c.follow_up_date, 'date')}
    </div>

    <div class="form-section-title">Other</div>
    <div class="form-grid">
      <div class="form-group span2">
        <label class="form-label" for="f-notes">Notes</label>
        <textarea id="f-notes" class="form-textarea" rows="4" placeholder="Topics discussed, intro offers, context…">${h(c.notes)}</textarea>
      </div>
      <div class="form-group span2">
        <div class="som-field-row">
          <label class="form-check-row">
            <input type="checkbox" id="f-som_yale_check"${somData.affiliated ? ' checked' : ''}
              onchange="document.getElementById('som-year-wrap').style.display=this.checked?'flex':'none'">
            Yale SOM affiliated
          </label>
          <div class="som-year-wrap" id="som-year-wrap" style="display:${somData.affiliated ? 'flex' : 'none'}">
            <span class="som-year-label">Class year</span>
            <input type="text" id="f-som_yale_year" class="form-input som-year-input"
              value="${h(somData.year)}" placeholder="'26" maxlength="4">
            <span class="som-year-preview" id="som-year-preview">${somData.affiliated ? `→ ${buildSomYale(true, somData.year)}` : ''}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('panel-footer').innerHTML = `
    <button class="btn btn-primary" id="save-btn">Save</button>
    <button class="btn btn-ghost" id="cancel-btn">Cancel</button>
  `;

  // Populate event datalist
  api('GET', '/events').then(events => {
    const dl = document.getElementById('event-datalist');
    if (dl) events.forEach(e => {
      const o = document.createElement('option'); o.value = e; dl.appendChild(o);
    });
  }).catch(() => {});

  // Live-update the SOM badge preview when year is typed
  const somYearInput = document.getElementById('f-som_yale_year');
  if (somYearInput) {
    somYearInput.addEventListener('input', () => {
      const preview = document.getElementById('som-year-preview');
      if (preview) preview.textContent = '→ ' + buildSomYale(true, somYearInput.value);
    });
  }

  document.getElementById('save-btn').onclick = saveContact;
  document.getElementById('cancel-btn').onclick = () => {
    if (S.isNew) {
      closePanel();
    } else {
      S.editing = false;
      S.editData = null;
      renderPanel();
    }
  };
}

function collectForm() {
  const get = id => {
    const el = document.getElementById('f-' + id);
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? 'true' : 'false';
    return el.value.trim();
  };
  const somCheck = document.getElementById('f-som_yale_check');
  const somYear  = document.getElementById('f-som_yale_year');
  const som_yale = somCheck ? buildSomYale(somCheck.checked, somYear?.value || '') : get('som_yale');

  const eventCheck = document.getElementById('f-event-check');
  const event = (eventCheck?.checked) ? (document.getElementById('f-event')?.value.trim() || '') : '';

  return {
    name: get('name'), firm: get('firm'), office: get('office'), role: get('role'),
    email: get('email'), phone: get('phone'), how_met: get('how_met'), event,
    date_met: get('date_met'), last_contact: get('last_contact'),
    status: get('status'), next_step: get('next_step'),
    follow_up_date: get('follow_up_date'), som_yale,
    notes: get('notes'),
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function saveContact() {
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const data = collectForm();
    let saved;
    if (S.isNew) {
      saved = await api('POST', '/contacts', data);
      toast(`Added ${saved.name || 'contact'}`);
    } else {
      saved = await api('PUT', '/contacts/' + S.selectedId, data);
      toast(`Saved ${saved.name || 'contact'}`);
    }
    S.isNew = false;
    S.editing = false;
    S.editData = null;

    await loadContacts();
    S.selectedId = saved.id;
    renderPanel();
    renderTable();
    refreshHistory();
  } catch (e) {
    toast('Save failed: ' + e.message, true);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  }
}

async function deleteContact(id) {
  try {
    await api('DELETE', '/contacts/' + id);
    toast('Contact deleted');
    closePanel();
    await loadContacts();
    refreshHistory();
  } catch (e) {
    toast('Delete failed: ' + e.message, true);
  }
}

// ── Follow-up actions ─────────────────────────────────────────────────────────

async function markFollowUpDone(id) {
  const today = new Date().toISOString().split('T')[0];
  await api('PUT', '/contacts/' + id, { follow_up_date: '', next_step: '', last_contact: today });
  const c = S.contacts.find(x => x.id === id);
  if (c) { c.follow_up_date = ''; c.next_step = ''; c.last_contact = today; }
  applyFilters(); renderTable(); renderCount();
  if (S.selectedId === id && !S.editing) renderPanel();
  toast('Done ✓ — last contact updated to today');
}

async function snoozeFollowUp(id) {
  const c = S.contacts.find(x => x.id === id);
  if (!c) return;
  const base = c.follow_up_date ? new Date(c.follow_up_date + 'T00:00:00') : new Date();
  base.setDate(base.getDate() + 7);
  const newDate = base.toISOString().split('T')[0];
  await api('PUT', '/contacts/' + id, { follow_up_date: newDate });
  c.follow_up_date = newDate;
  applyFilters(); renderTable(); renderCount();
  if (S.selectedId === id && !S.editing) renderPanel();
  toast('Snoozed → ' + fmtDate(newDate));
}

async function dismissFollowUp(id) {
  await api('PUT', '/contacts/' + id, { follow_up_date: '', next_step: '' });
  const c = S.contacts.find(x => x.id === id);
  if (c) { c.follow_up_date = ''; c.next_step = ''; }
  applyFilters(); renderTable(); renderCount();
  if (S.selectedId === id && !S.editing) renderPanel();
  toast('Follow-up removed');
}

// ── Bulk selection ────────────────────────────────────────────────────────────

function renderBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const n = S.selected.size;
  bar.classList.toggle('hidden', n === 0);
  if (n === 0) return;
  document.getElementById('bulk-count').textContent = `${n} selected`;
}

async function bulkUpdate(field, value) {
  const ids = [...S.selected];
  await Promise.all(ids.map(id => api('PUT', '/contacts/' + id, { [field]: value })));
  ids.forEach(id => {
    const c = S.contacts.find(x => x.id === id);
    if (c) c[field] = value;
  });
  applyFilters(); renderTable(); renderBulkBar(); renderCount();
  if (S.selectedId && S.selected.has(S.selectedId) && !S.editing) renderPanel();
  refreshHistory();
  toast(`Updated ${ids.length} contact${ids.length !== 1 ? 's' : ''}`);
}

async function bulkDelete() {
  const ids = [...S.selected];
  if (!confirm(`Delete ${ids.length} contact${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
  await Promise.all(ids.map(id => api('DELETE', '/contacts/' + id)));
  S.contacts = S.contacts.filter(c => !ids.includes(c.id));
  S.selected.clear();
  if (ids.includes(S.selectedId)) closePanel();
  applyFilters(); renderTable(); renderBulkBar(); renderCount();
  toast(`Deleted ${ids.length} contact${ids.length !== 1 ? 's' : ''}`);
}

function bulkCopy() {
  const contacts = S.contacts.filter(c => S.selected.has(c.id));
  const text = contacts.map(c => {
    const parts = [c.name, c.role, c.firm, c.office, c.email, c.phone].filter(Boolean);
    return parts.join(' | ');
  }).join('\n');
  navigator.clipboard.writeText(text).then(() => toast(`Copied ${contacts.length} contacts`));
}

// ── Inline cell editing ───────────────────────────────────────────────────────

let currentEdit = null;

function makeEditable(td, contact, fieldKey) {
  if (currentEdit) currentEdit.cancel();

  const originalValue = contact[fieldKey] || '';

  let input;
  if (fieldKey === 'status') {
    input = document.createElement('select');
    input.className = 'inline-select';
    [['', '— clear —'], ...STATUSES.map(s => [s, s])].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === originalValue) opt.selected = true;
      input.appendChild(opt);
    });
  } else if (fieldKey === 'last_contact' || fieldKey === 'follow_up_date') {
    input = document.createElement('input');
    input.type = 'date';
    input.className = 'inline-input';
    input.value = originalValue;
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-input';
    input.value = originalValue;
  }

  td.innerHTML = '';
  td.appendChild(input);
  td.classList.add('cell-editing');
  input.focus();
  if (input.type === 'text') input.select();

  let done = false;

  function commitLocal(value) {
    // Optimistic: update state and re-render immediately, no waiting for API
    const idx = S.contacts.findIndex(c => c.id === contact.id);
    if (idx !== -1) S.contacts[idx][fieldKey] = value;
    applyFilters(); renderTable(); renderCount();
    if (S.selectedId === contact.id && !S.editing) renderPanel();
  }

  async function save() {
    if (done) return;
    done = true;
    currentEdit = null;
    const newValue = input.value;
    commitLocal(newValue); // snap cell to new value right away
    if (newValue === originalValue) return;
    try {
      await api('PUT', '/contacts/' + contact.id, { [fieldKey]: newValue });
      refreshHistory();
    } catch (e) {
      commitLocal(originalValue); // rollback on failure
      toast('Save failed — reverted', true);
    }
  }

  function cancel() {
    if (done) return;
    done = true;
    currentEdit = null;
    commitLocal(originalValue); // snap back to original
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  if (fieldKey === 'status') {
    input.addEventListener('change', save);
  }
  input.addEventListener('blur', () => setTimeout(save, 120));

  currentEdit = { save, cancel };
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function init() {

  // Undo / redo
  document.getElementById('undo-btn').addEventListener('click', async () => {
    try { await applyHistoryResult(await api('POST', '/undo', {})); toast('Undone'); }
    catch(e) { toast(e.message, true); }
  });
  document.getElementById('redo-btn').addEventListener('click', async () => {
    try { await applyHistoryResult(await api('POST', '/redo', {})); toast('Redone'); }
    catch(e) { toast(e.message, true); }
  });
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (!document.getElementById('undo-btn').disabled) document.getElementById('undo-btn').click();
    } else if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      if (!document.getElementById('redo-btn').disabled) document.getElementById('redo-btn').click();
    }
  });

  // Toolbar collapse
  const toolbar = document.getElementById('toolbar');
  const toggleBtn = document.getElementById('toolbar-toggle');
  let toolbarCollapsed = localStorage.getItem('toolbarCollapsed') === 'true';
  const applyToolbar = () => {
    toolbar.classList.toggle('collapsed', toolbarCollapsed);
    toggleBtn.textContent = toolbarCollapsed ? '⌄' : '⌃';
    toggleBtn.title = toolbarCollapsed ? 'Show search bar' : 'Hide search bar';
  };
  toggleBtn.addEventListener('click', () => {
    toolbarCollapsed = !toolbarCollapsed;
    localStorage.setItem('toolbarCollapsed', toolbarCollapsed);
    applyToolbar();
  });
  applyToolbar();

  // Density toggle
  let density = localStorage.getItem('density') || 'normal';
  const densitySeg = document.getElementById('density-seg');
  function applyDensity() {
    document.body.classList.remove('density-compact', 'density-loose');
    if (density !== 'normal') document.body.classList.add('density-' + density);
    densitySeg.querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', b.dataset.density === density));
  }
  densitySeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-density]');
    if (!btn) return;
    density = btn.dataset.density;
    localStorage.setItem('density', density);
    applyDensity();
  });
  applyDensity();

  // Notes line count
  let noteLines = parseInt(localStorage.getItem('noteLines') || '2');
  const noteLinesVal = document.getElementById('notes-lines-val');
  function applyNoteLines() {
    document.documentElement.style.setProperty('--note-lines', noteLines);
    noteLinesVal.textContent = noteLines;
  }
  document.getElementById('notes-lines-dec').addEventListener('click', () => {
    if (noteLines > 1) { noteLines--; localStorage.setItem('noteLines', noteLines); applyNoteLines(); }
  });
  document.getElementById('notes-lines-inc').addEventListener('click', () => {
    if (noteLines < 8) { noteLines++; localStorage.setItem('noteLines', noteLines); applyNoteLines(); }
  });
  applyNoteLines();

  // Header
  document.getElementById('add-btn').onclick = () => openNewPanel();

  // Toolbar
  const searchEl = document.getElementById('search-input');
  let searchTimer;
  searchEl.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      S.search = e.target.value;
      applyFilters();
      renderTable();
      renderCount();
    }, 150);
  });

  document.getElementById('event-filter').addEventListener('change', e => {
    S.eventFilter = e.target.value;
    applyFilters(); renderTable(); renderCount();
  });

  document.getElementById('status-filter').addEventListener('change', e => {
    S.statusFilter = e.target.value;
    applyFilters();
    renderTable();
    renderCount();
  });

  document.getElementById('yale-filter').addEventListener('change', e => {
    S.yaleOnly = e.target.checked;
    applyFilters();
    renderTable();
    renderCount();
  });

  // Table sorting + row selection (event delegation)
  document.getElementById('table-head').addEventListener('click', e => {
    const th = e.target.closest('th[data-key]');
    if (!th) return;
    const key = th.dataset.key;
    const idx = S.sortKeys.findIndex(s => s.key === key);

    if (e.shiftKey) {
      // Shift+click: cycle through asc → desc → remove for this level
      if (idx === -1) {
        S.sortKeys.push({ key, asc: true });
      } else if (S.sortKeys[idx].asc) {
        S.sortKeys[idx].asc = false;
      } else {
        S.sortKeys.splice(idx, 1);
        if (!S.sortKeys.length) S.sortKeys = [{ key, asc: true }];
      }
    } else {
      // Plain click: single sort, toggle direction if already primary
      if (S.sortKeys.length === 1 && idx === 0) {
        S.sortKeys[0].asc = !S.sortKeys[0].asc;
      } else {
        S.sortKeys = [{ key, asc: idx === -1 ? true : S.sortKeys[idx].asc }];
      }
    }

    applyFilters();
    renderTable();
  });

  // Select-all checkbox
  document.getElementById('table-head').addEventListener('change', e => {
    if (!e.target.classList.contains('sel-all')) return;
    if (e.target.checked) S.filtered.forEach(c => S.selected.add(c.id));
    else S.filtered.forEach(c => S.selected.delete(c.id));
    renderTable(); renderBulkBar();
  });

  // Row checkboxes (with shift-click range selection)
  let lastCheckedId = null;

  document.getElementById('table-body').addEventListener('click', e => {
    const cb = e.target;
    if (!cb.classList.contains('row-sel')) return;

    const id = cb.dataset.id;
    if (e.shiftKey && lastCheckedId && lastCheckedId !== id) {
      const ids = S.filtered.map(c => c.id);
      const a = ids.indexOf(lastCheckedId);
      const b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      ids.slice(lo, hi + 1).forEach(rid => {
        cb.checked ? S.selected.add(rid) : S.selected.delete(rid);
      });
    } else {
      if (cb.checked) S.selected.add(id);
      else S.selected.delete(id);
    }
    lastCheckedId = id;
    renderTable(); renderBulkBar();
  });

  // Bulk bar: clear follow-ups
  document.getElementById('bulk-clear-fu').onclick = () => bulkUpdate('next_step', '');

  // Bulk bar: field selector
  const bulkFieldSel = document.getElementById('bulk-field-sel');
  const bulkValWrap  = document.getElementById('bulk-val-wrap');
  const bulkApply    = document.getElementById('bulk-apply');

  function makeDatalistInput(field, values, placeholder, width = '200px') {
    const dlId = 'bulk-dl-' + field;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.style.width = width;
    input.placeholder = placeholder;
    input.setAttribute('list', dlId);
    input.id = 'bulk-val-input';

    const dl = document.createElement('datalist');
    dl.id = dlId;
    values.forEach(v => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });

    bulkValWrap.appendChild(dl);
    bulkValWrap.appendChild(input);
    return input;
  }

  bulkFieldSel.addEventListener('change', () => {
    const field = bulkFieldSel.value;
    bulkValWrap.innerHTML = '';
    bulkApply.classList.toggle('hidden', !field);
    if (!field) return;

    let input;
    if (field === 'status') {
      input = document.createElement('select');
      input.className = 'filter-select';
      [['','— choose —'], ...STATUSES.map(s => [s,s])].forEach(([v,l]) => {
        const o = document.createElement('option'); o.value = v; o.textContent = l; input.appendChild(o);
      });
      input.id = 'bulk-val-input';
      bulkValWrap.appendChild(input);

    } else if (field === 'follow_up_date') {
      input = document.createElement('input');
      input.type = 'date'; input.className = 'search-input'; input.style.width = '140px';
      input.id = 'bulk-val-input';
      bulkValWrap.appendChild(input);

    } else if (field === 'how_met') {
      const vals = [...new Set(S.contacts.map(c => c.how_met).filter(Boolean))].sort();
      input = makeDatalistInput('how_met', vals, 'Select or type…', '220px');

    } else if (field === 'event') {
      const vals = [...new Set(S.contacts.map(c => c.event).filter(Boolean))].sort();
      if (vals.length) {
        input = document.createElement('select');
        input.className = 'filter-select';
        [['','— choose event —'], ...vals.map(v => [v,v])].forEach(([v,l]) => {
          const o = document.createElement('option'); o.value = v; o.textContent = l; input.appendChild(o);
        });
        // Also allow typing a new one
        const newOpt = document.createElement('option');
        newOpt.value = '__new__'; newOpt.textContent = '+ New event…';
        input.appendChild(newOpt);
        input.id = 'bulk-val-input';
        bulkValWrap.appendChild(input);
        // When "New event…" chosen, swap to text input
        input.addEventListener('change', () => {
          if (input.value === '__new__') {
            const text = makeDatalistInput('event_new', [], 'Type new event name…', '220px');
            bulkValWrap.innerHTML = '';
            bulkValWrap.appendChild(text);
            text.focus();
          }
        });
      } else {
        input = makeDatalistInput('event', [], 'Type event name…', '220px');
      }

    } else {
      input = document.createElement('input');
      input.type = 'text'; input.className = 'search-input'; input.style.width = '160px';
      input.placeholder = `New ${field.replace(/_/g,' ')}…`;
      input.id = 'bulk-val-input';
      bulkValWrap.appendChild(input);
    }
  });

  bulkApply.onclick = () => {
    const field = bulkFieldSel.value;
    const input = document.getElementById('bulk-val-input');
    if (!field || !input) return;
    bulkUpdate(field, input.value).then(() => {
      bulkFieldSel.value = '';
      bulkValWrap.innerHTML = '';
      bulkApply.classList.add('hidden');
    });
  };

  // Bulk bar: copy
  document.getElementById('bulk-copy').onclick = bulkCopy;

  // Bulk bar: delete
  document.getElementById('bulk-delete').onclick = bulkDelete;

  // Bulk bar: deselect
  document.getElementById('bulk-desel').onclick = () => {
    S.selected.clear(); renderTable(); renderBulkBar();
  };

  document.getElementById('table-body').addEventListener('click', e => {
    const doneBtn = e.target.closest('.fu-done-btn');
    if (doneBtn) { e.stopPropagation(); markFollowUpDone(doneBtn.dataset.id); return; }

    const snoozeBtn = e.target.closest('.fu-snooze-btn');
    if (snoozeBtn) { e.stopPropagation(); snoozeFollowUp(snoozeBtn.dataset.id); return; }

    const skipBtn = e.target.closest('.fu-skip-btn');
    if (skipBtn) { e.stopPropagation(); dismissFollowUp(skipBtn.dataset.id); return; }

    const addBtn = e.target.closest('.fu-add-btn');
    if (addBtn) {
      e.stopPropagation();
      const td = addBtn.closest('td[data-field]');
      const row = addBtn.closest('tr[data-id]');
      const contact = S.contacts.find(c => c.id === row?.dataset.id);
      if (td && contact) makeEditable(td, contact, 'follow_up_date');
      return;
    }
  });

  let panelClickTimer = null;

  document.getElementById('table-body').addEventListener('dblclick', e => {
    clearTimeout(panelClickTimer); // cancel pending panel open
    const td = e.target.closest('td[data-field]');
    if (!td) return;
    const row = td.closest('tr[data-id]');
    if (!row) return;
    const contact = S.contacts.find(c => c.id === row.dataset.id);
    if (!contact) return;
    makeEditable(td, contact, td.dataset.field);
  });

  document.getElementById('table-body').addEventListener('click', e => {
    if (e.target.closest('.cell-editing')) return;
    if (e.target.classList.contains('row-sel')) return;
    if (e.target.closest('.fu-done-btn,.fu-snooze-btn,.fu-skip-btn,.fu-add-btn')) return;
    if (e.detail > 1) return;
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    clearTimeout(panelClickTimer);
    panelClickTimer = setTimeout(() => {
      if (S.editing && S.selectedId === id) return;
      if (S.editing && S.isNew) { closePanel(); return; }
      if (S.selectedId === id && !S.editing) { closePanel(); return; }
      openPanel(id);
    }, 180);
  });

  // Side panel close
  document.getElementById('panel-close').onclick = closePanel;

  // Keyboard: Escape closes panel / cancels edit
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (S.editing) {
        if (S.isNew) closePanel();
        else { S.editing = false; renderPanel(); }
      } else if (S.selectedId) {
        closePanel();
      }
    }
  });

  // Column picker
  const colPickerBtn = document.getElementById('col-picker-btn');
  const colPicker    = document.getElementById('col-picker');

  colPicker.innerHTML = COLS.filter(c => !c.locked).map(col => `
    <label class="col-picker-item">
      <input type="checkbox" data-key="${col.key}" ${S.hiddenCols.has(col.key) ? '' : 'checked'}>
      ${col.label}
    </label>`).join('');

  let colPickerOpen = false;

  function openColPicker() {
    colPickerOpen = true;
    colPicker.classList.remove('hidden');
    const r = colPickerBtn.getBoundingClientRect();
    colPicker.style.top  = (r.bottom + 4) + 'px';
    colPicker.style.left = Math.max(4, r.right - 160) + 'px';
  }

  function closeColPicker() {
    colPickerOpen = false;
    colPicker.classList.add('hidden');
  }

  colPickerBtn.addEventListener('click', () => {
    colPickerOpen ? closeColPicker() : openColPicker();
  });

  colPicker.addEventListener('change', e => {
    const cb = e.target;
    if (cb.tagName !== 'INPUT') return;
    if (cb.checked) S.hiddenCols.delete(cb.dataset.key);
    else S.hiddenCols.add(cb.dataset.key);
    localStorage.setItem('hiddenCols', JSON.stringify([...S.hiddenCols]));
    applyColVisibility();
  });

  // Capture phase fires before any stopPropagation in child handlers
  document.addEventListener('pointerdown', e => {
    if (colPickerOpen
        && !e.target.closest('#col-picker')
        && !e.target.closest('#col-picker-btn')) {
      closeColPicker();
    }
  }, true);

  // Export
  document.getElementById('export-btn').onclick = () => {
    const ids = new Set(S.selected.size > 0 ? [...S.selected] : S.filtered.map(c => c.id));
    const contacts = S.contacts.filter(c => ids.has(c.id));
    const rows = contacts.map(c => ({
      'Name': c.name, 'Firm': c.firm, 'Office': c.office, 'Role': c.role,
      'Email': c.email, 'Phone': c.phone, 'How Met': c.how_met,
      'Date Met': c.date_met, 'Last Contact': c.last_contact, 'Status': c.status,
      'Next Step': c.next_step, 'Follow-up Date': c.follow_up_date,
      'SOM/Yale': c.som_yale, 'Notes': c.notes,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [20,18,12,22,28,16,28,12,12,18,28,14,8,50].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    XLSX.writeFile(wb, `contacts-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // Initial load
  loadContacts();
}

document.addEventListener('DOMContentLoaded', init);
