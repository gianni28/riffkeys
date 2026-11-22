/**
 * Separación de voz con un modelo MDX-Net (Kim Vocal 2, de la comunidad de
 * Ultimate Vocal Remover) corrido con ONNX Runtime Web. Recibe estéreo a
 * 44,1 kHz y devuelve la voz y el resto («instrumental») en estéreo a 22 050 Hz.
 *
 * El modelo trabaja sobre un espectrograma: STFT de 7680 puntos (que no es
 * potencia de 2, así que aquí hay una FFT de base mixta 15 × 512), salto de
 * 1024, los primeros 3072 bins y bloques de 256 cuadros (~5,9 s).
 */

import { fft } from "./dsp";

const N = 7680;
const HOPS = 1024;
const DIM_F = 3072;
const DIM_T = 256;
const CHUNK = HOPS * (DIM_T - 1); // 261 120 muestras
const TRIM = N / 2;
const GEN = CHUNK - 2 * TRIM;
const BINS = N / 2 + 1;
const P = 15;
const Q = 512;

// --- FFT de 7680 puntos (15 × 512) ------------------------------------------------
const tw = (() => {
  const re = new Float32Array(P * Q);
  const im = new Float32Array(P * Q);
  for (let n1 = 0; n1 < P; n1++)
    for (let k2 = 0; k2 < Q; k2++) {
      const a = (-2 * Math.PI * n1 * k2) / N;
      re[n1 * Q + k2] = Math.cos(a);
      im[n1 * Q + k2] = Math.sin(a);
    }
  return { re, im };
})();
const dft15 = (() => {
  const re = new Float32Array(P * P);
  const im = new Float32Array(P * P);
  for (let k = 0; k < P; k++)
    for (let n = 0; n < P; n++) {
      const a = (-2 * Math.PI * k * n) / P;
      re[k * P + n] = Math.cos(a);
      im[k * P + n] = Math.sin(a);
    }
  return { re, im };
})();
const subRe = Array.from({ length: P }, () => new Float32Array(Q));
const subIm = Array.from({ length: P }, () => new Float32Array(Q));

/** FFT compleja de 7680 puntos in situ. `inverse` sin normalizar. */
export function fft7680(re: Float32Array, im: Float32Array, inverse = false) {
  const s = inverse ? -1 : 1;
  for (let n1 = 0; n1 < P; n1++) {
    const r = subRe[n1];
    const i = subIm[n1];
    for (let n2 = 0; n2 < Q; n2++) {
      r[n2] = re[n1 + P * n2];
      i[n2] = im[n1 + P * n2];
    }
    fft(r, i, inverse);
    const o = n1 * Q;
    for (let k2 = 0; k2 < Q; k2++) {
      const wr = tw.re[o + k2];
      const wi = s * tw.im[o + k2];
      const xr = r[k2];
      const xi = i[k2];
      r[k2] = xr * wr - xi * wi;
      i[k2] = xr * wi + xi * wr;
    }
  }
  for (let k2 = 0; k2 < Q; k2++) {
    for (let k1 = 0; k1 < P; k1++) {
      let ar = 0;
      let ai = 0;
      const o = k1 * P;
      for (let n1 = 0; n1 < P; n1++) {
        const wr = dft15.re[o + n1];
        const wi = s * dft15.im[o + n1];
        const xr = subRe[n1][k2];
        const xi = subIm[n1][k2];
        ar += xr * wr - xi * wi;
        ai += xr * wi + xi * wr;
      }
      re[Q * k1 + k2] = ar;
      im[Q * k1 + k2] = ai;
    }
  }
}

const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); // Hann periódica

/** Lee con reflejo en los bordes (como torch.stft con center=True). */
function reflect(x: Float32Array, i: number) {
  const n = x.length;
  if (i < 0) i = -i;
  if (i >= n) i = 2 * n - 2 - i;
  return x[Math.max(0, Math.min(n - 1, i))];
}

/**
 * Espectrograma de un bloque estéreo con el formato del modelo: [4, 3072, 256]
 * (L real, L imag, R real, R imag). Las dos señales reales van en una sola FFT
 * compleja (L en la parte real, R en la imaginaria) y luego se separan.
 */
export function chunkSpec(L: Float32Array, R: Float32Array): Float32Array {
  const out = new Float32Array(4 * DIM_F * DIM_T);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const plane = DIM_F * DIM_T;
  for (let t = 0; t < DIM_T; t++) {
    const start = t * HOPS - N / 2;
    for (let i = 0; i < N; i++) {
      re[i] = reflect(L, start + i) * win[i];
      im[i] = reflect(R, start + i) * win[i];
    }
    fft7680(re, im);
    for (let k = 0; k < DIM_F; k++) {
      const nk = k === 0 ? 0 : N - k;
      // Z = X + iY  →  X[k] = (Z[k] + conj Z[N-k]) / 2,  Y[k] = (Z[k] - conj Z[N-k]) / 2i
      const zr = re[k];
      const zi = im[k];
      const cr = re[nk];
      const ci = -im[nk];
      const o = k * DIM_T + t;
      out[o] = (zr + cr) / 2;
      out[plane + o] = (zi + ci) / 2;
      out[2 * plane + o] = (zi - ci) / 2;
      out[3 * plane + o] = -(zr - cr) / 2;
    }
  }
  return out;
}

/** Del espectrograma del modelo a dos señales de CHUNK muestras (ISTFT con solape-suma). */
export function chunkWave(spec: Float32Array): { L: Float32Array; R: Float32Array } {
  const plane = DIM_F * DIM_T;
  const len = N + HOPS * (DIM_T - 1);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const wsum = new Float32Array(len);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let t = 0; t < DIM_T; t++) {
    re.fill(0);
    im.fill(0);
    // Espectro hermítico de L + i·R: Z[k] = XL[k] + i·XR[k], Z[N-k] = conj(XL[k]) + i·conj(XR[k]).
    for (let k = 0; k < DIM_F; k++) {
      const o = k * DIM_T + t;
      const lr = spec[o];
      const li = spec[plane + o];
      const rr = spec[2 * plane + o];
      const ri = spec[3 * plane + o];
      re[k] = lr - ri;
      im[k] = li + rr;
      if (k > 0) {
        re[N - k] = lr + ri;
        im[N - k] = -li + rr;
      }
    }
    fft7680(re, im, true);
    const o = t * HOPS;
    for (let i = 0; i < N; i++) {
      L[o + i] += (re[i] / N) * win[i];
      R[o + i] += (im[i] / N) * win[i];
      wsum[o + i] += win[i] * win[i];
    }
  }
  const outL = new Float32Array(CHUNK);
  const outR = new Float32Array(CHUNK);
  for (let i = 0; i < CHUNK; i++) {
    const k = i + N / 2;
    const w = Math.max(wsum[k], 1e-8);
    outL[i] = L[k] / w;
    outR[i] = R[k] / w;
  }
  return { L: outL, R: outR };
}

type Ort = typeof import("onnxruntime-web");
type Session = import("onnxruntime-web").InferenceSession;

/**
 * Separa la voz de una mezcla estéreo a 44,1 kHz. Devuelve voz e instrumental
 * en estéreo a 22 050 Hz (la mitad de muestras, promediando de a dos).
 */
export async function separateVocals(ort: Ort, session: Session, L: Float32Array, R: Float32Array, onProgress: (p: number) => void = () => undefined) {
  const n = L.length;
  const pad = GEN - (n % GEN);
  const total = TRIM + n + pad + TRIM;
  const get = (x: Float32Array, i: number) => {
    const k = i - TRIM;
    return k >= 0 && k < n ? x[k] : 0;
  };
  const half = Math.floor(n / 2);
  const voc = { L: new Float32Array(half), R: new Float32Array(half) };
  const chunks = Math.ceil((n + pad) / GEN);
  const segL = new Float32Array(CHUNK);
  const segR = new Float32Array(CHUNK);
  for (let c = 0, i = 0; i < n + pad; i += GEN, c++) {
    for (let k = 0; k < CHUNK; k++) {
      segL[k] = i + k < total ? get(L, i + k) : 0;
      segR[k] = i + k < total ? get(R, i + k) : 0;
    }
    const input = chunkSpec(segL, segR);
    const res = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 4, DIM_F, DIM_T]) });
    const outT = res[session.outputNames[0]];
    const wave = chunkWave(outT.data as Float32Array);
    outT.dispose?.();
    // Lo útil del bloque es [TRIM, CHUNK - TRIM): corresponde a la mezcla desde i.
    for (let k = TRIM; k < CHUNK - TRIM; k += 2) {
      const pos = i + k - TRIM; // posición en la mezcla original
      const h = pos >> 1;
      if (h >= half) break;
      voc.L[h] = 0.5 * 1.009 * (wave.L[k] + wave.L[k + 1]);
      voc.R[h] = 0.5 * 1.009 * (wave.R[k] + wave.R[k + 1]);
    }
    onProgress((c + 1) / chunks);
    await new Promise((r) => setTimeout(r, 0));
  }
  const inst = { L: new Float32Array(half), R: new Float32Array(half) };
  for (let h = 0; h < half; h++) {
    const k = 2 * h;
    inst.L[h] = 0.5 * (L[k] + (L[k + 1] ?? L[k])) - voc.L[h];
    inst.R[h] = 0.5 * (R[k] + (R[k + 1] ?? R[k])) - voc.R[h];
  }
  return { vocals: voc, instrumental: inst };
}

export const MDX = { N, HOPS, DIM_F, DIM_T, CHUNK, GEN, TRIM, BINS };
