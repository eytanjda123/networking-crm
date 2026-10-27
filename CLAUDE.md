# Networking CRM — instructions for adding/updating contacts

Static site (GitHub Pages, served from `main` / root). There is no server. The only data file is `data/contacts.json`, a JSON array of contact objects. When the user describes people they met, update that file and push to `main`.

## Contact schema (all values are strings; use "" when unknown)

`id, name, firm, office, role, email, phone, how_met, event, date_met, last_contact, status, next_step, follow_up_date, som_yale, notes`

- `id`: string; new contacts get (max existing id + 1). Never reuse or renumber ids.
- Dates: `YYYY-MM-DD`. `date_met` and `last_contact` are both today's date (or the meeting date) for a new contact. `follow_up_date` is blank unless a follow-up is implied.
- `status`: one of `Not started`, `In progress`, `Coffee chat & TY`, `TY`, `Done`, `-`. Use `Not started` for a new contact unless told otherwise.
- `som_yale`: `false` if not Yale-affiliated; `SOM '26` style (`SOM '<2-digit class year>`) or `SOM` if the year is unknown. Other schools follow the same pattern (e.g. `YLS '26`).
- `event`: only for a named conference/event (reuse the exact spelling of an existing event). Otherwise "".
- `how_met`: short phrase, e.g. "Coffee chat", "Panel at ...".
- `next_step`: short action, e.g. "Send TY email".
- `notes`: first-person style key points, advice, and context. Never mention the user by name. Use `\n` for line breaks.

## Workflow

1. Search `data/contacts.json` for an existing person (same email, or same first and last name). If found, update that record: append new info to `notes` under a dated divider (e.g. `\n\n── Oct 27, 2026 ──\n...`), update `last_contact`, and don't create a duplicate.
2. Otherwise append a new object with the next id.
3. Keep valid JSON with 2-space indentation, and keep `ensure_ascii=False` so non-ASCII characters aren't escaped. Validate by parsing the file after editing.
4. Commit with a short message (e.g. "Add Jane Doe (Acme)") and push to `main`. GitHub Pages redeploys in about a minute.

## Notes

- `data/contacts.json` is reloaded on every page load, so edits made in the browser UI last only until the next reload and are never in this file. If the user exports an Excel file from the app, merge any differences into `data/contacts.json` on request.
- `data/contacts.csv` is an old backup and is not used by the app.
- The site is public on GitHub Pages; never add anything more sensitive than normal professional contact details and notes.
