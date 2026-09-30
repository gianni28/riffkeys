import type { Song } from "./model";
import { parseAsciiTab } from "./importTab";

export const ACCEPTED = ".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl,.mid,.midi,.txt";

/** Elige el importador según la extensión y, si hace falta, el contenido. */
export async function importFile(file: File): Promise<Song> {
  const name = file.name;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

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
      `No pude leer «${name}». Riffkeys acepta Guitar Pro (.gp, .gp5, .gpx), MusicXML (.xml, .musicxml, .mxl), MIDI (.mid) y tablaturas en texto.`,
    );
  }
}

function isMidi(bytes: Uint8Array) {
  return bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64; // "MThd"
}
