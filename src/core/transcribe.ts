import type { Song } from "./model";
import { audioToSong, type HeardNote } from "./fromAudio";

const RATE = 22050; // lo que espera Basic Pitch
export const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm", "mp4", "mov", "m4v", "3gp"];
export const MAX_SECONDS = 8 * 60;

export function isAudioFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXT.includes(ext) || file.type.startsWith("audio/") || file.type.startsWith("video/");
}

/** Reconoce audio por sus primeros bytes, por si el archivo llega sin extensión ni tipo. */
export function looksLikeAudio(b: Uint8Array): boolean {
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  return (
    ascii(0, 3) === "ID3" || // MP3 con etiquetas
    (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || // trama MPEG / AAC ADTS
    (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") ||
    ascii(0, 4) === "OggS" ||
    ascii(0, 4) === "fLaC" ||
    ascii(4, 4) === "ftyp" || // MP4, M4A, MOV
    (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) // WebM / MKV
  );
}

/** Decodifica el audio (o el audio de un video) en mono a 22 050 Hz. */
async function decodeMono(bytes: ArrayBuffer): Promise<Float32Array> {
  let buf: AudioBuffer;
  try {
    buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes.slice(0));
  } catch {
    // Algunos Safari no aceptan 22 050 Hz: se decodifica a la tasa normal y se remuestrea a mano.
    const ctx = new OfflineAudioContext(1, 1, 44100);
    buf = await ctx.decodeAudioData(bytes.slice(0));
  }
  const len = buf.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  if (buf.sampleRate === RATE) return mono;
  const ratio = buf.sampleRate / RATE;
  const out = new Float32Array(Math.floor(len / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    // Promedio de la ventana: filtra un poco antes de bajar la tasa.
    let acc = 0;
    let n = 0;
    for (let k = i0; k < Math.min(len, i0 + Math.ceil(ratio)); k++, n++) acc += mono[k];
    out[i] = n ? acc / n : 0;
  }
  return out;
}

/**
 * Escucha una grabación y saca las notas con Basic Pitch (Spotify, Apache-2.0),
 * una red pequeña que corre en el navegador: el audio nunca sale del dispositivo.
 */
export async function transcribe(file: File, onProgress: (p: number, stage: string) => void): Promise<Song> {
  onProgress(0, "Leyendo el audio");
  const audio = await decodeMono(await file.arrayBuffer()).catch(() => {
    throw new Error(`No pude leer el audio de «${file.name}». Prueba con un MP3, M4A, WAV o un video MP4.`);
  });
  const seconds = audio.length / RATE;
  if (seconds > MAX_SECONDS) throw new Error(`La grabación dura ${Math.round(seconds / 60)} minutos. Recórtala a menos de ${MAX_SECONDS / 60} para que el navegador pueda con ella.`);
  if (seconds < 2) throw new Error("La grabación es demasiado corta.");

  onProgress(0.02, "Cargando el oído musical");
  const { frames, onsets } = await runModel(audio, (p) => onProgress(0.05 + 0.9 * p, "Escuchando la canción"));
  onProgress(0.97, "Armando el piano");
  const { outputToNotesPoly, noteFramesToTime } = await import("@spotify/basic-pitch");
  // Umbrales algo más altos que los de fábrica: en una mezcla completa hay mucho ruido.
  const events = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.32, 11, true, 2100, 32.7, true));
  const heard: HeardNote[] = events.map((e) => ({ start: e.startTimeSeconds, dur: e.durationSeconds, pitch: e.pitchMidi, amp: e.amplitude }));
  if (!heard.length) throw new Error("No escuché notas claras en esa grabación.");
  return audioToSong(heard, file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Canción");
}

// Constantes del modelo de Basic Pitch (ventanas de 2 s que se solapan 30 cuadros).
const FFT_HOP = 256;
const WINDOW = RATE * 2 - FFT_HOP; // 43 844 muestras
const OVERLAP = 30;
const HOP = WINDOW - OVERLAP * FFT_HOP;
const FPS = Math.floor(RATE / FFT_HOP);

/**
 * Corre el modelo por ventanas, de a varias a la vez y liberando la memoria de
 * la GPU en cada paso. (El bucle de la librería procesa de a una y no libera
 * nada: en un celular, una canción entera puede llenar la memoria.)
 */
async function runModel(audio: Float32Array, onProgress: (p: number) => void) {
  const tf = await import("@tensorflow/tfjs");
  await tf.ready();
  const model = await tf.loadGraphModel(`${import.meta.env.BASE_URL}basic-pitch/model.json`);
  const padded = new Float32Array((OVERLAP * FFT_HOP) / 2 + audio.length);
  padded.set(audio, (OVERLAP * FFT_HOP) / 2);
  const starts: number[] = [];
  for (let s = 0; s < padded.length; s += HOP) starts.push(s);
  const total = Math.floor(audio.length * (FPS / RATE));
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const batch = 4;
  try {
    for (let w = 0; w < starts.length && frames.length < total; w += batch) {
      const n = Math.min(batch, starts.length - w);
      const input = new Float32Array(n * WINDOW);
      for (let k = 0; k < n; k++) input.set(padded.subarray(starts[w + k], Math.min(padded.length, starts[w + k] + WINDOW)), k * WINDOW);
      const [fr, on] = tf.tidy(() => {
        const out = model.execute(tf.tensor3d(input, [n, WINDOW, 1]), ["Identity_1", "Identity_2"]) as import("@tensorflow/tfjs").Tensor3D[];
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
      await new Promise((r) => setTimeout(r, 0)); // deja respirar a la interfaz
    }
  } finally {
    model.dispose();
  }
  return { frames, onsets };
}
