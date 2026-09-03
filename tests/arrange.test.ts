import assert from "node:assert/strict";
import test from "node:test";

import { align, distribute } from "../src/arrange.ts";
import { bbox, PAPER_W, PEN_PRESETS, Scene, type Item } from "../src/scene.ts";

// Rectangles make the arithmetic obvious: a bbox is the stencil padded by the
// pen width on every side.
function rect(scene: Scene, label: string, x: number, y: number, w: number, h: number): Item {
  return scene.add(
    { kind: "shape", shape: "rectangle", x, y, w, h, rotation: 0, sides: 4 },
    { label, author: "agent", pen: { ...PEN_PRESETS.fineliner } },
  );
}

const PAD = PEN_PRESETS.fineliner.width;

test("align moves marks to the selection's extreme or centre line", () => {
  const scene = new Scene();
  const a = rect(scene, "a", 200, 300, 100, 60);
  const b = rect(scene, "b", 500, 400, 200, 40);
  const c = rect(scene, "c", 800, 500, 60, 120);
  const ids = [a.id, b.id, c.id];

  const left = align(scene, ids, "left");
  assert.deepEqual(left.map((i) => i.id), [b.id, c.id], "the leftmost mark already sits on the edge");
  const leftEdge = 200 - 50 - PAD;
  for (const id of ids) assert.equal(bbox(scene.get(id)!).x, leftEdge);

  // Widths are untouched by a move, so the union is as wide as the widest mark.
  const centre = bbox(scene.get(b.id)!).x + bbox(scene.get(b.id)!).w / 2;
  align(scene, ids, "center");
  for (const id of ids) {
    const box = bbox(scene.get(id)!);
    assert.ok(Math.abs(box.x + box.w / 2 - centre) < 1e-9, `${id} is not centred`);
  }

  const bottom = Math.max(...ids.map((id) => bbox(scene.get(id)!).y + bbox(scene.get(id)!).h));
  align(scene, ids, "bottom");
  for (const id of ids) {
    const box = bbox(scene.get(id)!);
    assert.ok(Math.abs(box.y + box.h - bottom) < 1e-9, `${id} does not sit on the bottom edge`);
  }
});

test("align toPaper uses the sheet, and needs no second mark", () => {
  const scene = new Scene();
  const only = rect(scene, "only", 300, 300, 120, 80);

  assert.deepEqual(align(scene, [only.id], "left"), [], "one mark is already aligned to itself");
  assert.equal(align(scene, [only.id], "left", true).length, 1);
  assert.equal(bbox(scene.get(only.id)!).x, 0);

  align(scene, [only.id], "center", true);
  const box = bbox(scene.get(only.id)!);
  assert.ok(Math.abs(box.x + box.w / 2 - PAPER_W / 2) < 1e-9);
});

test("distribute leaves the outermost marks and equalises the gaps between the rest", () => {
  const scene = new Scene();
  const a = rect(scene, "a", 200, 400, 100, 40);
  const b = rect(scene, "b", 300, 400, 40, 40);
  const c = rect(scene, "c", 400, 400, 160, 40);
  const d = rect(scene, "d", 900, 400, 80, 40);
  const ids = [a.id, b.id, c.id, d.id];
  const before = Object.fromEntries(ids.map((id) => [id, bbox(scene.get(id)!)]));

  const moved = distribute(scene, ids, "horizontal");
  assert.deepEqual(moved.map((i) => i.id).sort(), [b.id, c.id].sort(), "only the inner marks move");

  const boxes = ids.map((id) => bbox(scene.get(id)!)).sort((p, q) => p.x - q.x);
  assert.deepEqual(boxes[0], before[a.id], "the first mark stays put");
  assert.deepEqual(boxes[3], before[d.id], "the last mark stays put");
  const gaps = [1, 2, 3].map((n) => boxes[n].x - (boxes[n - 1].x + boxes[n - 1].w));
  for (const gap of gaps) assert.ok(Math.abs(gap - gaps[0]) < 1e-9, `uneven gaps: ${gaps.join(", ")}`);
  for (const id of ids) assert.equal(bbox(scene.get(id)!).y, before[id].y, "a horizontal spread never moves marks down");
});

test("distribute spreads vertically and is a no-op below three marks", () => {
  const scene = new Scene();
  const a = rect(scene, "a", 400, 100, 60, 40);
  const b = rect(scene, "b", 400, 150, 60, 40);
  const c = rect(scene, "c", 400, 600, 60, 40);

  assert.deepEqual(distribute(scene, [a.id, c.id], "vertical"), [], "two marks are already spread");
  const moved = distribute(scene, [a.id, b.id, c.id], "vertical");
  assert.deepEqual(moved.map((i) => i.id), [b.id]);
  const boxes = [a, b, c].map((i) => bbox(scene.get(i.id)!));
  const gaps = [1, 2].map((n) => boxes[n].y - (boxes[n - 1].y + boxes[n - 1].h));
  assert.ok(Math.abs(gaps[0] - gaps[1]) < 1e-9, `uneven gaps: ${gaps.join(", ")}`);
});
