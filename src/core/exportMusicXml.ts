import type { Arrangement, Note } from "./model";
import { estimateKey, spell } from "./key";

/** Resolución de la partitura: 4 divisiones por negra = semicorcheas. */
const DIV = 4;

/** Duraciones representables en unidades de semicorchea, de mayor a menor. */
const DURATIONS: { units: number; type: string; dots: number }[] = [
  { units: 16, type: "whole", dots: 0 },
  { units: 12, type: "half", dots: 1 },
  { units: 8, type: "half", dots: 0 },
  { units: 6, type: "quarter", dots: 1 },
  { units: 4, type: "quarter", dots: 0 },
  { units: 3, type: "eighth", dots: 1 },
  { units: 2, type: "eighth", dots: 0 },
  { units: 1, type: "16th", dots: 0 },
];

interface Segment {
  start: number; // unidades
  len: number;
  pitches: number[] | null; // null = silencio
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Convierte las notas de una mano en una línea de acordes y silencios
 * cuantizada a semicorcheas (una sola voz por pentagrama: más legible
 * para aprender que reproducir cada solapamiento exacto).
 */
export function toSegments(notes: Note[], totalUnits: number): Segment[] {
  const onsets = new Map<number, Note[]>();
  for (const n of notes) {
    const q = Math.round(n.start * DIV);
    if (q >= totalUnits) continue;
    let list = onsets.get(q);
    if (!list) onsets.set(q, (list = []));
    list.push(n);
  }
  const starts = [...onsets.keys()].sort((a, b) => a - b);
  const segs: Segment[] = [];
  let cursor = 0;
  starts.forEach((s, i) => {
    if (s > cursor) segs.push({ start: cursor, len: s - cursor, pitches: null });
    const group = onsets.get(s)!;
    const next = starts[i + 1] ?? totalUnits;
    const shortest = Math.min(...group.map((n) => Math.max(1, Math.round(n.dur * DIV))));
    const len = Math.max(1, Math.min(shortest, next - s));
    segs.push({ start: s, len, pitches: [...new Set(group.map((n) => n.pitch))].sort((a, b) => a - b) });
    cursor = s + len;
  });
  if (cursor < totalUnits) segs.push({ start: cursor, len: totalUnits - cursor, pitches: null });
  return segs;
}

/** Parte un largo en figuras representables, respetando el pulso cuando se puede. */
export function splitDuration(start: number, len: number): { units: number; type: string; dots: number }[] {
  const out: { units: number; type: string; dots: number }[] = [];
  let pos = start;
  let left = len;
  while (left > 0) {
    // Solo figuras que no crucen un límite de negra si no empiezan en él (lectura más clara).
    const fit = DURATIONS.find((d) => d.units <= left && (d.units <= 4 ? Math.floor(pos / 4) === Math.floor((pos + d.units - 1) / 4) || pos % 4 === 0 : pos % 4 === 0)) ?? DURATIONS[DURATIONS.length - 1];
    out.push(fit);
    pos += fit.units;
    left -= fit.units;
  }
  return out;
}

export function toMusicXml(arr: Arrangement): string {
  const [num, den] = arr.timeSignature;
  const measureUnits = Math.round(num * (4 / den) * DIV);
  const lengthUnits = Math.ceil(arr.length * DIV);
  const measures = Math.max(1, Math.ceil(lengthUnits / measureUnits));
  const total = measures * measureUnits;
  const key = estimateKey([...arr.right, ...arr.left]);
  const flats = key.fifths < 0;

  const staffSegs = [toSegments(arr.right, total), toSegments(arr.left, total)];

  // Parte cada segmento en los límites de compás.
  const perMeasure: Segment[][][] = Array.from({ length: measures }, () => [[], []]);
  staffSegs.forEach((segs, staff) => {
    for (const seg of segs) {
      let s = seg.start;
      let left = seg.len;
      while (left > 0) {
        const m = Math.floor(s / measureUnits);
        const inMeasure = Math.min(left, (m + 1) * measureUnits - s);
        perMeasure[m][staff].push({ start: s, len: inMeasure, pitches: seg.pitches });
        s += inMeasure;
        left -= inMeasure;
      }
    }
  });

  const noteXml = (pitches: number[] | null, d: { units: number; type: string; dots: number }, staff: number, tieStart: boolean, tieStop: boolean) => {
    // Una voz por pentagrama; alphaTab dibuja en gris las voces secundarias.
    const voice = 1;
    const dots = "<dot/>".repeat(d.dots);
    if (!pitches) {
      return `<note><rest/><duration>${d.units}</duration><voice>${voice}</voice><type>${d.type}</type>${dots}<staff>${staff}</staff></note>`;
    }
    return pitches
      .map((p, i) => {
        const { step, alter, octave } = spell(p, flats);
        const ties = `${tieStop ? '<tie type="stop"/>' : ""}${tieStart ? '<tie type="start"/>' : ""}`;
        const tied = tieStart || tieStop ? `<notations>${tieStop ? '<tied type="stop"/>' : ""}${tieStart ? '<tied type="start"/>' : ""}</notations>` : "";
        return `<note>${i > 0 ? "<chord/>" : ""}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch><duration>${d.units}</duration>${ties}<voice>${voice}</voice><type>${d.type}</type>${dots}<staff>${staff}</staff>${tied}</note>`;
      })
      .join("");
  };

  // Para ligar notas que cruzan barras, sabemos si el segmento continúa el anterior.
  const body: string[] = [];
  for (let m = 0; m < measures; m++) {
    const parts: string[] = [];
    if (m === 0) {
      parts.push(
        `<attributes><divisions>${DIV}</divisions><key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key><time><beats>${num}</beats><beat-type>${den}</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`,
      );
    }
    const measureStart = m * measureUnits;
    const endBeat = (measureStart + measureUnits) / DIV;
    for (const t of arr.tempos) {
      if (t.beat >= measureStart / DIV && t.beat < endBeat && (m === 0 || t.beat > 0)) {
        parts.push(
          `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(t.bpm)}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${Math.round(t.bpm)}"/></direction>`,
        );
        break;
      }
    }
    [0, 1].forEach((staffIdx) => {
      if (staffIdx === 1) parts.push(`<backup><duration>${measureUnits}</duration></backup>`);
      const segs = perMeasure[m][staffIdx];
      for (const seg of segs) {
        const pieces = splitDuration(seg.start - measureStart, seg.len);
        const continuesFromBefore = Boolean(seg.pitches) && seg.start === measureStart && m > 0 && continues(staffSegs[staffIdx], seg.start);
        const continuesAfter = Boolean(seg.pitches) && seg.start + seg.len === measureStart + measureUnits && continues(staffSegs[staffIdx], seg.start + seg.len);
        pieces.forEach((d, k) => {
          const tieStop = k > 0 || continuesFromBefore;
          const tieStart = k < pieces.length - 1 || continuesAfter;
          parts.push(noteXml(seg.pitches, d, staffIdx + 1, Boolean(seg.pitches) && tieStart, Boolean(seg.pitches) && tieStop));
        });
      }
    });
    body.push(`<measure number="${m + 1}">${parts.join("")}</measure>`);
  }

  const composer = arr.artist ? `<creator type="composer">${esc(arr.artist)}</creator>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>${esc(arr.title)}</work-title></work><identification>${composer}<encoding><software>Riffkeys</software></encoding></identification><part-list><score-part id="P1"><part-name>Piano</part-name><score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${body.join("")}</part></score-partwise>`;
}

/** ¿Hay un segmento con sonido que atraviesa la posición `at` (una barra de compás)? */
function continues(segs: Segment[], at: number): boolean {
  return segs.some((s) => s.pitches && s.start < at && s.start + s.len > at);
}
