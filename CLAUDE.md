# Networking CRM — instructions for adding/updating contacts

Static site (GitHub Pages, served from `main` / root). There is no server. The only data file is `data/contacts.json`, a JSON array of contact objects. When the user describes people they met, update that file and push to `main`.

## Contact schema (all values are strings; use "" when unknown)

`id, name, firm, office, role, email, phone, how_met, event, date_met, last_contact, som_yale, notes`

- `id`: string; new contacts get (max existing id + 1). Never reuse or renumber ids.
- Dates: `YYYY-MM-DD`. `date_met` and `last_contact` are both today's date (or the meeting date) for a new contact. The table is sorted by `last_contact` (newest first), so always set it.
- `status`, `next_step`, `follow_up_date`: no longer shown in the app. Leave them out for new contacts and don't touch them on existing records.
- `som_yale`: `false` if not Yale-affiliated; `SOM '26` style (`SOM '<2-digit class year>`) or `SOM` if the year is unknown. Other schools follow the same pattern (e.g. `YLS '26`).
- `event`: only for a named conference/event (reuse the exact spelling of an existing event). Otherwise "".
- `how_met`: short phrase, e.g. "Coffee chat", "Panel at ...".
- `notes`: first-person style key points, advice, and context. Never mention the user by name. Use `\n` for line breaks.

## Workflow

1. Search `data/contacts.json` for an existing person (same email, or same first and last name). If found, update that record: append new info to `notes` under a dated divider (e.g. `\n\n── Oct 27, 2026 ──\n...`), update `last_contact`, and don't create a duplicate.
2. Otherwise append a new object with the next id.
3. Keep valid JSON with 2-space indentation, and keep `ensure_ascii=False` so non-ASCII characters aren't escaped. Validate by parsing the file after editing.
4. Commit with a short message (e.g. "Add Jane Doe (Acme)") and push to `main`. GitHub Pages redeploys in about a minute.

## Notes

- The site is read-only: it loads `data/contacts.json` on every page load and has no editing UI. All changes go through that file.
- Recency (the sort order, the "Past 7/30 days" views and the "new" dot) uses `last_contact`, falling back to `date_met`.
- The Notes column shows each contact's full `notes` text (the Notes control switches Short / Medium / Full). The table can be sorted by last contact, date met, name, firm, role, office, event, or Yale class year.
- A passcode screen (cosmetic only, defined in `app.js`) fronts the site. The JSON is still publicly readable.
- `data/contacts.csv` is an old backup and is not used by the app.
- The site is public on GitHub Pages; never add anything more sensitive than normal professional contact details and notes.
