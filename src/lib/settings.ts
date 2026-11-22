import { useEffect, useState } from "react";

/** Ajustes que se recuerdan entre visitas (en este navegador). */
export interface Settings {
  speed: number;
  showNames: boolean;
  zoom: number; // segundos visibles antes del teclado
  metronome: boolean;
  countIn: boolean;
  reverb: boolean;
  volume: number;
  maxNotes: number;
  leftOctaves: boolean;
  simplify: boolean;
  soundMyKeys: boolean;
  trainer: boolean;
}

export const DEFAULTS: Settings = {
  speed: 1,
  showNames: true,
  zoom: 3,
  metronome: false,
  countIn: true,
  reverb: true,
  volume: 0.9,
  maxNotes: 4,
  leftOctaves: false,
  simplify: false,
  soundMyKeys: false,
  trainer: false,
};

const KEY = "riffkeys:ajustes";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno o bloqueado: no pasa nada */
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULTS, ...(read<Partial<Settings>>(KEY) ?? {}) }));
  useEffect(() => write(KEY, settings), [settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  return [settings, set] as const;
}
