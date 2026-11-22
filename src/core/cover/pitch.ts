import type * as TF from "@tensorflow/tfjs";
import type { HeardNote } from "../fromAudio";

// Constantes del modelo de Basic Pitch (ventanas de 2 s que se solapan 30 cuadros).
const RATE = 22050;
const FFT_HOP = 256;
const WINDOW = RATE * 2 - FFT_HOP; // 43 844 muestras
const OVERLAP = 30;
const HOP = WINDOW - OVERLAP * FFT_HOP;
const FPS = Math.floor(RATE / FFT_HOP);

export interface PitchOptions {
  onsetThresh?: number;
  frameThresh?: number;
  /** En cuadros de 11,6 ms. */
  minNoteLen?: number;
  minHz?: number;
  maxHz?: number;
}

/**
 * Corre Basic Pitch sobre una señal mono a 22 050 Hz, de a varias ventanas
 * a la vez y liberando la memoria en cada paso. Devuelve las notas en segundos.
 */
export async function basicPitch(
  tf: typeof TF,
  model: TF.GraphModel,
  audio: Float32Array,
  onProgress: (p: number) => void = () => undefined,
  opts: PitchOptions = {},
): Promise<HeardNote[]> {
  const padded = new Float32Array((OVERLAP * FFT_HOP) / 2 + audio.length);
  padded.set(audio, (OVERLAP * FFT_HOP) / 2);
  const starts: number[] = [];
  for (let s = 0; s < padded.length; s += HOP) starts.push(s);
  const total = Math.floor(audio.length * (FPS / RATE));
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const batch = 4;
  for (let w = 0; w < starts.length && frames.length < total; w += batch) {
    const n = Math.min(batch, starts.length - w);
    const input = new Float32Array(n * WINDOW);
    for (let k = 0; k < n; k++) input.set(padded.subarray(starts[w + k], Math.min(padded.length, starts[w + k] + WINDOW)), k * WINDOW);
    const [fr, on] = tf.tidy(() => {
      const out = model.execute(tf.tensor3d(input, [n, WINDOW, 1]), ["Identity_1", "Identity_2"]) as TF.Tensor3D[];
      return out.map((t) => t.slice([0, OVERLAP / 2, 0], [-1, t.shape[1] - OVERLAP, -1]).reshape([-1, t.shape[2]]));
    });
    const [fa, oa] = (await Promise.all([fr.array(), on.array()])) as number[][][];
    fr.dispose();
    on.dispose();
    const take = Math.min(fa.length, total - frames.length);
    for (let i = 0; i < take; i++) {
      frames.push(fa[i]);
      onsets.push(oa[i]);
    }
    onProgress(Math.min(1, frames.length / Math.max(1, total)));
    await new Promise((r) => setTimeout(r, 0));
  }
  const { outputToNotesPoly, noteFramesToTime } = await import("@spotify/basic-pitch");
  const { onsetThresh = 0.5, frameThresh = 0.3, minNoteLen = 11, minHz = 32.7, maxHz = 2100 } = opts;
  return noteFramesToTime(outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLen, true, maxHz, minHz, true)).map((e) => ({
    start: e.startTimeSeconds,
    dur: e.durationSeconds,
    pitch: e.pitchMidi,
    amp: e.amplitude,
  }));
}
