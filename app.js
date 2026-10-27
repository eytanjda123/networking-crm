(() => {
  'use strict';

  // Cosmetic gate only: the data file is still publicly readable.
  const PASSCODE = 'eytan';
  const UNLOCK_KEY = 'crm_unlocked';
  const PREFS_KEY = 'crm_prefs';
  const DAY = 86400000;
  const NEW_WITHIN_DAYS = 7;

  const $ = id => document.getElementById(id);

  const S = {
    contacts: [],
    range: 'all',
    event: '',
    som: false,
    group: '',
    sort: 'newest',
    q: '',
    collapsed: new Set(),
    openId: null,
    shown: [],
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function daysAgo(str) {
    const d = parseDate(str);
    if (!d) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today - d) / DAY);
  }

  function fmtDate(str) {
    const d = parseDate(str);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }

  function rel(str) {
    let n = daysAgo(str);
    if (n === null) return '';
    if (n < 0) {
      n = -n;
      return n === 1 ? 'Tomorrow' : n < 7 ? `In ${n} days` : fmtDate(str);
    }
    if (n === 0) return 'Today';
    if (n === 1) return 'Yesterday';
    if (n < 7) return `${n} days ago`;
    if (n < 30) { const w = Math.floor(n / 7); return w === 1 ? '1 week ago' : `${w} weeks ago`; }
    if (n < 365) { const m = Math.floor(n / 30); return m === 1 ? '1 month ago' : `${m} months ago`; }
    const y = Math.floor(n / 365);
    return y === 1 ? '1 year ago' : `${y} years ago`;
  }

  const recency = c => c.last_contact || c.date_met || '';

  function isSom(val) {
    const v = String(val || '').trim().toLowerCase();
    return !!v && v !== 'false';
  }

  function tagHtml(val) {
    const v = String(val || '').trim();
    if (!isSom(v)) return '';
    return `<span class="tag">${esc(v.toLowerCase() === 'true' ? 'SOM' : v)}</span>`;
  }

  function newDotHtml(c) {
    const n = daysAgo(recency(c));
    return n !== null && n >= 0 && n <= NEW_WITHIN_DAYS
      ? '<span class="new-dot" title="Recent contact" aria-label="Recent"></span>' : '';
  }

  function latestNote(c) {
    const notes = String(c.notes || '').trim();
    if (!notes) return '';
    const parts = notes.split(/──[^─\n]*──/).map(p => p.trim()).filter(Boolean);
    let last = parts.length ? parts[parts.length - 1] : notes;
    if (parts.length <= 1) {
      const paras = last.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      if (paras.length) last = paras[paras.length - 1];
    }
    return last.replace(/\s+/g, ' ');
  }

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ range: S.range, group: S.group, sort: S.sort, som: S.som }));
    } catch (e) {}
  }

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (['all', '7', '30'].includes(p.range)) S.range = p.range;
      if (['', 'firm', 'event'].includes(p.group)) S.group = p.group;
      if (['newest', 'oldest', 'name', 'firm'].includes(p.sort)) S.sort = p.sort;
      S.som = !!p.som;
    } catch (e) {}
  }

  // ── Filter, sort, group ─────────────────────────────────────────────────────

  function compare(a, b) {
    const blankLast = (x, y, fn) => (!x && y ? 1 : x && !y ? -1 : fn());
    const byId = (p, q) => (parseInt(q.id) || 0) - (parseInt(p.id) || 0);
    const name = (p, q) => (p.name || '').localeCompare(q.name || '', undefined, { sensitivity: 'base' });

    switch (S.sort) {
      case 'oldest':
        return blankLast(a._rec, b._rec, () => a._rec.localeCompare(b._rec)) || -byId(a, b);
      case 'name':
        return name(a, b);
      case 'firm': {
        const fa = (a.firm || '').trim(), fb = (b.firm || '').trim();
        return blankLast(fa, fb, () => fa.localeCompare(fb, undefined, { sensitivity: 'base' })) || name(a, b);
      }
      default:
        return blankLast(a._rec, b._rec, () => b._rec.localeCompare(a._rec))
          || (b.date_met || '').localeCompare(a.date_met || '')
          || byId(a, b);
    }
  }

  function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.contacts.filter(c => {
      if (S.event && (c.event || '') !== S.event) return false;
      if (S.som && !isSom(c.som_yale)) return false;
      if (S.range !== 'all') {
        const n = daysAgo(c._rec);
        if (n === null || n > +S.range) return false;
      }
      if (q && !c._hay.includes(q)) return false;
      return true;
    }).sort(compare);
  }

  function grouped(list) {
    const label = S.group === 'firm' ? 'No firm' : 'No event';
    const map = new Map();
    for (const c of list) {
      const raw = String((S.group === 'firm' ? c.firm : c.event) || '').trim();
      const key = raw.toLowerCase();
      if (!map.has(key)) map.set(key, { key, name: raw || label, items: [] });
      map.get(key).items.push(c);
    }
    const groups = [...map.values()];
    const maxRec = g => g.items.reduce((m, c) => (c._rec > m ? c._rec : m), '');
    const minRec = g => g.items.reduce((m, c) => (c._rec && (!m || c._rec < m) ? c._rec : m), '');
    groups.sort((a, b) => {
      if (!a.key && b.key) return 1;
      if (a.key && !b.key) return -1;
      if (S.sort === 'name' || S.sort === 'firm') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (S.sort === 'oldest') return minRec(a).localeCompare(minRec(b));
      return maxRec(b).localeCompare(maxRec(a));
    });
    return groups;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function rowHtml(c) {
    const when = rel(c._rec);
    const note = latestNote(c);
    return `<tr class="row${c.id === S.openId ? ' is-open' : ''}" data-id="${esc(c.id)}" tabindex="0">
      <td class="c-name">${esc(c.name)}${tagHtml(c.som_yale)}${newDotHtml(c)}</td>
      <td class="c-firm">${esc(c.firm) || '<span class="none">—</span>'}</td>
      <td class="c-role">${esc(c.role)}</td>
      <td class="c-when" title="${esc(fmtDate(c._rec))}">${when ? esc(when) : '<span class="none">—</span>'}</td>
      <td class="c-note" title="${esc(note)}">${esc(note)}</td>
    </tr>`;
  }

  function cardHtml(c) {
    const when = rel(c._rec);
    const note = latestNote(c);
    const sub = [c.role, c.firm].map(s => String(s || '').trim()).filter(Boolean).join(' · ');
    return `<article class="card" data-id="${esc(c.id)}" tabindex="0" role="button">
      <div class="card-top">
        <span class="card-name">${esc(c.name)}</span>${tagHtml(c.som_yale)}${newDotHtml(c)}
        ${when ? `<span class="card-when">${esc(when)}</span>` : ''}
      </div>
      ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
      ${note ? `<p class="card-note">${esc(note)}</p>` : ''}
    </article>`;
  }

  function groupToggleHtml(g, collapsed) {
    return `<button type="button" class="group-toggle" data-group="${esc(g.key)}" aria-expanded="${!collapsed}">${CHEVRON}<span>${esc(g.name)}</span><span class="n">${g.items.length}</span></button>`;
  }

  function render() {
    const list = filtered();
    S.shown = list;
    const total = S.contacts.length;
    $('count-label').textContent = list.length === total
      ? `${total} contact${total === 1 ? '' : 's'}`
      : `${list.length} of ${total}`;

    const empty = $('empty');
    empty.hidden = list.length > 0;
    if (!list.length) empty.textContent = total ? 'No contacts match your filters.' : 'No contacts yet.';

    let rows = '', cards = '';
    if (S.group) {
      for (const g of grouped(list)) {
        const collapsed = S.collapsed.has(`${S.group}|${g.key}`);
        rows += `<tr class="group-row"><th colspan="5" scope="rowgroup">${groupToggleHtml(g, collapsed)}</th></tr>`;
        cards += `<div class="group-head">${groupToggleHtml(g, collapsed)}</div>`;
        if (!collapsed) {
          rows += g.items.map(rowHtml).join('');
          cards += g.items.map(cardHtml).join('');
        }
      }
    } else {
      rows = list.map(rowHtml).join('');
      cards = list.map(cardHtml).join('');
    }
    $('table-body').innerHTML = rows;
    $('card-list').innerHTML = cards;
    $('contacts-table').classList.toggle('by-firm', S.group === 'firm');
    document.querySelector('.table-wrap').hidden = !list.length;
  }

  function renderEventFilter() {
    const events = [...new Set(S.contacts.map(c => (c.event || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    $('event-field').hidden = events.length === 0;
    $('event-filter').innerHTML = '<option value="">All</option>' +
      events.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
  }

  function syncControls() {
    document.querySelectorAll('.seg button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.range === S.range)));
    $('group-by').value = S.group;
    $('sort-by').value = S.sort;
    $('som-filter').checked = S.som;
  }

  // ── Detail panel ────────────────────────────────────────────────────────────

  let lastFocus = null;

  function fact(label, html, sub) {
    return html ? `<dt>${label}</dt><dd>${html}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</dd>` : '';
  }

  function openDetail(id, trigger) {
    const c = S.contacts.find(x => x.id === id);
    if (!c) return;
    S.openId = id;
    lastFocus = trigger || null;

    const email = String(c.email || '').trim();
    const phone = String(c.phone || '').trim();
    const sub = [c.role, c.firm].map(s => String(s || '').trim()).filter(Boolean).join(' · ');
    const metWhen = fmtDate(c.date_met);
    const lastWhen = fmtDate(c.last_contact);

    $('detail-body').innerHTML = `
      <h2>${esc(c.name) || 'Unnamed contact'}${tagHtml(c.som_yale)}</h2>
      ${sub ? `<p class="detail-sub">${esc(sub)}</p>` : ''}
      ${String(c.office || '').trim() ? `<p class="detail-office">${esc(c.office)}</p>` : ''}
      <dl class="facts">
        ${fact('Email', email && `<a href="mailto:${esc(email)}">${esc(email)}</a>`)}
        ${fact('Phone', phone && `<a href="tel:${esc(phone)}">${esc(phone)}</a>`)}
        ${fact('How met', esc(c.how_met))}
        ${fact('Event', esc(c.event))}
        ${fact('Met', metWhen && esc(metWhen), metWhen && rel(c.date_met))}
        ${fact('Last contact', lastWhen && esc(lastWhen), lastWhen && rel(c.last_contact))}
      </dl>
      <h3>Notes</h3>
      ${String(c.notes || '').trim()
        ? `<div class="notes">${esc(String(c.notes).trim())}</div>`
        : '<p class="none">No notes.</p>'}
    `;
    $('detail-body').scrollTop = 0;
    $('detail').classList.add('open');
    $('detail').setAttribute('aria-hidden', 'false');
    $('backdrop').classList.add('open');
    $('detail-close').focus({ preventScroll: true });
    document.querySelectorAll('tr.row').forEach(r => r.classList.toggle('is-open', r.dataset.id === id));
  }

  function closeDetail() {
    if (!S.openId) return;
    S.openId = null;
    $('detail').classList.remove('open');
    $('detail').setAttribute('aria-hidden', 'true');
    $('backdrop').classList.remove('open');
    document.querySelectorAll('tr.row.is-open').forEach(r => r.classList.remove('is-open'));
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  function exportXlsx() {
    if (!window.XLSX) { toast('Export library failed to load. Check your connection and reload.'); return; }
    if (!S.shown.length) { toast('Nothing to export'); return; }
    const rows = S.shown.map(c => ({
      'Name': c.name, 'Firm': c.firm, 'Office': c.office, 'Role': c.role,
      'Email': c.email, 'Phone': c.phone, 'How Met': c.how_met, 'Event': c.event,
      'Date Met': c.date_met, 'Last Contact': c.last_contact,
      'SOM/Yale': c.som_yale, 'Notes': c.notes,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [20, 18, 12, 22, 28, 16, 28, 24, 12, 12, 10, 60].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    XLSX.writeFile(wb, `contacts-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ── Boot ────────────────────────────────────────────────────────────────────

  let booted = false;

  async function boot() {
    if (booted) return;
    booted = true;
    loadPrefs();
    syncControls();
    try {
      const r = await fetch('data/contacts.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      S.contacts = data.map(c => ({
        ...c,
        id: String(c.id),
        _rec: recency(c),
        _hay: [c.name, c.firm, c.role, c.office, c.email, c.phone, c.how_met, c.event, c.som_yale, c.notes]
          .map(v => String(v || '')).join('\n').toLowerCase(),
      }));
      renderEventFilter();
      $('results').setAttribute('aria-busy', 'false');
      render();
    } catch (e) {
      $('empty').hidden = false;
      $('empty').textContent = 'Couldn’t load contacts. Reload the page to try again.';
      $('count-label').textContent = '';
    }
  }

  function unlock() {
    document.documentElement.dataset.unlocked = '1';
    try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (e) {}
    boot();
  }

  function init() {
    $('gate-form').addEventListener('submit', e => {
      e.preventDefault();
      const input = $('gate-input');
      if (input.value.trim().toLowerCase() === PASSCODE) {
        input.value = '';
        $('gate-error').hidden = true;
        unlock();
      } else {
        $('gate-error').hidden = false;
        const card = $('gate-form');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        input.select();
      }
    });

    $('lock-btn').addEventListener('click', () => {
      try { localStorage.removeItem(UNLOCK_KEY); } catch (e) {}
      location.reload();
    });

    let searchTimer;
    $('search-input').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { S.q = e.target.value; render(); }, 100);
    });

    document.querySelector('.seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-range]');
      if (!b) return;
      S.range = b.dataset.range;
      syncControls(); savePrefs(); render();
    });

    $('event-filter').addEventListener('change', e => { S.event = e.target.value; render(); });
    $('group-by').addEventListener('change', e => { S.group = e.target.value; savePrefs(); render(); });
    $('sort-by').addEventListener('change', e => { S.sort = e.target.value; savePrefs(); render(); });
    $('som-filter').addEventListener('change', e => { S.som = e.target.checked; savePrefs(); render(); });
    $('export-btn').addEventListener('click', exportXlsx);

    $('results').addEventListener('click', e => {
      const toggle = e.target.closest('.group-toggle');
      if (toggle) {
        const key = `${S.group}|${toggle.dataset.group}`;
        if (S.collapsed.has(key)) S.collapsed.delete(key); else S.collapsed.add(key);
        render();
        return;
      }
      const item = e.target.closest('[data-id]');
      if (item) openDetail(item.dataset.id, item);
    });

    $('results').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('[data-id]');
      if (!item || e.target !== item) return;
      e.preventDefault();
      openDetail(item.dataset.id, item);
    });

    $('detail-close').addEventListener('click', closeDetail);
    $('backdrop').addEventListener('click', closeDetail);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

    if (document.documentElement.dataset.unlocked === '1') boot();
    else $('gate-input').focus();
  }

  init();
})();
