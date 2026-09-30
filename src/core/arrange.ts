import type { Arrangement, Hand, Note, Song } from "./model";

export interface ArrangeOptions {
  /** Semitonos para transponer todo el arreglo. */
  transpose?: number;
  /** Máximo de notas simultáneas por mano (acordes). */
  maxNotesPerHand?: number;
  /** Abertura máxima de un acorde en semitonos (una mano normal alcanza ~una décima). */
  maxSpan?: number;
  /** En modo "split", las notas por debajo de esta altura (original) van a la izquierda. Por defecto Re3. */
  splitPoint?: number;
}

/** Registro cómodo de cada mano en un piano de 88 teclas. */
export const HAND_RANGE: Record<"right" | "left", { min: number; max: number; center: number }> = {
  right: { min: 55, max: 96, center: 72 }, // Sol3 – Do7, centro en Do5
  left: { min: 28, max: 64, center: 45 }, // Mi1 – Mi4, centro en La2
};

export const PIANO_MIN = 21; // La0
export const PIANO_MAX = 108; // Do8

const EPS = 1e-4;

/**
 * Convierte las pistas elegidas en un arreglo para dos manos:
 * 1. Mueve cada pista de octava para que caiga en el registro de su mano (sin cambiar la melodía).
 * 2. Ajusta notas sueltas que se salen del registro.
 * 3. Quita notas repetidas y reduce acordes imposibles de tocar.
 */
export function arrange(song: Song, hands: Record<string, Hand>, opts: ArrangeOptions = {}): Arrangement {
  const { transpose = 0, maxNotesPerHand = 4, maxSpan = 14, splitPoint = 50 } = opts;
  const out: Record<"right" | "left", Note[]> = { right: [], left: [] };

  const place = (notes: Note[], hand: "right" | "left") => {
    if (!notes.length) return;
    const range = HAND_RANGE[hand];
    const sorted = notes.map((n) => n.pitch + transpose).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const shift = Math.round((range.center - med) / 12) * 12;
    for (const n of notes) {
      let p = n.pitch + transpose + shift;
      while (p < range.min) p += 12;
      while (p > range.max) p -= 12;
      p = Math.max(PIANO_MIN, Math.min(PIANO_MAX, p));
      out[hand].push({ pitch: p, start: n.start, dur: n.dur, vel: n.vel });
    }
  };

  for (const track of song.tracks) {
    const hand = hands[track.id] ?? "off";
    if (hand === "off" || track.isPercussion || !track.notes.length) continue;
    if (hand === "split") {
      place(track.notes.filter((n) => n.pitch < splitPoint), "left");
      place(track.notes.filter((n) => n.pitch >= splitPoint), "right");
    } else place(track.notes, hand);
  }

  const right = playable(dedupe(out.right), maxNotesPerHand, maxSpan, "right");
  const left = playable(dedupe(out.left), maxNotesPerHand, maxSpan, "left");
  const length = Math.max(0, ...right.map((n) => n.start + n.dur), ...left.map((n) => n.start + n.dur));

  return { title: song.title, artist: song.artist, tempos: song.tempos, timeSignature: song.timeSignature, right, left, length };
}

/** Une notas de la misma altura que se solapan (p. ej. dos guitarras dobladas). */
export function dedupe(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch || a.start - b.start);
  const out: Note[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && last.pitch === n.pitch && n.start < last.start + last.dur - EPS) {
      if (Math.abs(n.start - last.start) < EPS) {
        last.dur = Math.max(last.dur, n.dur);
        last.vel = Math.max(last.vel, n.vel);
      } else {
        // La nueva vuelve a atacar la tecla: la anterior se corta ahí.
        last.dur = n.start - last.start;
        out.push({ ...n });
      }
    } else out.push({ ...n });
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** Reduce cada acorde a lo que una mano puede tocar: máximo N notas dentro de una abertura. */
export function playable(notes: Note[], maxNotes: number, maxSpan: number, hand: "right" | "left"): Note[] {
  const out: Note[] = [];
  let i = 0;
  while (i < notes.length) {
    let j = i;
    while (j < notes.length && Math.abs(notes[j].start - notes[i].start) < 0.02) j++;
    let chord = notes.slice(i, j).sort((a, b) => a.pitch - b.pitch);
    i = j;
    if (chord.length === 1) {
      out.push(chord[0]);
      continue;
    }
    // La derecha conserva la nota más aguda (suele ser la melodía); la izquierda, la más grave (el bajo).
    const anchor = hand === "right" ? chord[chord.length - 1].pitch : chord[0].pitch;
    chord = chord.filter((n) => Math.abs(n.pitch - anchor) <= maxSpan);
    if (chord.length > maxNotes) {
      const keep = [chord[0], chord[chord.length - 1]];
      const middle = chord.slice(1, -1);
      // Prioriza clases de altura distintas para no perder la armonía.
      const seen = new Set(keep.map((n) => n.pitch % 12));
      for (const n of middle) {
        if (keep.length < maxNotes && !seen.has(n.pitch % 12)) {
          keep.push(n);
          seen.add(n.pitch % 12);
        }
      }
      for (const n of middle) if (keep.length < maxNotes && !keep.includes(n)) keep.push(n);
      chord = keep.sort((a, b) => a.pitch - b.pitch);
    }
    out.push(...chord);
  }
  return out;
}

/** Sugerencia inicial de manos según el papel de cada pista. */
export function suggestHands(song: Song): Record<string, Hand> {
  const hands: Record<string, Hand> = {};
  const melodic = song.tracks.filter((t) => !t.isPercussion);
  if (melodic.length === 1) {
    // Una sola pista (p. ej. una tab de guitarra): graves a la izquierda y el resto a la derecha.
    hands[melodic[0].id] = melodic[0].role === "bass" ? "left" : "split";
    song.tracks.filter((t) => t.isPercussion).forEach((t) => (hands[t.id] = "off"));
    return hands;
  }
  let hasRight = false;
  let hasLeft = false;
  for (const t of song.tracks) {
    if (t.role === "drums" || t.isPercussion) hands[t.id] = "off";
    else if (t.role === "melody" && !hasRight) {
      hands[t.id] = "right";
      hasRight = true;
    } else if (t.role === "bass" && !hasLeft) {
      hands[t.id] = "left";
      hasLeft = true;
    } else hands[t.id] = "off";
  }
  // Si falta alguna mano, usa la primera pista libre que encaje.
  const free = song.tracks.filter((t) => hands[t.id] === "off" && !t.isPercussion && t.role !== "drums");
  if (!hasRight && free.length) hands[free.shift()!.id] = "right";
  if (!hasLeft && free.length) hands[free.shift()!.id] = "left";
  return hands;
}
