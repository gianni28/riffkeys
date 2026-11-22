// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fft, frameCount, HOP, KEEP_BINS, magnitudes, N_FFT, onsetEnvelope, SR, synthesize } from "./dsp";
import { estimatePeriod, secondsToBeatGrid, smoothBeats, trackBeats } from "./beats";
import { beatChroma, detectChords, estimateKeyFromChroma } from "./chords";
import { buildCover, cleanLine, dropLonelyBars, leftHandFromChords } from "./build";

const sine = (len: number, freqs: number[], amp = 0.3) => new Float32Array(len).map((_, i) => freqs.reduce((a, f) => a + amp * Math.sin((2 * Math.PI * f * i) / SR), 0));
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

describe("dsp", () => {
  it("FFT ida y vuelta", () => {
    const re = new Float32Array(16).map((_, i) => Math.sin(i));
    const orig = re.slice();
    const im = new Float32Array(16);
    fft(re, im);
    fft(re, im, true);
    re.forEach((v, i) => expect(v / 16).toBeCloseTo(orig[i], 4));
  });

  it("la resíntesis sin máscara reconstruye la señal", () => {
    const x = sine(SR, [220, 330]);
    const frames = frameCount(x.length);
    const re = new Float32Array(frames * KEEP_BINS);
    const im = new Float32Array(frames * KEEP_BINS);
    const fr = new Float32Array(N_FFT);
    const fi = new Float32Array(N_FFT);
    const win = new Float32Array(N_FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
    for (let f = 0; f < frames; f++) {
      for (let i = 0; i < N_FFT; i++) {
        const k = f * HOP - N_FFT / 2 + i;
        fr[i] = k >= 0 && k < x.length ? x[k] * win[i] : 0;
        fi[i] = 0;
      }
      fft(fr, fi);
      re.set(fr.subarray(0, KEEP_BINS), f * KEEP_BINS);
      im.set(fi.subarray(0, KEEP_BINS), f * KEEP_BINS);
    }
    const y = synthesize(re, im, frames, x.length, () => 1);
    for (let i = N_FFT; i < x.length - N_FFT; i += 997) expect(y[i]).toBeCloseTo(x[i], 3);
  });
});

describe("pulso", () => {
  // Clics cada 0,5 s (120 bpm) con un pequeño desfase.
  const clicks = (bpm: number, seconds: number) => {
    const x = new Float32Array(SR * seconds);
    const step = (60 / bpm) * SR;
    for (let t = 0.13 * SR; t < x.length; t += step) for (let i = 0; i < 200; i++) x[Math.round(t) + i] = (Math.random() * 2 - 1) * Math.exp(-i / 40);
    return x;
  };

  it("encuentra el tempo y los pulsos de un metrónomo", () => {
    const x = clicks(120, 20);
    const { mag, frames } = magnitudes(x);
    const env = onsetEnvelope(mag, frames);
    const period = estimatePeriod(env);
    expect((60 * (SR / HOP)) / period).toBeCloseTo(120, -1);
    const beats = trackBeats(env, period);
    expect(beats.length).toBeGreaterThan(30);
    const ivs = beats.slice(1).map((b, i) => b - beats[i]);
    const med = ivs.sort((a, b) => a - b)[ivs.length >> 1];
    expect(med).toBeCloseTo(0.5, 1);
    // Caen sobre los clics (0,13 + k·0,5) con menos de 30 ms de error.
    for (const b of beats.slice(2, -2)) expect(Math.abs(((b - 0.13 + 0.25) % 0.5) - 0.25)).toBeLessThan(0.03);
  });

  it("pasa de segundos a pulsos sobre la rejilla", () => {
    const toBeat = secondsToBeatGrid([1, 1.5, 2, 2.5]);
    expect(toBeat(1.25)).toBeCloseTo(0.5);
    expect(toBeat(0.5)).toBeCloseTo(-1);
    expect(toBeat(3)).toBeCloseTo(4);
    const ext = smoothBeats([1, 1.5, 2, 2.5, 3], 4);
    expect(ext[ext.length - 1]).toBeGreaterThanOrEqual(4);
  });
});

describe("acordes", () => {
  it("reconoce Mi menor, Do y Re a partir del audio", () => {
    const beat = 0.5;
    const progression = [
      [40, 52, 55, 59], // Em: Mi grave + Mi Sol Si
      [36, 48, 52, 55], // C
      [38, 50, 54, 57], // D
    ];
    const parts = progression.flatMap((ch) => Array.from({ length: 4 }, () => sine(SR * beat, ch.map(hz), 0.2)));
    const x = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
      x.set(p, o);
      o += p.length;
    }
    const bass = sine(x.length, []).map((_, i) => x[i]);
    const beats = Array.from({ length: 12 }, (_, i) => i * beat);
    const ch = beatChroma(x, bass, beats);
    const key = estimateKeyFromChroma(ch.map((c) => c.full));
    const chords = detectChords(ch, key);
    const names = chords.map((c) => `${c.root}${c.minor ? "m" : ""}`);
    expect(names.slice(0, 4)).toEqual(["4m", "4m", "4m", "4m"]);
    expect(names.slice(5, 8)).toEqual(["0", "0", "0"]);
    expect(names.slice(9, 12)).toEqual(["2", "2", "2"]);
  });
});

describe("armar el cover", () => {
  const toBeat = (s: number) => s * 2; // 120 bpm
  it("limpia una línea: cuantiza, corrige octavas y une notas partidas", () => {
    const notes = cleanLine(
      [
        { start: 0.02, dur: 0.2, pitch: 64, amp: 0.8 },
        { start: 0.26, dur: 0.2, pitch: 64, amp: 0.6 }, // la misma nota partida
        { start: 0.5, dur: 0.24, pitch: 67, amp: 0.8 },
        { start: 0.75, dur: 0.24, pitch: 81, amp: 0.8 }, // octava equivocada (69 + 12)
        { start: 1.0, dur: 0.24, pitch: 67, amp: 0.8 },
        { start: 1.25, dur: 0.24, pitch: 66, amp: 0.8 },
      ],
      toBeat,
      { lo: 50, hi: 90, minAmp: 0.3 },
    );
    expect(notes.map((n) => n.pitch)).toEqual([64, 67, 69, 67, 66]);
    expect(notes[0].start).toBe(0);
    expect(notes[0].dur).toBeCloseTo(1);
  });

  it("quita compases con una sola nota", () => {
    const n = (start: number) => ({ pitch: 60, start, dur: 0.5, vel: 80 });
    expect(dropLonelyBars([n(0), n(1), n(5)]).map((x) => x.start)).toEqual([0, 1]);
  });

  it("la izquierda sigue los acordes en octavas", () => {
    const lh = leftHandFromChords(
      [
        { root: 4, minor: true, conf: 1 },
        { root: 4, minor: true, conf: 1 },
        { root: 0, minor: false, conf: 1 },
      ],
      0,
      100,
    );
    expect(lh.filter((n) => n.start === 0).map((n) => n.pitch)).toEqual([40, 52]);
    expect(lh.filter((n) => n.start === 2).map((n) => n.pitch)).toEqual([36, 48]);
    expect(lh.every((n) => n.pitch >= 36 && n.pitch < 60)).toBe(true);
  });

  it("arma la canción con tempo real y reparte las manos", () => {
    const beats = Array.from({ length: 33 }, (_, i) => 0.3 + i * 0.5);
    const chords = beats.map((_, i) => ({ root: i < 16 ? 4 : 0, minor: i < 16, conf: 1 }));
    const vocals = Array.from({ length: 24 }, (_, i) => ({ start: 0.3 + i * 0.5, dur: 0.4, pitch: [64, 67, 69, 71][i % 4], amp: 0.8 }));
    const { song } = buildCover({ title: "Prueba", beats, phase: 1, chords, vocals, lead: [], bass: [] });
    expect(song.source).toBe("audio");
    expect(song.tempos[1].bpm).toBeCloseTo(120);
    const ids = song.tracks.map((t) => t.id);
    expect(ids).toContain("melodia");
    expect(ids).toContain("izquierda");
    // Con fase 1 se agregan 3 pulsos de entrada para que el «1» caiga en múltiplo de 4.
    const lh = song.tracks.find((t) => t.id === "izquierda")!;
    expect(lh.notes[0].start).toBe(3);
  });
});
