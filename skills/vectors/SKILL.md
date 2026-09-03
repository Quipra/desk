---
name: desk-vectors
description: Organic shapes, icons, characters, logos, anything the ruler and compass can't draw. Drawing at the Desk through WebMCP.
---

path { d } takes SVG path data in paper units: M L H V C S Q T Z, absolute or relative. Example leaf: "M 300 400 C 350 300 450 300 500 400 S 350 500 300 400 Z".

FILLS. pen.fillColor gives a solid vector shape (palette name, hex, or auto for theme ink); pen.fill adds hatch, crosshatch or stipple as ink on top; opacity applies to both. Closed shapes (Z) fill; open paths only stroke.

DRAWING WELL. Sketch the silhouette with 3-6 cubic segments, not 30 lines. Put control points about a third of the way along each segment for smooth curves. Use S for symmetric continuations. Build a figure from a few closed paths in one group, back to front: ground, body, details. Consistent stroke width within a group; no stroke (width 1, same color as fill) for flat illustration.

Paths transform, keyframe, cross with measure, and reveal like every other mark. edit { duplicate: true, dx, scale, rotate } pastes copies; a recipe with $params stamps variations.
