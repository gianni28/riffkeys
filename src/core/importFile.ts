import type { Song } from "./model";
import { parseAsciiTab } from "./importTab";
import { isAudioFile, looksLikeAudio, transcribe } from "./transcribe";

/** Elige el importador según la extensión y, si hace falta, el contenido. */
export async function importFile(file: File, onProgress?: (p: number, stage: string) => void): Promise<Song> {
  const name = file.name;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  // Una grabación (audio o video): se escucha y se transcribe.
  if (isAudioFile(file) || looksLikeAudio(bytes)) return transcribe(file, onProgress ?? (() => undefined));

  if (ext === "mid" || ext === "midi" || isMidi(bytes)) {
    const { importMidi } = await import("./importMidi");
    return importMidi(bytes, name);
  }
  if (ext === "txt") return parseAsciiTab(new TextDecoder().decode(bytes), { title: name.replace(/\.[^.]+$/, "") }).song;
  // alphaTab pesa ~1 MB: solo se descarga cuando alguien sube un Guitar Pro o MusicXML.
  const { importWithAlphaTab } = await import("./importAlphaTab");
  try {
    return importWithAlphaTab(bytes, name);
  } catch {
    throw new Error(
      `No pude leer «${name}». Riffkeys acepta Guitar Pro (.gp, .gp5, .gpx), MusicXML (.xml, .musicxml, .mxl), MIDI (.mid), tablaturas en texto y audio o video (MP3, M4A, WAV, MP4…).`,
    );
  }
}

function isMidi(bytes: Uint8Array) {
  return bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64; // "MThd"
}
