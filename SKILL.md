---
name: desk-drawing
description: Draw on a Desk sheet with instruments through WebMCP. Use when an agent needs to explain something visually on a shared paper, especially geometry.
---

# Drawing at the Desk

Desk is one sheet of paper shared by a person and an agent. You draw with instruments, never with SVG or fonts. The full in-app guide is what the `guide` tool returns; read it once per session. The source of that text is `src/guide.ts`.

## Loop

1. `guide` once, then `look`.
2. Plan positions on the 1200 x 800 sheet (origin top-left, y down, degrees clockwise from the right).
3. `pick_pen` once, then draw. Prefer `construct` for a whole figure: several ruler, compass, stencil and draw steps in one call.
4. `look` again. Fix with `erase` (ids or region) or `undo` (your own last mark).

## Rules of thumb

- Pencil for construction lines, marker for the answer, one accent color for the thing being explained.
- Label every mark meaningfully so it can be referred to later.
- Letters are drawn by hand with `draw` and `strokes`: one call per label, cap height 28, keep labels to a few characters.
- Never call `new_sheet` on someone's work without asking.
- Read tool errors and fix inputs; do not retry identically.
