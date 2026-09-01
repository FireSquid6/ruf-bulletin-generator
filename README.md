# RUF Bulletin Generator (TypeScript)

Generate a one-sheet, duplex (front + back), landscape-A4 RUF bulletin from a
single YAML file. Songs, scripture, announcements, contacts, QR codes, and
branding are all data; the generator handles the layout.

## Quick start

```bash
bun install

# Generate the example bulletin (dummy song text)
bun run bulletin-generator.ts example/example-dummy.yaml

# Output: output/bulletin.pdf
```

CLI options:

```bash
bun run bulletin-generator.ts bulletin.yaml    # write to spec's output: path
bun run bulletin-generator.ts bulletin.yaml -o out.pdf
bun run bulletin-generator.ts bulletin.yaml --debug   # draw column guides
```

Type-check and run tests:

```bash
bunx tsc -p tsconfig.json
bun test
```

## Layout model

- One physical sheet, landscape A4 (297 x 210 mm), printable duplex.
- Up to 2 pages in `pages:` (front and back sides).
- Each side is an independent set of 1-3 columns.
- `column_weights` (optional) sets relative column widths, e.g. `[2, 1]`.
- If a column's content is too tall, the generator steps its scale down
  (100% -> 50% in 5% steps) until it fits the sheet. If text is overly small,
  move blocks between columns.

## YAML reference

Top level:

| Key | Meaning |
| --- | --- |
| `metadata` | `title`, `author`, `subject` for the PDF |
| `layout` | `margin_mm` (default 10), `gutter_mm` (default 8) |
| `output` | Output PDF path, relative to the YAML file |
| `pages` | List of 1-2 sides; each has `columns` (list of block lists) and optional `column_weights` |

Block types:

| Type | Fields | Notes |
| --- | --- | --- |
| `song` | `title`, `parts`, `columns` (1 or 2) | Parts are auto-balanced; in a 2-column song, verse text is laid out side by side with smaller type |
| `scripture` | `reference`, `text`, `label`, `text_style` | Default label is "Scripture Reading"; the text is wrapped in curly quotes |
| `announcements` | `title`, `date`, `items` | String items, or `{title, text}` pairs rendered with a bold lead-in; `date` sits right-aligned on the header row |
| `contacts` | `items: [{name, detail}]` | Rendered as evenly spaced columns |
| `heading` | `text`, `style` | Callout-style bold heading (order-of-service markers like "Prayer") |
| `text` | `text`, `style` | Plain paragraph |
| `image` / `branding` | `path`, `max_width_mm`, `max_height_mm` | Path relative to the YAML file |
| `qr` | `path`, `caption`, `size_mm` | Caption centered above the QR image |
| `spacer` | `height_mm` | Vertical gap |

Song `parts` entries: `text` (newlines preserved), optional `label` (e.g. `"1."`,
rendered bold), optional `style: chorus` (renders italic). For 2-column songs,
parts are split into two balanced sub-columns in reading order.

Relative paths (images, output) resolve against the YAML file's directory, so
you can keep weekly YAMLs in `bulletins/` sharing the same `../assets/`.

## Files

```
bulletin-generator.ts         # the generator (Bun + pdfkit + js-yaml)
tests/bulletin-generator.test.ts
example/example-dummy.yaml    # example weekly spec (dummy song text)
assets/ruf-baylor-logo.png    # extracted from the example bulletin
assets/groupme-qr.png         # extracted from the example bulletin
example/                     # original reference PDF + DOCX
output/                       # generated PDFs
```

## Notes

- The example YAML uses **dummy song text**; the original hymn lyrics are
  copyrighted. Paste in authorized text per week before printing.
- Scripture in the example is KJV (public domain); swap translations per your
  church's license.
