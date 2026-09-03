import type { Pt } from "./scene.ts";

export const STUDY_SENTENCE = "Hey, this is a first testing using only pencil tool and writing tools, without using any specific fonts and texts.";

// A single prepared pencil study, not a text renderer. These are hand-planned
// word strokes. No font files, glyph outlines, SVG, or canvas text calls are used.
// Each inner array is a separate pen-down gesture in local paper coordinates.
type Word = { label: string; strokes: number[][] };
const hey: Word = { label: "Hey,", strokes: [
  [0,0, 0,24], [17,0, 16,24], [0,12, 16,11],
  [26,16, 39,14, 37,9, 32,8, 27,11, 25,17, 28,23, 35,24, 40,21],
  [47,9, 49,20, 55,23, 61,9, 58,24, 55,32, 49,35, 45,32], [70,23, 68,30],
] };
const thisWord: Word = { label: "this", strokes: [
  [5,1, 4,19, 7,21, 10,19], [0,7, 11,7],
  [17,0, 16,21, 17,12, 21,8, 25,10, 25,21],
  [33,9, 33,21], [33,3, 33.2,3.4],
  [52,10, 47,8, 42,11, 44,15, 50,16, 52,19, 48,22, 42,20],
] };
const is: Word = { label: "is", strokes: [[1,9, 1,21], [1,3, 1.2,3.4], [21,10, 16,8, 11,11, 13,15, 19,16, 21,19, 17,22, 11,20]] };
const a: Word = { label: "a", strokes: [[12,10, 7,8, 2,11, 0,16, 2,21, 7,21, 12,16], [12,8, 12,21, 15,21]] };
const first: Word = { label: "first", strokes: [
  [11,1, 7,0, 4,4, 4,21], [0,9, 10,9], [17,9, 17,21], [17,3, 17.2,3.4],
  [26,9, 26,21, 26,13, 31,8, 35,9],
  [52,10, 47,8, 42,11, 44,15, 50,16, 52,19, 48,22, 42,20],
  [64,1, 63,19, 66,21, 69,19], [58,8, 70,8],
] };
const testing: Word = { label: "testing", strokes: [
  [5,1, 4,19, 7,21, 10,19], [0,8, 11,8],
  [17,15, 28,13, 25,8, 20,9, 16,14, 17,19, 21,22, 28,20],
  [46,10, 41,8, 36,11, 38,15, 44,16, 46,19, 42,22, 36,20],
  [57,1, 56,19, 59,21, 62,19], [52,8, 63,8], [70,9, 70,21], [70,3, 70.2,3.4],
  [79,8, 79,21, 79,13, 84,8, 89,10, 89,21],
  [109,10, 103,8, 98,11, 97,17, 100,21, 105,20, 109,14], [109,8, 109,25, 106,30, 100,31, 97,28],
] };
const using: Word = { label: "using", strokes: [
  [0,9, 0,18, 3,21, 8,20, 12,14], [12,8, 12,21],
  [33,10, 28,8, 23,11, 25,15, 31,16, 33,19, 29,22, 23,20], [41,9, 41,21], [41,3, 41.2,3.4],
  [50,8, 50,21, 50,13, 55,8, 60,10, 60,21],
  [80,10, 74,8, 69,11, 68,17, 71,21, 76,20, 80,14], [80,8, 80,25, 77,30, 71,31, 68,28],
] };
const only: Word = { label: "only", strokes: [
  [12,10, 7,8, 2,10, 0,15, 2,20, 7,22, 12,19, 14,14, 12,10],
  [22,8, 22,21, 22,13, 27,8, 32,10, 32,21], [41,0, 40,19, 43,22, 46,20],
  [52,9, 55,19, 60,21, 66,9, 63,23, 60,30, 54,32, 51,29],
] };
const pencil: Word = { label: "pencil", strokes: [
  [1,9, 1,31], [1,12, 6,8, 12,10, 14,15, 12,20, 6,22, 1,19],
  [22,15, 33,13, 30,8, 25,9, 21,14, 22,19, 26,22, 33,20],
  [42,8, 42,21, 42,13, 47,8, 52,10, 52,21],
  [73,10, 67,8, 61,12, 60,17, 64,21, 70,21, 74,18],
  [82,9, 82,21], [82,3, 82.2,3.4], [92,0, 91,19, 94,22, 97,20],
] };
const tool: Word = { label: "tool", strokes: [
  [5,1, 4,19, 7,21, 10,19], [0,8, 11,8],
  [28,10, 23,8, 18,10, 16,15, 18,20, 23,22, 28,19, 30,14, 28,10],
  [49,10, 44,8, 39,10, 37,15, 39,20, 44,22, 49,19, 51,14, 49,10], [60,0, 59,19, 62,22, 65,20],
] };
const and: Word = { label: "and", strokes: [
  ...a.strokes, [23,8, 23,21, 23,13, 28,8, 33,10, 33,21],
  [54,10, 48,8, 43,11, 41,17, 44,21, 49,21, 54,16], [54,0, 54,21, 57,21],
] };
const writing: Word = { label: "writing", strokes: [
  [0,9, 4,21, 10,11, 15,21, 21,8], [29,9, 29,21, 29,13, 34,8, 38,9],
  [46,9, 46,21], [46,3, 46.2,3.4], [59,1, 58,19, 61,21, 64,19], [53,8, 65,8],
  [73,9, 73,21], [73,3, 73.2,3.4], [82,8, 82,21, 82,13, 87,8, 92,10, 92,21],
  [112,10, 106,8, 101,11, 100,17, 103,21, 108,20, 112,14], [112,8, 112,25, 109,30, 103,31, 100,28],
] };
const tools: Word = { label: "tools,", strokes: [...tool.strokes, [84,10, 79,8, 74,11, 76,15, 82,16, 84,19, 80,22, 74,20], [94,21, 92,27]] };
const without: Word = { label: "without", strokes: [
  [0,9, 4,21, 10,11, 15,21, 21,8], [29,9, 29,21], [29,3, 29.2,3.4],
  [42,1, 41,19, 44,21, 47,19], [36,8, 48,8], [56,0, 55,21, 56,12, 60,8, 64,10, 64,21],
  [84,10, 79,8, 74,10, 72,15, 74,20, 79,22, 84,19, 86,14, 84,10],
  [95,9, 95,18, 98,21, 103,20, 107,14], [107,8, 107,21],
  [121,1, 120,19, 123,21, 126,19], [115,8, 127,8],
] };
const any: Word = { label: "any", strokes: [...a.strokes,
  [23,8, 23,21, 23,13, 28,8, 33,10, 33,21], [42,9, 45,19, 50,21, 56,9, 53,23, 50,30, 44,32, 41,29],
] };
const specific: Word = { label: "specific", strokes: [
  [12,10, 7,8, 2,11, 4,15, 10,16, 12,19, 8,22, 2,20],
  [22,9, 22,31], [22,12, 27,8, 33,10, 35,15, 33,20, 27,22, 22,19],
  [43,15, 54,13, 51,8, 46,9, 42,14, 43,19, 47,22, 54,20],
  [76,10, 70,8, 64,12, 63,17, 67,21, 73,21, 77,18], [85,9, 85,21], [85,3, 85.2,3.4],
  [105,1, 101,0, 98,4, 98,21], [94,9, 104,9], [113,9, 113,21], [113,3, 113.2,3.4],
  [136,10, 130,8, 124,12, 123,17, 127,21, 133,21, 137,18],
] };
const fonts: Word = { label: "fonts", strokes: [
  [11,1, 7,0, 4,4, 4,21], [0,9, 10,9],
  [28,10, 23,8, 18,10, 16,15, 18,20, 23,22, 28,19, 30,14, 28,10],
  [39,8, 39,21, 39,13, 44,8, 49,10, 49,21],
  [63,1, 62,19, 65,21, 68,19], [57,8, 69,8],
  [89,10, 84,8, 79,11, 81,15, 87,16, 89,19, 85,22, 79,20],
] };
const texts: Word = { label: "texts.", strokes: [
  [5,1, 4,19, 7,21, 10,19], [0,8, 11,8],
  [17,15, 28,13, 25,8, 20,9, 16,14, 17,19, 21,22, 28,20],
  [37,9, 49,21], [49,9, 37,21], [62,1, 61,19, 64,21, 67,19], [56,8, 68,8],
  [88,10, 83,8, 78,11, 80,15, 86,16, 88,19, 84,22, 78,20], [99,21, 99.2,21.4],
] };

const lines = [[hey], [thisWord, is, a, first, testing], [using, only, pencil, tool], [and, writing, tools], [without, using, any, specific], [fonts, and, texts]];

export function pencilStudy(): { label: string; strokes: Pt[][] }[] {
  return lines.flatMap((words, line) => {
    const scale = line === 0 ? 3.1 : 1.75;
    let left = 150;
    const top = line === 0 ? 110 : 235 + (line - 1) * 93;
    return words.map((word) => {
      const strokes = word.strokes.map((path, pathIndex) => {
        const points: Pt[] = [];
        for (let i = 0; i < path.length; i += 2) {
          points.push({ x: left + path[i] * scale, y: top + path[i + 1] * scale, p: 0.42 + 0.12 * Math.sin(i + pathIndex) });
        }
        return points;
      });
      left += (Math.max(...word.strokes.flatMap((path) => path.filter((_, i) => i % 2 === 0))) + 13) * scale;
      return { label: word.label, strokes };
    });
  });
}

export async function runPencilStudy(call: (name: string, input?: Record<string, unknown>) => Promise<unknown>) {
  const check = (result: unknown) => {
    if (result && typeof result === "object" && "error" in result) throw new Error(String(result.error));
  };
  check(await call("pick_pen", { kind: "pencil", color: "auto", width: 2.5, opacity: 0.93 }));
  for (const word of pencilStudy()) check(await call("draw", word));
}
