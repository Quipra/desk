---
name: desk-drawing
description: Draw on a Desk sheet with instruments through WebMCP. Use when an agent needs to explain or illustrate something on a shared paper, especially geometry.
---

# Drawing at the Desk

Desk is one sheet of paper shared by a person and an agent. You draw with instruments, never with SVG or fonts. The full in-app guide is what the `guide` tool returns and what the first `look` of a session includes; the source is `src/guide.ts`.

## Loop

1. `look` once. It carries the guide the first time and, later, what the person drew since your last look.
2. Plan positions on the 1200 x 800 sheet (origin top-left, y down, degrees clockwise from the right). Use `measure` for exact crossings and midpoints instead of estimating.
3. One `construct` call with all steps and `verify: true`. Any step may carry an inline `pen` and a `group`.
4. Read the returned sheet. Fix with `edit` (restyle, move, scale, rotate, duplicate), `erase`, or `undo` only if something is wrong.

## Make your own tools

- `make` kind `brush`: design a pen once (kind, color, width, opacity, dash, texture grain or chalk, taper, fill hatch, crosshatch or stipple) and use it as `pen: { brush: name }`.
- `make` kind `recipe`: a named list of construct steps with `$params` and expressions like `($A.x+$B.x)/2`. Use it as a construct step `{ tool: "recipe", name, args }`. Build one for anything you will draw more than once.
- Paste is `edit` with `duplicate: true` plus `dx`, `dy`, `scale`, or `rotate`.

## Rules of thumb

- Dashed pencil for construction lines, fineliner or marker in ink for the figure, one accent color for the thing being explained.
- Label every mark meaningfully so it can be referred to later. Group related marks.
- Letters are drawn by hand with `draw` and `strokes`: one call per label, cap height 28, keep labels to a few characters.
- Never call `new_sheet` on someone's work without asking.
- Read tool errors and fix inputs; do not retry identically.
