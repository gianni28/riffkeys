import { fft, SR } from "./dsp";

export interface Chord {
  /** Clase de altura de la fundamental (0 = Do). */
  root: number;
  minor: boolean;
  /** Qué tan seguro está (0–1). */
  conf: number;
}

const CN = 8192; // 2,7 Hz por bin: alcanza a distinguir semitonos hasta ~45 Hz
const CHOP = 2048;
const cwin = new Float32Array(CN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / CN));
const cPitch = new Float32Array(CN / 2).map((_, b) => (b === 0 ? -1 : 69 + 12 * Math.log2((b * SR) / CN / 440)));

/** Espectro promedio (magnitud) de un tramo, con FFT larga para tener resolución en los graves. */
function segmentSpectrum(x: Float32Array, t0: number, t1: number): Float32Array {
  const acc = new Float32Array(CN / 2);
  const re = new Float32Array(CN);
  const im = new Float32Array(CN);
  const s0 = Math.floor(t0 * SR);
  const s1 = Math.max(s0 + CHOP, Math.floor(t1 * SR));
  let n = 0;
  for (let c = s0 - CN / 2 + CHOP / 2; c < s1 - CN / 2 + CHOP / 2; c += CHOP, n++) {
    for (let i = 0; i < CN; i++) {
      const k = c + i;
      re[i] = k >= 0 && k < x.length ? x[k] * cwin[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < CN / 2; b++) acc[b] += Math.hypot(re[b], im[b]);
  }
  if (n) for (let b = 0; b < acc.length; b++) acc[b] /= n;
  return acc;
}

function chromaOf(spec: Float32Array, lo: number, hi: number): Float32Array {
  const c = new Float32Array(12);
  let mx = 1e-9;
  for (let b = 1; b < spec.length; b++) if (cPitch[b] >= lo && cPitch[b] <= hi) mx = Math.max(mx, spec[b]);
  for (let b = 1; b < spec.length; b++) {
    const p = cPitch[b];
    if (p < lo || p > hi) continue;
    // Solo picos: un bin cuenta si sobresale de sus vecinos (así el ruido no aplana el croma).
    if (spec[b] < spec[b - 1] || spec[b] < spec[b + 1]) continue;
    const d = Math.abs(p - Math.round(p));
    if (d > 0.4) continue;
    c[((Math.round(p) % 12) + 12) % 12] += Math.log1p(50 * (spec[b] / mx)) * (1 - d);
  }
  return norm(c);
}

/**
 * Croma por pulso: energía de cada una de las 12 notas entre dos pulsos.
 * `harmony` es lo armónico sin voz (guitarras, teclados); `bass` es la señal de
 * los graves, que delata la fundamental del acorde.
 */
export function peaks(x: Float32Array, t0: number, t1: number, lo: number, hi: number, k = 6) {
  const spec = segmentSpectrum(x, t0, t1);
  const out: { hz: number; pitch: number; mag: number }[] = [];
  for (let b = 2; b < spec.length - 1; b++) {
    const p = cPitch[b];
    if (p < lo || p > hi || spec[b] < spec[b - 1] || spec[b] < spec[b + 1]) continue;
    out.push({ hz: (b * SR) / CN, pitch: p, mag: spec[b] });
  }
  return out.sort((a, b) => b.mag - a.mag).slice(0, k);
}

export function beatChroma(harmony: Float32Array, bass: Float32Array, beats: number[]) {
  return beats.map((t, i) => {
    const t1 = beats[i + 1] ?? t + (t - (beats[i - 1] ?? t - 0.5));
    return { full: chromaOf(segmentSpectrum(harmony, t, t1), 40, 88), bass: chromaOf(segmentSpectrum(bass, t, t1), 28, 55) };
  });
}

function norm(v: Float32Array) {
  let m = 0;
  for (const x of v) m = Math.max(m, x);
  if (m > 0) for (let i = 0; i < v.length; i++) v[i] /= m;
  return v;
}

// Perfiles de Krumhansl–Kessler para estimar la tonalidad.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: ArrayLike<number>, b: ArrayLike<number>) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let s = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < 12; i++) {
    s += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return s / Math.sqrt(sa * sb || 1);
}

export function estimateKeyFromChroma(chromas: Float32Array[]): { tonic: number; minor: boolean } {
  const total = new Float32Array(12);
  for (const c of chromas) for (let i = 0; i < 12; i++) total[i] += c[i];
  let best = { tonic: 0, minor: false, s: -Infinity };
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => Array.from({ length: 12 }, (_, i) => p[(i - t + 12) % 12]);
    const sM = corr(total, rot(MAJOR));
    const sm = corr(total, rot(MINOR));
    if (sM > best.s) best = { tonic: t, minor: false, s: sM };
    if (sm > best.s) best = { tonic: t, minor: true, s: sm };
  }
  return { tonic: best.tonic, minor: best.minor };
}

/**
 * Acordes por pulso. Cada pulso se compara con 24 plantillas (mayor y menor en
 * las 12 notas); el bajo pesa mucho para decidir la fundamental, y un Viterbi
 * premia quedarse en el mismo acorde para que no salte en cada golpe.
 * Los power chords (sin tercera) toman mayor o menor según la tonalidad.
 */
export function detectChords(chroma: { full: Float32Array; bass: Float32Array }[], key: { tonic: number; minor: boolean }, changeCost = 0.8): Chord[] {
  const S = 24;
  const diatonicMinor = (root: number) => {
    // Grados de la escala de la tonalidad: decide la cualidad cuando no hay tercera.
    const rel = (root - key.tonic + 12) % 12;
    const minorDegrees = key.minor ? [0, 3, 5] : [2, 4, 9];
    return minorDegrees.includes(rel);
  };
  // Acordes propios de la tonalidad (en menor se acepta también el V mayor).
  const t = key.tonic;
  const diatonic = new Set(
    (key.minor
      ? [[0, 1], [3, 0], [5, 1], [7, 1], [7, 0], [8, 0], [10, 0], [2, 1]]
      : [[0, 0], [2, 1], [4, 1], [5, 0], [7, 0], [9, 1], [10, 0]]
    ).map(([d, m]) => ((t + d) % 12) + 12 * m),
  );
  const emit = chroma.map(({ full, bass }) => {
    const e = new Float32Array(S);
    for (let s = 0; s < S; s++) {
      const r = s % 12;
      const minor = s >= 12;
      const third = (r + (minor ? 3 : 4)) % 12;
      const other = (r + (minor ? 4 : 3)) % 12;
      const fifth = (r + 7) % 12;
      let v = 1.0 * full[r] + 0.8 * full[fifth] + 0.6 * full[third] - 0.4 * full[other];
      // Notas fuera del acorde restan un poco.
      let out = 0;
      for (let k = 0; k < 12; k++) if (k !== r && k !== fifth && k !== third) out += full[k];
      v -= 0.12 * out;
      v += 1.4 * bass[r] - 0.3 * bass[fifth];
      // Sin tercera clara: la tonalidad decide.
      if (Math.abs(full[third] - full[other]) < 0.15) v += diatonicMinor(r) === minor ? 0.15 : -0.15;
      if (!diatonic.has(s)) v -= 0.35;
      e[s] = v;
    }
    return e;
  });

  // Viterbi: cambiar de acorde cuesta `changeCost` (en las mismas unidades que la evidencia).
  const n = emit.length;
  if (!n) return [];
  const score = new Float32Array(S).map((_, s) => emit[0][s]);
  const back: Uint8Array[] = [];
  for (let i = 1; i < n; i++) {
    const bp = new Uint8Array(S);
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (score[s] > score[bestPrev]) bestPrev = s;
    const next = new Float32Array(S);
    for (let s = 0; s < S; s++) {
      const keep = score[s];
      const move = score[bestPrev] - changeCost;
      if (keep >= move) {
        next[s] = keep + emit[i][s];
        bp[s] = s;
      } else {
        next[s] = move + emit[i][s];
        bp[s] = bestPrev;
      }
    }
    score.set(next);
    back.push(bp);
  }
  let s = 0;
  for (let k = 1; k < S; k++) if (score[k] > score[s]) s = k;
  const path = new Array<number>(n);
  path[n - 1] = s;
  for (let i = n - 1; i > 0; i--) path[i - 1] = back[i - 1][path[i]];
  return path.map((st, i) => {
    const e = emit[i];
    let mx = -Infinity;
    let second = -Infinity;
    for (const v of e) {
      if (v > mx) {
        second = mx;
        mx = v;
      } else if (v > second) second = v;
    }
    return { root: st % 12, minor: st >= 12, conf: Math.max(0, Math.min(1, (e[st] - second + 0.5) / 1)) };
  });
}

/** Elige la fase del compás (en qué pulso cae el «1»): donde más cambian los acordes y más pega el bajo. */
export function downbeatPhase(chords: Chord[], bassHits: number[], perBar = 4): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let ph = 0; ph < perBar; ph++) {
    let s = 0;
    for (let i = ph; i < chords.length; i += perBar) {
      const prev = chords[i - 1];
      if (prev && (prev.root !== chords[i].root || prev.minor !== chords[i].minor)) s += 2;
      s += bassHits[i] ?? 0;
    }
    for (let i = 0; i < chords.length; i++) {
      // Cambios fuera del «1» restan.
      if (i % perBar !== ph && chords[i - 1] && chords[i - 1].root !== chords[i].root) s -= 0.5;
    }
    if (s > bestScore) {
      bestScore = s;
      best = ph;
    }
  }
  return best;
}
