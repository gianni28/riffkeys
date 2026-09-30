import { Midi } from "@tonejs/midi";
import type { Song, Track } from "./model";
import { guessRole, median } from "./roles";
import { normalizeTempos } from "./tempo";

export function importMidi(bytes: Uint8Array, fileName = ""): Song {
  const midi = new Midi(bytes);
  const ppq = midi.header.ppq || 480;

  const tracks: Track[] = midi.tracks
    .map((t, i) => {
      const notes = t.notes
        .map((n) => ({ pitch: n.midi, start: n.ticks / ppq, dur: Math.max(1 / 64, n.durationTicks / ppq), vel: Math.round(n.velocity * 127) || 80 }))
        .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      const isPercussion = t.instrument.percussion || t.channel === 9;
      const program = isPercussion ? null : t.instrument.number;
      const name = t.name?.trim() || (isPercussion ? "Batería" : t.instrument.name ? capitalize(t.instrument.name) : `Pista ${i + 1}`);
      return {
        id: `t${i}`,
        name,
        program,
        isPercussion,
        role: guessRole(name, program, isPercussion, median(notes.map((n) => n.pitch))),
        notes,
      };
    })
    .filter((t) => t.notes.length > 0);

  const ts = midi.header.timeSignatures[0]?.timeSignature;
  return {
    title: midi.header.name?.trim() || fileName.replace(/\.[^.]+$/, "") || "Sin título",
    artist: "",
    tempos: normalizeTempos(midi.header.tempos.map((t) => ({ beat: t.ticks / ppq, bpm: t.bpm }))),
    timeSignature: ts && ts.length === 2 ? [ts[0], ts[1]] : [4, 4],
    tracks,
    source: "midi",
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
