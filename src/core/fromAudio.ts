import type { Note, Song, Track } from "./model";

/** Nota detectada en el audio, en segundos. */
export interface HeardNote {
  start: number;
  dur: number;
  pitch: number;
  /** 0–1 */
  amp: number;
}

/**
 * Tempo aproximado a partir de los ataques: autocorrelación de una envolvente
 * de ataques (10 ms) entre 60 y 190 bpm, con preferencia suave por 90–140.
 * Si se equivoca no pasa nada grave: los tiempos de las notas no cambian,
 * solo dónde caen las líneas de compás.
 */
export function estimateBpm(notes: HeardNote[]): number {
  if (notes.length < 8) return 120;
  const step = 0.01;
  const end = Math.max(...notes.map((n) => n.start)) + 1;
  const env = new Float32Array(Math.ceil(end / step) + 1);
  for (const n of notes) env[Math.round(n.start / step)] += n.amp;
  let best = 120;
  let bestScore = -Infinity;
  for (let bpm = 60; bpm <= 190; bpm += 0.5) {
    const lag = 60 / bpm / step;
    let s = 0;
    for (const k of [1, 2, 4]) {
      const L = lag * k;
      const i0 = Math.floor(L);
      const f = L - i0;
      let acc = 0;
      for (let i = 0; i + i0 + 1 < env.length; i++) if (env[i]) acc += env[i] * (env[i + i0] * (1 - f) + env[i + i0 + 1] * f);
      s += acc / k;
    }
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 118) / 0.45) ** 2);
    if (s * prior > bestScore) {
      bestScore = s * prior;
      best = bpm;
    }
  }
  return Math.round(best);
}

/** Notas atacadas a la vez (un acorde). Una nota que ya venía sonando no tapa un ataque nuevo. */
const together = (a: HeardNote, t: number) => Math.abs(a.start - t) <= 0.06;

/**
 * Lo más agudo que suena en cada momento (la «línea del cielo»): en una
 * mezcla completa casi siempre es la voz o la guitarra principal.
 */
export function skyline(notes: HeardNote[], dir: "top" | "bottom", minDur = 0.08): HeardNote[] {
  const sorted = [...notes].filter((n) => n.dur >= minDur).sort((a, b) => a.start - b.start);
  const better = (a: HeardNote, b: HeardNote) => (dir === "top" ? a.pitch > b.pitch : a.pitch < b.pitch);
  const out: HeardNote[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    let covered = false;
    // Solo compite con lo que se atacó casi al mismo tiempo.
    for (let j = i - 1; j >= 0 && sorted[j].start >= n.start - 0.06 && !covered; j--) covered = together(sorted[j], n.start) && better(sorted[j], n) && sorted[j].amp >= n.amp * 0.6;
    for (let j = i + 1; j < sorted.length && sorted[j].start <= n.start + 0.06 && !covered; j++) covered = together(sorted[j], n.start) && better(sorted[j], n) && sorted[j].amp >= n.amp * 0.6;
    if (covered) continue;
    const last = out[out.length - 1];
    if (last && last.start + last.dur > n.start) last.dur = Math.max(0.05, n.start - last.start); // una nota a la vez
    out.push({ ...n });
  }
  return out;
}

/** Convierte lo detectado en una canción con tres pistas: melodía, bajo y todo. */
export function audioToSong(heard: HeardNote[], title: string): Song {
  const clean = heard.filter((n) => n.amp >= 0.25 && n.dur >= 0.05 && n.pitch >= 24 && n.pitch <= 108);
  const bpm = estimateBpm(clean);
  const toNote = (n: HeardNote): Note => ({
    pitch: n.pitch,
    start: (n.start * bpm) / 60,
    dur: Math.max(0.125, (n.dur * bpm) / 60),
    vel: Math.round(50 + 77 * Math.min(1, n.amp)),
  });
  const melody = skyline(
    clean.filter((n) => n.pitch >= 55),
    "top",
  );
  const bass = skyline(
    clean.filter((n) => n.pitch < 55),
    "bottom",
    0.1,
  );
  const track = (id: string, name: string, role: Track["role"], notes: HeardNote[]): Track => ({
    id,
    name,
    program: null,
    isPercussion: false,
    role,
    notes: notes.map(toNote).sort((a, b) => a.start - b.start || a.pitch - b.pitch),
  });
  return {
    title,
    artist: "",
    source: "audio",
    tempos: [{ beat: 0, bpm }],
    timeSignature: [4, 4],
    tracks: [
      track("melodia", "Melodía (lo más agudo)", "melody", melody),
      track("bajo", "Bajo (lo más grave)", "bass", bass),
      track("todo", "Todo lo que se oye", "other", clean),
    ].filter((t) => t.notes.length),
  };
}
