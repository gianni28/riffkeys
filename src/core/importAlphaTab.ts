import * as alphaTab from "@coderline/alphatab";
import type { Note, Song, TempoChange, Track } from "./model";
import { guessRole, median } from "./roles";
import { normalizeTempos } from "./tempo";

const TICKS_PER_QUARTER = 960; // resolución interna del generador MIDI de alphaTab

/**
 * Lee Guitar Pro (gp3/4/5/gpx/gp), MusicXML y Capella usando alphaTab.
 * Usamos su generador MIDI (y no el modelo de partitura directamente) porque
 * ya resuelve repeticiones, finales alternativos, ligaduras y afinaciones.
 */
export function importWithAlphaTab(bytes: Uint8Array, fileName = ""): Song {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);

  const perTrack = new Map<number, Note[]>();
  const tempos: TempoChange[] = [];
  const handler = {
    addTimeSignature() {},
    addRest() {},
    addControlChange() {},
    addProgramChange() {},
    addBend() {},
    addNoteBend() {},
    finishTrack() {},
    addTickShift() {},
    addTempo(tick: number, bpm: number) {
      tempos.push({ beat: tick / TICKS_PER_QUARTER, bpm });
    },
    addNote(track: number, start: number, length: number, key: number, velocity: number) {
      if (length <= 0 || key < 0 || key > 127) return;
      let list = perTrack.get(track);
      if (!list) perTrack.set(track, (list = []));
      list.push({ pitch: key, start: start / TICKS_PER_QUARTER, dur: length / TICKS_PER_QUARTER, vel: Math.max(1, Math.min(127, velocity)) });
    },
  };
  new alphaTab.midi.MidiFileGenerator(score, settings, handler as unknown as alphaTab.midi.IMidiFileHandler).generate();

  const tracks: Track[] = score.tracks.map((t, i) => {
    const notes = (perTrack.get(i) ?? []).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const program = t.playbackInfo?.program ?? null;
    return {
      id: `t${i}`,
      name: t.name?.trim() || `Pista ${i + 1}`,
      program,
      isPercussion: t.isPercussion,
      role: guessRole(t.name ?? "", program, t.isPercussion, median(notes.map((n) => n.pitch))),
      notes,
    };
  });

  const mb = score.masterBars[0];
  const isXml = /\.(xml|musicxml|mxl)$/i.test(fileName);
  return {
    title: score.title?.trim() || fileName.replace(/\.[^.]+$/, "") || "Sin título",
    artist: score.artist?.trim() || "",
    tempos: normalizeTempos(tempos, score.tempo || 120),
    timeSignature: mb ? [mb.timeSignatureNumerator, mb.timeSignatureDenominator] : [4, 4],
    tracks: tracks.filter((t) => t.notes.length > 0),
    source: isXml ? "musicxml" : "guitar-pro",
  };
}
