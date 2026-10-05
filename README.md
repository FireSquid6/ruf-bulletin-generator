# RUF Bulletin Generator (TypeScript)

Generate a one-sheet, duplex (front + back), landscape-A4 RUF bulletin from a
single YAML file. Songs, scripture, announcements, contacts, QR codes, and
branding are all data; the generator handles the layout.

## Quick start

```bash
bun install

# Generate the example bulletin (dummy song text)
bun run src/cli.ts example/example-dummy.yaml

# Output: output/bulletin.pdf
```

CLI options:

```bash
bun run src/cli.ts bulletin.yaml    # write to spec's output: path
bun run src/cli.ts bulletin.yaml -o out.pdf
bun run src/cli.ts bulletin.yaml --store path/to/song-store.yaml
bun run src/cli.ts bulletin.yaml --debug   # draw column guides
```

Type-check and run tests:

```bash
bunx tsc -p tsconfig.json
bun test
```

## Layout model

- One physical sheet, landscape A4 (297 x 210 mm), printable duplex.
- Folded bulletins have a fixed cover at page 1 right. Content then reads through
  page 2 left, page 2 right, and page 1 left.
- Flowing blocks stay intact and automatically move between the three content
  panels. Songs, scripture, and other blocks are never split midway.
- The generator finds the largest common font scale that fits the cover and all
  three content panels. This keeps body text consistent throughout a given week
  while preserving the size ratios between body text, titles, and headings.
- The default top and bottom margins are 4mm. Horizontal margins remain 7mm.

The preferred folded format declares the fixed cover and ordered content directly:

```yaml
layout:
  horizontal_margin_mm: 7
  vertical_margin_mm: 4
  gutter_mm: 14

cover:
  - type: branding
    path: ../assets/ruf-baylor-logo.png
  - type: announcements
    items:
      - "Weekly announcement"
  - type: contacts
    items:
      - name: "Staff Name"
        detail: "(555) 555-0100"

flow:
  - type: song
    song_ref: opening_song
  - type: scripture
    reference: "John 1:1"
    text: "Scripture text"
```

Existing two-page, two-column files can set `folded: true`. The generator treats
page 1 right as the cover and combines the other blocks in physical reading order
before redistributing them automatically.

## Song store

Songs can be kept in a keyed YAML store instead of copied into each bulletin:

```yaml
songs:
  opening_song:
    title: "Opening Song"
    columns: 2
    scale: 0.95
    parts:
      - label: "1."
        text: |
          First verse lyrics
      - style: chorus
        text: |
          Chorus lyrics
```

Reference a stored song anywhere a song block is accepted:

```yaml
- type: song
  song_ref: opening_song
  columns: 1
```

The generator uses `--store <filepath>` when supplied. Otherwise, a bulletin that
contains `song_ref` uses `./store/song-store.yaml`. Both paths are relative to the
current working directory. A missing store, an unknown song key, or an invalid
store produces an error before PDF rendering begins. Inline song blocks continue
to work without a store.

Store entries may provide `columns` and `scale` defaults. A reference may override
those two presentation fields, but cannot provide `title` or `parts`; those always
come from the store. Song keys are case-sensitive.

## YAML reference

Top level:

| Key | Meaning |
| --- | --- |
| `metadata` | `title`, `author`, `subject` for the PDF |
| `layout` | `horizontal_margin_mm` (default 7), `vertical_margin_mm` (default 4), and `gutter_mm` (default 14); `margin_mm` remains available to set both margins together |
| `output` | Output PDF path, relative to the YAML file |
| `cover` | Fixed page-1-right blocks for the preferred folded format |
| `flow` | Blocks in reading order for automatic placement across the other three panels |
| `folded` | Set to `true` to apply folded flow to a legacy two-page, two-column `pages` layout |
| `pages` | Legacy list of 1-2 sides; each has `columns` and optional `column_weights` |

Block types:

| Type | Fields | Notes |
| --- | --- | --- |
| `song` | `song_ref`, or inline `title` and `parts`; `columns` (1 or 2), `scale` | Stored songs are looked up by exact key; parts are auto-balanced; lyrics use the standard body size by default, while an explicit `scale` adjusts only the lyrics |
| `scripture` | `reference`, `text`, `label`, `text_style` | Default label is "Scripture Reading"; the text is wrapped in curly quotes |
| `announcements` | `title`, `date`, `items` | String items, or `{title, text}` pairs rendered with a bold lead-in; `date` sits right-aligned on the header row |
| `contacts` | `items: [{name, detail}]` | Rendered as evenly spaced columns |
| `heading` | `text`, `style` | Callout-style bold heading (order-of-service markers like "Prayer") |
| `text` | `text`, `style` | Plain paragraph |
| `image` / `branding` | `path`, `max_width_mm`, `max_height_mm` | Path relative to the YAML file |
| `qr` | `path`, `caption`, `size_mm`, or `items: [{path, caption, size_mm}]` | One QR, or multiple evenly spaced in a row; each caption is centered above its image |
| `spacer` | `height_mm` | Vertical gap |

Song `parts` entries: `text` (newlines preserved), optional `label` (e.g. `"1."`,
rendered bold), optional `style: chorus` (renders italic). For 2-column songs,
parts are split into two balanced sub-columns in reading order.

Relative image and configured output paths resolve against the bulletin YAML's
directory, so weekly YAMLs in `bulletins/` can share the same `../assets/`. CLI
`--output` and `--store` paths resolve against the current working directory.

## Files

```
src/cli.ts                    # Commander CLI entry point
src/index.ts                  # public generator API
src/generate.ts               # YAML-to-PDF orchestration
src/song-store.ts             # song store validation and reference resolution
src/layout.ts                 # fitting, scaling, and folded flow
src/render.ts                 # PDF block and column rendering
src/validation.ts             # YAML specification validation
src/constants.ts              # page dimensions and typography
src/types.ts                  # shared specification types
src/paths.ts                  # YAML-relative path resolution
src/images.ts                 # image dimension detection
tests/bulletin-generator.test.ts
example/example-dummy.yaml    # example weekly spec (dummy song text)
store/song-store.yaml         # default reusable song store
assets/ruf-baylor-logo.png    # extracted from the example bulletin
assets/groupme-qr.png         # extracted from the example bulletin
example/                      # original reference PDF + DOCX
output/                       # generated PDFs
```

## Notes

- The example YAML uses **dummy song text**; the original hymn lyrics are
  copyrighted. Paste in authorized text per week before printing.
- Scripture in the example is KJV (public domain); swap translations per your
  church's license.
