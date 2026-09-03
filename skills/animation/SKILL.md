---
name: desk-animation
description: Anything should move, appear over time, wiggle, or be shown frame by frame. Drawing at the Desk through WebMCP.
---

The sheet has a clock: timeline { duration, fps, loop, onion }. A keyframe is an edit at a time: edit { group, at, dx, dy, scale, rotate, opacity, reveal, ease }.

RULES. Like After Effects, each property holds its first key before it and its last key after it, so start every animated mark with a key at 0 that sets each property you will animate (rest is dx 0, dy 0, scale 1, rotate 0, opacity 1, reveal 1). A single key is a constant. Keys are relative to where the mark was drawn.

CURVES. ease into a key: linear, ease, easeIn, easeOut, easeInOut, bounce, or bezier [x1,y1,x2,y2]. Overshoot then settle for life: scale 0 -> 1.1 (easeOut) -> 1.

PRESETS. edit { preset, at, stagger }: rise, drop, pop, fade, wipe (write-on), typewriter, breathe, spin, shake, drift (wiggle), sketchy (line boil), fadeOut, sink. stagger cascades a group. Make your own with make kind motion { keys, wiggle, boil } and apply it the same way.

HAND-DRAWN LIFE. wiggle { amp, freq } for float; boil for a shimmering edge; reveal keys for a construction appearing step by step.

PLAYBACK. Adding keys plays once; timeline play/pause/seek control it; look { at } shows the pose at a time. Keep loops under a few seconds; stagger groups by a few frames; at 12 fps a frame is 1/12 s, so frame-by-frame means a key per frame or a duplicate per frame.
