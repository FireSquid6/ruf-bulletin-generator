---
name: RUF Bulletin Studio
description: Document-first editing for RUF's dated bulletins
colors:
  action: "#2563eb"
  action-ink: "#ffffff"
  canvas: "#f4f4f5"
  paper: "#ffffff"
  inset: "#fafafa"
  border: "#d4d4d8"
  text: "#27272a"
  heading: "#18181b"
  muted: "#52525b"
  success: "#257045"
  warning: "#92400e"
  error: "#b42323"
typography:
  interface:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  document:
    fontFamily: "Georgia, Times New Roman, serif"
    fontSize: "12px"
    lineHeight: 1.45
  page-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.8rem"
    fontWeight: 600
rounded:
  control: "4px"
  dialog: "8px"
spacing:
  compact: "8px"
  regular: "16px"
  spacious: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
---

# Design System: RUF Bulletin Studio

## Overview

**Creative North Star: “The document is the work.”** The application is a quiet workspace around a printable object. On desktop, the bulletin preview owns most of the viewport; controls live alongside it rather than covering it. The interface is light, neutral, compact, and task-oriented, with blue reserved for an active choice or primary action. This describes the **revised prototype** and is not a claim that the current generator already has a web UI.

**Key characteristics:** a white two-spread document against a cool neutral canvas; plain sans-serif editing UI against serif print content; visible cover/flow distinction; local, explicit status and errors; little ornamental chrome.

## Colors

The light palette is normative for this mockup. The blue action color distinguishes primary actions, active tabs, and keyboard focus. Neutral paper, inset, canvas, border, and text tokens form the application hierarchy; the print preview remains white with dark text. Green is for saved/success, amber for caution, and red for generation or field errors. The prototype's Paper UI component sheet also defines a dark palette, but the revised editor renders in light mode; dark-mode support is not a product requirement.

**The Document-First Rule.** Keep the page visually dominant; UI accents should identify actions and state rather than compete with bulletin content.

## Typography

The interface uses system sans-serif for controls, labels, metadata, and navigation; the print surface uses Georgia with a Times fallback for songs, passages, and bulletin copy. The app's baseline is compact (13px) while Paper UI begins at 16px before local overrides. Small uppercase or muted labels may mark document roles, but form controls and error messages remain plainly legible. The mockup's 12px preview type is a screen approximation, **not** the production PDF fitting rule.

## Layout

- **Editor desktop:** 68px header with date at left and primary export at right. The preview is the flexible left region; a roughly 354px right sidebar holds navigation, save state, section/setup tabs, and an independently scrolling block editor. The two landscape spreads stack vertically, outside before inside, with an 840×594px screen representation and a subtle fold line.
- **Library screens:** the song store is a restrained two-column catalog/editor with search on the left; assets use a single-column upload form followed by a thumbnail list. Management content is centered at a maximum width near 1120px.
- **Mobile (≤760px in the prototype):** Preview/Edit switches between two full-width views. The preview can scroll horizontally within its document area; editor actions and fields get larger touch targets. The song library stacks catalog over editor.
- The precise A4 dimensions, column fitting, and print pagination belong to the PDF renderer; screen preview measurements must not become the persisted bulletin schema.

## Elevation & Depth

Flat bordered UI surfaces carry most of the structure. The document alone has a soft two-layer shadow to read as paper on a canvas. Dialogs rise above a dark translucent scrim; error panels are distinguished by a warm tint and border rather than a decorative shadow.

**The Paper Rule.** Reserve elevation for the printable sheet and active dialogs; separate routine controls with spacing, tone, and fine borders.

## Shapes

Controls and selected rows have lightly rounded corners (4px). Dialogs are slightly softer (8px). Section rows are rectangular and compact, with a border/inset treatment when expanded. The PDF preview has square sheet edges and no app-style cards inside it.

## Components

- **Primary/secondary buttons:** the primary button uses blue fill and white text; secondary controls use white fill with a fine neutral border. Quiet controls sit without a visible border. Disabled state reduces emphasis; focus is a visible blue outline offset from the control.
- **Section row + expanded editor:** collapsed rows show a descriptive title, block placement/type, and disclosure icon. The open row gains an inset background; its fields include placement, movement, removal, and type-specific editing. The paper preview itself remains read-only.
- **Form fields:** visible labels above lightly bordered inputs and textareas; grouped announcement/contact/QR items have their own headings and move/remove controls. Errors are located near affected fields and in a generation summary with a “Locate block” action.
- **Document preview:** two scrollable outside/inside sheets. Song lyrics and scripture use the serif print voice. The on-screen mockup is illustrative; exact visual parity with generated PDFs must be verified against the real generator.
- **Library views:** search and selection before detail editing; image uploads show thumbnails and kind/name metadata. Reuse the same Paper UI tokens and field/button idioms rather than a new visual system for each route.
- **Dialogs:** confirm destructive removal and explain export/conflict outcomes in direct language, preserving unfinished work where possible.

## Do's and Don'ts

### Do:
- **Do** keep preview, edit controls, and save/generation status separately identifiable.
- **Do** use the exact selected visual hierarchy as a starting point when building the real web application; see [docs/design/EDITOR.md](docs/design/EDITOR.md) and [reference captures](docs/design/README.md).
- **Do** surface broken references, overflow, and stale revisions with specific messages and a way back to the affected content.

### Don't:
- **Don't** turn the screen mockup's localStorage, HTML measurement, browser print, or fixture content into backend or PDF authority.
- **Don't** lock branding or other blocks to the cover: the physical panel is fixed, its contents are not.
- **Don't** introduce promotional banners, sidebar slogans, app footers, or click-to-edit behavior on the preview; the selected concept keeps editing in the sidebar.
