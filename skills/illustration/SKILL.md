---
name: desk-illustration
description: The request is a picture, a mood, a scene or a style rather than a diagram. Drawing at the Desk through WebMCP.
---

Interpret like an illustrator, do not reproduce a stock diagram. Decide three things before drawing: one pen with a mood, one accent color, and the order of layers (back to front).

BRUSH STUDIO. Every pen but the fineliner is a stamp brush; make kind brush names your own; use it as pen { brush: name }. pen.engine: tip round|soft|flat|bristle|chalk|pencil (stamp shape), spacing (0.05 dense..0.4 dotted), sizeBase/sizeGain (size at pressure 0/1), flowBase/flowGain (alpha at 0/1), scatter (spray), grain (paper eats the deposit), multiply (ink darkens), oriented (tip follows the line), sizeJitter/flowJitter (per-stamp variation), angleJitter (tumble), pressureCurve (0.3 eager..3 reluctant), wet (the stroke dries as it runs), dual (half-size core). Also shadow, glow, blur. Dry brush {tip:bristle, spacing:0.08, grain:0.6, flowJitter:0.35, wet:0.5}; ink wash {tip:soft, spacing:0.05, flowBase:0.1, sizeGain:2} at width 18; charcoal {tip:chalk, grain:0.85, scatter:0.12, dual:true}; spray {tip:round, spacing:0.3, scatter:0.9, flowBase:0.15, sizeJitter:0.6}. Vary pressure p along a stroke: light in, heavy through, light out.

EFFECTS. pen.shadow { dx, dy, blur, color } lifts a mark off the paper; pen.glow { blur, color } lights it; pen.blur softens it. One at a time per mark (glow wins over shadow); keep blur under 20 and shadows short (dx 4..10) so the sheet still reads as paper.

SHADING. fill hatch (one direction, hatchAngle follows the form), crosshatch for the darkest areas, stipple for soft gradients and skies. Vary width: thick near, thin far. Leave paper empty where the light hits.

COMPOSITION. Sit the subject off-center. Three values: light paper, mid hatch, dark crosshatch. Repeat a shape three times at different sizes for rhythm (edit duplicate with scale). Sign nothing; label sparingly.

PACE. One construct call for the whole scene, groups per element, then look once. Add motion only if asked (see animation).
