import { useEffect, useMemo, useRef } from "react";
import type { Arrangement } from "../core/model";
import { beatToSeconds } from "../core/tempo";
import { pitchName } from "../core/key";
import { layoutKeys, visibleRange } from "../lib/keyboard";
import type { Player } from "../audio/player";

import { HAND_COLOR } from "../lib/colors";
const HAND_COLOR_DARK = { right: "#3f63c9", left: "#c96a22" } as const;

interface Props {
  arrangement: Arrangement;
  player: Player;
  /** Teclas que el usuario está presionando en su teclado MIDI. */
  pressed: Set<number>;
  showNames: boolean;
  /** Segundos de anticipación visibles sobre el teclado. */
  lookahead?: number;
  onKey?: (pitch: number) => void;
}

/** Vista de notas cayendo al estilo Synthesia, dibujada en canvas a 60 fps. */
export function FallingNotes({ arrangement, player, pressed, showNames, lookahead = 3, onKey }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pressedRef = useRef(pressed);
  pressedRef.current = pressed;

  const prepared = useMemo(() => {
    const t = arrangement.tempos;
    const all = [
      ...arrangement.right.map((n) => ({ ...n, hand: "right" as const })),
      ...arrangement.left.map((n) => ({ ...n, hand: "left" as const })),
    ].map((n) => ({ ...n, s: beatToSeconds(n.start, t), e: beatToSeconds(n.start + n.dur, t) }));
    all.sort((a, b) => a.s - b.s);
    const [lo, hi] = visibleRange(all.map((n) => n.pitch));
    const { keys, whiteCount } = layoutKeys(lo, hi);
    const byPitch = new Map(keys.map((k) => [k.pitch, k]));
    return { notes: all, keys, whiteCount, byPitch, lo, hi };
  }, [arrangement]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let W = 0;
    let H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { notes, keys, whiteCount, byPitch } = prepared;
      const unit = W / whiteCount;
      const kh = Math.min(140, Math.max(70, unit * 5.2));
      const hitY = H - kh;
      const speed = player.speed;
      const now = beatToSeconds(player.position(), arrangement.tempos);
      const pps = (hitY * speed) / lookahead; // píxeles por segundo de canción (a velocidad 1)

      // Fondo
      ctx.fillStyle = "#15161d";
      ctx.fillRect(0, 0, W, H);
      // Guías de octava (en cada Do) y de Fa, para ubicar las teclas
      for (const k of keys) {
        if (k.black) continue;
        const pc = k.pitch % 12;
        if (pc === 0 || pc === 5) {
          ctx.fillStyle = pc === 0 ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)";
          ctx.fillRect(Math.round(k.x * unit), 0, 1, hitY);
        }
      }

      // Notas
      const active = new Map<number, "right" | "left">();
      const minS = now - 0.05;
      const maxS = now + hitY / pps;
      for (const n of notes) {
        if (n.s > maxS) break;
        if (n.e < minS) continue;
        const k = byPitch.get(n.pitch);
        if (!k) continue;
        const yBottom = hitY - (n.s - now) * pps;
        const yTop = hitY - (n.e - now) * pps;
        const isActive = n.s <= now && n.e > now;
        if (isActive) active.set(n.pitch, n.hand);
        const pad = k.black ? 0.5 : 1.5;
        const x = k.x * unit + pad;
        const w = k.w * unit - pad * 2;
        const top = Math.max(-4, yTop);
        const bottom = Math.min(hitY, yBottom);
        if (bottom <= top) continue;
        ctx.fillStyle = k.black ? HAND_COLOR_DARK[n.hand] : HAND_COLOR[n.hand];
        ctx.globalAlpha = isActive ? 1 : 0.92;
        roundRect(x, top, w, bottom - top, Math.min(6, w / 3));
        ctx.fill();
        ctx.globalAlpha = 1;
        if (showNames && bottom - top > 16 && w > 12) {
          ctx.fillStyle = "rgba(10,12,20,0.85)";
          ctx.font = `700 ${Math.min(11, w * 0.42)}px Figtree Variable, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(pitchName(n.pitch).replace(/\d+$/, ""), x + w / 2, bottom - 5);
        }
      }

      // Si falta mucho para la próxima nota (intro o silencio largo), avísalo.
      const next = notes.find((n) => n.e > now);
      if (next && next.s - now > (hitY / pps) * 0.9 && active.size === 0) {
        const wait = (next.s - now) / speed;
        ctx.fillStyle = "rgba(236,235,242,0.55)";
        ctx.font = "600 15px Figtree Variable, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`La próxima nota llega en ${Math.ceil(wait)} s`, W / 2, hitY / 2);
      }

      // Línea de golpe
      const glow = ctx.createLinearGradient(0, hitY - 18, 0, hitY);
      glow.addColorStop(0, "rgba(255,255,255,0)");
      glow.addColorStop(1, "rgba(255,255,255,0.10)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, hitY - 18, W, 18);

      // Teclado: primero blancas, luego negras encima
      const you = pressedRef.current;
      for (const pass of [false, true]) {
        for (const k of keys) {
          if (k.black !== pass) continue;
          const x = k.x * unit;
          const w = k.w * unit;
          const h = k.black ? kh * 0.62 : kh;
          const hand = active.get(k.pitch);
          let fill = k.black ? "#1d1e25" : "#f3f0e8";
          if (hand) fill = k.black ? HAND_COLOR_DARK[hand] : HAND_COLOR[hand];
          if (you.has(k.pitch)) fill = hand ? "#ffffff" : k.black ? "#5a5d6b" : "#c9ccd8";
          ctx.fillStyle = fill;
          roundRect(x + (k.black ? 0 : 0.5), hitY, w - (k.black ? 0 : 1), h, k.black ? 3 : 5);
          ctx.fill();
          if (!k.black) {
            ctx.fillStyle = "rgba(0,0,0,0.12)";
            ctx.fillRect(x + w - 0.5, hitY, 1, h);
            if (k.pitch % 12 === 0 && unit > 14) {
              ctx.fillStyle = hand ? "rgba(10,12,20,0.7)" : "rgba(40,40,50,0.45)";
              ctx.font = `600 ${Math.min(11, unit * 0.45)}px Figtree Variable, system-ui, sans-serif`;
              ctx.textAlign = "center";
              ctx.fillText(pitchName(k.pitch), x + w / 2, hitY + h - 8);
            }
          }
        }
      }
      // Sombra superior del teclado
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, hitY, W, 3);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [prepared, player, arrangement.tempos, showNames, lookahead]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onKey) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const { keys, whiteCount } = prepared;
    const unit = r.width / whiteCount;
    const kh = Math.min(140, Math.max(70, unit * 5.2));
    const hitY = r.height - kh;
    if (y < hitY) return;
    const inBlack = y < hitY + kh * 0.62;
    const hit =
      (inBlack && keys.find((k) => k.black && x >= k.x * unit && x <= (k.x + k.w) * unit)) ||
      keys.find((k) => !k.black && x >= k.x * unit && x < (k.x + 1) * unit);
    if (hit) onKey(hit.pitch);
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      className="block h-full w-full touch-none"
      role="img"
      aria-label={`Notas cayendo del arreglo para piano: ${arrangement.right.length} notas para la mano derecha y ${arrangement.left.length} para la izquierda. Rango de ${pitchName(prepared.lo)} a ${pitchName(prepared.hi)}.`}
    />
  );
}

