/**
 * Procesado de señal para el «cover inteligente»: FFT, STFT, separación
 * armónico/percusivo (HPSS) y centro/lados, y envolvente de ataques.
 * Todo en Float32Array y sin dependencias, para que corra en el navegador y en Node.
 */

export const SR = 22050;
export const N_FFT = 2048;
export const HOP = 512;
export const FPS = SR / HOP; // ≈ 43 cuadros por segundo
/** Bins que se conservan (≈ 5.5 kHz): de ahí para arriba no hay fundamentales útiles. */
export const KEEP_BINS = 512;

const fftCache = new Map<number, { cos: Float32Array; sin: Float32Array; rev: Uint32Array; win: Float32Array }>();

function plan(n: number) {
  let p = fftCache.get(n);
  if (p) return p;
  const cos = new Float32Array(n / 2);
  const sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const win = new Float32Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  p = { cos, sin, rev, win };
  fftCache.set(n, p);
  return p;
}

/** FFT compleja in situ (radix-2). `inverse` sin normalizar. */
export function fft(re: Float32Array, im: Float32Array, inverse = false) {
  const n = re.length;
  const { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? -1 : 1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

export function frameCount(len: number) {
  return Math.floor(len / HOP) + 1;
}

/** Espectro complejo de un cuadro (centrado, con ventana de Hann). */
function analyze(x: Float32Array, frame: number, re: Float32Array, im: Float32Array) {
  const { win } = plan(N_FFT);
  const start = frame * HOP - N_FFT / 2;
  for (let i = 0; i < N_FFT; i++) {
    const k = start + i;
    re[i] = k >= 0 && k < x.length ? x[k] * win[i] : 0;
    im[i] = 0;
  }
  fft(re, im);
}

/** Magnitudes (cuadros × KEEP_BINS) de una señal mono. */
export function magnitudes(x: Float32Array): { mag: Float32Array; frames: number } {
  const frames = frameCount(x.length);
  const mag = new Float32Array(frames * KEEP_BINS);
  const re = new Float32Array(N_FFT);
  const im = new Float32Array(N_FFT);
  for (let f = 0; f < frames; f++) {
    analyze(x, f, re, im);
    const o = f * KEEP_BINS;
    for (let b = 0; b < KEEP_BINS; b++) mag[o + b] = Math.hypot(re[b], im[b]);
  }
  return { mag, frames };
}

/** Mediana de un trozo pequeño (in situ). */
function median(buf: Float32Array, n: number): number {
  // Inserción: para 17 valores es más rápido que ordenar con comparador.
  for (let i = 1; i < n; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j];
      j--;
    }
    buf[j + 1] = v;
  }
  return buf[n >> 1];
}

/**
 * Separación armónico/percusivo (Fitzgerald, 2010): lo que se mantiene en el
 * tiempo (notas) frente a lo que se extiende en frecuencia (golpes de batería).
 * Devuelve la máscara armónica suave (0–1) por cuadro y bin.
 */
export function harmonicMask(mag: Float32Array, frames: number, len = 17): Float32Array {
  const B = KEEP_BINS;
  const h = len >> 1;
  const H = new Float32Array(frames * B);
  const P = new Float32Array(frames * B);
  const buf = new Float32Array(len);
  for (let b = 0; b < B; b++) {
    for (let f = 0; f < frames; f++) {
      let n = 0;
      for (let k = Math.max(0, f - h); k <= Math.min(frames - 1, f + h); k++) buf[n++] = mag[k * B + b];
      H[f * B + b] = median(buf, n);
    }
  }
  for (let f = 0; f < frames; f++) {
    const o = f * B;
    for (let b = 0; b < B; b++) {
      let n = 0;
      for (let k = Math.max(0, b - h); k <= Math.min(B - 1, b + h); k++) buf[n++] = mag[o + k];
      P[o + b] = median(buf, n);
    }
  }
  for (let i = 0; i < H.length; i++) {
    const h2 = H[i] * H[i];
    const p2 = P[i] * P[i];
    H[i] = h2 + p2 > 1e-12 ? h2 / (h2 + p2) : 0;
  }
  return H;
}

/**
 * Envolvente de ataques (flujo espectral con compresión logarítmica), un valor por cuadro.
 * Con `mask` (máscara armónica) se usa solo la parte percusiva.
 */
export function onsetEnvelope(mag: Float32Array, frames: number, mask?: Float32Array, maxBin = KEEP_BINS): Float32Array {
  const B = KEEP_BINS;
  const env = new Float32Array(frames);
  let prev = new Float32Array(maxBin);
  let cur = new Float32Array(maxBin);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let b = 0; b < maxBin; b++) {
      const m = mag[f * B + b] * (mask ? 1 - mask[f * B + b] : 1);
      cur[b] = Math.log1p(100 * m);
      const d = cur[b] - prev[b];
      if (d > 0 && f > 0) s += d;
    }
    env[f] = s;
    [prev, cur] = [cur, prev];
  }
  // Quita la tendencia lenta y normaliza.
  const out = new Float32Array(frames);
  const w = Math.round(FPS); // 1 s
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += env[f];
    if (f >= w) acc -= env[f - w];
    const mean = acc / Math.min(f + 1, w);
    out[f] = Math.max(0, env[f] - mean);
  }
  let mx = 0;
  for (const v of out) mx = Math.max(mx, v);
  if (mx > 0) for (let f = 0; f < frames; f++) out[f] /= mx;
  return out;
}

/**
 * Plan B sin IA: separa por posición en el estéreo y por tipo de sonido.
 * - «centro armónico»: lo que suena igual en ambos canales y es sostenido → voz (y bajo).
 * - «lados armónicos»: lo que está paneado → normalmente las guitarras.
 * - envolvente de ataques de la parte percusiva → batería (para el pulso).
 */
export function dspSeparate(L: Float32Array, R: Float32Array, onProgress?: (p: number) => void) {
  const len = Math.min(L.length, R.length);
  const frames = frameCount(len);
  const B = KEEP_BINS;
  const monoRe = new Float32Array(frames * B);
  const monoIm = new Float32Array(frames * B);
  const center = new Float32Array(frames * B);
  const mag = new Float32Array(frames * B);
  const lr = new Float32Array(N_FFT);
  const li = new Float32Array(N_FFT);
  const rr = new Float32Array(N_FFT);
  const ri = new Float32Array(N_FFT);
  for (let f = 0; f < frames; f++) {
    analyze(L, f, lr, li);
    analyze(R, f, rr, ri);
    const o = f * B;
    for (let b = 0; b < B; b++) {
      const mr = (lr[b] + rr[b]) / 2;
      const mi = (li[b] + ri[b]) / 2;
      monoRe[o + b] = mr;
      monoIm[o + b] = mi;
      mag[o + b] = Math.hypot(mr, mi);
      const e = lr[b] * lr[b] + li[b] * li[b] + rr[b] * rr[b] + ri[b] * ri[b];
      const sim = e > 1e-12 ? (2 * (lr[b] * rr[b] + li[b] * ri[b])) / e : 0;
      const m = Math.max(0, Math.min(1, (sim - 0.75) / 0.2));
      center[o + b] = m * m;
    }
    if (onProgress && f % 500 === 0) onProgress(0.4 * (f / frames));
  }
  onProgress?.(0.45);
  const harm = harmonicMask(mag, frames);
  onProgress?.(0.8);
  const drums = onsetEnvelope(mag, frames, harm);
  const vocal = synthesize(monoRe, monoIm, frames, len, (i, b) => harm[i] * center[i] * (b >= 12 ? 1 : 0)); // > ~130 Hz
  const other = synthesize(monoRe, monoIm, frames, len, (i, b) => harm[i] * (1 - center[i]) * (b >= 6 ? 1 : 0));
  const bass = synthesize(monoRe, monoIm, frames, len, (i, b) => harm[i] * (b <= 28 ? 1 : b <= 36 ? (36 - b) / 8 : 0)); // < ~300 Hz
  onProgress?.(1);
  return { vocal, other, bass, drums, mag, frames, harm };
}

/** Vuelve al dominio del tiempo aplicando una máscara (solape-suma con Hann, hop N/4). */
export function synthesize(re: Float32Array, im: Float32Array, frames: number, len: number, mask: (i: number, bin: number) => number): Float32Array {
  const B = KEEP_BINS;
  const { win } = plan(N_FFT);
  const out = new Float32Array(len);
  const fr = new Float32Array(N_FFT);
  const fi = new Float32Array(N_FFT);
  const norm = 1 / (N_FFT * 1.5); // suma de Hann² con hop N/4 = 1.5; la IFFT no normaliza
  for (let f = 0; f < frames; f++) {
    fr.fill(0);
    fi.fill(0);
    const o = f * B;
    for (let b = 0; b < B; b++) {
      const m = mask(o + b, b);
      fr[b] = re[o + b] * m;
      fi[b] = im[o + b] * m;
      if (b > 0) {
        fr[N_FFT - b] = fr[b];
        fi[N_FFT - b] = -fi[b];
      }
    }
    fft(fr, fi, true);
    const start = f * HOP - N_FFT / 2;
    for (let i = 0; i < N_FFT; i++) {
      const k = start + i;
      if (k >= 0 && k < len) out[k] += fr[i] * win[i] * norm;
    }
  }
  return out;
}

/** Baja de 44,1 kHz a 22,05 kHz (factor 2, con un paso bajo sencillo) y suma a mono si hace falta. */
export function downsample2(x: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor(x.length / 2));
  for (let i = 0; i < out.length; i++) {
    const k = 2 * i;
    out[i] = 0.25 * (x[k - 1] ?? x[k]) + 0.5 * x[k] + 0.25 * (x[k + 1] ?? x[k]);
  }
  return out;
}
