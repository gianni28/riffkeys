import type { Arrangement, Note } from "./model";
import { beatToSeconds } from "./tempo";

export type HandId = "right" | "left";

/** Nota del arreglo con su tiempo en segundos de canción (a velocidad 1). */
export interface TimedNote extends Note {
  hand: HandId;
  /** Inicio y fin en segundos de canción. */
  s: number;
  e: number;
  /** Índice estable dentro de la lista ordenada. */
  i: number;
}

export function timedNotes(arr: Arrangement): TimedNote[] {
  const all = [
    ...arr.right.map((n) => ({ ...n, hand: "right" as const })),
    ...arr.left.map((n) => ({ ...n, hand: "left" as const })),
  ]
    .map((n) => ({ ...n, s: beatToSeconds(n.start, arr.tempos), e: beatToSeconds(n.start + n.dur, arr.tempos), i: 0 }))
    .sort((a, b) => a.s - b.s || a.pitch - b.pitch);
  all.forEach((n, i) => (n.i = i));
  return all;
}

export interface WaitChord {
  beat: number;
  pitches: number[];
}

/** Acordes que hay que tocar (en modo esperar), solo de las manos que practica el usuario. */
export function waitChords(arr: Arrangement, hands: HandId[]): WaitChord[] {
  const notes = hands.flatMap((h) => arr[h]).sort((a, b) => a.start - b.start);
  const out: WaitChord[] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - n.start) < 0.02) {
      if (!last.pitches.includes(n.pitch)) last.pitches.push(n.pitch);
    } else out.push({ beat: n.start, pitches: [n.pitch] });
  }
  return out;
}

/** Destello de una tecla tocada; `at` es tiempo real (performance.now, en ms). */
export type Flash = { pitch: number; at: number; kind: "hit" | "wrong" };

export interface PracticeStats {
  hits: number;
  misses: number;
  wrong: number;
  streak: number;
  best: number;
  /** 0–100, o null si aún no hay notas evaluadas. */
  accuracy: number | null;
}

/**
 * Evalúa lo que toca el usuario contra el arreglo: una nota es acierto si se
 * toca la tecla correcta dentro de la ventana de tiempo; si pasa la ventana
 * sin tocarla es un fallo, y una tecla que no corresponde a nada es un error.
 */
export class PracticeScorer {
  /** Estado por nota (índice de TimedNote): acierto o fallo. */
  readonly result = new Map<number, "hit" | "miss">();
  flashes: Flash[] = [];
  stats: PracticeStats = { hits: 0, misses: 0, wrong: 0, streak: 0, best: 0, accuracy: null };
  private cursor = 0;
  private expected: TimedNote[];

  constructor(
    notes: TimedNote[],
    hands: HandId[],
    /** Ventana de acierto en segundos de canción. */
    private window = 0.2,
  ) {
    this.expected = notes.filter((n) => hands.includes(n.hand));
  }

  get active() {
    return this.expected.length > 0;
  }

  setWindow(w: number) {
    this.window = w;
  }

  /** Reinicia (al saltar a otra parte de la canción). */
  reset(fromSec = 0) {
    this.result.clear();
    this.flashes = [];
    this.stats = { hits: 0, misses: 0, wrong: 0, streak: 0, best: 0, accuracy: null };
    this.cursor = this.expected.findIndex((n) => n.s >= fromSec - this.window);
    if (this.cursor < 0) this.cursor = this.expected.length;
  }

  /** Olvida los resultados a partir de un punto (al repetir un bucle), sin tocar las estadísticas. */
  rewind(fromSec: number) {
    for (const n of this.expected) if (n.s >= fromSec - this.window) this.result.delete(n.i);
    this.cursor = this.expected.findIndex((n) => n.s >= fromSec - this.window);
    if (this.cursor < 0) this.cursor = this.expected.length;
  }

  /** Marca como fallo lo que ya pasó sin tocarse. */
  advance(nowSec: number) {
    while (this.cursor < this.expected.length && this.expected[this.cursor].s + this.window < nowSec) {
      const n = this.expected[this.cursor];
      if (!this.result.has(n.i)) {
        this.result.set(n.i, "miss");
        this.stats.misses++;
        this.stats.streak = 0;
      }
      this.cursor++;
    }
    this.update();
  }

  /** El usuario tocó una tecla en `nowSec`. Devuelve si fue acierto. */
  noteOn(pitch: number, nowSec: number): boolean {
    let best: TimedNote | null = null;
    for (let k = Math.max(0, this.cursor - 8); k < this.expected.length; k++) {
      const n = this.expected[k];
      if (n.s - this.window > nowSec) break;
      if (n.pitch !== pitch || this.result.has(n.i) || Math.abs(n.s - nowSec) > this.window) continue;
      if (!best || Math.abs(n.s - nowSec) < Math.abs(best.s - nowSec)) best = n;
    }
    if (best) {
      this.result.set(best.i, "hit");
      this.stats.hits++;
      this.stats.streak++;
      this.stats.best = Math.max(this.stats.best, this.stats.streak);
      this.flashes.push({ pitch, at: performance.now(), kind: "hit" });
    } else {
      this.stats.wrong++;
      this.stats.streak = 0;
      this.flashes.push({ pitch, at: performance.now(), kind: "wrong" });
    }
    if (this.flashes.length > 40) this.flashes.splice(0, this.flashes.length - 40);
    this.update();
    return !!best;
  }

  private update() {
    const done = this.stats.hits + this.stats.misses;
    this.stats.accuracy = done ? Math.round((100 * this.stats.hits) / (done + this.stats.wrong * 0.5)) : null;
  }
}
