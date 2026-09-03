import "./style.css";
import { applyTheme, type Theme } from "./appearance.ts";
import { Instruments, type Mode } from "./instruments.ts";
import { Paper } from "./paper.ts";
import { PALETTE, Scene, type PaperKind, type PenKind, type StencilShape } from "./scene.ts";
import { registerDesk } from "./webmcp.ts";
import { keyTimes } from "./motion.ts";

const COLORS = [PALETTE.ink, PALETTE.accent, PALETTE.blue, PALETTE.green, PALETTE.ochre];
const COLOR_NAMES = ["ink · follows paper theme", "accent", "blue", "green", "ochre"];
let theme: Theme = "charcoal";
try { if (localStorage.getItem("desk-theme") === "paper") theme = "paper"; } catch { /* Drawing works without storage. */ }
applyTheme(theme);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="top">
    <div class="identity"><a class="wordmark" href="./" aria-label="Desk home">DESK</a><span class="tagline">one sheet, two hands</span></div>
    <div class="status">
      <span id="cursor" aria-hidden="true"></span>
      <button type="button" class="tool theme-toggle" id="theme" aria-pressed="false">charcoal</button>
      <span class="chip off" id="agent" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span id="agent-label">agent: connecting</span></span>
    </div>
  </header>
  <main class="stage" id="stage">
    <canvas id="paper" role="img" aria-label="Shared drawing sheet"></canvas>
    <p class="sr-only" id="paper-status" aria-live="polite">The grid sheet is empty.</p>
    <div class="hint" id="hint"><span>a shared sheet. draw on it, or ask your agent to.</span></div>
  </main>
  <section class="strip" id="strip" hidden aria-label="Timeline">
    <button type="button" class="tool" id="play" aria-label="Play or pause">play</button>
    <span class="clock" id="clock">0.00 / 4.00</span>
    <div class="scrub">
      <input type="range" id="scrub" min="0" max="4" step="0.01" value="0" aria-label="Scrub the timeline" />
      <div class="ticks" id="ticks" aria-hidden="true"></div>
    </div>
    <button type="button" class="tool" id="loop" aria-pressed="true">loop</button>
    <button type="button" class="tool" id="onion" aria-pressed="false">onion</button>
  </section>
  <footer class="tray">
    <div class="tray-inner">
      <div class="group" id="pens" role="group" aria-label="Pens">
        <button type="button" class="tool active" data-pen="pencil" aria-pressed="true">pencil</button>
        <button type="button" class="tool" data-pen="fineliner" aria-pressed="false">fineliner</button>
        <button type="button" class="tool" data-pen="marker" aria-pressed="false">marker</button>
        <button type="button" class="tool" data-pen="brush" aria-pressed="false">brush</button>
        <button type="button" class="tool" data-pen="highlighter" aria-pressed="false">highlighter</button>
      </div>
      <div class="group" id="colors" role="group" aria-label="Ink colors"></div>
      <div class="group" id="modes" role="group" aria-label="Drawing tools">
        <button type="button" class="tool" data-mode="eraser" aria-pressed="false">eraser</button>
        <button type="button" class="tool" data-mode="ruler" aria-pressed="false">ruler</button>
        <button type="button" class="tool" data-mode="compass" aria-pressed="false">compass</button>
        <button type="button" class="tool" data-mode="stencil" data-stencil="rectangle" aria-pressed="false">stencil</button>
      </div>
      <div class="group" role="group" aria-label="Sheet controls">
        <button type="button" class="tool" id="undo">undo</button>
        <button type="button" class="tool" id="replay">replay</button>
        <button type="button" class="tool" id="sheet" data-paper="grid" aria-label="Change sheet style; current style grid">sheet: grid</button>
      </div>
    </div>
  </footer>
`;

const scene = new Scene();
const canvas = document.querySelector<HTMLCanvasElement>("#paper")!;
const paper = new Paper(canvas, scene);
const stage = document.querySelector<HTMLElement>("#stage")!;
const instruments = new Instruments(paper, scene);
paper.theme = theme;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
paper.reducedMotion = motion.matches;
motion.addEventListener("change", () => { paper.reducedMotion = motion.matches; });

const themeButton = document.querySelector<HTMLButtonElement>("#theme")!;
function updateTheme() {
  applyTheme(theme);
  paper.theme = theme;
  paper.render();
  themeButton.textContent = theme;
  themeButton.setAttribute("aria-label", `Charcoal theme; switch to ${theme === "charcoal" ? "light paper" : "charcoal"}`);
  themeButton.setAttribute("aria-pressed", String(theme === "charcoal"));
}
updateTheme();
themeButton.addEventListener("click", () => {
  theme = theme === "charcoal" ? "paper" : "charcoal";
  updateTheme();
  try { localStorage.setItem("desk-theme", theme); } catch { /* Theme still works for this tab. */ }
});

new ResizeObserver(() => paper.resize()).observe(stage);
paper.resize();

// Tray wiring
const penButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-pen]")];
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];
const colorsEl = document.querySelector<HTMLElement>("#colors")!;
const STENCILS: StencilShape[] = ["rectangle", "triangle", "polygon"];

for (const [index, c] of COLORS.entries()) {
  const b = document.createElement("button");
  b.className = "swatch" + (c === COLORS[0] ? " active" : "");
  b.style.setProperty("--swatch", c === "auto" ? "var(--ink)" : c);
  b.title = COLOR_NAMES[index];
  b.dataset.color = c;
  b.type = "button";
  b.setAttribute("aria-label", `Use ${COLOR_NAMES[index]} ink`);
  b.setAttribute("aria-pressed", String(c === COLORS[0]));
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
  for (const b of penButtons) {
    const active = instruments.mode === "pen" && b.dataset.pen === instruments.pen.kind;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  for (const b of modeButtons) {
    const active = b.dataset.mode === instruments.mode;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
    if (b.dataset.mode === "stencil") b.textContent = instruments.mode === "stencil" ? `stencil: ${instruments.stencil}` : "stencil";
  }
  for (const s of colorsEl.children) {
    const active = (s as HTMLElement).dataset.color === instruments.pen.color;
    (s as HTMLElement).classList.toggle("active", active);
    s.setAttribute("aria-pressed", String(active));
  }
};

document.querySelector("#undo")!.addEventListener("click", () => scene.undo("human"));
document.querySelector("#replay")!.addEventListener("click", () => paper.replay());
const sheetBtn = document.querySelector<HTMLButtonElement>("#sheet")!;
sheetBtn.addEventListener("click", () => {
  const order: PaperKind[] = ["grid", "blank", "lined"];
  const next = order[(order.indexOf(scene.paper) + 1) % order.length];
  scene.setPaper(next);
});
const hint = document.querySelector<HTMLElement>("#hint")!;
const paperStatus = document.querySelector<HTMLElement>("#paper-status")!;
scene.on((e) => {
  if (e.type === "paper" || e.type === "clear") {
    sheetBtn.textContent = `sheet: ${scene.paper}`;
    sheetBtn.setAttribute("aria-label", `Change sheet style; current style ${scene.paper}`);
  }
  hint.hidden = scene.items.length > 0;
  paperStatus.textContent = `The ${scene.paper} sheet has ${scene.items.length} ${scene.items.length === 1 ? "mark" : "marks"}.`;
});

// Timeline strip: appears once anything moves.
const strip = document.querySelector<HTMLElement>("#strip")!;
const playBtn = document.querySelector<HTMLButtonElement>("#play")!;
const clock = document.querySelector<HTMLElement>("#clock")!;
const scrub = document.querySelector<HTMLInputElement>("#scrub")!;
const ticks = document.querySelector<HTMLElement>("#ticks")!;
const loopBtn = document.querySelector<HTMLButtonElement>("#loop")!;
const onionBtn = document.querySelector<HTMLButtonElement>("#onion")!;
function syncStrip() {
  const { duration, loop, onion } = scene.timeline;
  strip.hidden = !scene.animated;
  scrub.max = String(duration);
  loopBtn.classList.toggle("active", loop);
  loopBtn.setAttribute("aria-pressed", String(loop));
  onionBtn.classList.toggle("active", onion);
  onionBtn.setAttribute("aria-pressed", String(onion));
  ticks.replaceChildren(...keyTimes(scene.items).map((t) => {
    const el = document.createElement("i");
    el.style.left = `${(t / duration) * 100}%`;
    return el;
  }));
}
paper.onTime = (time, playing) => {
  scrub.value = String(time);
  clock.textContent = `${time.toFixed(2)} / ${scene.timeline.duration.toFixed(2)}`;
  playBtn.textContent = playing ? "pause" : "play";
};
playBtn.addEventListener("click", () => paper.toggle());
scrub.addEventListener("input", () => {
  if (paper.playing) paper.pause();
  paper.seek(Number(scrub.value));
});
loopBtn.addEventListener("click", () => scene.setTimeline({ loop: !scene.timeline.loop }));
onionBtn.addEventListener("click", () => scene.setTimeline({ onion: !scene.timeline.onion }));
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || strip.hidden || (e.target as HTMLElement)?.tagName === "INPUT") return;
  e.preventDefault();
  paper.toggle();
});
scene.on((e) => {
  if (e.type === "motion" || e.type === "timeline" || e.type === "clear" || e.type === "remove") syncStrip();
});

// Pointer readout in paper units, useful when talking to the agent about positions.
const cursorEl = document.querySelector<HTMLElement>("#cursor")!;
canvas.addEventListener("pointermove", (e) => {
  const p = paper.toPaper(e);
  cursorEl.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
});
canvas.addEventListener("pointerleave", () => (cursorEl.textContent = ""));

// Agent status chip
const agentChip = document.querySelector<HTMLElement>("#agent")!;
const agentLabel = document.querySelector<HTMLElement>("#agent-label")!;
let activeUntil = 0;
let idleLabel = "agent: connecting";
let activityTimer: ReturnType<typeof setTimeout> | undefined;
function setAgentActive(active: boolean) {
  if (active) {
    if (activityTimer !== undefined) clearTimeout(activityTimer);
    activeUntil = performance.now() + 600;
    agentChip.className = "chip on";
    agentLabel.textContent = "agent: drawing";
    return;
  }
  // Debounce so rapid tool calls read as one continuous session at the desk.
  const settle = () => {
    const remaining = activeUntil - performance.now();
    if (remaining > 0) {
      activityTimer = setTimeout(settle, remaining);
      return;
    }
    activityTimer = undefined;
    if (paper.busy) return;
    agentChip.className = "chip";
    agentLabel.textContent = idleLabel;
  };
  if (activityTimer !== undefined) clearTimeout(activityTimer);
  activityTimer = setTimeout(settle, Math.max(0, activeUntil - performance.now()));
}
paper.onActivity = setAgentActive;

registerDesk(scene, paper, {
  onActivity: setAgentActive,
  onTool(name, source) {
    agentChip.title = `last tool: ${name} (${source})`;
  },
}, { waitMs: 3000 }).then((desk) => {
  // Handy for trying instruments from the console and for automated checks.
  (window as unknown as { desk: unknown }).desk = desk;
  window.addEventListener("pagehide", (event) => { if (!event.persisted) desk.dispose(); });
  if (desk.connected) {
    agentChip.className = "chip";
    idleLabel = "agent: ready";
    agentLabel.textContent = idleLabel;
    agentChip.title = `${desk.registered.length} instruments registered with WebMCP`;
    return;
  }
  if (desk.registrationErrors.length > 0) {
    agentChip.className = "chip off";
    idleLabel = `agent: ${desk.registered.length}/${desk.names.length} tools`;
    agentLabel.textContent = idleLabel;
    addNotice(`${desk.registrationErrors.length} of ${desk.names.length} instruments failed to register: ${desk.registrationErrors.join("; ")}`, "alert");
    return;
  }
  idleLabel = "agent: unavailable";
  agentLabel.textContent = idleLabel;
  const n = document.createElement("div");
  n.className = "notice";
  n.innerHTML = `This browser has no WebMCP, so an agent can't pick up the pens. Open Desk in ChatGPT's browser, or in Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code> on. You can still draw.`;
  stage.appendChild(n);
}).catch((error: unknown) => {
  agentChip.className = "chip off";
  idleLabel = "agent: failed";
  agentLabel.textContent = idleLabel;
  addNotice(`Desk could not register its instruments: ${error instanceof Error ? error.message : String(error)}`, "alert");
});

function addNotice(message: string, role: "status" | "alert" = "status") {
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", role);
  notice.textContent = message;
  stage.appendChild(notice);
}
