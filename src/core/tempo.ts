import type { TempoChange } from "./model";

/** Convierte negras a segundos respetando los cambios de tempo. */
export function beatToSeconds(beat: number, tempos: TempoChange[], speed = 1): number {
  // Antes del inicio (cuenta previa) el tiempo sigue al primer tempo.
  if (beat < 0) return (beat * 60) / ((tempos[0]?.bpm ?? 120) * speed);
  let seconds = 0;
  for (let i = 0; i < tempos.length; i++) {
    const cur = tempos[i];
    const nextBeat = i + 1 < tempos.length ? tempos[i + 1].beat : Infinity;
    if (beat <= cur.beat) break;
    const span = Math.min(beat, nextBeat) - cur.beat;
    seconds += (span * 60) / (cur.bpm * speed);
    if (beat <= nextBeat) break;
  }
  return seconds;
}

/** Inversa de beatToSeconds. */
export function secondsToBeat(seconds: number, tempos: TempoChange[], speed = 1): number {
  let elapsed = 0;
  for (let i = 0; i < tempos.length; i++) {
    const cur = tempos[i];
    const nextBeat = i + 1 < tempos.length ? tempos[i + 1].beat : Infinity;
    const spanSeconds = ((nextBeat - cur.beat) * 60) / (cur.bpm * speed);
    if (seconds <= elapsed + spanSeconds) {
      return cur.beat + ((seconds - elapsed) * cur.bpm * speed) / 60;
    }
    elapsed += spanSeconds;
  }
  return 0;
}

/** Tempo vigente en una posición (en negras). */
export function bpmAt(beat: number, tempos: TempoChange[]): number {
  let bpm = tempos[0]?.bpm ?? 120;
  for (const t of tempos) {
    if (t.beat > beat + 1e-6) break;
    bpm = t.bpm;
  }
  return bpm;
}

/** Duración de un compás en negras (6/8 → 3, 4/4 → 4). */
export function barLength(timeSignature: [number, number]): number {
  const [num, den] = timeSignature;
  return num > 0 && den > 0 ? (num * 4) / den : 4;
}

/** Inicio (en negras) de cada compás hasta `length`. */
export function barStarts(length: number, timeSignature: [number, number]): number[] {
  const bar = barLength(timeSignature);
  const out: number[] = [];
  for (let b = 0; b < length + 1e-6; b += bar) out.push(b);
  return out;
}

/** Deja la lista ordenada, sin duplicados y siempre con un tempo en el beat 0. */
export function normalizeTempos(list: TempoChange[], fallback = 120): TempoChange[] {
  const sorted = [...list].filter((t) => t.bpm > 0 && Number.isFinite(t.bpm)).sort((a, b) => a.beat - b.beat);
  const out: TempoChange[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - t.beat) < 1e-6) last.bpm = t.bpm;
    else if (!last || last.bpm !== t.bpm) out.push({ beat: t.beat, bpm: t.bpm });
  }
  if (!out.length || out[0].beat > 0) out.unshift({ beat: 0, bpm: out[0]?.bpm ?? fallback });
  return out;
}
