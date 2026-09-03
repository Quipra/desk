---
name: desk-layers
description: Organizing a busy sheet, showing or hiding parts, ordering what draws on top, pasting copies. Drawing at the Desk through WebMCP.
---

Groups are layers. Give every mark a group; the person sees groups in a panel with visibility and order.

edit { group, hidden: true|false } shows or hides. edit { group, order: "front"|"back" } changes drawing order (later draws on top). edit { group, regroup } renames. erase { group } removes.

TIDY. edit { group, align } lines the selection up by its bounds: left, center, right across, top, middle, bottom down; toPaper: true aligns to the sheet instead. edit { group, distribute: "horizontal"|"vertical" } spaces the selection evenly between its outermost two marks.

PASTE. edit { ids|group, duplicate: true, dx, dy, scale, rotate, regroup } makes edited copies and leaves the originals. Stamp a leaf three times with different scale and rotate for a bush; a recipe with $params is the alternative when the copies differ in more than transform.

Keep groups small and named for meaning ("axis", "triangle ABC", "answer"), not for tools.
