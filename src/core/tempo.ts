import type { TempoChange } from "./model";

/** Convierte negras a segundos respetando los cambios de tempo. */
export function beatToSeconds(beat: number, tempos: TempoChange[], speed = 1): number {
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
