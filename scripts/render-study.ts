// Optional renderer QA, not browser automation or a live WebMCP test.
// node scripts/render-study.ts /absolute/path/to/@napi-rs/canvas/index.js /tmp/desk-study.png [paper|charcoal]
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Paper } from "../src/paper.ts";
import { Scene } from "../src/scene.ts";
import { registerDesk } from "../src/webmcp.ts";
import { runPencilStudy } from "../src/pencil-study.ts";

const [canvasModule, output, theme = "charcoal"] = process.argv.slice(2);
if (!canvasModule || !output || !["charcoal", "paper"].includes(theme)) throw new Error("Provide canvas module path, PNG output path and optional theme.");
const { createCanvas } = await import(pathToFileURL(canvasModule).href);
const canvas = createCanvas(1200, 800);
let frame: FrameRequestCallback | undefined;
Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => { frame = callback; return 1; } });
const scene = new Scene();
const paper = new Paper(canvas, scene);
paper.theme = theme as "charcoal" | "paper";
paper.reducedMotion = true;
const desk = await registerDesk(scene, paper, { onActivity() {} });
await runPencilStudy(desk.call);
frame?.(0);
await paper.whenIdle();
await writeFile(output, canvas.toBuffer("image/png"));
console.log(JSON.stringify({ output, marks: scene.items.length, theme, evidence: "local canvas renderer; not browser or agent proof" }));
