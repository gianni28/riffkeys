import type { Song } from "./model";
import { audioToSong, type HeardNote } from "./fromAudio";

const RATE = 22050; // lo que espera Basic Pitch
export const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm", "mp4", "mov", "m4v", "3gp"];
export const MAX_SECONDS = 8 * 60;

export function isAudioFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXT.includes(ext) || file.type.startsWith("audio/") || file.type.startsWith("video/");
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
  const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import("@spotify/basic-pitch");
  const model = new BasicPitch(`${import.meta.env.BASE_URL}basic-pitch/model.json`);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  await model.evaluateModel(
    audio,
    (f, o) => {
      frames.push(...f);
      onsets.push(...o);
    },
    (p) => onProgress(0.05 + 0.9 * p, "Escuchando la canción"),
  );
  onProgress(0.97, "Armando el piano");
  // Umbrales algo más altos que los de fábrica: en una mezcla completa hay mucho ruido.
  const events = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.32, 11, true, 2100, 32.7, true));
  const heard: HeardNote[] = events.map((e) => ({ start: e.startTimeSeconds, dur: e.durationSeconds, pitch: e.pitchMidi, amp: e.amplitude }));
  if (!heard.length) throw new Error("No escuché notas claras en esa grabación.");
  return audioToSong(heard, file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Canción");
}
