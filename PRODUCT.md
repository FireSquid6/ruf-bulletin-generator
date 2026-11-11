# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

RUF staff prepare bulletins for gatherings, maintain the reusable song store and image assets, and generate a printable PDF. Administrators additionally issue registration invitations and manage MCP API keys. This is an internal tool, not a public publishing site or multi-organization product.

## Product Purpose

Replace hand-edited weekly YAML with a dated bulletin editor backed by Postgres. Staff can save incomplete work, rearrange content, and preview or download the generated bulletin on demand. MCP offers the same content-management and generation capabilities to authenticated clients.

## Operating Context

- At most one bulletin exists for a gathering date. The date supplies the displayed date, default PDF title, and output filename; announcement text may mention other dates.
- A new bulletin starts with the familiar folded arrangement and current RUF logo, but its blocks are freely editable. The cover is a physical panel, not an immutable collection of content.
- A saved draft may have zero Sermon passages, zero Scripture Readings, missing song references, or other unfinished content. There is no publish or approval step.
- For now the PDF is one landscape-A4 sheet, printed duplex and folded. Content and interface concepts must allow a different layout/output format later.
- The current generator and YAML examples are in this repository; `~/design/ruf-bulletin-web-editor` is an interactive design prototype, not the production app. Portable visual captures are indexed in [docs/design/README.md](docs/design/README.md).

## Capabilities and Constraints

- Postgres is authoritative for bulletin content, song-store entries, uploaded QR/branding images, and application records. One self-hosted Bun web/MCP service connects to it; deeper stack/deployment choices are intentionally deferred.
- Staff can add, remove, and reorder **all** block types—including branding—and move them between cover and reading-order content. They can also reorder items within announcement, contact, and QR blocks. Retain optional headings, text, images, and spacers.
- Sermon passage and Scripture Reading are explicit, distinct roles. Each may appear zero or more times; reference and full text are editable.
- Bulletin song blocks store a song **key**, never song lyrics. Songs are selected in the bulletin editor and maintained on a separate song-store page with title, ordered verse/chorus parts, and optional column/scale defaults.
- A change to a song affects older bulletins that reference its key. Deletion or key rename may leave broken references; adding a song under the old key reconnects them. The interface shows broken references rather than hiding or auto-replacing them.
- Reusable images are uploaded and selected from an asset library. The existing RUF logo is the default branding asset, but its block can be changed or removed. QR captions/order belong to bulletin content.
- Saving a draft must succeed even if PDF generation would fail. Generation must report specific missing references, unavailable assets, and content that cannot fit; it must not silently drop content.
- Simultaneous saves must detect a newer bulletin revision and surface a conflict instead of silently overwriting work. Any signed-in staff member can edit/delete bulletins, songs, and assets.
- Registration takes email, password, and an admin-issued **single-use, 16-character** invitation key. Administrators alone generate invitations and issue/revoke MCP API keys for named staff accounts; multiple keys per account are allowed. MCP cannot manage accounts or invitations.
- Bootstrap the first admin via a one-time server setup command. Only a simple throwaway script to import `store/song-store.yaml` is wanted; weekly YAML bulletin migration is manual.

## Brand Commitments

Keep the current RUF Baylor logo available as a reusable starter asset. The editor's **document-first light interface** is the selected visual direction: read-only stacked outside/inside preview, editing controls to the right on desktop, a minimal date/export header, and restrained application chrome. This is interface guidance, not a mandate to reproduce fixture copy or to change the PDF's historical visual styling.

## Evidence on Hand

- `assets/ruf-baylor-logo.png` and `assets/groupme-qr.png` are real project assets.
- `README.md`, `packages/generator/src/`, `packages/cli/src/`, `store/song-store.yaml`, and `bulletins/` describe the current YAML CLI and its supported blocks.
- The revised prototype's source is at `~/design/ruf-bulletin-web-editor/src/`. Its demo lyrics, names, announcements, date, and tagline are **sample content**, not approved weekly bulletin copy.
- The prototype stores data in browser localStorage, approximates pagination in HTML, and uses browser print. These are demonstrations, not persistence, PDF, authorization, or concurrency implementations.

## Product Principles

1. Trust staff with content and layout choices; drafts may be incomplete and passages are not artificially required.
2. Preserve every edit; make generation failures and save conflicts explicit and actionable.
3. Keep bulletin composition independent from the current printable format.
4. Keep reusable material in shared libraries while each bulletin retains its own ordered composition.
5. Give the web UI and MCP the same content semantics; do not turn the prototype's shortcuts into backend rules.

## Deferred

Email confirmation and self-service password recovery use outbound email. Confirmation can be disabled by server flag in development; when enabled, unconfirmed accounts cannot use the workspace or MCP. Changing the one-sheet PDF format is likely later. Detailed hosting choices are not part of the current design brief.
