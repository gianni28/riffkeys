// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import * as alphaTab from "@coderline/alphatab";
import { importWithAlphaTab } from "./importAlphaTab";
import { importMidi } from "./importMidi";
import { parseAsciiTab } from "./importTab";
import { arrange, dedupe, playable, suggestHands } from "./arrange";
import { toMidi } from "./exportMidi";
import { splitDuration, toMusicXml, toSegments } from "./exportMusicXml";
import { estimateKey, pitchName } from "./key";
import { beatToSeconds, normalizeTempos, secondsToBeat } from "./tempo";
import { EXAMPLE_TAB } from "./example";

const bytes = (f: string) => new Uint8Array(readFileSync(`test-data/${f}`));

describe("tempo", () => {
  const tempos = normalizeTempos([{ beat: 0, bpm: 120 }, { beat: 8, bpm: 60 }]);
  it("convierte negras a segundos con cambios de tempo", () => {
    expect(beatToSeconds(4, tempos)).toBeCloseTo(2);
    expect(beatToSeconds(10, tempos)).toBeCloseTo(4 + 2);
    expect(beatToSeconds(4, tempos, 0.5)).toBeCloseTo(4);
  });
  it("secondsToBeat es la inversa", () => {
    for (const b of [0, 3, 8, 9.5]) expect(secondsToBeat(beatToSeconds(b, tempos), tempos)).toBeCloseTo(b);
  });
  it("siempre empieza en el beat 0", () => {
    expect(normalizeTempos([{ beat: 4, bpm: 90 }])[0]).toEqual({ beat: 0, bpm: 90 });
  });
});

describe("tablatura en texto", () => {
  it("lee afinación estándar, trastes de dos cifras y barras", () => {
    const tab = ["e|-----|------|", "B|-----|------|", "G|-----|------|", "D|-----|------|", "A|-----|--12--|", "E|-0---|------|"].join("\n");
    const { song, tuning } = parseAsciiTab(tab, { charsPerBeat: 4 });
    expect(tuning).toEqual([64, 59, 55, 50, 45, 40]);
    const notes = song.tracks[0].notes;
    expect(notes.map((n) => n.pitch)).toEqual([40, 57]); // Mi2 y La2+12
    expect(notes[1].start).toBeCloseTo(7 / 4); // 5 columnas + 2 guiones (las barras no cuentan)
  });
  it("respeta afinaciones bajadas escritas en las etiquetas", () => {
    const tab = ["e|------|", "B|------|", "G|------|", "D|------|", "A|------|", "D|0-----|"].join("\n");
    const { tuning, song } = parseAsciiTab(tab);
    expect(tuning[5]).toBe(38); // Drop D
    expect(song.tracks[0].notes[0].pitch).toBe(38);
  });
  it("reconoce un bajo de 4 cuerdas", () => {
    const tab = ["G|-------|", "D|-------|", "A|-------|", "E|-3-----|"].join("\n");
    const { song } = parseAsciiTab(tab);
    expect(song.tracks[0].role).toBe("bass");
    expect(song.tracks[0].notes[0].pitch).toBe(31);
  });
  it("explica el error si no hay tab", () => {
    expect(() => parseAsciiTab("hola")).toThrow(/No encontré/);
  });
  it("el ejemplo incluido se puede leer", () => {
    const { song } = parseAsciiTab(EXAMPLE_TAB.text, EXAMPLE_TAB.options);
    expect(song.tracks[0].notes.length).toBeGreaterThan(30);
  });
});

describe("Guitar Pro y MusicXML (alphaTab)", () => {
  it("importa un Guitar Pro 5 con varias pistas", () => {
    const song = importWithAlphaTab(bytes("nightwish.gp5"), "nightwish.gp5");
    expect(song.source).toBe("guitar-pro");
    expect(song.tracks.length).toBeGreaterThan(3);
    expect(song.tempos[0].bpm).toBe(95);
    const voice = song.tracks.find((t) => /voice/i.test(t.name))!;
    expect(voice.role).toBe("melody");
    expect(song.tracks.some((t) => t.role === "bass")).toBe(true);
  });
  it("importa MusicXML de piano", () => {
    const song = importWithAlphaTab(bytes("MozartPianoSonata.xml"), "MozartPianoSonata.xml");
    expect(song.source).toBe("musicxml");
    expect(song.tracks[0].notes.length).toBe(70);
  });
});

describe("arreglo para dos manos", () => {
  const song = importWithAlphaTab(bytes("nightwish.gp5"), "nightwish.gp5");
  const hands = suggestHands(song);
  const arr = arrange(song, hands);

  it("sugiere melodía a la derecha, bajo a la izquierda y apaga la batería", () => {
    const byRole = (r: string) => song.tracks.filter((t) => t.role === r).map((t) => hands[t.id]);
    expect(byRole("melody")).toContain("right");
    expect(byRole("bass")).toContain("left");
    byRole("drums").forEach((h) => expect(h).toBe("off"));
  });
  it("cada mano queda en su registro", () => {
    arr.right.forEach((n) => expect(n.pitch).toBeGreaterThanOrEqual(55));
    arr.left.forEach((n) => expect(n.pitch).toBeLessThanOrEqual(64));
    expect(arr.right.length).toBeGreaterThan(0);
    expect(arr.left.length).toBeGreaterThan(0);
  });
  it("ningún acorde supera el máximo de notas", () => {
    const counts = new Map<number, number>();
    arr.left.forEach((n) => counts.set(Math.round(n.start * 100), (counts.get(Math.round(n.start * 100)) ?? 0) + 1));
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(4);
  });
  it("dividir manda los graves a la izquierda", () => {
    const tab = parseAsciiTab(EXAMPLE_TAB.text, EXAMPLE_TAB.options).song;
    expect(suggestHands(tab)).toEqual({ t0: "split" });
    const a = arrange(tab, { t0: "split" });
    expect(a.left.length).toBeGreaterThan(0);
    expect(a.right.length).toBeGreaterThan(0);
  });
  it("transponer mueve todo por igual", () => {
    const up = arrange(song, hands, { transpose: 2 });
    expect(up.right.length).toBe(arr.right.length);
  });
  it("dedupe une notas dobladas", () => {
    const out = dedupe([
      { pitch: 60, start: 0, dur: 1, vel: 80 },
      { pitch: 60, start: 0, dur: 2, vel: 100 },
      { pitch: 60, start: 1.5, dur: 1, vel: 80 },
    ]);
    expect(out).toEqual([
      { pitch: 60, start: 0, dur: 1.5, vel: 100 },
      { pitch: 60, start: 1.5, dur: 1, vel: 80 },
    ]);
  });
  it("playable respeta la abertura de la mano", () => {
    const chord = [36, 48, 55, 60, 64, 67].map((p) => ({ pitch: p, start: 0, dur: 1, vel: 80 }));
    const left = playable(chord, 4, 14, "left").map((n) => n.pitch);
    expect(left[0]).toBe(36);
    expect(Math.max(...left) - 36).toBeLessThanOrEqual(14);
  });
});

describe("exportar", () => {
  const song = parseAsciiTab(EXAMPLE_TAB.text, EXAMPLE_TAB.options).song;
  const arr = arrange(song, { t0: "left" });

  it("el MIDI se vuelve a leer con las mismas notas", () => {
    const midi = new Midi(toMidi(arr));
    expect(midi.tracks.map((t) => t.name)).toEqual(["Mano derecha", "Mano izquierda"]);
    expect(midi.tracks[1].notes.length).toBe(arr.left.length);
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(EXAMPLE_TAB.options.bpm);
    const back = importMidi(toMidi(arr));
    expect(back.tracks[0].notes[0].pitch).toBe(arr.left[0].pitch);
  });

  it("el MusicXML es válido para alphaTab y conserva las notas", () => {
    const xml = toMusicXml(arr);
    expect(xml).toContain("<staves>2</staves>");
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), new alphaTab.Settings());
    expect(score.tracks[0].staves.length).toBe(2);
    const back = importWithAlphaTab(new TextEncoder().encode(xml), "a.musicxml");
    // La cuantización puede unir notas repetidas en acordes, pero todas las alturas siguen ahí.
    const pcs = (ns: { pitch: number }[]) => new Set(ns.map((n) => n.pitch));
    expect(pcs(back.tracks[0].notes)).toEqual(pcs(arr.left));
  });

  it("los compases suman exactamente su duración", () => {
    const segs = toSegments(arr.left, 64);
    expect(segs.reduce((s, x) => s + x.len, 0)).toBe(64);
    expect(splitDuration(1, 7).reduce((s, d) => s + d.units, 0)).toBe(7);
  });
});

describe("tonalidad", () => {
  it("reconoce Mi menor en un riff de Mi menor", () => {
    const riff = [40, 43, 45, 47, 40, 52, 55, 47].map((p, i) => ({ pitch: p, start: i, dur: 1, vel: 80 }));
    const k = estimateKey(riff);
    expect(k.tonic).toBe(4);
    expect(k.mode).toBe("minor");
    expect(k.fifths).toBe(1);
  });
  it("nombres de notas", () => {
    expect(pitchName(60)).toBe("C4");
    expect(pitchName(70, true)).toBe("Bb4");
  });
});
