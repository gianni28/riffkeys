import { Midi } from "@tonejs/midi";
import type { Arrangement } from "./model";

const PPQ = 480;

/** Exporta el arreglo como MIDI de dos pistas (mano derecha e izquierda). */
export function toMidi(arr: Arrangement): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(arr.tempos[0]?.bpm ?? 120);
  midi.header.tempos = arr.tempos.map((t) => ({ ticks: Math.round(t.beat * PPQ), bpm: t.bpm }));
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: arr.timeSignature }];
  midi.header.name = arr.title;
  midi.header.update();

  for (const [name, notes] of [
    ["Mano derecha", arr.right],
    ["Mano izquierda", arr.left],
  ] as const) {
    const track = midi.addTrack();
    track.name = name;
    track.instrument.number = 0; // Piano acústico
    for (const n of notes) {
      track.addNote({ midi: n.pitch, ticks: Math.round(n.start * PPQ), durationTicks: Math.max(1, Math.round(n.dur * PPQ)), velocity: n.vel / 127 });
    }
  }
  return midi.toArray();
}
