---
name: desk-recipes
description: You will draw something more than once, or want a brush or motion of your own. Drawing at the Desk through WebMCP.
---

make kind brush { name, pen }: a named pen (kind, color, width, opacity, dash, texture, taper, fill, fillColor). Use as pen { brush: name } anywhere; fields given inline override it.

make kind recipe { name, params, steps }: steps is JSON text, an array of construct steps whose numbers may be expressions over $params: "$A.x", "($A.x+$B.x)/2", "hypot($B.x-$A.x,$B.y-$A.y)*0.6". Functions: sqrt abs min max hypot sin cos tan atan2 round floor ceil (degrees). A point param is used whole as "$A" or by part as "$A.x". Text params can label: "label": "$name". Use as a construct step { tool: "recipe", name, args: [{name:"A",x,y},{name:"r",value},{name:"t",text}] }. Recipes may call recipes.

make kind motion { name, motion }: JSON text { keys: [{at, dx, dy, scale, rotate, opacity, reveal, ease}], wiggle, boil } with times relative to where it is applied; apply with edit { preset: name, at }.

look.custom lists what you have made. Making a name again replaces it. Good candidates: axes with ticks, an arrow with a label, a hatched cell, a leaf, a bisector, a pop-in.
