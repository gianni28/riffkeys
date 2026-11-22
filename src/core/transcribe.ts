import type { Song } from "./model";

export const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm", "mp4", "mov", "m4v", "3gp"];

/** Formatos de partitura: aunque el navegador diga «audio/midi», no son grabaciones. */
const SCORE_EXT = ["mid", "midi", "kar", "gp", "gp3", "gp4", "gp5", "gpx", "xml", "musicxml", "mxl", "txt"];

export function isAudioFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (SCORE_EXT.includes(ext) || /midi|mid$/i.test(file.type)) return false;
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

/**
 * Escucha una grabación y arma un cover para piano (ver `cover/index.ts`).
 * Todo corre en el navegador: el audio nunca sale del dispositivo.
 */
export async function transcribe(file: File, onProgress: (p: number, stage: string) => void, opts: { ai?: boolean } = {}): Promise<Song> {
  const { makeCover, aiRecommended } = await import("./cover");
  return makeCover(file, { ai: opts.ai ?? aiRecommended() }, onProgress).catch((e: unknown) => {
    if (e instanceof Error && /decod|EncodingError|Unable to decode/i.test(`${e.name} ${e.message}`)) {
      throw new Error(`No pude leer el audio de «${file.name}». Prueba con un MP3, M4A, WAV o un video MP4.`);
    }
    throw e;
  });
}
