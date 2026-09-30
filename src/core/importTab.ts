import type { Note, Song } from "./model";
import { normalizeTempos } from "./tempo";

export interface TabOptions {
  /** Cuántos caracteres de la tab equivalen a una negra. 4 = cada guion es una semicorchea. */
  charsPerBeat?: number;
  bpm?: number;
  title?: string;
}

export interface TabParseResult {
  song: Song;
  strings: number;
  tuning: number[];
  warnings: string[];
}

// Afinaciones estándar, de la cuerda más aguda (arriba en la tab) a la más grave.
const STANDARD: Record<number, number[]> = {
  4: [43, 38, 33, 28], // bajo: G D A E
  5: [43, 38, 33, 28, 23], // bajo de 5: + B
  6: [64, 59, 55, 50, 45, 40], // guitarra: e B G D A E
  7: [64, 59, 55, 50, 45, 40, 35], // guitarra de 7: + B
  8: [64, 59, 55, 50, 45, 40, 35, 30], // guitarra de 8: + F#
};

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Una línea de tab: etiqueta opcional, barras y sobre todo guiones y números. */
const TAB_LINE = /^\s*([A-Ga-g][#b]?)?\s*[|:]?([-0-9xXhpbrsvt~/\\()|<>.^*=]+)\s*$/;

function labelToPitch(label: string, expected: number): number {
  const letter = label[0].toUpperCase();
  let pc = PC[letter];
  if (pc === undefined) return expected;
  if (label[1] === "#") pc += 1;
  if (label[1] === "b") pc -= 1;
  // El tono con esa nota más cercano a la afinación estándar de esa cuerda (bajar es más común que subir).
  let best = expected;
  let bestDist = Infinity;
  for (let p = expected - 7; p <= expected + 5; p++) {
    if (((p % 12) + 12) % 12 === ((pc % 12) + 12) % 12) {
      const d = Math.abs(p - expected);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
  }
  return best;
}

/**
 * Convierte una tablatura en texto (ASCII) en notas. Las tabs de texto casi
 * nunca indican el ritmo, así que el tiempo sale del espaciado: cada carácter
 * vale 1/charsPerBeat de negra. Es un "mejor esfuerzo" y la interfaz lo dice.
 */
export function parseAsciiTab(text: string, opts: TabOptions = {}): TabParseResult {
  const charsPerBeat = opts.charsPerBeat ?? 4;
  const bpm = opts.bpm ?? 120;
  const warnings: string[] = [];

  // 1. Agrupar líneas de tab consecutivas en sistemas.
  const systems: { label: string; body: string }[][] = [];
  let current: { label: string; body: string }[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const m = raw.match(TAB_LINE);
    const dashes = m ? (m[2].match(/-/g) ?? []).length : 0;
    if (m && dashes >= 4) {
      current.push({ label: m[1] ?? "", body: m[2] });
    } else if (current.length) {
      systems.push(current);
      current = [];
    }
  }
  if (current.length) systems.push(current);

  const valid = systems.filter((s) => s.length >= 4 && s.length <= 8);
  if (!valid.length) throw new Error("No encontré ninguna tablatura. Cada cuerda debe ir en su propia línea, por ejemplo: e|---0---3---|");
  const strings = mostCommon(valid.map((s) => s.length));
  const used = valid.filter((s) => s.length === strings);
  if (used.length < valid.length) warnings.push(`Se ignoraron ${valid.length - used.length} bloques con un número distinto de cuerdas.`);

  // 2. Afinación: estándar, ajustada con las etiquetas del primer sistema si las hay.
  const standard = STANDARD[strings] ?? STANDARD[6];
  const tuning = standard.map((p, i) => (used[0][i].label ? labelToPitch(used[0][i].label, p) : p));

  // 3. Recorrer columnas.
  const notes: Note[] = [];
  const lastOnString: (Note | null)[] = Array(strings).fill(null);
  let beat = 0;
  const step = 1 / charsPerBeat;

  for (const system of used) {
    const width = Math.min(...system.map((l) => l.body.length));
    for (let col = 0; col < width; col++) {
      const isBar = system.every((l) => l.body[col] === "|");
      if (isBar) continue;
      for (let s = 0; s < strings; s++) {
        const line = system[s].body;
        const ch = line[col];
        if (!/\d/.test(ch) || /\d/.test(line[col - 1] ?? "")) continue;
        let fretText = ch;
        if (/\d/.test(line[col + 1] ?? "") && Number(ch + line[col + 1]) <= 24) fretText += line[col + 1];
        const fret = Number(fretText);
        const prev = lastOnString[s];
        if (prev) prev.dur = Math.min(beat - prev.start, 2);
        const note: Note = { pitch: tuning[s] + fret, start: beat, dur: 1, vel: 90 };
        notes.push(note);
        lastOnString[s] = note;
      }
      beat += step;
    }
  }
  // La última nota de cada cuerda dura hasta el final (máximo 2 negras).
  lastOnString.forEach((n) => n && (n.dur = Math.max(step, Math.min(beat - n.start, 2))));
  notes.forEach((n) => (n.dur = Math.max(step, n.dur)));

  if (!notes.length) throw new Error("La tablatura no tiene notas. Revisa que los trastes estén escritos con números.");

  const isBass = strings <= 5 && tuning[0] < 50;
  const name = isBass ? "Bajo" : "Guitarra";
  return {
    strings,
    tuning,
    warnings,
    song: {
      title: opts.title?.trim() || "Tablatura pegada",
      artist: "",
      tempos: normalizeTempos([{ beat: 0, bpm }]),
      timeSignature: [4, 4],
      source: "tab",
      tracks: [{ id: "t0", name, program: isBass ? 33 : 29, isPercussion: false, role: isBass ? "bass" : "harmony", notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) }],
    },
  };
}

function mostCommon(values: number[]): number {
  const count = new Map<number, number>();
  values.forEach((v) => count.set(v, (count.get(v) ?? 0) + 1));
  return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}
