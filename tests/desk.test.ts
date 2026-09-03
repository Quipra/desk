import assert from "node:assert/strict";
import test from "node:test";

import { Paper, pathProgress, smooth } from "../src/paper.ts";
import { bbox, PEN_PRESETS, Scene } from "../src/scene.ts";
import { registerDesk } from "../src/webmcp.ts";
import { describe } from "../src/look.ts";
import { inkColor, THEMES } from "../src/appearance.ts";
import { pencilStudy, runPencilStudy, STUDY_SENTENCE } from "../src/pencil-study.ts";
import { Instruments } from "../src/instruments.ts";

test("animation waiters settle after erase, undo, clear, and replay", async (t) => {
  for (const mutation of ["erase", "undo", "clear"] as const) {
    await t.test(mutation, async () => {
      const { scene, paper, runNextFrame } = paperHarness();
      const item = scene.add(
        { kind: "line", from: { x: 0, y: 0 }, to: { x: 1200, y: 800 }, arrow: false },
        { label: "long line", author: "agent", pen: PEN_PRESETS.pencil },
      );
      runNextFrame(0);
      const idle = paper.whenIdle();

      if (mutation === "erase") scene.remove([item.id]);
      if (mutation === "undo") scene.undo("agent");
      if (mutation === "clear") scene.clear("blank");

      await resolvesSoon(idle);
      assert.equal(paper.busy, false);
    });
  }

  await t.test("replay", async () => {
    const { scene, paper, flushFrames } = paperHarness();
    scene.add(
      { kind: "line", from: { x: 100, y: 100 }, to: { x: 600, y: 100 }, arrow: false },
      { label: "human line", author: "human", pen: PEN_PRESETS.pencil },
    );
    paper.replay();
    const idle = paper.whenIdle();
    flushFrames();
    await resolvesSoon(idle);
    assert.equal(paper.busy, false);
  });
});

test("registration attempts all fifteen tools and names each failure", async () => {
  const attempted: string[] = [];
  installDocument({
    registerTool(tool: { name: string }) {
      attempted.push(tool.name);
      if (tool.name === "compass") throw new Error("schema rejected");
    },
  });

  const desk = await registerDesk(new Scene(), idlePaper(), { onActivity() {} });

  assert.equal(attempted.length, 15);
  assert.equal(attempted.includes("write"), false);
  assert.equal(desk.registered.length, 14);
  assert.deepEqual(attempted, desk.names);
  assert.equal(desk.connected, false);
  assert.deepEqual(desk.registrationErrors, ["compass: schema rejected"]);
});

test("registration classifies three read tools and twelve state-changing tools", async () => {
  const registered: { name: string; annotations?: { readOnlyHint?: boolean } }[] = [];
  installDocument({ registerTool(tool) { registered.push(tool); } });
  const desk = await registerDesk(new Scene(), idlePaper(), { onActivity() {} });

  assert.equal(desk.connected, true);
  assert.deepEqual(registered.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name), ["guide", "look", "measure"]);
  assert.deepEqual(registered.filter((tool) => tool.annotations?.readOnlyHint === false).map((tool) => tool.name), [
    "pick_pen", "draw", "ruler", "compass", "stencil", "path", "edit", "erase", "undo", "timeline", "make", "construct",
  ]);
  assert.equal(registered.filter((tool) => typeof tool.annotations?.readOnlyHint !== "boolean").length, 0);
  desk.dispose();
});

// Chat hosts convert tool schemas to strict function schemas; keywords outside
// this subset make the whole tool unusable there.
test("tool schemas use only the host-safe JSON Schema subset", async () => {
  const registered: { name: string; inputSchema: unknown }[] = [];
  installDocument({ registerTool(tool) { registered.push(tool); } });
  await registerDesk(new Scene(), idlePaper(), { onActivity() {} });
  const allowed = new Set(["type", "properties", "required", "enum", "items", "description", "additionalProperties"]);
  const walk = (node: unknown, where: string) => {
    if (Array.isArray(node)) return;
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (where.endsWith(".properties")) {
        walk(value, `${where}.${key}`);
        continue;
      }
      assert.ok(allowed.has(key), `${where}.${key} is not in the safe schema subset`);
      walk(value, `${where}.${key}`);
    }
  };
  assert.equal(registered.length, 15);
  for (const tool of registered) walk(tool.inputSchema, tool.name);
});

test("measure returns exact crossings and mark properties", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  const ab = await desk.call("ruler", { from: { x: 300, y: 400 }, to: { x: 700, y: 400 }, label: "AB" }) as { id: string };
  const arcA = await desk.call("compass", { center: { x: 300, y: 400 }, radius: 300, label: "from A" }) as { id: string };
  const arcB = await desk.call("compass", { center: { x: 700, y: 400 }, radius: 300, label: "from B" }) as { id: string };
  const cross = await desk.call("measure", { a: arcA.id, b: arcB.id }) as { crossings: { x: number; y: number }[] };
  assert.equal(cross.crossings.length, 2);
  for (const p of cross.crossings) {
    assert.equal(p.x, 500);
    assert.ok(Math.abs(Math.abs(p.y - 400) - 223.6) < 0.2, `unexpected y ${p.y}`);
  }
  const onLine = await desk.call("measure", { a: ab.id, b: arcA.id }) as { crossings: { x: number; y: number }[] };
  assert.deepEqual(onLine.crossings, [{ x: 600, y: 400 }]);
  const props = await desk.call("measure", { of: ab.id }) as { length: number; midpoint: { x: number; y: number } };
  assert.equal(props.length, 400);
  assert.deepEqual(props.midpoint, { x: 500, y: 400 });
  const quarter = await desk.call("compass", { center: { x: 300, y: 400 }, radius: 100, start: 0, end: 90, label: "quarter" }) as { id: string };
  const vertical = await desk.call("ruler", { from: { x: 300, y: 200 }, to: { x: 300, y: 600 }, label: "v" }) as { id: string };
  const q = await desk.call("measure", { a: quarter.id, b: vertical.id }) as { crossings: { x: number; y: number }[] };
  assert.deepEqual(q.crossings, [{ x: 300, y: 500 }], "the arc only crosses below the center");
  assert.ok("error" in (await desk.call("measure", { a: "nope", b: ab.id }) as object));
});

test("edit restyles, moves, duplicates and regroups without redrawing", async () => {
  installDocument({ registerTool() {} });
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: () => true } });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  await desk.call("construct", { steps: [
    { tool: "ruler", from: { x: 300, y: 300 }, to: { x: 500, y: 300 }, label: "top", group: "box" },
    { tool: "ruler", from: { x: 300, y: 300 }, to: { x: 300, y: 500 }, label: "left", group: "box", pen: { kind: "fineliner", color: "blue", dash: true } },
  ] });
  assert.equal(scene.items[1].pen.kind, "fineliner");
  assert.equal(scene.items[1].pen.color, "#3b82f6");
  assert.equal(scene.items[1].pen.dash, true);
  const moved = await desk.call("edit", { group: "box", dx: 100, dy: 50, pen: { color: "accent" } }) as { edited: string[] };
  assert.equal(moved.edited.length, 2);
  const top = scene.items[0];
  if (top.kind !== "line") throw new Error("expected line");
  assert.deepEqual([top.from, top.to].map((p) => ({ x: p.x, y: p.y })), [{ x: 400, y: 350 }, { x: 600, y: 350 }]);
  assert.equal(top.pen.color, "#e5484d");
  const dup = await desk.call("edit", { ids: [top.id], duplicate: true, dy: 200, regroup: "copy" }) as { edited: string[] };
  assert.equal(scene.items.length, 3);
  assert.equal(scene.items[2].group, "copy");
  assert.equal(scene.items[2].id, dup.edited[0]);
  assert.equal(top.group, "box", "original keeps its group");
  const scaled = await desk.call("edit", { ids: [top.id], scale: 2, about: { x: 400, y: 350 } }) as { marks: { bbox: { w: number } }[] };
  assert.equal(scaled.marks[0].bbox.w, 400 + 2 * 2.5);
  assert.ok("error" in (await desk.call("edit", { ids: [top.id] }) as object));
  assert.equal((await desk.call("erase", { group: "copy" }) as { removed: string[] }).removed.length, 1);
});

test("make creates brushes and recipes the agent can reuse", async () => {
  installDocument({ registerTool() {} });
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: () => true } });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  const brush = await desk.call("make", { kind: "brush", name: "inkwash", description: "soft wash", pen: { kind: "brush", width: 14, opacity: 0.35, texture: "chalk", taper: true, color: "blue" } }) as { pen: { texture: string; brush: string } };
  assert.equal(brush.pen.texture, "chalk");
  assert.equal(brush.pen.brush, "inkwash");
  await desk.call("draw", { points: [{ x: 100, y: 100 }, { x: 300, y: 120 }], label: "wash", pen: { brush: "inkwash", opacity: 0.5 } });
  assert.equal(scene.items[0].pen.brush, "inkwash");
  assert.equal(scene.items[0].pen.opacity, 0.5);
  assert.equal(scene.items[0].pen.taper, true);
  assert.equal(scene.items[0].pen.color, "#3b82f6");
  assert.ok("error" in (await desk.call("draw", { points: [{ x: 1, y: 1 }], label: "x", pen: { brush: "nope" } }) as object));

  const steps = JSON.stringify([
    { tool: "compass", center: "$A", radius: "hypot($B.x-$A.x,$B.y-$A.y)*0.6", label: "arc A", pen: { kind: "pencil", dash: true } },
    { tool: "compass", center: "$B", radius: "hypot($B.x-$A.x,$B.y-$A.y)*0.6", label: "arc B", pen: { kind: "pencil", dash: true } },
    { tool: "ruler", from: { x: "($A.x+$B.x)/2", y: "($A.y+$B.y)/2 - 150" }, to: { x: "($A.x+$B.x)/2", y: "($A.y+$B.y)/2 + 150" }, label: "$name" },
  ]);
  const made = await desk.call("make", { kind: "recipe", name: "bisector", params: ["A", "B", "name"], steps }) as { made: string; params: string[] };
  assert.equal(made.made, "recipe");
  const run = await desk.call("construct", { steps: [{ tool: "recipe", name: "bisector", args: [{ name: "A", x: 300, y: 400 }, { name: "B", x: 700, y: 400 }, { name: "name", text: "bisector of AB" }] }] }) as { done: number; results: { results: { tool: string; radius?: number }[] }[] };
  assert.equal(run.done, 1);
  assert.equal(run.results[0].results.length, 3);
  assert.equal(run.results[0].results[0].radius, 240);
  const line = scene.items.at(-1);
  if (line?.kind !== "line") throw new Error("expected line");
  assert.deepEqual([line.from.x, line.from.y, line.to.y], [500, 250, 550]);
  assert.equal(line.label, "bisector of AB");
  assert.equal(scene.items.at(-2)?.pen.dash, true);
  const missing = await desk.call("construct", { steps: [{ tool: "recipe", name: "bisector", args: [{ name: "A", x: 1, y: 1 }] }] }) as { error: string };
  assert.match(missing.error, /needs \$B, \$name/);
  const bad = await desk.call("make", { kind: "recipe", name: "broken", steps: "[{\"tool\":\"fly\"}]" }) as { error: string };
  assert.match(bad.error, /tool must be one of/);
  const look = await desk.call("look") as { custom: { brushes: { name: string }[]; recipes: { name: string; params: string[] }[] } };
  assert.deepEqual(look.custom.brushes.map((b) => b.name), ["inkwash"]);
  assert.deepEqual(look.custom.recipes[0].params, ["A", "B", "name"]);
});

test("recipe expressions evaluate safely", async () => {
  const { evaluate, substitute } = await import("../src/recipes.ts");
  const params = { A: { x: 100, y: 200 }, r: 50, t: "hi" };
  assert.equal(evaluate("($A.x + 300) / 2", params), 200);
  assert.equal(evaluate("hypot(3, 4) * $r", params), 250);
  assert.equal(evaluate("cos(60) * 2", params).toFixed(3), "1.000");
  assert.equal(evaluate("2 ^ 3 ^ 2", params), 512);
  assert.equal(evaluate("-$r + 10", params), -40);
  assert.throws(() => evaluate("$A + 1", params), /\$A\.x or \$A\.y/);
  assert.throws(() => evaluate("$t * 2", params), /text/);
  assert.throws(() => evaluate("window.alert(1)", params), /unknown function|unexpected|cannot read/);
  assert.throws(() => evaluate("1 / 0", params), /finite/);
  assert.deepEqual(substitute({ center: "$A", radius: "$r*2", label: "plain text", pen: { dash: true } }, params), { center: { x: 100, y: 200 }, radius: 100, label: "plain text", pen: { dash: true } });
});

test("keyframes are edits at a time, with easing, wiggle, presets and a timeline", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  const ball = await desk.call("compass", { center: { x: 200, y: 400 }, radius: 40, label: "ball", group: "ball" }) as { id: string };
  await desk.call("edit", { group: "ball", at: 0, dx: 0 });
  const k1 = await desk.call("edit", { group: "ball", at: 1, dx: 400, ease: "easeOut" }) as { animated: string[]; timeline: { duration: number; keyTimes: number[] } };
  assert.deepEqual(k1.animated, [ball.id]);
  assert.deepEqual(k1.timeline.keyTimes, [0, 1]);
  await desk.call("edit", { ids: [ball.id], at: 2, dx: 400, dy: -150, rotate: 90, opacity: 0.5, bezier: [0.4, 0, 0.2, 1] });
  await desk.call("edit", { ids: [ball.id], at: 6, dx: 0, ease: "bounce" });
  assert.equal(scene.timeline.duration, 6, "the timeline grows to hold the last key");
  const { poseAt } = await import("../src/motion.ts");
  const item = scene.get(ball.id)!;
  assert.equal(poseAt(item, 0).transform.dx, undefined, "the key at 0 is the rest pose for x");
  assert.equal(poseAt(item, 0).transform.dy, -150, "a channel holds its own first key, so dy is already -150 at 0");
  const mid = poseAt(item, 0.5);
  assert.ok(mid.transform.dx! > 200 && mid.transform.dx! < 400, `easeOut is ahead of linear at the midpoint: ${mid.transform.dx}`);
  assert.equal(poseAt(item, 1).transform.dx, 400);
  const two = poseAt(item, 2);
  assert.equal(two.transform.dy, -150);
  assert.equal(two.transform.rotate, 90);
  assert.equal(two.opacity, 0.5);
  assert.equal(poseAt(item, 6).transform.dx, undefined, "back to rest x by the last key");
  const seen = await desk.call("look", { at: 1 }) as { at: number; items: { bbox: { x: number } }[]; timeline: { keyTimes: number[] } };
  assert.equal(seen.at, 1);
  assert.equal(seen.items[0].bbox.x, Math.round(200 + 400 - 40 - 2.5), "look at a time reports the posed bounds");
  assert.deepEqual(seen.timeline.keyTimes, [0, 1, 2, 6]);

  await desk.call("edit", { group: "ball", wiggle: { amp: 12, freq: 3 }, boil: 6 });
  assert.deepEqual(scene.get(ball.id)!.motion?.wiggle, { amp: 12, freq: 3 });
  assert.equal(scene.get(ball.id)!.motion?.boil, 6);
  const w1 = poseAt(scene.get(ball.id)!, 1.5);
  const w2 = poseAt(scene.get(ball.id)!, 1.5);
  assert.deepEqual(w1, w2, "wiggle is deterministic");
  assert.ok(Math.abs(w1.transform.dx! - 400) <= 12 && w1.transform.dx !== 400, "wiggle drifts within its amplitude");

  const made = await desk.call("make", { kind: "motion", name: "pop-in", motion: JSON.stringify({ keys: [{ at: 0, scale: 0, opacity: 0 }, { at: 0.4, scale: 1.1, ease: "easeOut" }, { at: 0.6, scale: 1 }] }) }) as { made: string; keys: number };
  assert.equal(made.keys, 3);
  const box = await desk.call("stencil", { shape: "rectangle", x: 600, y: 600, w: 100, h: 60, label: "box" }) as { id: string };
  const applied = await desk.call("edit", { ids: [box.id], preset: "pop-in", at: 2 }) as { keyframes: Record<string, number[]> };
  assert.deepEqual(applied.keyframes[box.id], [2, 2.4, 2.6]);
  assert.equal(poseAt(scene.get(box.id)!, 2).opacity, 0);
  assert.equal(poseAt(scene.get(box.id)!, 1).opacity, 0, "before its first key a mark holds that key, so pop-in stays hidden");
  assert.equal(poseAt(scene.get(box.id)!, 2.6).transform.scale, undefined, "scale 1 is rest");

  const tl = await desk.call("timeline", { action: "set", fps: 24, loop: false, duration: 8 }) as { fps: number; loop: boolean; duration: number; animated: boolean };
  assert.deepEqual([tl.fps, tl.loop, tl.duration, tl.animated], [24, false, 8, true]);
  const sought = await desk.call("timeline", { action: "seek", at: 2.5 }) as { time: number };
  assert.equal(sought.time, 2.5);
  assert.ok("error" in (await desk.call("edit", { ids: [ball.id], at: 1 }) as object), "a keyframe needs a change");
  assert.ok("error" in (await desk.call("edit", { ids: [ball.id], at: 1, dx: 5, ease: "zoom" }) as object));
  await desk.call("edit", { group: "ball", clearMotion: true });
  assert.equal(scene.get(ball.id)!.motion, undefined);
  const cleared = await desk.call("timeline", { action: "clear", paper: "blank" }) as { animated: boolean };
  assert.equal(cleared.animated, false);
  assert.equal(scene.items.length, 0);
});

test("the pen tool parses SVG path data into a vector mark that fills, crosses and transforms", async () => {
  installDocument({ registerTool() {} });
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: () => true } });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  const leaf = await desk.call("path", { d: "M 300 400 C 350 300 450 300 500 400 S 350 500 300 400 Z", label: "leaf", group: "leaf", pen: { kind: "fineliner", color: "green", fillColor: "green" } }) as { id: string; segments: number; bbox: { x: number; w: number } };
  assert.equal(leaf.segments, 4);
  const item = scene.get(leaf.id)!;
  if (item.kind !== "path") throw new Error("expected path");
  assert.deepEqual(item.segments.map((s) => s.c), ["M", "C", "C", "Z"]);
  assert.equal(item.pen.fillColor, "#22a06b");
  assert.ok(leaf.bbox.x <= 300 && leaf.bbox.x + leaf.bbox.w >= 500);
  const rel = await desk.call("path", { d: "m 100 100 l 50 0 v 50 h -50 z", label: "box" }) as { id: string };
  const props = await desk.call("measure", { of: rel.id }) as { closed: boolean; d: string; length: number };
  assert.equal(props.closed, true);
  assert.equal(props.length, 200);
  assert.equal(props.d, "M100 100 L150 100 L150 150 L100 150 Z");
  const cut = await desk.call("ruler", { from: { x: 400, y: 200 }, to: { x: 400, y: 600 }, label: "cut" }) as { id: string };
  const x = await desk.call("measure", { a: leaf.id, b: cut.id }) as { crossings: { x: number; y: number }[] };
  assert.equal(x.crossings.length, 2);
  assert.ok(x.crossings.every((p) => p.x === 400));
  await desk.call("edit", { ids: [leaf.id], dx: 100, scale: 2, about: { x: 300, y: 400 } });
  const moved = scene.get(leaf.id)!;
  if (moved.kind !== "path") throw new Error("expected path");
  assert.deepEqual(moved.segments[0], { c: "M", x: 400, y: 400 });
  assert.ok("error" in (await desk.call("path", { d: "L 1 2", label: "bad" }) as object));
  assert.ok("error" in (await desk.call("path", { d: "M 1 2 X 3", label: "bad" }) as object));
});

test("layers: hidden and order, and the motion library with stagger", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  await desk.call("construct", { steps: [
    { tool: "stencil", shape: "rectangle", x: 200, y: 200, w: 50, h: 50, label: "a", group: "row" },
    { tool: "stencil", shape: "rectangle", x: 300, y: 200, w: 50, h: 50, label: "b", group: "row" },
    { tool: "stencil", shape: "rectangle", x: 400, y: 200, w: 50, h: 50, label: "c", group: "row" },
    { tool: "compass", center: { x: 600, y: 400 }, radius: 30, label: "dot" },
  ] });
  const ids = scene.items.map((i) => i.id);
  await desk.call("edit", { group: "row", hidden: true });
  assert.equal(scene.items.filter((i) => i.hidden).length, 3);
  const look = await desk.call("look") as { items: { hidden?: boolean }[] };
  assert.equal(look.items.filter((i) => i.hidden).length, 3);
  await desk.call("edit", { group: "row", hidden: false, order: "front" });
  assert.equal(scene.items.filter((i) => i.hidden).length, 0);
  assert.deepEqual(scene.items.map((i) => i.id), [ids[3], ids[0], ids[1], ids[2]], "row moved to the front of the drawing order");
  const cascade = await desk.call("edit", { group: "row", preset: "pop", at: 1, stagger: 0.2 }) as { keyframes: Record<string, number[]> };
  assert.deepEqual(cascade.keyframes[ids[0]], [1, 1.35, 1.5]);
  assert.deepEqual(cascade.keyframes[ids[2]], [1.4, 1.75, 1.9]);
  const { poseAt, LIBRARY } = await import("../src/motion.ts");
  assert.equal(poseAt(scene.get(ids[2])!, 1.2).opacity, 0, "the third box has not started yet");
  assert.equal(poseAt(scene.get(ids[0])!, 1.5).transform.scale, undefined, "the first box has settled to scale 1");
  assert.ok(Object.keys(LIBRARY).length >= 12);
  const state = await desk.call("timeline", { action: "set" }) as { presets: string[] };
  assert.ok(state.presets.includes("typewriter"));
  await desk.call("edit", { ids: [ids[3]], preset: "sketchy" });
  assert.equal(scene.get(ids[3])!.motion?.boil, 8);
  assert.ok("error" in (await desk.call("edit", { ids: [ids[3]], preset: "explode" }) as object));
});

test("first look carries the guide once and later looks report what changed", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  const first = await desk.call("look") as { guide?: string; changes: unknown };
  assert.ok(first.guide?.includes("DESK"));
  assert.equal(first.changes, null);
  scene.add({ kind: "line", from: { x: 10, y: 10 }, to: { x: 50, y: 10 }, arrow: false }, { label: "student mark", author: "human", pen: PEN_PRESETS.pencil });
  const second = await desk.call("look") as { guide?: string; changes: { added: { author: string }[]; removed: string[] } };
  assert.equal(second.guide, undefined);
  assert.equal(second.changes.added.length, 1);
  assert.equal(second.changes.added[0].author, "human");
  const built = await desk.call("construct", { verify: true, steps: [{ tool: "ruler", from: { x: 100, y: 100 }, to: { x: 200, y: 100 }, label: "x" }] }) as { sheet: { count: number; changes: { added: unknown[] } } };
  assert.equal(built.sheet.count, 2);
  assert.equal(built.sheet.changes.added.length, 1);
});

test("construct runs steps in order with the shared pen and stops at the first bad step", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  const result = await desk.call("construct", {
    steps: [
      { tool: "pick_pen", kind: "marker", width: 5 },
      { tool: "ruler", from: { x: 300, y: 500 }, to: { x: 700, y: 500 }, label: "segment AB" },
      { tool: "compass", center: { x: 300, y: 500 }, radius: 260, label: "arc from A" },
      { tool: "ruler", from: { x: -5, y: 0 }, to: { x: 1, y: 1 }, label: "off paper" },
      { tool: "undo" },
    ],
  }) as { done: number; results: unknown[]; error?: string };
  assert.equal(result.done, 3);
  assert.equal(result.results.length, 3);
  assert.match(result.error ?? "", /^step 3 \(ruler\): from\.x/);
  assert.equal(scene.items.length, 2);
  assert.equal(scene.items[0].pen.width, 5);
  assert.deepEqual(await desk.call("construct", { steps: [{ tool: "guide" }] }), { done: 0, results: [], error: "step 0: tool must be one of pick_pen, draw, ruler, compass, stencil, path, edit, erase, undo, timeline, recipe" });
  const guide = await desk.call("guide") as { core: string; index: string; tools: string[] };
  assert.ok(guide.core.includes("1200 wide x 800 tall"));
  assert.ok(guide.index.includes("- geometry:"));
  assert.equal(guide.tools.length, 15);
  const topic = await desk.call("guide", { topic: "animation" }) as { topic: string; skill: string };
  assert.equal(topic.topic, "animation");
  assert.ok(topic.skill.includes("keyframe"));
  assert.ok("error" in (await desk.call("guide", { topic: "cooking" }) as object));
});

test("grouped strokes preserve pen lifts and undo as one mark", async () => {
  const { scene, paper, flushFrames } = paperHarness();
  installDocument({ registerTool() {} });
  const desk = await registerDesk(scene, paper, { onActivity() {} });
  const strokes = [[{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 400, y: 100 }, { x: 500, y: 100 }]];
  const result = await desk.call("draw", { strokes, label: "two strokes" }) as { strokes: number };
  assert.equal(result.strokes, 2);
  assert.equal(scene.items.length, 1);
  const item = scene.items[0];
  assert.equal(item.kind, "stroke");
  if (item.kind !== "stroke") throw new Error("expected stroke");
  assert.deepEqual(item.paths.map((path) => path.map(({ x, y }) => ({ x, y }))), strokes);
  assert.deepEqual(pathProgress(item.paths, 0.5).map((p) => p.progress), [1, 0]);
  assert.equal(describe(scene).raster.rows[4][12], ".", "pen lift must not paint the gap");
  flushFrames();
  await desk.call("undo");
  assert.equal(scene.items.length, 0);
});

test("invalid grouped input is atomic and prototype pen names are rejected", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  for (const input of [
    { points: [{ x: 1, y: 1 }], strokes: [[{ x: 1, y: 1 }]], label: "both" },
    { strokes: [[{ x: 1, y: 1 }], [{ x: -1, y: 1 }]], label: "bad second path" },
    { strokes: Array.from({ length: 65 }, () => [{ x: 1, y: 1 }]), label: "too many paths" },
    { points: Array.from({ length: 2001 }, () => ({ x: 1, y: 1 })), label: "too many points" },
  ]) {
    assert.ok("error" in (await desk.call("draw", input) as object));
    assert.equal(scene.items.length, 0);
  }
  assert.ok("error" in (await desk.call("pick_pen", { kind: "toString" }) as object));
});

test("look detail is bounded, paginated and can inspect without waiting for ink", async () => {
  const { scene, paper } = paperHarness();
  installDocument({ registerTool() {} });
  const desk = await registerDesk(scene, paper, { onActivity() {} });
  for (let n = 0; n < 3; n++) await desk.call("draw", { label: `mark ${n}`, points: Array.from({ length: 100 }, (_, i) => ({ x: 100 + i, y: 100 + n * 100 })) });
  const result = await desk.call("look", { detail: true, wait: false, limit: 1 }) as ReturnType<typeof describe> & { drawing: boolean; appearance: { theme: string } };
  assert.equal(result.drawing, true);
  assert.equal(result.appearance.theme, "charcoal");
  assert.equal(result.count, 3);
  assert.equal(result.items.length, 1);
  assert.equal(result.nextOffset, 1);
  const geometry = result.items[0].geometry;
  assert.equal(geometry?.kind, "stroke");
  if (geometry?.kind !== "stroke") throw new Error("expected stroke geometry");
  assert.equal(geometry.paths[0].length, 32);
  assert.equal(geometry.sampled, true);
  const region = await desk.call("look", { wait: false, region: { x: 80, y: 180, w: 150, h: 40 } }) as ReturnType<typeof describe>;
  assert.equal(region.matched, 1);
  assert.equal(region.items[0].label, "mark 1");
});

test("cancelled look rejects without cancelling other waiters or deleting marks", async () => {
  const { scene, paper, flushFrames } = paperHarness();
  installDocument({ registerTool() {} });
  const desk = await registerDesk(scene, paper, { onActivity() {} });
  await desk.call("draw", { points: [{ x: 100, y: 100 }, { x: 500, y: 100 }], label: "line" });
  const controller = new AbortController();
  const rejected = assert.rejects(desk.call("look", { wait: true }, { signal: controller.signal }), { name: "AbortError" });
  const other = paper.whenIdle();
  controller.abort();
  await rejected;
  assert.equal(scene.items.length, 1);
  flushFrames();
  await resolvesSoon(other);
  desk.dispose();
  await assert.rejects(desk.call("undo"), { name: "AbortError" });
  assert.equal(scene.items.length, 1);
});

test("compass rejects enormous spans and preserves counterclockwise geometry", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  for (const end of [1e308, 1000, 0]) {
    assert.ok("error" in (await desk.call("compass", { center: { x: 500, y: 300 }, radius: 100, end, label: "bad" }) as object));
  }
  assert.equal(scene.items.length, 0);
  await desk.call("compass", { center: { x: 500, y: 300 }, radius: 100, start: 0, end: -90, label: "quarter arc" });
  assert.ok(bbox(scene.items[0]).y < 201);
  assert.equal(describe(scene).count, 1);
});

test("charcoal and paper ink stay readable without changing explicit colors", () => {
  assert.equal(inkColor("auto", "charcoal"), THEMES.charcoal.ink);
  assert.equal(inkColor("auto", "paper"), THEMES.paper.ink);
  assert.equal(inkColor("#123456", "charcoal"), "#123456");
  for (const theme of Object.values(THEMES)) {
    assert.ok(contrast(theme.ink, theme.paper) >= 7);
    assert.ok(contrast(theme.muted, theme.desk) >= 4.5);
  }
});

test("pencil study uses the exact sentence, only drawing tools, and stays inside the sheet", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const invoked: string[] = [];
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {}, onTool(name) { invoked.push(name); } });
  assert.equal(pencilStudy().map((word) => word.label).join(" "), STUDY_SENTENCE);
  await runPencilStudy(desk.call);
  assert.deepEqual([...new Set(invoked)], ["pick_pen", "draw"]);
  assert.equal(scene.items.length, pencilStudy().length);
  for (const item of scene.items) {
    assert.equal(item.kind, "stroke");
    assert.equal(item.pen.kind, "pencil");
    const b = bbox(item);
    assert.ok(b.x > 100 && b.x + b.w < 1120 && b.y > 70 && b.y + b.h < 740, `${item.label}: ${JSON.stringify(b)}`);
  }
});

test("reduced motion settles the entire pencil study in one frame", async () => {
  const { scene, paper, runNextFrame } = paperHarness();
  installDocument({ registerTool() {} });
  const desk = await registerDesk(scene, paper, { onActivity() {} });
  paper.reducedMotion = true;
  await runPencilStudy(desk.call);
  const idle = paper.whenIdle();
  runNextFrame(0);
  await resolvesSoon(idle);
  assert.equal(paper.busy, false);
});

test("smoothing never sends a valid edge stroke outside the paper", () => {
  const points = smooth([{ x: 0, y: 0 }, { x: 0, y: 700 }, { x: 1200, y: 800 }, { x: 1200, y: 0 }]);
  assert.ok(points.every((p) => p.x >= 0 && p.x <= 1200 && p.y >= 0 && p.y <= 800));
});

test("pointer ownership, coalesced samples, and the final pen-up coordinate are preserved", () => {
  const scene = new Scene();
  const listeners = new Map<string, (event: PointerEvent) => void>();
  const captures = new Set<number>();
  const canvas = {
    style: {},
    addEventListener(name: string, listener: (event: PointerEvent) => void) { listeners.set(name, listener); },
    setPointerCapture(id: number) { captures.add(id); },
    hasPointerCapture(id: number) { return captures.has(id); },
    releasePointerCapture(id: number) { captures.delete(id); },
  };
  const paper = { canvas, preview: null, render() {}, invalidate() {}, toPaper(e: PointerEvent) { return { x: e.clientX, y: e.clientY }; } } as unknown as Paper;
  const instruments = new Instruments(paper, scene);
  const event = (x: number, id = 1) => ({ clientX: x, clientY: 100, pointerId: id, pointerType: "mouse", button: 0, isPrimary: true, pressure: 0.5, preventDefault() {} }) as PointerEvent;
  const emit = (type: string, e: PointerEvent) => listeners.get(type)!(e);
  emit("pointerdown", event(100));
  emit("pointerdown", event(900, 2));
  emit("pointermove", event(1000, 2));
  const move = event(200);
  move.getCoalescedEvents = () => [event(150), event(200)];
  emit("pointermove", move);
  emit("pointerup", event(1100, 2));
  assert.equal(scene.items.length, 0);
  emit("pointerup", event(300));
  assert.equal(captures.size, 0);
  const item = scene.items[0];
  assert.equal(item.kind, "stroke");
  if (item.kind !== "stroke") throw new Error("expected stroke");
  assert.deepEqual(item.paths[0].map((p) => p.x), [100, 150, 200, 300]);

  emit("pointerdown", event(500));
  instruments.setMode("ruler");
  emit("pointerup", event(600));
  assert.equal(scene.items.length, 1, "changing instruments cancels the pending gesture");
  assert.equal(captures.size, 0);
  instruments.setMode("eraser");
  emit("pointerdown", event(250));
  emit("pointerup", event(250));
  assert.equal(scene.items.length, 0, "eraser hits the segment between sparse points");
});

test("native dispatch uses registered read/write callbacks, JSON input, and registration cleanup", async () => {
  type Registered = { name: string; execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> };
  const registered = new Map<string, Registered>();
  const sources: string[] = [];
  const mc = {
    registerTool(tool: Registered, options: { signal: AbortSignal }) {
      registered.set(tool.name, tool);
      options.signal.addEventListener("abort", () => registered.delete(tool.name), { once: true });
    },
    async getTools() { return [...registered.values()]; },
    async executeTool(tool: Registered, input: string) {
      assert.equal(typeof input, "string");
      return JSON.stringify(await tool.execute(JSON.parse(input)));
    },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: mc } });
  const scene = new Scene();
  const human = scene.add(
    { kind: "line", from: { x: 20, y: 20 }, to: { x: 40, y: 20 }, arrow: false },
    { label: "person's mark", author: "human", pen: PEN_PRESETS.pencil },
  );
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {}, onTool(_name, source) { sources.push(source); } });
  assert.equal(desk.connected, true);
  assert.ok(desk.nativeCall);
  const result = await desk.nativeCall("measure", { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }) as { length: number };
  assert.equal(result.length, 5);
  await desk.call("measure", { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } });
  assert.deepEqual(sources, ["webmcp", "local"]);
  await desk.nativeCall("pick_pen", { kind: "pencil", width: 4 });
  const drawn = await desk.nativeCall("draw", {
    points: [{ x: 100, y: 100 }, { x: 200, y: 180 }], label: "registered pencil gesture",
  }) as { id: string };
  assert.equal(scene.get(drawn.id)?.pen.width, 4);
  const beforeLook = JSON.stringify(scene.items);
  const looked = await desk.nativeCall("look", { wait: false }) as ReturnType<typeof describe>;
  assert.equal(looked.count, 2);
  assert.equal(JSON.stringify(scene.items), beforeLook, "read-only inspection leaves marks unchanged");
  await desk.nativeCall("undo");
  assert.deepEqual(scene.items.map((item) => item.id), [human.id]);
  assert.deepEqual(sources.slice(2), ["webmcp", "webmcp", "webmcp", "webmcp"]);
  desk.dispose();
  assert.equal(registered.size, 0);
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("tool calls reject malformed values with field-specific errors", async () => {
  installDocument({ registerTool() {} });
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: (_property: string, value: string) => value !== "not-a-color" } });
  const desk = await registerDesk(new Scene(), idlePaper(), { onActivity() {} });

  assert.deepEqual(
    await desk.call("ruler", { from: { x: "10", y: 20 }, to: { x: 30, y: 40 }, label: "line" }),
    { error: "from.x must be a finite number" },
  );
  assert.deepEqual(await desk.call("erase", {}), { error: "select marks with ids, group and/or region" });
  assert.deepEqual(await desk.call("pick_pen", { kind: "marker", color: "not-a-color" }), { error: "color must be one of ink, auto, accent, blue, green, ochre or a valid CSS color" });
});

function installDocument(modelContext: { registerTool(tool: { name: string }): void }) {
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext } });
}

function idlePaper(): Paper {
  const p = { busy: false, time: 0, playing: false, theme: "charcoal", whenIdle: () => Promise.resolve(), play() { p.playing = true; }, pause() { p.playing = false; }, seek(t: number) { p.time = t; } };
  return p as unknown as Paper;
}

function paperHarness() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let rafId = 0;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: {} } });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => "#5b5bd6" }) });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      const id = ++rafId;
      callbacks.set(id, callback);
      return id;
    },
  });

  const noop = () => {};
  const context = {
    setTransform: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    arc: noop,
    fill: noop,
    closePath: noop,
    strokeText: noop,
    fillText: noop,
    clip: noop,
    rect: noop,
    strokeRect: noop,
    setLineDash: noop,
    drawImage: noop,
    clearRect: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    getContext: () => context,
    style: {},
  } as unknown as HTMLCanvasElement;
  const scene = new Scene();
  const paper = new Paper(canvas, scene);

  const runNextFrame = (now: number) => {
    const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    assert.ok(entry, "expected a queued animation frame");
    callbacks.delete(entry[0]);
    entry[1](now);
  };
  const flushFrames = () => {
    let now = 0;
    for (let count = 0; callbacks.size > 0 && count < 20; count++) {
      runNextFrame(now);
      now += 2000;
    }
    assert.equal(callbacks.size, 0, "animation did not finish within 20 frames");
  };

  return { scene, paper, runNextFrame, flushFrames };
}

async function resolvesSoon(promise: Promise<void>) {
  await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("animation waiter did not settle")), 100)),
  ]);
}
