/** Geometría de un teclado de piano: posición y ancho de cada tecla en unidades de tecla blanca. */

const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlack = (pitch: number) => BLACK.has(((pitch % 12) + 12) % 12);

// Desplazamiento de las teclas negras respecto a la blanca anterior (como en un piano real, no centradas).
const BLACK_OFFSET: Record<number, number> = { 1: 0.6, 3: 0.75, 6: 0.58, 8: 0.68, 10: 0.78 };

export interface KeyRect {
  pitch: number;
  x: number; // en unidades de tecla blanca
  w: number;
  black: boolean;
}

/** Rango visible: desde el Do anterior a la nota más grave hasta el Si posterior a la más aguda, mínimo 3 octavas. */
export function visibleRange(pitches: number[]): [number, number] {
  if (!pitches.length) return [48, 83];
  let lo = Math.floor(Math.min(...pitches) / 12) * 12;
  let hi = Math.ceil((Math.max(...pitches) + 1) / 12) * 12 - 1;
  while (hi - lo + 1 < 36) {
    if (lo > 21) lo -= 12;
    if (hi - lo + 1 < 36 && hi < 108) hi += 12;
    if (lo <= 21 && hi >= 108) break;
  }
  return [Math.max(21, lo), Math.min(108, hi)];
}

export function layoutKeys(lo: number, hi: number): { keys: KeyRect[]; whiteCount: number } {
  const keys: KeyRect[] = [];
  let white = 0;
  for (let p = lo; p <= hi; p++) {
    if (isBlack(p)) {
      keys.push({ pitch: p, x: white - 1 + BLACK_OFFSET[p % 12], w: 0.58, black: true });
    } else {
      keys.push({ pitch: p, x: white, w: 1, black: false });
      white++;
    }
  }
  return { keys, whiteCount: white };
}
