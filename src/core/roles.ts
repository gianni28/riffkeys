import type { TrackRole } from "./model";

/**
 * Adivina el papel de una pista a partir de su nombre y su programa General MIDI.
 * Sirve solo para sugerir a qué mano asignarla; el usuario siempre decide.
 */
export function guessRole(name: string, program: number | null, isPercussion: boolean, medianPitch: number | null): TrackRole {
  const n = name.toLowerCase();
  if (isPercussion || /drum|bater|percu|kit/.test(n)) return "drums";
  if (/bass|bajo/.test(n) || (program !== null && program >= 32 && program <= 39)) return "bass";
  if (/voice|vocal|voz|lead|solo|melod|sing|canto/.test(n)) return "melody";
  if (/rhythm|ritm|chord|acord|pad|choir|coro|string|cuerda|organ|órgano/.test(n)) return "harmony";
  if (/piano|key|teclad|synth|sinte/.test(n) || (program !== null && program <= 7)) return "harmony"; // pianos y teclados
  if (program !== null && (program === 30 || program === 29)) return "harmony"; // guitarra distorsionada / overdrive
  if (program !== null && program >= 48 && program <= 55) return "harmony"; // cuerdas y coros
  if (program !== null && program >= 56 && program <= 79) return "melody"; // vientos y flautas
  if (medianPitch !== null && medianPitch < 48) return "bass";
  return "other";
}

export const ROLE_LABEL: Record<TrackRole, string> = {
  melody: "Melodía",
  harmony: "Acompañamiento",
  bass: "Bajo",
  drums: "Batería",
  other: "Otra",
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
