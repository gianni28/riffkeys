import { useEffect, useState } from "react";
import type { Player } from "../audio/player";

export const SPEEDS = [0.25, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25];

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Posición del reproductor como estado de React, sin re-renderizar a quien no la usa. */
export function usePosition(player: Player, fps = 30) {
  const [pos, setPos] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 1000 / fps) return;
      last = t;
      setPos(player.position());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player, fps]);
  return pos;
}
