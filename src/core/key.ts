import type { Note } from "./model";

// Perfiles de Krumhansl-Kessler para tonalidades mayores y menores.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Quintas del círculo para cada tónica mayor (0 = Do). Las menores usan su relativa mayor. */
const FIFTHS_OF_MAJOR = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / 12;
  const mb = b.reduce((s, v) => s + v, 0) / 12;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Estima la tonalidad (algoritmo de Krumhansl-Schmuckler) ponderando por duración. */
export function estimateKey(notes: Note[]): { tonic: number; mode: "major" | "minor"; fifths: number } {
  const hist = Array(12).fill(0);
  notes.forEach((n) => (hist[((n.pitch % 12) + 12) % 12] += n.dur));
  let best = { tonic: 0, mode: "major" as "major" | "minor", score: -Infinity };
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - t + 12) % 12]);
    const sMaj = correlate(hist, rot(MAJOR));
    const sMin = correlate(hist, rot(MINOR));
    if (sMaj > best.score) best = { tonic: t, mode: "major", score: sMaj };
    if (sMin > best.score) best = { tonic: t, mode: "minor", score: sMin };
  }
  const relativeMajor = best.mode === "major" ? best.tonic : (best.tonic + 3) % 12;
  return { tonic: best.tonic, mode: best.mode, fifths: FIFTHS_OF_MAJOR[relativeMajor] };
}

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const ES_SHARP = ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
const ES_FLAT = ["Do", "Re♭", "Re", "Mi♭", "Mi", "Fa", "Sol♭", "Sol", "La♭", "La", "Si♭", "Si"];

/** Nombre de la nota en notación inglesa con octava científica: 60 → C4. */
export function pitchName(pitch: number, useFlats = false): string {
  return `${(useFlats ? FLAT : SHARP)[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function keyName(key: { tonic: number; mode: "major" | "minor"; fifths: number }): string {
  const names = key.fifths < 0 ? ES_FLAT : ES_SHARP;
  return `${names[key.tonic]} ${key.mode === "major" ? "mayor" : "menor"}`;
}

/** Deletreo para MusicXML: paso, alteración y octava. */
export function spell(pitch: number, useFlats: boolean): { step: string; alter: number; octave: number } {
  const name = (useFlats ? FLAT : SHARP)[pitch % 12];
  return { step: name[0], alter: name[1] === "#" ? 1 : name[1] === "b" ? -1 : 0, octave: Math.floor(pitch / 12) - 1 };
}
