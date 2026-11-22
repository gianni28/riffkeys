import type { Hand, Note, Song, Track } from "./model";
import { barLength } from "./tempo";

/**
 * «Melodía automática»: en el rock y el metal la melodía salta de un
 * instrumento a otro: la voz canta las estrofas y los coros, y en la intro,
 * los puentes y los solos la lleva una guitarra (o dos armonizadas, como en
 * Iron Maiden). Esta pista virtual junta todo eso compás por compás para que
 * la mano derecha siempre tenga lo que se oye arriba, sin tener que buscar y
 * pegar cada riff a mano.
 */

export const AUTO_ID = "auto-melodia";

const VOCAL = /voc|voice|voz|sing|canto|vox|lyric|letra/i;
const GUITAR = /guit|gtr|lead|solo|rhythm|ritm|riff/i;

export function isVocal(t: Track): boolean {
  // 53 Voice Oohs, 54 Synth Voice, 85 Lead Voice. Los coros (52) se tratan como un instrumento más.
  return VOCAL.test(t.name) || (t.program !== null && [53, 54, 85].includes(t.program));
}

function isCandidate(t: Track): boolean {
  if (t.isPercussion || t.role === "drums" || t.role === "bass" || !t.notes.length) return false;
  if (isVocal(t)) return true;
  return GUITAR.test(t.name) || (t.program !== null && t.program >= 24 && t.program <= 31) || t.role === "melody" || t.role === "harmony" || t.role === "other";
}

interface BarStats {
  onsets: Note[][];
  score: number;
}

/** Agrupa notas que empiezan juntas. */
function onsets(notes: Note[]): Note[][] {
  const out: Note[][] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].start - n.start) < 0.02) last.push(n);
    else out.push([n]);
  }
  return out;
}

/** Quinta (con o sin octava) sobre la nota más grave: un power chord. */
function isPowerChord(g: Note[]): boolean {
  if (g.length < 2) return false;
  const lo = Math.min(...g.map((n) => n.pitch));
  return g.every((n) => [0, 7, 12, 19, 24, 5].includes(n.pitch - lo));
}

/** Qué tanto «canta» una pista en un compás: muchas notas sueltas, variadas y no muy graves. */
function stats(notes: Note[]): BarStats {
  const g = onsets(notes);
  if (!g.length) return { onsets: g, score: 0 };
  const tops = g.map((x) => Math.max(...x.map((n) => n.pitch)));
  const mono = g.filter((x) => x.length === 1).length / g.length;
  const variety = new Set(tops).size;
  const mean = tops.reduce((a, b) => a + b, 0) / tops.length;
  const register = Math.max(0.3, Math.min(1.4, (mean - 45) / 25));
  const score = Math.sqrt(g.length) * (0.35 + 0.65 * mono) * Math.min(3, 1 + variety / 3) * register;
  return { onsets: g, score };
}

/** Los power chords se tocan solo con su fundamental: en la mano derecha suenan a melodía. */
function melodic(g: Note[][]): Note[] {
  return g.flatMap((x) => (isPowerChord(x) ? [x.reduce((a, b) => (b.pitch < a.pitch ? b : a))] : x));
}

/** ¿La segunda guitarra arma con la primera (mismo ritmo, otras notas)? */
function harmonizes(a: Note[][], b: Note[][]): boolean {
  if (b.length < 2 || a.length < 2) return false;
  const starts = new Set(a.map((x) => Math.round(x[0].start * 48)));
  const shared = b.filter((x) => starts.has(Math.round(x[0].start * 48)));
  if (shared.length / Math.max(a.length, b.length) < 0.6) return false;
  const topA = new Map(a.map((x) => [Math.round(x[0].start * 48), Math.max(...x.map((n) => n.pitch))]));
  const differ = shared.filter((x) => {
    const d = Math.abs(Math.max(...x.map((n) => n.pitch)) - (topA.get(Math.round(x[0].start * 48)) ?? 0)) % 12;
    return d >= 3 && d <= 9; // terceras, cuartas, quintas, sextas
  }).length;
  return differ / shared.length >= 0.5;
}

export interface AutoMelody {
  track: Track;
  /** Compases tomados de cada pista (por nombre), para explicarlo en la interfaz. */
  sources: { name: string; bars: number; vocal: boolean }[];
}

export function autoMelody(song: Song): AutoMelody | null {
  const cands = song.tracks.filter((t) => t.id !== AUTO_ID && isCandidate(t));
  if (cands.length < 2) return null;
  const vocals = cands.filter(isVocal);
  const guitars = cands.filter((t) => !isVocal(t));
  const bar = barLength(song.timeSignature);
  const end = Math.max(...cands.flatMap((t) => t.notes.map((n) => n.start + n.dur)));
  const nBars = Math.ceil(end / bar - 1e-6);

  // Notas de cada pista repartidas por compás (según dónde empiezan).
  const byBar = new Map<string, Note[][]>();
  for (const t of cands) {
    const bars: Note[][] = Array.from({ length: nBars }, () => []);
    for (const n of t.notes) bars[Math.min(nBars - 1, Math.floor(n.start / bar + 1e-6))]?.push(n);
    byBar.set(t.id, bars);
  }

  const used = new Map<string, number>();
  const out: Note[] = [];
  let prev: string | null = null;
  for (let b = 0; b < nBars; b++) {
    // 1. Si alguien canta en este compás, manda la voz.
    const voice = vocals
      .filter((v) => byBar.get(v.id)![b].length > 0)
      .sort((x, y) => byBar.get(y.id)![b].length - byBar.get(x.id)![b].length)[0];
    if (voice) {
      out.push(...byBar.get(voice.id)![b]);
      used.set(voice.id, (used.get(voice.id) ?? 0) + 1);
      prev = voice.id;
      continue;
    }
    // 2. Si no, la guitarra que más «canta», sin saltar de una a otra por poco.
    const scored = guitars.map((t) => ({ t, s: stats(byBar.get(t.id)![b]) })).filter((x) => x.s.score > 0);
    if (!scored.length) {
      prev = null;
      continue;
    }
    scored.sort((x, y) => y.s.score - x.s.score);
    let best = scored[0];
    const keep = scored.find((x) => x.t.id === prev);
    if (keep && keep.s.score >= best.s.score * 0.75) best = keep;
    out.push(...melodic(best.s.onsets));
    used.set(best.t.id, (used.get(best.t.id) ?? 0) + 1);
    // 3. Guitarras gemelas: si otra hace la armonía, también va.
    const twin = scored.find((x) => x.t.id !== best.t.id && x.s.score >= best.s.score * 0.5 && harmonizes(best.s.onsets, x.s.onsets));
    if (twin) out.push(...melodic(twin.s.onsets));
    prev = best.t.id;
  }

  if (!out.length) return null;
  const sources = cands
    .filter((t) => used.has(t.id))
    .map((t) => ({ name: t.name, bars: used.get(t.id)!, vocal: isVocal(t) }))
    .sort((a, b) => b.bars - a.bars);
  return {
    track: {
      id: AUTO_ID,
      name: "Melodía automática",
      program: null,
      isPercussion: false,
      role: "melody",
      notes: out.sort((a, b) => a.start - b.start || a.pitch - b.pitch),
    },
    sources,
  };
}

/** Añade (o recalcula) la melodía automática al principio de la lista de pistas. */
export function withAutoMelody(song: Song): { song: Song; auto: AutoMelody | null } {
  const base = { ...song, tracks: song.tracks.filter((t) => t.id !== AUTO_ID) };
  const auto = autoMelody(base);
  return { song: auto ? { ...base, tracks: [auto.track, ...base.tracks] } : base, auto };
}

/**
 * Une otra canción (otra guitarra, otra tab) a la actual, empezando en `offsetBeats`.
 * `label` nombra las pistas sin nombre propio; con `forceLabel` nombra también una pista única.
 */
export function mergeSongs(base: Song, extra: Song, offsetBeats = 0, label?: string, forceLabel = false): Song {
  const n = 1 + Math.max(0, ...base.tracks.map((t) => Number(/^p(\d+)-/.exec(t.id)?.[1] ?? 0)));
  const generic = /^(tablatura|pista \d+|sin título)$/i;
  const tracks = extra.tracks.map((t, i) => ({
    ...t,
    id: `p${n}-${t.id}`,
    name:
      label && forceLabel && extra.tracks.length === 1
        ? label
        : generic.test(t.name) || t.name === extra.title
          ? `${label || `Parte ${n}`}${extra.tracks.length > 1 ? ` ${i + 1}` : ""}`
          : t.name,
    notes: t.notes.map((x) => ({ ...x, start: x.start + offsetBeats })),
  }));
  return { ...base, tracks: [...base.tracks.filter((t) => t.id !== AUTO_ID), ...tracks] };
}

/** Une varios archivos subidos a la vez: el primero manda en título y tempo. */
export function combineSongs(songs: Song[]): Song {
  if (songs.length === 1) return songs[0];
  let out: Song = { ...songs[0], tracks: songs[0].tracks.map((t) => ({ ...t, id: `p0-${t.id}` })) };
  for (const s of songs.slice(1)) out = mergeSongs(out, s, 0, s.title);
  return out;
}

/** Reparto sugerido cuando hay melodía automática: ella a la derecha, el bajo a la izquierda. */
export function suggestWithAuto(song: Song, fallback: (s: Song) => Record<string, Hand>): Record<string, Hand> {
  const hands = fallback(song);
  if (!song.tracks.some((t) => t.id === AUTO_ID)) return hands;
  const out: Record<string, Hand> = {};
  for (const t of song.tracks) out[t.id] = "off";
  out[AUTO_ID] = "right";
  const bass = song.tracks.find((t) => t.role === "bass" && !t.isPercussion);
  if (bass) out[bass.id] = "left";
  else {
    // Sin bajo: la guitarra rítmica (la más grave) dividida hace de izquierda.
    const low = song.tracks
      .filter((t) => t.id !== AUTO_ID && !t.isPercussion && t.role !== "drums" && !isVocal(t) && t.notes.length)
      .map((t) => ({ t, m: t.notes.reduce((a, n) => a + n.pitch, 0) / t.notes.length }))
      .sort((a, b) => a.m - b.m)[0];
    if (low) out[low.t.id] = "left";
  }
  return out;
}
