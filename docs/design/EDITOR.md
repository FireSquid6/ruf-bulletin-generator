# Bulletin editor UX brief

Use this brief when implementing or revising the editor and its neighboring screens. It captures the **selected revised mockup**, not permission to copy its temporary storage or renderer. Read [PRODUCT.md](../../PRODUCT.md) for confirmed product behavior and [DESIGN.md](../../DESIGN.md) for visual tokens before changing the UI.

## Screen map

- **Bulletins:** list/search by gathering date, create one bulletin per date, reopen saved drafts, and delete with confirmation. The new-bulletin flow must use the familiar starter arrangement, with blank/editable content rather than last week's literal copy. The prototype currently creates an *empty* draft; change that in production.
- **Editor:** minimal date/export header; read-only outside then inside preview on the left; right rail for navigation, Save draft, Sections/Page setup, and the selected block's fields. Mobile uses Preview/Edit switching. PDF preview/download must use actual generation output or reliably display its errors, not silently treat the browser print approximation as proof of fit.
- **Song store:** separate browse/search and edit page. Edit key, title, ordered parts with verse/chorus labels, and optional layout defaults. Warn that changing a key breaks older references; allow deletion and later re-use of the same key to reconnect. Bulletin song blocks only select a key.
- **Assets:** upload and manage reusable branding, image, and QR assets; select them within bulletin blocks. Keep image data in Postgres in production. Allow removal and report any newly broken references.
- **Access:** staff registration with email, password, and admin-issued single-use 16-character invitation; admin management of invitations and MCP keys assigned to **named staff accounts** (multiple revocable keys per account). Illustrate access with the same UI language; design the real flows when authentication is implemented. Password reset/email verification are deferred.

## Bulletin composition

The screen distinguishes **cover** (page 1 right) from **reading-order content** (the other three panels). The physical cover stays fixed, but its list of blocks is editable. Every block—including branding, QR, Sermon passage, and Scripture Reading—can be inserted, moved within a list, moved between cover and reading order, and removed. A group of announcement, contact, QR, or song parts has independent item ordering. There is no required count of either passage role.

The default should explain the old format through a ready-to-edit arrangement, not enforce it. Use explicit, structured fields rather than encoding announcements or contacts as lines in one textarea. A song picker searches keys/titles and displays the current referenced song; lyrics are edited only on the store page. A broken song key remains visible and selectable for repair. The date appears once as an editable gathering date and supplies derived presentation metadata; it is unique among bulletins.

## States to design, not merely the happy path

1. **Draft and save:** unsaved state is distinguishable from saved state. Incomplete/empty compositions can be saved; a PDF may be generated with zero passages. Navigation away from unsaved edits should offer a way to keep work.
2. **Generation:** preview and download represent the same generator result. If a song key is missing, an image is unavailable, or material cannot fit the current format, identify the block and reason, keep its content visible in the editor, and block only PDF generation. Never claim PDF success from a partial preview. Avoid unnecessary content-completeness gates; staff are trusted to decide what belongs on a bulletin.
3. **Conflict:** on a stale revision, keep the user's unsaved edits while showing that a newer version exists. Give explicit recovery or comparison choices; never overwrite in silence. The prototype simulates this in browser storage; the real app must detect server revisions.
4. **Deletion:** a signed-in staff member can delete a bulletin or shared song/asset. Confirm the target and explain that deleting a referenced store item may cause generation errors elsewhere; do not silently cascade or repair references.
5. **Small screens:** switch between full-width edit and preview. Keep the physical sheet readable via bounded horizontal scrolling; don't squeeze the A4 sheet into illegibility or make the whole app scroll sideways.

## Prototype-to-product translation

Treat these differences as **requirements to resolve**, not design patterns to inherit:

| Prototype evidence | Product direction |
| --- | --- |
| `src/model.ts` stores fixtures and a single sample bulletin in browser localStorage. | The Bun service persists authoritative records/assets in Postgres. Sample lyrics and dates are not canonical content. |
| `src/main.tsx` starts a newly dated bulletin with no blocks. | Start with the familiar editable folded arrangement and current logo; keep its text fields uncommitted to any week's copy. |
| `src/Preview.tsx` measures HTML blocks at a fixed pixel height and `main.tsx` uses browser print. | PDF generation is authoritative; use the existing PDF generator or its evolved interface. A live preview may approximate but must not assert PDF correctness from HTML fit. |
| `src/Preview.tsx` blocks generation on an entirely empty bulletin and several unfinished field values. | Saving is always allowed. The user explicitly permits zero passages and prefers explicit generation errors to hidden workarounds; only genuine generator limitations should block PDF. |
| Access screen takes a name and says a password will be collected later by an unspecified provider; invitations show an email delivery and expiry example. | Registration actually requires email, password, and a single-use 16-character admin code. No email service, expiry policy, or provider has been decided for MVP. |
| MCP key screen speaks of keys for named integrations and scoped/audited credentials. | Admins issue/revoke separate keys tied to named **staff accounts**, with content operations only. API-key scopes, audit UX, and automated delivery were not agreed. |
| Some image fields or empty text blocks produce demo-specific warnings. | Keep actionable errors, but don't add a general approval/publishing checklist or artificially require passages, songs, announcements, contacts, or QR codes. |

## Screen completion check

For any added or revised surface, verify its primary task, keyboard and mobile operation, empty/unsaved/error states, and alignment with the reference captures. Check that a saved bulletin's composition can be represented without the present A4 layout; the PDF format may change later. Confirm every example that looks like real RUF copy against a source or mark it clearly as a sample.
