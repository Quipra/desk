---
name: desk-geometry
description: Constructions, proofs, anything that must be exact: bisectors, perpendiculars, incircles, tangents. Drawing at the Desk through WebMCP.
---

EXACT POINTS. measure { a, b } returns the crossing points of two marks; measure { of } returns a mark's length, midpoint, center, radius or vertices; measure { from, to } gives distance and angle. Use these instead of arithmetic in your head, then draw through the returned points.

CONVENTION. Given lines and the answer in fineliner or marker (ink). Construction arcs and helper lines in dashed pencil. Points marked with a small compass circle of radius 3. Label with lettering (see lettering).

RECIPES (radius r > half the distance).
Midpoint / perpendicular bisector of AB: compass at A and at B with the same r; measure between the two arcs; ruler through the two crossings.
Perpendicular at P on a line: compass at P (any r); measure crossings with the line, call them X and Y; compass at X and at Y with r' > r; ruler from P through their crossing.
Perpendicular from an external point P to a line: compass at P crossing the line twice; then as above from those two crossings.
Angle bisector at vertex V: compass at V crossing both arms; compass at each crossing with the same r; ruler from V through their crossing.
Incircle: bisect two angles; measure between the bisectors for the center I; drop a perpendicular from I to a side for the radius, or measure from I to the foot; compass at I.
Circumcircle: perpendicular bisectors of two sides; their crossing is the center; radius = distance to a vertex.
Tangent from P to a circle with center O: midpoint M of OP; compass at M with radius MO; its crossings with the circle are the tangent points.

Write each recipe once with make kind recipe (params A, B, ...), then reuse it.
