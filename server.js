require('dotenv').config({ override: true, path: require('path').join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'contacts.csv');
const FIELDS = [
  'id','name','firm','office','role','email','phone',
  'how_met','event','date_met','last_contact','status',
  'next_step','follow_up_date','som_yale','notes'
];

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── CSV helpers ───────────────────────────────────────────────────────────────

function readCSV() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, 'utf-8').replace(/^﻿/, '');
  if (!raw.trim()) return [];
  const records = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
  return records.map(r => {
    const obj = {};
    FIELDS.forEach(f => { obj[f] = (r[f] ?? '').toString(); });
    return obj;
  });
}

function writeCSV(contacts) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const csv = stringify(contacts, { header: true, columns: FIELDS, quoted: true, record_delimiter: '\n' });
  fs.writeFileSync(DATA_FILE, csv, 'utf-8');
}

function ensureFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) writeCSV([]);
}

function loadContacts() {
  const contacts = readCSV();
  const maxId = contacts.reduce((m, c) => Math.max(m, parseInt(c.id) || 0), 0);
  let nextId = maxId + 1;
  let changed = false;
  contacts.forEach(c => { if (!c.id) { c.id = String(nextId++); changed = true; } });
  if (changed) writeCSV(contacts);
  return contacts;
}

// ── Undo / redo ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 30;
let undoStack = [];
let redoStack = [];

function snapshot() {
  undoStack.push(loadContacts());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

function historyState() {
  return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}

app.get('/api/history-state', (req, res) => res.json(historyState()));

app.post('/api/undo', (req, res) => {
  try {
    if (!undoStack.length) return res.status(400).json({ error: 'Nothing to undo' });
    redoStack.push(loadContacts());
    writeCSV(undoStack.pop());
    res.json({ contacts: loadContacts(), ...historyState() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/redo', (req, res) => {
  try {
    if (!redoStack.length) return res.status(400).json({ error: 'Nothing to redo' });
    undoStack.push(loadContacts());
    writeCSV(redoStack.pop());
    res.json({ contacts: loadContacts(), ...historyState() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API routes ────────────────────────────────────────────────────────────────

app.get('/api/contacts', (req, res) => {
  try { res.json(loadContacts()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/contacts', (req, res) => {
  try {
    snapshot();
    const contacts = loadContacts();
    const maxId = contacts.reduce((m, c) => Math.max(m, parseInt(c.id) || 0), 0);
    const contact = { ...req.body, id: String(maxId + 1) };
    contacts.push(contact);
    writeCSV(contacts);
    res.json(contact);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/contacts/:id', (req, res) => {
  try {
    snapshot();
    const contacts = loadContacts();
    const i = contacts.findIndex(c => c.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Not found' });
    contacts[i] = { ...contacts[i], ...req.body, id: req.params.id };
    writeCSV(contacts);
    res.json(contacts[i]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/contacts/:id', (req, res) => {
  try {
    snapshot();
    const contacts = loadContacts().filter(c => c.id !== req.params.id);
    writeCSV(contacts);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/events', (req, res) => {
  try {
    const events = [...new Set(
      loadContacts().map(c => (c.event || '').trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));
    res.json(events);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    const client = new Anthropic();
    const today = new Date().toISOString().split('T')[0];

    const result = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a networking CRM assistant for Eytan, a Yale SOM student. Extract ALL networking contacts from his message — there may be one or several people.

Return ONLY a valid JSON array of contact objects. Always return an array, even for a single contact.

Each object has exactly these fields (use "" for unknown):
{
  "name": "full name",
  "firm": "company or organization",
  "office": "city, state, or office location",
  "role": "job title",
  "email": "email address",
  "phone": "phone number",
  "how_met": "how/where they met",
  "date_met": "YYYY-MM-DD, today is ${today}",
  "last_contact": "YYYY-MM-DD (same as date_met if just met)",
  "status": "one of exactly: Not started | In progress | Coffee chat & TY | TY | Done | -",
  "next_step": "recommended next action",
  "follow_up_date": "YYYY-MM-DD or empty",
  "som_yale": "true if Yale/SOM affiliated, false otherwise",
  "notes": "first-person notes as Eytan would write them — key points, advice, context. If multiple people share context (same email, same event), note it (e.g. 'From same BCG info session email'). Never mention Eytan by name."
}

Only extract people who are actual networking contacts — not people merely mentioned in passing.
No markdown fences, no explanation — the JSON array only.`,
      messages: [{ role: 'user', content: message }]
    });

    const text = result.content[0].text.trim()
      .replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(text);
    const contacts = Array.isArray(parsed) ? parsed : [parsed];
    res.json({ contacts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upload-notes', async (req, res) => {
  try {
    const { images } = req.body;
    if (!images?.length) return res.status(400).json({ error: 'No images provided' });

    const client = new Anthropic();
    const today = new Date().toISOString().split('T')[0];

    const content = [
      ...images.map(img => img.type === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.data } }
        : { type: 'image',    source: { type: 'base64', media_type: img.type, data: img.data } }
      ),
      {
        type: 'text',
        text: `These are photos of handwritten notes from a conference, panel, or meeting. Today is ${today}.

Read ALL the handwriting carefully. Identify every speaker/panelist/contact present — there may be several.

First, identify the overall context: event name, panel topic, date, location if mentioned.

Then create ONE contact object per speaker/panelist. For each contact's "notes" field include BOTH:
1. PANEL CONTEXT: 2-3 sentences summarizing the overall panel/event topic and key themes
2. SPEAKER NOTES: this specific person's contributions, quotes, opinions, and insights where you can attribute them

Return a JSON ARRAY — one object per person — with these exact fields (empty string for unknown):
{
  "name": "full name",
  "firm": "their company or organization",
  "office": "city or office location",
  "role": "their job title",
  "email": "email address if visible",
  "phone": "phone number if visible",
  "how_met": "Panel: [panel/event name] at [conference/venue]",
  "date_met": "YYYY-MM-DD, use today (${today}) if not specified",
  "last_contact": "same as date_met",
  "status": "Not started",
  "next_step": "Follow up from [event name]",
  "follow_up_date": "",
  "som_yale": "true if Yale/SOM affiliated, false otherwise",
  "notes": "Panel context: [overall panel summary]. \\n\\nContributions: [what this specific speaker said, argued, or contributed]"
}

If you cannot attribute specific comments to specific speakers, put all notes under each contact's notes field.
Return ONLY the JSON array — no markdown fences, no explanation.`
      }
    ];

    const result = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content }]
    });

    const text = result.content[0].text.trim()
      .replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(text);
    const contacts = Array.isArray(parsed) ? parsed : [parsed];
    res.json({ contacts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/draft-email', async (req, res) => {
  try {
    const { contacts, context, senderName } = req.body;
    if (!contacts?.length) return res.status(400).json({ error: 'No contacts provided' });

    const client = new Anthropic();
    const contactsText = contacts.map((c, i) => `
Contact ${i + 1}: ${c.name}
  Firm: ${c.firm || '—'}  |  Role: ${c.role || '—'}  |  Office: ${c.office || '—'}
  Email: ${c.email || '—'}
  How we met: ${c.how_met || '—'}
  Date met: ${c.date_met || '—'}  |  Last contact: ${c.last_contact || 'never'}
  Status: ${c.status || '—'}  |  Next step: ${c.next_step || '—'}
  Notes: ${(c.notes || 'No notes').replace(/\n/g, ' ')}`).join('\n\n');

    const result = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `You are helping Eytan${senderName && senderName !== 'Eytan' ? ` (going by ${senderName})` : ''}, a Yale SOM student, draft personalized networking emails.

Rules:
- Write in first person, warm but professional
- Reference the specific context of how they met and details from the notes — make it feel hand-written, not templated
- Keep the body to 4-6 sentences max
- Never use generic phrases like "I hope this finds you well" or "reaching out to connect"
- Mention something specific from their notes or conversation to show you were paying attention
- End with a clear, low-friction ask or next step
- Return ONLY a valid JSON array, no markdown, no explanation`,
      messages: [{
        role: 'user',
        content: `Draft one personalized email per contact. Use ALL the details provided — notes, how we met, last contact, status — to make each email genuinely specific to that person.

Purpose of these emails: ${context}

${contactsText}

Return JSON array with one object per contact (same order):
[{"name":"Full Name","subject":"Subject line","body":"Email body text"}]`
      }]
    });

    const text = result.content[0].text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    res.json({ emails: JSON.parse(text) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export', (req, res) => {
  try {
    let contacts = loadContacts();
    if (req.query.ids) {
      const ids = new Set(req.query.ids.split(','));
      contacts = contacts.filter(c => ids.has(c.id));
    }
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
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `contacts-${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Settings ──────────────────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const DEFAULT_SETTINGS = {
  reminderEmail: '', smtpUser: '', smtpPass: '',
  smtpHost: 'smtp.gmail.com', smtpPort: 587,
  daysAhead: 1, sendTime: '08:00', enabled: false
};

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); }

app.get('/api/settings', (req, res) => res.json(loadSettings()));
app.post('/api/settings', (req, res) => {
  saveSettings({ ...loadSettings(), ...req.body });
  rescheduleCron();
  res.json({ ok: true });
});

// ── Reminder email ─────────────────────────────────────────────────────────────

function getDueContacts(daysAhead) {
  const contacts = loadContacts();
  const today = new Date(); today.setHours(0,0,0,0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + daysAhead);
  return contacts.filter(c => {
    if (!c.follow_up_date) return false;
    const d = new Date(c.follow_up_date + 'T00:00:00');
    return d >= today && d <= cutoff;
  });
}

async function buildReminderContent(contacts) {
  const client = new Anthropic();
  const list = contacts.map((c,i) => `
${i+1}. ${c.name} — ${c.firm || '—'}, ${c.role || '—'}, ${c.office || '—'}
   How met: ${c.how_met || '—'} on ${c.date_met || '—'}
   Follow-up date: ${c.follow_up_date}  |  Next step: ${c.next_step || '—'}
   Notes: ${(c.notes || '').replace(/\n/g,' ').slice(0,400)}`).join('\n');

  const result = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 3000,
    system: 'You write concise networking follow-up briefings for Eytan. Return ONLY a JSON array.',
    messages: [{ role: 'user', content:
      `For each contact below, write a briefing object with the key facts Eytan needs before following up. Be concise — no fluff.

${list}

Return JSON array:
[{
  "name": "...",
  "firm": "...",
  "role": "...",
  "email": "... or empty",
  "follow_up_date": "...",
  "next_step": "...",
  "bullets": [
    "Where & when met: ...",
    "Context: 1 sentence on who they are and the relationship",
    "Notes: key points from conversation — advice, topics, anything notable",
    "Follow-up goal: what this follow-up is trying to accomplish"
  ]
}]

Keep each bullet tight. Omit a bullet if there's nothing useful to say.` }]
  });

  const text = result.content[0].text.trim().replace(/^```json?\n?/,'').replace(/\n?```$/,'');
  return JSON.parse(text);
}

function reminderHtml(items, dateStr) {
  const cards = items.map(r => {
    const emailLine = r.email ? `<div style="font-size:12px;color:#64748b;margin-bottom:10px;">${r.email}</div>` : '';
    const bulletList = (r.bullets || []).map(b =>
      `<li style="font-size:13px;color:#334155;margin-bottom:6px;line-height:1.5;">${b}</li>`
    ).join('');
    return `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
        <span style="font-size:15px;font-weight:600;">${r.name}</span>
        <span style="font-size:12px;color:#94a3b8;">Due ${r.follow_up_date}</span>
      </div>
      <div style="font-size:13px;color:#64748b;margin-bottom:8px;">${r.firm}${r.role ? ' · ' + r.role : ''}</div>
      ${emailLine}
      <ul style="margin:0;padding-left:18px;">${bulletList}</ul>
      ${r.next_step ? `<div style="margin-top:10px;padding:8px 12px;background:#f8fafc;border-radius:6px;font-size:12px;color:#475569;"><strong>Next step:</strong> ${r.next_step}</div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#0f172a;">
    <h2 style="margin:0 0 4px;">📬 Networking Follow-ups</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 24px;">${items.length} reminder${items.length!==1?'s':''} — ${dateStr}</p>
    ${cards}
    <p style="font-size:12px;color:#94a3b8;margin-top:24px;">Sent by your Networking CRM · <a href="http://localhost:${PORT}" style="color:#94a3b8;">Open app</a></p>
  </body></html>`;
}

async function sendReminderEmail(preview = false) {
  const settings = loadSettings();
  const due = getDueContacts(settings.daysAhead);
  if (!due.length) return { sent: false, count: 0, reason: 'No follow-ups due in this window' };

  const items = await buildReminderContent(due);
  const dateStr = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const html = reminderHtml(items, dateStr);
  const subject = `📬 ${due.length} Follow-up${due.length!==1?'s':''} Due — ${dateStr}`;

  if (preview) return { sent: false, preview: true, html, subject, count: due.length };

  const transport = nodemailer.createTransport({
    host: settings.smtpHost, port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    auth: { user: settings.smtpUser, pass: settings.smtpPass }
  });
  await transport.sendMail({
    from: `"Networking CRM" <${settings.smtpUser}>`,
    to: settings.reminderEmail, subject, html
  });
  return { sent: true, count: due.length };
}

app.post('/api/reminders/send', async (req, res) => {
  try { res.json(await sendReminderEmail(req.body.preview)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reminders/preview', async (req, res) => {
  try {
    const settings = loadSettings();
    const due = getDueContacts(settings.daysAhead);
    res.json({ count: due.length, contacts: due.map(c => ({ name: c.name, firm: c.firm, follow_up_date: c.follow_up_date })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Cron scheduler ────────────────────────────────────────────────────────────

let cronTask = null;
function rescheduleCron() {
  if (cronTask) { cronTask.stop(); cronTask = null; }
  const s = loadSettings();
  if (!s.enabled || !s.reminderEmail) return;
  const [h, m] = (s.sendTime || '08:00').split(':').map(Number);
  cronTask = cron.schedule(`${m} ${h} * * *`, async () => {
    try { const r = await sendReminderEmail(); console.log('Reminder:', r); }
    catch(e) { console.error('Reminder error:', e.message); }
  });
  console.log(`Reminders scheduled at ${s.sendTime} daily → ${s.reminderEmail}`);
}

ensureFile();
rescheduleCron();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nNetworking CRM → http://localhost:${PORT}\n`);
  console.log(`Data file: ${DATA_FILE}`);
});
