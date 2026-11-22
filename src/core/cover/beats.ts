import { FPS } from "./dsp";

/** Corrección medida con metrónomos sintéticos (90, 120 y 160 bpm). */
const ONSET_LAG = 0.027;

/**
 * Tempo dominante de una envolvente de ataques: autocorrelación con una
 * preferencia suave por tempos de rock (centrada en 120 bpm).
 * Devuelve el período en cuadros (con decimales).
 */
export function estimatePeriod(env: Float32Array): number {
  const minLag = Math.floor((60 / 240) * FPS);
  const maxLag = Math.ceil((60 / 50) * FPS);
  const n = env.length;
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (n - lag);
  }
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * FPS) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.7) ** 2);
    // Las negras de verdad también se ven al doble del período.
    const harmonic = ac[lag] + 0.5 * (2 * lag <= maxLag + 1 ? ac[2 * lag] : 0);
    const score = harmonic * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Interpolación parabólica para afinar el período.
  const a = ac[best - 1] ?? ac[best];
  const b = ac[best];
  const c = ac[best + 1] ?? ac[best];
  const d = a - 2 * b + c;
  return d !== 0 ? best + (0.5 * (a - c)) / d : best;
}

/**
 * Seguimiento de pulsos por programación dinámica (Ellis, 2007): busca la
 * serie de pulsos que cae sobre los ataques fuertes sin alejarse del tempo.
 * Devuelve los tiempos de cada pulso en segundos.
 */
export function trackBeats(env: Float32Array, period = estimatePeriod(env), tightness = 400): number[] {
  const n = env.length;
  if (n < period * 4) return [];
  // Normaliza para que el término de transición tenga peso estable.
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  let sd = 0;
  for (const v of env) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) local[i] = env[i] / sd;

  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const r = Math.log((t - p) / period);
      const s = score[p] - tightness * r * r;
      if (s > best) {
        best = s;
        arg = p;
      }
    }
    score[t] = local[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // El último pulso: el mejor de los últimos cuadros con buen ataque.
  let end = n - 1;
  let bestEnd = -Infinity;
  for (let t = Math.max(0, n - Math.round(period * 2)); t < n; t++) {
    if (score[t] > bestEnd) {
      bestEnd = score[t];
      end = t;
    }
  }
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    frames.push(t);
    if (back[t] < 0) break;
  }
  frames.reverse();
  // El flujo espectral con ventana centrada de 2048 llega ~27 ms antes que el golpe real.
  return frames.map((f) => f / FPS + ONSET_LAG);
}

/**
 * Suaviza los pulsos con una regresión local (ventana de 8): elimina el
 * temblor de ±1 cuadro sin perder los cambios de tempo de verdad.
 * También extiende la rejilla hasta el principio y el final de la canción.
 */
export function smoothBeats(beats: number[], duration: number, win = 4): number[] {
  if (beats.length < 4) return beats;
  const out = beats.map((_, i) => {
    const a = Math.max(0, i - win);
    const b = Math.min(beats.length - 1, i + win);
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    const n = b - a + 1;
    for (let k = a; k <= b; k++) {
      sx += k;
      sy += beats[k];
      sxx += k * k;
      sxy += k * beats[k];
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const icpt = (sy - slope * sx) / n;
    return icpt + slope * i;
  });
  const first = out[1] - out[0];
  while (out[0] - first > -first * 0.5 && out[0] - first >= 0) out.unshift(out[0] - first);
  const last = out[out.length - 1] - out[out.length - 2];
  while (out[out.length - 1] + last <= duration + last) out.push(out[out.length - 1] + last);
  return out;
}

/** Convierte segundos a posición en pulsos (con decimales) usando la rejilla de pulsos. */
export function secondsToBeatGrid(beats: number[]) {
  return (sec: number): number => {
    const n = beats.length;
    if (sec <= beats[0]) return (sec - beats[0]) / (beats[1] - beats[0]);
    if (sec >= beats[n - 1]) return n - 1 + (sec - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
    let a = 0;
    let b = n - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (beats[m] <= sec) a = m;
      else b = m;
    }
    return a + (sec - beats[a]) / (beats[a + 1] - beats[a]);
  };
}

/** Fuerza de ataque cerca de cada pulso (máximo en ±2 cuadros). */
export function strengthAt(env: Float32Array, beats: number[]): number[] {
  return beats.map((t) => {
    const f = Math.round(t * FPS);
    let m = 0;
    for (let k = f - 2; k <= f + 2; k++) if (k >= 0 && k < env.length) m = Math.max(m, env[k]);
    return m;
  });
}
