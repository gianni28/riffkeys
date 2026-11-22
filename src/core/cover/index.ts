import type { Song } from "../model";
import { dspSeparate, SR } from "./dsp";
import { estimatePeriod, smoothBeats, strengthAt, trackBeats } from "./beats";
import { beatChroma, detectChords, downbeatPhase, estimateKeyFromChroma } from "./chords";
import { basicPitch } from "./pitch";
import { buildCover } from "./build";
import { aiRecommended, separateWithAI } from "./separate";

export { aiRecommended };

export interface CoverOptions {
  /** Separar con IA (HTDemucs). Si falla, se usa la separación por DSP. */
  ai: boolean;
}

export type CoverProgress = (p: number, stage: string) => void;

async function decode(bytes: ArrayBuffer, rate: number): Promise<{ L: Float32Array; R: Float32Array }> {
  const buf = await new OfflineAudioContext(2, 1, rate).decodeAudioData(bytes.slice(0));
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  return { L: new Float32Array(L), R: new Float32Array(R) };
}

function resampleTo22k(x: Float32Array, rate: number): Float32Array {
  if (rate === SR) return x;
  const ratio = rate / SR;
  const out = new Float32Array(Math.floor(x.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const i0 = Math.floor(i * ratio);
    let acc = 0;
    let n = 0;
    for (let k = i0; k < Math.min(x.length, i0 + Math.ceil(ratio)); k++, n++) acc += x[k];
    out[i] = n ? acc / n : 0;
  }
  return out;
}

/**
 * Carga TensorFlow.js con el mejor motor: WebGL en computador; WebAssembly en
 * celulares (más estable que su WebGL de media precisión) o si no hay WebGL.
 */
async function loadPitchModel() {
  const tf = await import("@tensorflow/tfjs");
  let forced: string | null = null;
  try {
    forced = localStorage.getItem("riffkeys:motor");
  } catch {
    /* sin almacenamiento */
  }
  const mobile = navigator.maxTouchPoints > 1 && /Mobi|iPhone|iPad|Android/i.test(navigator.userAgent);
  try {
    if (forced === "wasm" || (mobile && forced !== "webgl")) throw new Error("WebAssembly");
    if (!(await tf.setBackend("webgl"))) throw new Error("sin WebGL");
  } catch {
    const wasm = await import("@tensorflow/tfjs-backend-wasm");
    wasm.setWasmPaths(`${import.meta.env.BASE_URL}tfjs/`);
    await tf.setBackend("wasm");
  }
  await tf.ready();
  const model = await tf.loadGraphModel(`${import.meta.env.BASE_URL}basic-pitch/model.json`);
  return { tf, model };
}

/**
 * De una grabación a un cover para piano:
 * 1. separa voz, bajo, guitarras y batería (IA o DSP);
 * 2. sigue el pulso real y detecta el compás;
 * 3. saca los acordes pulso a pulso;
 * 4. transcribe la voz, la guitarra principal y el bajo;
 * 5. arma melodía a la derecha y acompañamiento a la izquierda, a tempo.
 */
export async function makeCover(file: File, opts: CoverOptions, onProgress: CoverProgress): Promise<Song> {
  const bytes = await file.arrayBuffer();
  onProgress(0, "Leyendo el audio");
  let L: Float32Array;
  let R: Float32Array;
  // La IA necesita 44,1 kHz; el resto trabaja a 22 050 Hz.
  let rate = opts.ai ? 44100 : SR;
  try {
    ({ L, R } = await decode(bytes, rate));
  } catch {
    rate = rate === SR ? 44100 : SR;
    ({ L, R } = await decode(bytes, rate));
  }
  const seconds = L.length / rate;
  if (seconds < 3) throw new Error("La grabación es demasiado corta.");
  if (seconds > 9 * 60) throw new Error("La grabación dura más de 9 minutos. Recórtala para que el navegador pueda con ella.");

  // 1. Separación. Con IA: la voz sale limpia y el resto (instrumental) se separa por DSP.
  //    Sin IA: todo por DSP (posición en el estéreo + armónico/percusivo).
  let vocal: Float32Array | null = null;
  let mixL = resampleTo22k(L, rate);
  let mixR = resampleTo22k(R, rate);
  let usedAI = false;
  if (opts.ai) {
    try {
      if (rate !== 44100) throw new Error("La IA necesita el audio a 44,1 kHz");
      const split = await separateWithAI(L, R, (p, s) => onProgress(0.02 + 0.6 * p, s));
      vocal = new Float32Array(split.vocals.L.length);
      for (let i = 0; i < vocal.length; i++) vocal[i] = (split.vocals.L[i] + split.vocals.R[i]) / 2;
      mixL = split.instrumental.L;
      mixR = split.instrumental.R;
      usedAI = true;
    } catch (e) {
      console.warn("Separación con IA no disponible, se usa DSP:", e);
    }
  }
  const base = usedAI ? 0.62 : 0.2;
  onProgress(usedAI ? 0.62 : 0.05, "Separando bajo, guitarras y batería");
  const sep = dspSeparate(mixL, mixR, (p) => onProgress((usedAI ? 0.62 : 0.05) + (usedAI ? 0.04 : 0.15) * p, "Separando bajo, guitarras y batería"));
  const drums = sep.drums;
  const bass = sep.bass;
  // Con IA el «centro» del instrumental ya no tiene voz: es guitarra/teclado y sirve para acordes y solos.
  const other = new Float32Array(sep.other.length);
  for (let i = 0; i < other.length; i++) other[i] = sep.other[i] + (usedAI ? sep.vocal[i] : 0);
  if (!vocal) vocal = sep.vocal;

  // 2–3. Pulso, compás y acordes
  onProgress(base, "Buscando el pulso y los acordes");
  await new Promise((r) => setTimeout(r, 0));
  const beats = smoothBeats(trackBeats(drums, estimatePeriod(drums)), seconds);
  if (beats.length < 8) throw new Error("No encontré un pulso claro en la grabación.");
  const harmony = new Float32Array(other.length);
  for (let i = 0; i < harmony.length; i++) harmony[i] = other[i] + 0.5 * (bass[i] ?? 0);
  const chroma = beatChroma(harmony, bass, beats);
  const key = estimateKeyFromChroma(chroma.map((c) => c.full));
  const chords = detectChords(chroma, key);
  const phase = downbeatPhase(chords, strengthAt(drums, beats));

  // 4. Transcripción
  onProgress(base + 0.03, "Cargando el oído musical");
  const { tf, model } = await loadPitchModel();
  const span = (1 - base - 0.08) / 3;
  const at = (i: number) => base + 0.05 + span * i;
  try {
    // La voz aislada por IA es limpia: umbrales más sensibles para no perder sílabas.
    const vocalOpts = usedAI ? { onsetThresh: 0.4, frameThresh: 0.3, minNoteLen: 8 } : {};
    const vocals = await basicPitch(tf, model, vocal, (p) => onProgress(at(0) + span * p, "Escuchando la voz"), vocalOpts);
    const lead = await basicPitch(tf, model, other, (p) => onProgress(at(1) + span * p, "Escuchando las guitarras"));
    const bassNotes = await basicPitch(tf, model, bass, (p) => onProgress(at(2) + span * p, "Escuchando el bajo"), { maxHz: 400 });
    onProgress(0.97, "Armando el cover");
    const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Canción";
    return buildCover({ title, beats, phase, chords, vocals, lead, bass: bassNotes }).song;
  } finally {
    model.dispose();
  }
}
