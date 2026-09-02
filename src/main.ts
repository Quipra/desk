import "./style.css";
import { Instruments, type Mode } from "./instruments";
import { Paper } from "./paper";
import { Scene, type PaperKind, type PenKind, type Pt, type StencilShape } from "./scene";
import { registerDesk } from "./webmcp";

const COLORS = ["#1a1a1a", "#d63b3b", "#2b6cd6", "#2a9d5c", "#e0912a"];

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="top">
    <a class="wordmark" href="/">DESK</a>
    <div class="status">
      <span id="cursor"></span>
      <span class="chip off" id="agent"><span class="dot"></span><span id="agent-label">agent: idle</span></span>
    </div>
  </header>
  <main class="stage" id="stage">
    <canvas id="paper"></canvas>
  </main>
  <footer class="tray">
    <div class="tray-inner">
      <div class="group" id="pens">
        <button class="tool active" data-pen="pencil">pencil</button>
        <button class="tool" data-pen="marker">marker</button>
        <button class="tool" data-pen="brush">brush</button>
      </div>
      <div class="group" id="colors"></div>
      <div class="group" id="modes">
        <button class="tool" data-mode="eraser">eraser</button>
        <button class="tool" data-mode="ruler">ruler</button>
        <button class="tool" data-mode="compass">compass</button>
        <button class="tool" data-mode="stencil" data-stencil="rectangle">stencil</button>
        <button class="tool" data-mode="text">write</button>
      </div>
      <div class="group">
        <button class="tool" id="undo">undo</button>
        <button class="tool" id="replay">replay</button>
        <button class="tool" id="sheet" data-paper="grid">sheet: grid</button>
      </div>
    </div>
  </footer>
`;

const scene = new Scene();
const canvas = document.querySelector<HTMLCanvasElement>("#paper")!;
const paper = new Paper(canvas, scene);
const stage = document.querySelector<HTMLElement>("#stage")!;
const instruments = new Instruments(paper, scene, openTextEntry);

new ResizeObserver(() => paper.resize()).observe(stage);
paper.resize();

// Tray wiring
const penButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-pen]")];
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];
const colorsEl = document.querySelector<HTMLElement>("#colors")!;
const STENCILS: StencilShape[] = ["rectangle", "triangle", "polygon"];

for (const c of COLORS) {
  const b = document.createElement("button");
  b.className = "swatch" + (c === COLORS[0] ? " active" : "");
  b.style.background = c;
  b.title = c;
  b.addEventListener("click", () => instruments.setColor(c));
  colorsEl.appendChild(b);
}

for (const b of penButtons) b.addEventListener("click", () => instruments.setPenKind(b.dataset.pen as PenKind));
for (const b of modeButtons) {
  b.addEventListener("click", () => {
    const mode = b.dataset.mode as Mode;
    if (mode === "stencil" && instruments.mode === "stencil") {
      // Tapping the stencil again cycles the shape.
      const next = STENCILS[(STENCILS.indexOf(instruments.stencil) + 1) % STENCILS.length];
      instruments.stencil = next;
    }
    instruments.setMode(mode);
  });
}

instruments.onChange = () => {
  for (const b of penButtons) b.classList.toggle("active", instruments.mode === "pen" && b.dataset.pen === instruments.pen.kind);
  for (const b of modeButtons) {
    b.classList.toggle("active", b.dataset.mode === instruments.mode);
    if (b.dataset.mode === "stencil") b.textContent = instruments.mode === "stencil" ? `stencil: ${instruments.stencil}` : "stencil";
  }
  for (const s of colorsEl.children) (s as HTMLElement).classList.toggle("active", (s as HTMLElement).title === instruments.pen.color);
};

document.querySelector("#undo")!.addEventListener("click", () => scene.undo("human"));
document.querySelector("#replay")!.addEventListener("click", () => paper.replay());
const sheetBtn = document.querySelector<HTMLButtonElement>("#sheet")!;
sheetBtn.addEventListener("click", () => {
  const order: PaperKind[] = ["grid", "blank", "lined"];
  const next = order[(order.indexOf(scene.paper) + 1) % order.length];
  scene.setPaper(next);
});
scene.on((e) => {
  if (e.type === "paper" || e.type === "clear") sheetBtn.textContent = `sheet: ${scene.paper}`;
});

// Pointer readout in paper units, useful when talking to the agent about positions.
const cursorEl = document.querySelector<HTMLElement>("#cursor")!;
canvas.addEventListener("pointermove", (e) => {
  const p = paper.toPaper(e);
  cursorEl.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
});
canvas.addEventListener("pointerleave", () => (cursorEl.textContent = ""));

// Inline handwriting entry for the person's write tool.
function openTextEntry(at: Pt) {
  const input = document.createElement("input");
  input.className = "text-entry";
  input.placeholder = "write";
  const rect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  input.style.left = `${rect.left - stageRect.left + at.x * paper.scale}px`;
  input.style.top = `${rect.top - stageRect.top + at.y * paper.scale - 24 * paper.scale}px`;
  input.style.fontSize = `${24 * paper.scale}px`;
  stage.appendChild(input);
  input.focus();
  const commit = () => {
    const text = input.value.trim();
    input.remove();
    if (text) scene.add({ kind: "text", x: at.x, y: at.y, text, size: 24 }, { label: text, author: "human", pen: instruments.pen });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") input.remove();
  });
  input.addEventListener("blur", commit);
}

// Agent status chip
const agentChip = document.querySelector<HTMLElement>("#agent")!;
const agentLabel = document.querySelector<HTMLElement>("#agent-label")!;
let activeUntil = 0;
function setAgentActive(active: boolean) {
  if (active) {
    activeUntil = performance.now() + 600;
    agentChip.className = "chip on";
    agentLabel.textContent = "agent: drawing";
    return;
  }
  // Debounce so rapid tool calls read as one continuous session at the desk.
  const at = performance.now();
  setTimeout(() => {
    if (performance.now() >= activeUntil && !paper.busy) {
      agentChip.className = "chip";
      agentLabel.textContent = "agent: ready";
    }
  }, Math.max(0, activeUntil - at));
}
paper.onActivity = setAgentActive;

registerDesk(scene, paper, { onActivity: setAgentActive }).then((ok) => {
  if (ok) {
    agentChip.className = "chip";
    agentLabel.textContent = "agent: ready";
    return;
  }
  agentLabel.textContent = "agent: not connected";
  const n = document.createElement("div");
  n.className = "notice";
  n.innerHTML = `This browser has no WebMCP, so an agent can't pick up the pens. Open Desk in ChatGPT's browser, or in Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code> turned on. You can still draw.`;
  stage.appendChild(n);
});
