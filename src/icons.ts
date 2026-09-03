// Hand-drawn icons: Khushmeen Sidhu's Doodle Icons (CC0), vendored from the
// MIT-licensed react-doodle-icons mirror and normalized to currentColor. A few
// tiny marks that the set lacks are drawn here in the same spirit.

import arrowLeft from "./doodle/arrow-circle-left.svg?raw";
import arrowRight from "./doodle/arrow-circle-right.svg?raw";
import copy from "./doodle/copy.svg?raw";
import cross from "./doodle/cross.svg?raw";
import del from "./doodle/delete.svg?raw";
import diamond from "./doodle/diamond.svg?raw";
import eraser from "./doodle/eraser.svg?raw";
import floppy from "./doodle/floppy.svg?raw";
import folder from "./doodle/folder.svg?raw";
import grid from "./doodle/grid.svg?raw";
import hand from "./doodle/hand.svg?raw";
import hide from "./doodle/hide.svg?raw";
import layer from "./doodle/layer.svg?raw";
import list from "./doodle/list.svg?raw";
import maximize from "./doodle/maximize.svg?raw";
import clapper from "./doodle/movie-clapper.svg?raw";
import navigation from "./doodle/navigation.svg?raw";
import paintBrush from "./doodle/paint-brush-2.svg?raw";
import pause from "./doodle/pause.svg?raw";
import penTool from "./doodle/pen-tool.svg?raw";
import pen from "./doodle/pen.svg?raw";
import pencil3 from "./doodle/pencil-3.svg?raw";
import pencil from "./doodle/pencil.svg?raw";
import play from "./doodle/play.svg?raw";
import rectangle from "./doodle/rectangle.svg?raw";
import ruler from "./doodle/ruler.svg?raw";
import shape from "./doodle/shape.svg?raw";
import shuffle from "./doodle/shuffle.svg?raw";
import square from "./doodle/square.svg?raw";
import sync from "./doodle/sync.svg?raw";
import target from "./doodle/target.svg?raw";
import unhide from "./doodle/unhide.svg?raw";
import upload from "./doodle/upload.svg?raw";

const mark = (svg: string) => svg.replace("<svg ", '<svg aria-hidden="true" ');
const doodle = (d: string) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS = {
  hand: mark(hand),
  pencil: mark(pencil),
  fineliner: mark(penTool),
  marker: mark(pen),
  brush: mark(paintBrush),
  highlighter: mark(pencil3),
  eraser: mark(eraser),
  ruler: mark(ruler),
  compass: mark(target),
  stencil: mark(shape),
  rectangle: mark(rectangle),
  triangle: mark(navigation),
  polygon: mark(diamond),
  undo: mark(arrowLeft),
  redo: mark(arrowRight),
  replay: mark(sync),
  play: mark(play),
  pause: mark(pause),
  loop: mark(shuffle),
  onion: mark(copy),
  grid: mark(grid),
  lined: mark(list),
  blank: mark(square),
  dash: doodle('<path d="M3.5 12.6c1.4-.4 2.4-.3 3.6 0"/><path d="M10.2 12.2c1.3-.5 2.3-.3 3.6.1"/><path d="M16.9 12.5c1.3-.4 2.4-.2 3.6.2"/>'),
  solid: doodle('<path d="M3.5 12.8c3-.9 5.9-.4 8.6-.2 2.8.2 5.6-.6 8.4-.3"/>'),
  plus: doodle('<path d="M12 5.2c.3 4.5-.2 9 .1 13.6"/><path d="M5.2 12.1c4.6-.4 9 .2 13.6-.1"/>'),
  minus: doodle('<path d="M5.2 12.3c4.6-.5 9 .2 13.6-.2"/>'),
  fit: mark(maximize),
  export: mark(upload),
  video: mark(clapper),
  save: mark(floppy),
  library: mark(folder),
  trash: mark(del),
  close: mark(cross),
  eye: mark(unhide),
  eyeOff: mark(hide),
  front: mark(layer),
} as const;

export type IconName = keyof typeof ICONS;
