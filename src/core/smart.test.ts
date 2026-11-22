// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Note, Song, Track } from "./model";
import { AUTO_ID, autoMelody, combineSongs, mergeSongs, suggestWithAuto, withAutoMelody } from "./smart";
import { suggestHands } from "./arrange";
import { importWithAlphaTab } from "./importAlphaTab";

const line = (pitches: number[], bar: number, step = 0.5): Note[] => pitches.map((p, i) => ({ pitch: p, start: bar * 4 + i * step, dur: step, vel: 100 }));
const power = (root: number, bar: number): Note[] =>
  Array.from({ length: 8 }, (_, i) => [root, root + 7, root + 12].map((p) => ({ pitch: p, start: bar * 4 + i * 0.5, dur: 0.5, vel: 100 }))).flat();
const track = (id: string, name: string, program: number | null, notes: Note[], role: Track["role"] = "harmony"): Track => ({ id, name, program, isPercussion: false, role, notes });

// Estilo Iron Maiden: dos guitarras armonizadas en terceras, una rítmica con power chords, voz y bajo.
const lead1 = [64, 66, 67, 69, 71, 69, 67, 66];
const lead2 = lead1.map((p) => p - 3);
const maiden: Song = {
  title: "Gemelas",
  artist: "",
  source: "guitar-pro",
  tempos: [{ beat: 0, bpm: 160 }],
  timeSignature: [4, 4],
  tracks: [
    track("g1", "Dave", 29, [...line(lead1, 0), ...line(lead1, 3)]),
    track("g2", "Adrian", 29, [...line(lead2, 0), ...line(lead2, 3)]),
    track("g3", "Janick", 30, [0, 1, 2, 3].flatMap((b) => power(40, b))),
    track("v", "Vocals", 53, [...line([69, 71, 72, 71], 1, 1), ...line([67, 69, 71, 67], 2, 1)], "melody"),
    track("b", "Bass", 33, [0, 1, 2, 3].flatMap((b) => line([28, 28, 28, 28, 28, 28, 28, 28], b)), "bass"),
  ],
};

describe("melodía automática", () => {
  it("toma la voz al cantar y las guitarras gemelas en las partes instrumentales", () => {
    const auto = autoMelody(maiden)!;
    const bars = (b: number) => auto.track.notes.filter((n) => n.start >= b * 4 && n.start < b * 4 + 4).map((n) => n.pitch);
    expect(new Set(bars(0))).toEqual(new Set([...lead1, ...lead2]));
    expect(bars(1)).toEqual([69, 71, 72, 71]);
    expect(bars(2)).toEqual([67, 69, 71, 67]);
    expect(new Set(bars(3))).toEqual(new Set([...lead1, ...lead2]));
    expect(auto.sources.map((s) => s.name)).not.toContain("Janick"); // la rítmica no entra
  });

  it("sin voz ni guitarras líderes, un riff de power chords queda en su fundamental", () => {
    const song: Song = { ...maiden, tracks: [track("r", "Rhythm", 30, power(40, 0)), track("x", "Guitar 2", 30, power(45, 0).map((n) => ({ ...n, start: n.start })))] };
    const auto = autoMelody(song)!;
    expect(auto.track.notes.every((n) => n.pitch === 40 || n.pitch === 45)).toBe(true);
  });

  it("una sola pista no necesita melodía automática", () => {
    expect(autoMelody({ ...maiden, tracks: [maiden.tracks[0]] })).toBeNull();
  });

  it("la reparte: melodía a la derecha, bajo a la izquierda, lo demás fuera", () => {
    const { song } = withAutoMelody(maiden);
    expect(song.tracks[0].id).toBe(AUTO_ID);
    const hands = suggestWithAuto(song, suggestHands);
    expect(hands[AUTO_ID]).toBe("right");
    expect(hands.b).toBe("left");
    expect(hands.g1).toBe("off");
    expect(withAutoMelody(song).song.tracks.filter((t) => t.id === AUTO_ID)).toHaveLength(1);
  });

  it("funciona con un Guitar Pro real (voz + guitarras + orquesta)", () => {
    const song = importWithAlphaTab(new Uint8Array(readFileSync("test-data/nightwish.gp5")), "nightwish.gp5");
    const auto = autoMelody(song)!;
    expect(auto.sources[0].vocal).toBe(true);
    expect(auto.sources.some((s) => !s.vocal)).toBe(true);
  });
});

describe("juntar partes", () => {
  const tabA: Song = { ...maiden, title: "Tablatura", source: "tab", tracks: [track("t0", "Tablatura", 29, line([40, 43, 45], 0))] };
  const tabB: Song = { ...maiden, title: "Tablatura", source: "tab", tracks: [track("t0", "Tablatura", 29, line([52, 55], 0))] };

  it("añade otra parte con un desplazamiento y un nombre", () => {
    const m = mergeSongs(tabA, tabB, 8, "Guitarra 2", true);
    expect(m.tracks.map((t) => t.name)).toEqual(["Tablatura", "Guitarra 2"]);
    expect(new Set(m.tracks.map((t) => t.id)).size).toBe(2);
    expect(m.tracks[1].notes[0].start).toBe(8);
    const m2 = mergeSongs(m, tabB, 0, "Guitarra 3", true);
    expect(new Set(m2.tracks.map((t) => t.id)).size).toBe(3);
  });

  it("combina varios archivos en una canción", () => {
    const c = combineSongs([maiden, tabB]);
    expect(c.title).toBe("Gemelas");
    expect(c.tracks).toHaveLength(maiden.tracks.length + 1);
    expect(new Set(c.tracks.map((t) => t.id)).size).toBe(c.tracks.length);
  });
});

import { searchLinks } from "../lib/platform";
describe("búsqueda", () => {
  it("arma los enlaces a tabs gratis", () => {
    const l = searchLinks(" Iron Maiden The Wicker Man ");
    expect(l.tabs).toBe("https://www.ultimate-guitar.com/search.php?search_type=title&value=Iron%20Maiden%20The%20Wicker%20Man&type=200");
    expect(l.youtube).toContain("Wicker%20Man%20piano");
  });
});
