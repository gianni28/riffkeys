import type { Player } from "../audio/player";
import type { TimedNote } from "../core/practice";
import { pitchName } from "../core/key";
import { beatToSeconds } from "../core/tempo";
import type { TempoChange } from "../core/model";
import { usePosition } from "../lib/transport";

/** Botón para saltar silencios largos (intros de batería) y aviso accesible del modo esperar. */
export function StageOverlay({ player, notes, bar, tempos }: { player: Player; notes: TimedNote[]; bar: number; tempos: TempoChange[] }) {
  const pos = usePosition(player, 8);
  const now = beatToSeconds(pos, tempos);
  let a = 0;
  let b = notes.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (notes[m].s < now - 1e-3) a = m + 1;
    else b = m;
  }
  const next = notes[a];
  const sounding = notes.some((n) => n.s <= now && n.e > now);
  const gap = next ? (next.s - now) / player.speed : 0;
  const holding = player.holding;

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {holding ? `Te espero: ${holding.pitches.map((p) => pitchName(p)).join(", ")}` : ""}
      </p>
      {next && !sounding && !holding && gap > 3.5 && (
        <button
          type="button"
          className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-white/10 bg-stage/80 px-4 py-2 text-sm font-semibold text-ink shadow-lg backdrop-blur transition hover:bg-raised"
          onClick={() => {
            const target = Math.max(pos, (Math.floor(next.start / bar + 1e-6) - 1) * bar);
            player.seek(target);
          }}
        >
          Saltar silencio · {Math.ceil(gap)} s ⏭
        </button>
      )}
    </>
  );
}
