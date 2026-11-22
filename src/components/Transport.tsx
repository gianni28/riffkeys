import type { Player } from "../audio/player";
import type { Arrangement } from "../core/model";
import { barLength, beatToSeconds } from "../core/tempo";
import { IconButton } from "./ui";
import { SPEEDS, fmtTime, usePosition } from "../lib/transport";
import { BackIcon, ExpandIcon, ForwardIcon, LoopIcon, MetronomeIcon, PauseIcon, PlayIcon, RestartIcon, ShrinkIcon, VolumeIcon } from "./Icons";

interface Props {
  player: Player;
  arrangement: Arrangement;
  playing: boolean;
  onToggle: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  metronome: boolean;
  onMetronome: (v: boolean) => void;
  loop: { from: number; to: number } | null;
  onLoopToggle: () => void;
  volume: number;
  onVolume: (v: number) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}

export function Transport(p: Props) {
  const { player, arrangement: arr } = p;
  const pos = Math.max(0, usePosition(player));
  const bar = barLength(arr.timeSignature);
  const curBar = Math.floor(pos / bar + 1e-6);
  const totalBars = Math.max(1, Math.ceil(arr.length / bar - 1e-6));
  const totalSec = beatToSeconds(arr.length, arr.tempos) / p.speed;
  const pct = (b: number) => `${(100 * Math.min(arr.length, Math.max(0, b))) / Math.max(arr.length, 1e-6)}%`;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-line bg-surface/95 px-2 py-2 sm:px-3">
      <div className="flex items-center gap-0.5">
        <IconButton label="Volver al inicio (Inicio)" onClick={() => player.seek(p.loop?.from ?? 0)}>
          <RestartIcon />
        </IconButton>
        <IconButton label="Compás anterior (←)" onClick={() => player.seek((curBar - (pos - curBar * bar < 0.25 ? 1 : 0)) * bar)}>
          <BackIcon />
        </IconButton>
        <button
          type="button"
          onClick={p.onToggle}
          className="mx-1 grid h-12 w-12 place-items-center rounded-full bg-bone text-stage shadow-[0_0_0_4px_rgba(243,240,232,0.08)] transition hover:scale-105 hover:bg-white active:scale-95"
          aria-label={p.playing ? "Pausar (espacio)" : "Reproducir (espacio)"}
          title={p.playing ? "Pausar (espacio)" : "Reproducir (espacio)"}
        >
          {p.playing ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} className="translate-x-px" />}
        </button>
        <IconButton label="Compás siguiente (→)" onClick={() => player.seek(Math.min(arr.length, (curBar + 1) * bar))}>
          <ForwardIcon />
        </IconButton>
      </div>

      <div className="order-last flex w-full min-w-[12rem] flex-1 items-center gap-3 sm:order-none sm:w-auto">
        <span className="num w-10 text-right text-xs text-muted">{fmtTime(beatToSeconds(pos, arr.tempos) / p.speed)}</span>
        <div className="relative flex h-8 flex-1 items-center">
          <div className="absolute inset-x-0 h-1.5 rounded-full bg-line" />
          {p.loop && <div className="absolute h-1.5 rounded-full bg-gold/40" style={{ left: pct(p.loop.from), width: `calc(${pct(p.loop.to)} - ${pct(p.loop.from)})` }} />}
          <div className="absolute h-1.5 rounded-full bg-gradient-to-r from-lh to-rh" style={{ width: pct(pos) }} />
          <input
            type="range"
            min={0}
            max={arr.length}
            step={0.25}
            value={Math.min(pos, arr.length)}
            onChange={(e) => player.seek(Number(e.target.value))}
            className="seek relative w-full"
            aria-label="Posición en la canción"
            aria-valuetext={`Compás ${curBar + 1} de ${totalBars}`}
          />
        </div>
        <span className="num w-10 text-xs text-muted">{fmtTime(totalSec)}</span>
        <span className="num hidden w-16 text-xs text-muted md:inline" aria-hidden="true">
          c. {Math.min(curBar + 1, totalBars)}/{totalBars}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <label className="flex items-center" title="Velocidad ([ y ])">
          <span className="sr-only">Velocidad</span>
          <select className="field num h-9 border-transparent bg-raised pr-7 font-semibold" value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)} %
              </option>
            ))}
          </select>
        </label>
        <IconButton label="Metrónomo (M)" active={p.metronome} onClick={() => p.onMetronome(!p.metronome)}>
          <MetronomeIcon />
        </IconButton>
        <IconButton label="Repetir un pasaje (L)" active={!!p.loop} onClick={p.onLoopToggle}>
          <LoopIcon />
        </IconButton>
        <label className="hidden items-center gap-1.5 px-1 text-muted lg:flex" title="Volumen">
          <VolumeIcon />
          <span className="sr-only">Volumen</span>
          <input type="range" min={0} max={1.5} step={0.05} value={p.volume} onChange={(e) => p.onVolume(Number(e.target.value))} className="w-20 accent-bone" />
        </label>
        <IconButton label={p.fullscreen ? "Salir de pantalla completa (F)" : "Pantalla completa (F)"} onClick={p.onFullscreen}>
          {p.fullscreen ? <ShrinkIcon /> : <ExpandIcon />}
        </IconButton>
      </div>
    </div>
  );
}
