import { useMemo } from "react";
import { parseAsciiTab } from "../core/importTab";
import { arrange } from "../core/arrange";
import { timedNotes } from "../core/practice";
import { barStarts, beatToSeconds } from "../core/tempo";
import { EXAMPLE_TAB } from "../core/example";
import { FallingNotes, type Clock } from "./FallingNotes";

/** Notas cayendo en silencio con el riff de ejemplo, para la portada. */
export function DemoStage() {
  const { notes, clock, bars } = useMemo(() => {
    const song = parseAsciiTab(EXAMPLE_TAB.text, EXAMPLE_TAB.options).song;
    const arr = arrange(song, { t0: "split" }, { leftOctaves: true });
    const notes = timedNotes(arr);
    const total = beatToSeconds(arr.length, arr.tempos) + 1.5;
    const t0 = performance.now();
    const clock: Clock = {
      speed: 1,
      songSeconds: () => (((performance.now() - t0) / 1000) % total) - 1,
    };
    const bars = barStarts(arr.length, arr.timeSignature).map((b) => beatToSeconds(b, arr.tempos));
    return { notes, clock, bars };
  }, []);
  return <FallingNotes notes={notes} clock={clock} bars={bars} lookahead={2.2} compact />;
}
