import type { Note, Song, TempoChange, Track } from "../model";
import { skyline, type HeardNote } from "../fromAudio";
import { autoMelody } from "../smart";
import { secondsToBeatGrid } from "./beats";
import type { Chord } from "./chords";

export interface CoverInput {
  title: string;
  /** Pulsos en segundos (suavizados). */
  beats: number[];
  /** En qué pulso cae el primer «1» (0–3). */
  phase: number;
  /** Un acorde por pulso. */
  chords: Chord[];
  vocals: HeardNote[];
  lead: HeardNote[];
  bass: HeardNote[];
}

const NAMES = ["Do", "Do#", "Re", "Mib", "Mi", "Fa", "Fa#", "Sol", "Lab", "La", "Sib", "Si"];
export const chordName = (c: Chord) => `${NAMES[c.root]}${c.minor ? "m" : ""}`;

const q = (x: number, step: number) => Math.round(x / step) * step;

/** Notas detectadas (segundos) → notas en pulsos, cuantizadas y limpias, una a la vez. */
export function cleanLine(
  heard: HeardNote[],
  toBeat: (s: number) => number,
  { lo, hi, minAmp, dir = "top" as "top" | "bottom", grid = 0.25 }: { lo: number; hi: number; minAmp: number; dir?: "top" | "bottom"; grid?: number },
): Note[] {
  const line = skyline(
    heard.filter((n) => n.pitch >= lo && n.pitch <= hi && n.amp >= minAmp),
    dir,
    0.07,
  );
  let notes: (Note & { amp: number })[] = [];
  for (const n of line) {
    const s = q(toBeat(n.start), grid);
    const e = Math.max(s + grid, q(toBeat(n.start + n.dur), grid));
    if (s < 0) continue;
    const prev = notes[notes.length - 1];
    if (prev && Math.abs(prev.start - s) < 1e-6) {
      // Dos notas cayeron en el mismo casillero: se queda la más fuerte.
      if (n.amp > prev.amp) notes[notes.length - 1] = { pitch: n.pitch, start: s, dur: e - s, vel: 0, amp: n.amp };
      continue;
    }
    notes.push({ pitch: n.pitch, start: s, dur: e - s, vel: 0, amp: n.amp });
  }
  // Octavas equivocadas: si una nota salta lejos de sus vecinas y una octava la acerca, se corrige.
  for (let i = 0; i < notes.length; i++) {
    const near = notes.slice(Math.max(0, i - 6), i + 7).filter((_, k) => k !== Math.min(6, i)).map((n) => n.pitch);
    if (near.length < 3) continue;
    const med = [...near].sort((a, b) => a - b)[near.length >> 1];
    const p = notes[i].pitch;
    if (Math.abs(p - med) > 9) {
      if (Math.abs(p - 12 - med) < 6) notes[i].pitch -= 12;
      else if (Math.abs(p + 12 - med) < 6) notes[i].pitch += 12;
    }
  }
  // Une la misma nota partida en dos (pasa mucho con notas largas de la voz).
  const merged: typeof notes = [];
  for (const n of notes) {
    const prev = merged[merged.length - 1];
    if (prev && prev.pitch === n.pitch && n.start - (prev.start + prev.dur) < grid / 2 && n.amp < prev.amp * 1.1) {
      prev.dur = n.start + n.dur - prev.start;
      continue;
    }
    if (prev && prev.start + prev.dur > n.start) prev.dur = Math.max(grid, n.start - prev.start);
    merged.push({ ...n });
  }
  notes = merged;
  // Notas sueltas lejos de todo suelen ser ruido.
  notes = notes.filter((n, i) => {
    const a = notes[i - 1];
    const b = notes[i + 1];
    const near = (a && n.start - (a.start + a.dur) < 1.5) || (b && b.start - (n.start + n.dur) < 1.5);
    return near || n.dur > 0.5;
  });
  return notes.map((n) => ({ pitch: n.pitch, start: n.start, dur: n.dur, vel: Math.round(60 + 60 * Math.min(1, n.amp)) }));
}

/** Quita los compases con una sola nota (en una voz, casi siempre es ruido de otro instrumento). */
export function dropLonelyBars(notes: Note[], perBar = 4): Note[] {
  const count = new Map<number, number>();
  for (const n of notes) count.set(Math.floor(n.start / perBar), (count.get(Math.floor(n.start / perBar)) ?? 0) + 1);
  return notes.filter((n) => (count.get(Math.floor(n.start / perBar)) ?? 0) >= 2);
}

/** Mano izquierda a partir de los acordes: octava partida en corcheas (o negras si va muy rápido). */
export function leftHandFromChords(chords: Chord[], firstBeat: number, bpm: number): Note[] {
  const out: Note[] = [];
  const fast = bpm >= 150;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const beat = firstBeat + i;
    if (beat < 0) continue;
    const low = 36 + c.root; // Do2–Si2
    const change = i === 0 || chords[i - 1].root !== c.root || beat % 4 === 0;
    const vel = beat % 4 === 0 ? 92 : 76;
    if (change) {
      out.push({ pitch: low, start: beat, dur: fast ? 1 : 0.5, vel }, { pitch: low + 12, start: beat, dur: fast ? 1 : 0.5, vel: vel - 8 });
      if (!fast) out.push({ pitch: low + 12, start: beat + 0.5, dur: 0.5, vel: vel - 14 });
    } else if (fast) {
      out.push({ pitch: i % 2 ? low + 12 : low, start: beat, dur: 1, vel });
    } else {
      out.push({ pitch: low, start: beat, dur: 0.5, vel }, { pitch: low + 12, start: beat + 0.5, dur: 0.5, vel: vel - 10 });
    }
  }
  return out;
}

/** Acordes en la derecha: tríada cerrada alrededor de Do4, cada vez que cambia el acorde o empieza compás. */
export function rightHandChords(chords: Chord[], firstBeat: number): Note[] {
  const out: Note[] = [];
  for (let i = 0; i < chords.length; i++) {
    const beat = firstBeat + i;
    if (beat < 0) continue;
    const c = chords[i];
    const change = i === 0 || chords[i - 1].root !== c.root || chords[i - 1].minor !== c.minor;
    if (!change && beat % 4 !== 0) continue;
    let len = 1;
    while (i + len < chords.length && len < 4 && chords[i + len].root === c.root && chords[i + len].minor === c.minor && (beat + len) % 4 !== 0) len++;
    const tones = [c.root, c.root + (c.minor ? 3 : 4), c.root + 7].map((p) => {
      let x = 55 + ((p - 55) % 12 + 12) % 12;
      if (x > 66) x -= 12;
      return x;
    });
    for (const p of tones) out.push({ pitch: p, start: beat, dur: len, vel: 70 });
  }
  return out;
}

const track = (id: string, name: string, role: Track["role"], notes: Note[], program: number | null = null): Track => ({
  id,
  name,
  program,
  isPercussion: false,
  role,
  notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch),
});

/**
 * Arma el cover: melodía (voz cuando canta, guitarra principal cuando no) a la
 * derecha y acompañamiento en octavas siguiendo los acordes a la izquierda,
 * todo sobre la rejilla de pulsos real de la grabación.
 */
export function buildCover(input: CoverInput): { song: Song; chordsByBeat: string[] } {
  const { beats, phase, chords } = input;
  // El «1» del primer compás completo cae en beats[phase]; se agrega un compás de entrada si hace falta.
  const offset = phase > 0 ? 4 - phase : 0;
  const grid = secondsToBeatGrid(beats);
  const toBeat = (s: number) => grid(s) + offset;
  const iv0 = beats[1] - beats[0];
  const tempos: TempoChange[] = [{ beat: 0, bpm: 60 / iv0 }];
  for (let i = 0; i + 1 < beats.length; i++) tempos.push({ beat: i + offset, bpm: Math.round((600 / (beats[i + 1] - beats[i]))) / 10 });
  const ivs = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  const bpm = 60 / ivs[ivs.length >> 1];

  const vocals = dropLonelyBars(cleanLine(input.vocals, toBeat, { lo: 50, hi: 88, minAmp: 0.3 }));
  const lead = cleanLine(input.lead, toBeat, { lo: 52, hi: 96, minAmp: 0.4 });
  const bass = cleanLine(input.bass, toBeat, { lo: 28, hi: 55, minAmp: 0.3, dir: "bottom" });

  const voiceTrack = track("voz", "Voz", "melody", vocals, 53);
  const leadTrack = track("guitarra", "Guitarra principal", "harmony", lead, 30);
  const auto = autoMelody({ title: input.title, artist: "", source: "audio", tempos, timeSignature: [4, 4], tracks: [voiceTrack, leadTrack] });
  const melody = auto?.track.notes ?? vocals;

  const tracks = [
    track("melodia", "Melodía (voz + guitarra)", "melody", melody.map((n) => ({ ...n }))),
    track("izquierda", "Acompañamiento (acordes)", "bass", leftHandFromChords(chords, offset, bpm)),
    track("acordes", "Acordes para la derecha", "harmony", rightHandChords(chords, offset)),
    track("bajo", "Bajo de la grabación", "bass", bass, 33),
    voiceTrack,
    leadTrack,
  ].filter((t) => t.notes.length);

  const song: Song = { title: input.title, artist: "", source: "audio", tempos, timeSignature: [4, 4], tracks };
  return { song, chordsByBeat: chords.map(chordName) };
}
