// Phosphor duotone icons, inlined at build time so the tray needs no requests.
// They use currentColor, so they take the theme's ink.

import arrowClockwise from "@phosphor-icons/core/assets/duotone/arrow-clockwise-duotone.svg?raw";
import arrowCounterClockwise from "@phosphor-icons/core/assets/duotone/arrow-counter-clockwise-duotone.svg?raw";
import books from "@phosphor-icons/core/assets/duotone/books-duotone.svg?raw";
import circleDashed from "@phosphor-icons/core/assets/duotone/circle-dashed-duotone.svg?raw";
import compassTool from "@phosphor-icons/core/assets/duotone/compass-tool-duotone.svg?raw";
import cornersOut from "@phosphor-icons/core/assets/duotone/corners-out-duotone.svg?raw";
import dotsThree from "@phosphor-icons/core/assets/duotone/dots-three-duotone.svg?raw";
import eraser from "@phosphor-icons/core/assets/duotone/eraser-duotone.svg?raw";
import exportIcon from "@phosphor-icons/core/assets/duotone/export-duotone.svg?raw";
import eye from "@phosphor-icons/core/assets/duotone/eye-duotone.svg?raw";
import eyeSlash from "@phosphor-icons/core/assets/duotone/eye-slash-duotone.svg?raw";
import filmStrip from "@phosphor-icons/core/assets/duotone/film-strip-duotone.svg?raw";
import floppyDisk from "@phosphor-icons/core/assets/duotone/floppy-disk-duotone.svg?raw";
import gridFour from "@phosphor-icons/core/assets/duotone/grid-four-duotone.svg?raw";
import hand from "@phosphor-icons/core/assets/duotone/hand-duotone.svg?raw";
import highlighter from "@phosphor-icons/core/assets/duotone/highlighter-duotone.svg?raw";
import lineSegment from "@phosphor-icons/core/assets/duotone/line-segment-duotone.svg?raw";
import markerCircle from "@phosphor-icons/core/assets/duotone/marker-circle-duotone.svg?raw";
import minus from "@phosphor-icons/core/assets/bold/minus-bold.svg?raw";
import noteBlank from "@phosphor-icons/core/assets/duotone/note-blank-duotone.svg?raw";
import paintBrush from "@phosphor-icons/core/assets/duotone/paint-brush-duotone.svg?raw";
import pause from "@phosphor-icons/core/assets/duotone/pause-duotone.svg?raw";
import penNib from "@phosphor-icons/core/assets/duotone/pen-nib-duotone.svg?raw";
import pencil from "@phosphor-icons/core/assets/duotone/pencil-duotone.svg?raw";
import pentagon from "@phosphor-icons/core/assets/duotone/pentagon-duotone.svg?raw";
import play from "@phosphor-icons/core/assets/duotone/play-duotone.svg?raw";
import plus from "@phosphor-icons/core/assets/bold/plus-bold.svg?raw";
import repeat from "@phosphor-icons/core/assets/duotone/repeat-duotone.svg?raw";
import rows from "@phosphor-icons/core/assets/duotone/rows-duotone.svg?raw";
import ruler from "@phosphor-icons/core/assets/duotone/ruler-duotone.svg?raw";
import shapes from "@phosphor-icons/core/assets/duotone/shapes-duotone.svg?raw";
import square from "@phosphor-icons/core/assets/duotone/square-duotone.svg?raw";
import stackSimple from "@phosphor-icons/core/assets/duotone/stack-simple-duotone.svg?raw";
import trash from "@phosphor-icons/core/assets/duotone/trash-duotone.svg?raw";
import triangle from "@phosphor-icons/core/assets/duotone/triangle-duotone.svg?raw";
import x from "@phosphor-icons/core/assets/duotone/x-duotone.svg?raw";

const mark = (svg: string) => svg.replace("<svg ", '<svg aria-hidden="true" ');

export const ICONS = {
  hand: mark(hand),
  pencil: mark(pencil),
  fineliner: mark(penNib),
  marker: mark(markerCircle),
  brush: mark(paintBrush),
  highlighter: mark(highlighter),
  eraser: mark(eraser),
  ruler: mark(ruler),
  compass: mark(compassTool),
  stencil: mark(shapes),
  rectangle: mark(square),
  triangle: mark(triangle),
  polygon: mark(pentagon),
  undo: mark(arrowCounterClockwise),
  replay: mark(arrowClockwise),
  play: mark(play),
  pause: mark(pause),
  loop: mark(repeat),
  onion: mark(circleDashed),
  grid: mark(gridFour),
  lined: mark(rows),
  blank: mark(noteBlank),
  dash: mark(dotsThree),
  solid: mark(lineSegment),
  plus: mark(plus),
  minus: mark(minus),
  fit: mark(cornersOut),
  export: mark(exportIcon),
  video: mark(filmStrip),
  save: mark(floppyDisk),
  library: mark(books),
  trash: mark(trash),
  close: mark(x),
  eye: mark(eye),
  eyeOff: mark(eyeSlash),
  front: mark(stackSimple),
} as const;

export type IconName = keyof typeof ICONS;
