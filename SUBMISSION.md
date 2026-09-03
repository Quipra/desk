# Devpost submission draft

Deadline: September 3, 2026, 1:00 PM PT. Nothing can be edited after.

## Project name

Desk

## Tagline

One desk shared by a person and an agent. Paper, pens, ruler, compass, stencils. Nothing else.

## Description (paste into Devpost)

**The problem.** Agents are bad at drawing, and it's our fault: we make them write code for it. Ask ChatGPT for a diagram and it emits SVG or matplotlib, a wall of coordinates it can't see and you can't touch. For anyone learning geometry that's backwards. Geometry has been taught for two thousand years with a ruler and a compass on a sheet of paper, with a teacher drawing next to you.

**What Desk is.** A single sheet of paper on a desk, with a tray of instruments: pencil, marker, brush, eraser, ruler, compass, stencils, and a pen for labels. A person draws with them by hand. Through WebMCP, an agent picks up the same instruments. When ChatGPT constructs a perpendicular bisector, it sets the compass twice and lays the ruler once, and each mark reveals on the paper in front of you with a glow, the way a hand would draw it. You can mark up its work, and it can look at yours.

**Why WebMCP is the right fit.** The instruments only make sense *on the page*. They need the canvas, the person's marks, and the person's eyes. A remote MCP server would have none of that. WebMCP puts the tools where the paper is: twelve `document.modelContext.registerTool` calls, all writing to the same scene the person's pointer writes to. The agent uses the site's own drawing model, not a screenshot-and-click loop.

**How it improves the experience.** Before: "explain the Pythagorean theorem" gets a paragraph, or a picture you can't edit. After: the agent draws the right triangle on your paper, labels the sides, draws the squares, and when you scribble "why?" next to one, it looks at your mark and answers there. Every sheet replays as an animation of how it was drawn, so a construction is also a lesson.

**What people and agents can do together now.** Draw on the same sheet, in turns. The person sketches a rough shape and asks for it to be corrected or continued. The agent draws a construction and the person marks the step they didn't follow. Both hands, one paper.

**Implementation.** Vite, TypeScript, one HTML canvas, no framework. `src/scene.ts` holds the shared scene: every mark has an id, a label, an author (human or agent), and a pen. `src/instruments.ts` turns pointer gestures into marks. `src/webmcp.ts` registers the twelve instruments, each a thin tool over the same scene. Because WebMCP tool results are text, `look` is how the agent sees: an inventory of marks with bounding boxes plus a 48 × 32 character raster of where ink is. `measure` returns distances and angles so the agent can check a construction. Strokes are filled ribbons so pressure changes width smoothly; sparse agent points pass through a Catmull-Rom curve so they bend like a pen moved. Agent marks queue and reveal in order with a glow. `src/paper.ts` does rendering, reveal, and replay.

**What's different from existing WebMCP demos.** Excalidraw and Graphite demos let an agent add shapes and paths. Desk gives the agent a pen with pressure, a ruler, and a compass; draws live; lets a person draw on the same sheet; and lets the agent look at what the person drew. It's a desk, not a shape API.

**Honest limits.** The agent's freehand is only as good as the points it chooses, so Desk leans on instruments for precision and freehand for gesture. Tool results can't carry images yet, so `look` is text. No accounts, no saving; the sheet lives in the tab.

## Testing instructions (Devpost "how to test")

1. Open the live URL in ChatGPT's desktop browser, or in Chrome 149+ with `chrome://flags/#enable-webmcp-testing` on.
2. The status chip top-right should read "agent: ready". In ChatGPT, open Site tools in the address bar to see the twelve instruments.
3. Ask: "Draw triangle ABC and its incircle, label the vertices." Watch the marks reveal on the paper.
4. Draw something yourself with the pencil, then ask: "Look at my sketch and tell me what I drew."
5. Press replay to watch the sheet redraw in order.

Without WebMCP: open the browser console and run `desk.call("compass", { center: {x: 600, y: 400}, radius: 150, label: "test" })`.

## Video script (under 3 minutes)

0:00 Paper on screen, empty. "This is Desk. One sheet of paper, one tray of instruments, and two hands: mine, and an agent's."
0:15 Type in ChatGPT: "Construct the perpendicular bisector of a 400-unit segment with a compass." Marks reveal live with glow. "It's not writing SVG. It set the compass twice and used the ruler once. Same tools I'd use."
0:50 Draw a rough triangle by hand. Ask: "Look at my triangle. Label the longest side and draw its altitude." Agent calls look, then draws. "It saw my marks and drew on top of them."
1:30 Ask: "Now explain why the altitude is perpendicular, on the paper." Agent writes labels, draws the right-angle mark.
2:00 Press replay. "Every sheet is also a lesson: replay shows how it was drawn."
2:20 Show Site tools list and the code briefly: twelve tools, one scene. "WebMCP put the tools where the paper is."
2:45 "Desk. Built for the WebMCP Challenge." End.

## Checklist

- [ ] Live URL works in ChatGPT desktop browser
- [ ] Live URL works in Chrome 149+ with flag
- [x] Public repo with MIT license visible in About: https://github.com/Quipra/desk
- [ ] YouTube video < 3 min, public, audio, no copyrighted music
- [ ] Devpost form: description, testing instructions, repo, live URL, video
