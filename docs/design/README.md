# Design references

These images were captured from the **revised** interactive prototype at `~/design/ruf-bulletin-web-editor` on 2026-11-10, after the initial focused/outline screenshots in that directory. They are visual references, not production screenshots. The production repository has no web UI yet.

| Screen | Reference | What to preserve |
| --- | --- | --- |
| Editor, desktop | [editor-desktop.png](reference/editor-desktop.png) | White outside/inside paper on light canvas; editor controls in right rail; minimal header. |
| Editor, mobile preview | [editor-mobile-preview.png](reference/editor-mobile-preview.png) | Preview/Edit tabs; paper pans inside its own scroll region. |
| Editor, mobile editing | [editor-mobile-edit.png](reference/editor-mobile-edit.png) | Full-width fields and visible block placement/movement. |
| Song store | [song-store-desktop.png](reference/song-store-desktop.png) | Searchable catalog beside separate detail editor. |
| Asset library | [asset-library-desktop.png](reference/asset-library-desktop.png) | Upload controls followed by reusable asset thumbnails. |
| Access illustrations | [access-desktop.png](reference/access-desktop.png) | Same restrained UI treatment; **flow is illustrative, not authoritative**. |

The original interactive source remains at `~/design/ruf-bulletin-web-editor/src/` if present. In particular, `src/model.ts`, `src/main.tsx`, `src/BlockEditor.tsx`, `src/Libraries.tsx`, `src/Preview.tsx`, `src/app.css`, `src/libraries.css`, and `src/paper-ui/styles.css` explain the prototype. These repo-local captures keep the visual direction available when that external directory is not. [PRODUCT.md](../../PRODUCT.md) is the product authority; [DESIGN.md](../../DESIGN.md) is the visual authority; [EDITOR.md](EDITOR.md) describes interactions and deliberate prototype-to-production differences.
