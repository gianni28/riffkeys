// @vitest-environment node
import { describe, expect, it } from "vitest";
import { audioToSong, estimateBpm, skyline, type HeardNote } from "./fromAudio";

const at = (start: number, pitch: number, dur = 0.3, amp = 0.8): HeardNote => ({ start, dur, pitch, amp });

describe("de audio a piano", () => {
  it("estima el tempo de un patrón regular", () => {
    const beat = 60 / 100;
    const notes = Array.from({ length: 64 }, (_, i) => at(i * beat, 60 + (i % 4), 0.2, i % 4 === 0 ? 1 : 0.6));
    expect(Math.abs(estimateBpm(notes) - 100)).toBeLessThanOrEqual(2);
  });

  it("la línea de arriba se queda con la nota más aguda de cada acorde", () => {
    const notes = [at(0, 60), at(0, 64), at(0, 67), at(0.5, 62), at(0.5, 69)];
    expect(skyline(notes, "top").map((n) => n.pitch)).toEqual([67, 69]);
    expect(skyline(notes, "bottom").map((n) => n.pitch)).toEqual([60, 62]);
  });

  it("una nota nueva no la tapa otra más aguda que ya venía sonando", () => {
    const out = skyline([at(0, 84, 0.6), at(0.5, 81, 0.6), at(1, 78, 0.6)], "top");
    expect(out.map((n) => n.pitch)).toEqual([84, 81, 78]);
  });

  it("la melodía es monofónica: una nota corta a la anterior", () => {
    const out = skyline([at(0, 72, 1), at(0.4, 74, 1)], "top");
    expect(out[0].dur).toBeCloseTo(0.4);
  });

  it("arma melodía, bajo y todo, descartando ruido débil", () => {
    const song = audioToSong([at(0, 40, 0.5), at(0, 72, 0.5), at(0.5, 43, 0.5), at(0.5, 74, 0.5), at(0.2, 90, 0.2, 0.1)], "Prueba");
    expect(song.source).toBe("audio");
    expect(song.tracks.map((t) => t.id)).toEqual(["melodia", "bajo", "todo"]);
    expect(song.tracks[0].notes.map((n) => n.pitch)).toEqual([72, 74]);
    expect(song.tracks[1].notes.map((n) => n.pitch)).toEqual([40, 43]);
    expect(song.tracks[2].notes.some((n) => n.pitch === 90)).toBe(false);
  });
});
