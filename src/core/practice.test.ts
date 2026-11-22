// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Arrangement } from "./model";
import { PracticeScorer, timedNotes, waitChords } from "./practice";
import { addOctaves, simplifyRepeats } from "./arrange";
import { barLength, barStarts, beatToSeconds, bpmAt } from "./tempo";
import { nearestSample } from "../audio/piano";

const arr: Arrangement = {
  title: "t",
  artist: "",
  tempos: [{ beat: 0, bpm: 60 }],
  timeSignature: [4, 4],
  right: [
    { pitch: 72, start: 0, dur: 1, vel: 90 },
    { pitch: 76, start: 0, dur: 1, vel: 90 },
    { pitch: 74, start: 1, dur: 1, vel: 90 },
  ],
  left: [{ pitch: 48, start: 0, dur: 2, vel: 90 }],
  length: 2,
};

describe("práctica", () => {
  it("timedNotes ordena y pasa a segundos", () => {
    const n = timedNotes(arr);
    expect(n.map((x) => x.pitch)).toEqual([48, 72, 76, 74]);
    expect(n[3].s).toBe(1);
    expect(n.map((x) => x.i)).toEqual([0, 1, 2, 3]);
  });
  it("waitChords agrupa solo las manos elegidas", () => {
    expect(waitChords(arr, ["right"])).toEqual([
      { beat: 0, pitches: [72, 76] },
      { beat: 1, pitches: [74] },
    ]);
    expect(waitChords(arr, ["left", "right"])[0].pitches.sort()).toEqual([48, 72, 76]);
  });
  it("cuenta aciertos, fallos y notas de más", () => {
    const s = new PracticeScorer(timedNotes(arr), ["right"], 0.2);
    s.reset(0);
    expect(s.noteOn(72, 0.05)).toBe(true);
    expect(s.noteOn(60, 0.1)).toBe(false); // tecla equivocada
    s.advance(0.5); // 76 nunca se tocó
    expect(s.noteOn(74, 0.9)).toBe(true);
    s.advance(2);
    expect(s.stats).toMatchObject({ hits: 2, misses: 1, wrong: 1, streak: 1, best: 1 });
    expect(s.stats.accuracy).toBe(Math.round((100 * 2) / (3 + 0.5)));
  });
  it("una nota no cuenta dos veces y fuera de la ventana es error", () => {
    const s = new PracticeScorer(timedNotes(arr), ["right"], 0.2);
    s.reset(0);
    expect(s.noteOn(72, 0)).toBe(true);
    expect(s.noteOn(72, 0.05)).toBe(false);
    expect(s.noteOn(74, 0.5)).toBe(false);
  });
  it("rewind borra el pasaje para repetirlo sin perder estadísticas", () => {
    const s = new PracticeScorer(timedNotes(arr), ["right"], 0.2);
    s.reset(0);
    s.noteOn(72, 0);
    s.advance(2);
    const misses = s.stats.misses;
    s.rewind(0);
    expect(s.result.size).toBe(0);
    expect(s.stats.misses).toBe(misses);
    expect(s.noteOn(76, 0)).toBe(true);
  });
});

describe("arreglo: opciones de metal", () => {
  it("simplifica semicorcheas repetidas a corcheas", () => {
    const chug = Array.from({ length: 8 }, (_, i) => ({ pitch: 40, start: i * 0.25, dur: 0.25, vel: 90 }));
    const out = simplifyRepeats(chug);
    expect(out.map((n) => n.start)).toEqual([0, 0.5, 1, 1.5]);
    expect(out.every((n) => n.dur === 0.5)).toBe(true);
  });
  it("no toca notas distintas", () => {
    const riff = [40, 43, 45, 40].map((p, i) => ({ pitch: p, start: i * 0.25, dur: 0.25, vel: 90 }));
    expect(simplifyRepeats(riff)).toHaveLength(4);
  });
  it("dobla en octavas las notas sueltas", () => {
    const out = addOctaves([
      { pitch: 45, start: 0, dur: 1, vel: 100 },
      { pitch: 40, start: 1, dur: 1, vel: 100 },
      { pitch: 47, start: 1, dur: 1, vel: 100 },
    ]);
    expect(out.filter((n) => n.start === 0).map((n) => n.pitch)).toEqual([33, 45]);
    expect(out.filter((n) => n.start === 1)).toHaveLength(2); // los acordes se dejan igual
  });
});

describe("tempo y compases", () => {
  const tempos = [
    { beat: 0, bpm: 120 },
    { beat: 8, bpm: 60 },
  ];
  it("antes del inicio sigue el primer tempo (cuenta previa)", () => {
    expect(beatToSeconds(-2, tempos)).toBeCloseTo(-1);
  });
  it("tempo vigente y compases", () => {
    expect(bpmAt(9, tempos)).toBe(60);
    expect(bpmAt(2, tempos)).toBe(120);
    expect(barLength([6, 8])).toBe(3);
    expect(barStarts(8, [4, 4])).toEqual([0, 4, 8]);
  });
});

describe("piano sampleado", () => {
  it("usa la muestra más cercana (cada tres semitonos)", () => {
    expect(nearestSample(60)).toBe(60);
    expect(nearestSample(61)).toBe(60);
    expect(nearestSample(62)).toBe(63);
    expect(nearestSample(10)).toBe(21);
    expect(nearestSample(127)).toBe(108);
  });
});
