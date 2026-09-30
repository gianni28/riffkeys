/**
 * Modelo interno de Riffkeys. Todo el tiempo se mide en negras (beats):
 * una negra = 1, una corchea = 0.5. Así el modelo no depende del formato
 * de origen (ticks de MIDI, compases de Guitar Pro, columnas de una tab).
 */

export interface Note {
  /** Número MIDI (60 = Do central). */
  pitch: number;
  /** Inicio en negras desde el principio de la canción. */
  start: number;
  /** Duración en negras. */
  dur: number;
  /** 1–127 */
  vel: number;
}

export type TrackRole = "melody" | "harmony" | "bass" | "drums" | "other";

export interface Track {
  id: string;
  name: string;
  /** Programa General MIDI (0–127) si se conoce. */
  program: number | null;
  isPercussion: boolean;
  /** Suposición sobre qué papel cumple, para sugerir la mano. */
  role: TrackRole;
  notes: Note[];
}

export interface TempoChange {
  /** En negras. */
  beat: number;
  bpm: number;
}

export interface Song {
  title: string;
  artist: string;
  /** Siempre tiene al menos un cambio en el beat 0. */
  tempos: TempoChange[];
  timeSignature: [number, number];
  tracks: Track[];
  /** Formato del que vino, para mostrarlo en la interfaz. */
  source: "guitar-pro" | "musicxml" | "midi" | "tab";
}

/** "split" reparte una sola pista: los graves a la izquierda y el resto a la derecha. */
export type Hand = "right" | "left" | "split" | "off";

export interface Arrangement {
  title: string;
  artist: string;
  tempos: TempoChange[];
  timeSignature: [number, number];
  right: Note[];
  left: Note[];
  /** Duración total en negras. */
  length: number;
}
