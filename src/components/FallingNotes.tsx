import { useEffect, useMemo, useRef } from "react";
import type { TimedNote, PracticeScorer, WaitChord, HandId } from "../core/practice";
import { pitchName } from "../core/key";
import { layoutKeys, visibleRange, type KeyRect } from "../lib/keyboard";
import { HAND_COLOR, HAND_COLOR_DARK, HAND_COLOR_LIGHT, HIT_COLOR, WRONG_COLOR } from "../lib/colors";

/** Lo mínimo que la vista necesita del reproductor (así la portada puede usar un reloj falso). */
export interface Clock {
  songSeconds(): number;
  speed: number;
  countdown?(): number;
  holding?: WaitChord | null;
}

interface Props {
  notes: TimedNote[];
  clock: Clock;
  /** Teclas que el usuario está presionando en su teclado MIDI. */
  pressed?: Set<number>;
  showNames?: boolean;
  /** Segundos de anticipación visibles sobre el teclado (a velocidad normal). */
  lookahead?: number;
  /** Inicio de cada compás, en segundos de canción. */
  bars?: number[];
  /** Bucle A–B en segundos de canción. */
  loop?: { from: number; to: number } | null;
  scorer?: PracticeScorer | null;
  /** Vista reducida para la portada: sin nombres ni avisos. */
  compact?: boolean;
  onKeyDown?: (pitch: number) => void;
  onKeyUp?: (pitch: number) => void;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  r: number;
}

const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Vista de notas cayendo al estilo Synthesia, dibujada en canvas a 60 fps. */
export function FallingNotes(props: Props) {
  const { notes, compact = false } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const pointerKeys = useRef(new Map<number, number>()); // pointerId → tecla

  const prepared = useMemo(() => {
    const [lo, hi] = visibleRange(notes.map((n) => n.pitch));
    const { keys, whiteCount } = layoutKeys(lo, hi);
    const byPitch = new Map(keys.map((k) => [k.pitch, k]));
    const maxDur = Math.max(0.1, ...notes.map((n) => n.e - n.s));
    return { keys, whiteCount, byPitch, lo, hi, maxDur };
  }, [notes]);

  const geometry = (W: number, H: number) => {
    const unit = W / prepared.whiteCount;
    const kh = compact ? Math.min(90, Math.max(46, unit * 4.6)) : Math.min(150, Math.max(72, unit * 5.4));
    return { unit, kh, hitY: H - kh };
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let W = 0;
    let H = 0;
    let last = performance.now();
    let lastNow = Number.NaN;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sparks: Spark[] = [];
    const calm = reducedMotion();

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
      const rr = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    };

    /** Primera nota que podría seguir sonando en `t` (búsqueda binaria). */
    const firstFrom = (t: number) => {
      let a = 0;
      let b = notes.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (notes[m].s < t) a = m + 1;
        else b = m;
      }
      return a;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const nowMs = performance.now();
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const p = live.current;
      const { keys, byPitch, maxDur } = prepared;
      const { unit, kh, hitY } = geometry(W, H);
      const lookahead = p.lookahead ?? 3;
      const speed = p.clock.speed;
      const now = p.clock.songSeconds();
      const pps = (hitY * speed) / lookahead; // píxeles por segundo de canción
      const yOf = (sec: number) => hitY - (sec - now) * pps;
      const scorer = p.scorer;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";

      // Fondo con carriles: las teclas negras tienen un carril algo más oscuro.
      const bg = ctx.createLinearGradient(0, 0, 0, hitY);
      bg.addColorStop(0, "#0d0e14");
      bg.addColorStop(1, "#181924");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      for (const k of keys) {
        if (k.black) {
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          ctx.fillRect(k.x * unit, 0, k.w * unit, hitY);
        } else if (k.pitch % 12 === 0 || k.pitch % 12 === 5) {
          ctx.fillStyle = k.pitch % 12 === 0 ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)";
          ctx.fillRect(Math.round(k.x * unit), 0, 1, hitY);
        }
      }

      // Líneas de compás con su número
      if (p.bars?.length) {
        ctx.font = "600 10px Figtree Variable, system-ui, sans-serif";
        ctx.textAlign = "left";
        const top = now + hitY / pps;
        for (let b = 0; b < p.bars.length; b++) {
          const sec = p.bars[b];
          if (sec < now - 0.01 || sec > top) continue;
          const y = Math.round(yOf(sec)) + 0.5;
          ctx.fillStyle = "rgba(255,255,255,0.07)";
          ctx.fillRect(0, y, W, 1);
          if (!compact) {
            ctx.fillStyle = "rgba(157,158,178,0.55)";
            ctx.fillText(String(b + 1), 6, y - 4);
          }
        }
      }

      // Bucle A–B
      if (p.loop) {
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.font = "800 12px Figtree Variable, system-ui, sans-serif";
        ctx.textAlign = "right";
        for (const [sec, label] of [
          [p.loop.from, "A"],
          [p.loop.to, "B"],
        ] as const) {
          const y = yOf(sec);
          if (y < 0 || y > hitY) continue;
          ctx.strokeStyle = "rgba(255,209,102,0.75)";
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
          ctx.fillStyle = "#ffd166";
          ctx.fillText(label, W - 8, y - 5);
        }
        ctx.setLineDash([]);
      }

      // Notas
      const active = new Map<number, HandId>();
      const maxS = now + hitY / pps;
      for (let i = firstFrom(now - maxDur - 0.1); i < notes.length; i++) {
        const n = notes[i];
        if (n.s > maxS) break;
        if (n.e < now - 0.05) continue;
        const k = byPitch.get(n.pitch);
        if (!k) continue;
        const isActive = n.s <= now + 1e-4 && n.e > now;
        if (isActive) active.set(n.pitch, n.hand);
        const pad = k.black ? 0.5 : 1.5;
        const x = k.x * unit + pad;
        const w = k.w * unit - pad * 2;
        const top = Math.max(-4, yOf(n.e));
        const bottom = Math.min(hitY, yOf(n.s));
        if (bottom - top < 1) continue;
        const res = scorer?.result.get(n.i);
        let fill: string = k.black ? HAND_COLOR_DARK[n.hand] : HAND_COLOR[n.hand];
        if (res === "hit") fill = HAND_COLOR_LIGHT[n.hand];
        if (res === "miss") fill = "#4b4d5c";
        if (isActive && !calm) {
          ctx.shadowColor = HAND_COLOR[n.hand];
          ctx.shadowBlur = 18;
        }
        ctx.fillStyle = fill;
        roundRect(x, top, w, bottom - top, Math.min(6, w / 3));
        ctx.fill();
        ctx.shadowBlur = 0;
        // Brillo en el borde izquierdo y en la punta, para darle volumen.
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(x + 1.5, top + 3, Math.max(1, w * 0.12), Math.max(0, bottom - top - 6));
        if (res === "hit") {
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 1.5;
          roundRect(x + 0.75, top + 0.75, w - 1.5, bottom - top - 1.5, Math.min(6, w / 3));
          ctx.stroke();
        }
        if (p.showNames && !compact && bottom - top > 16 && w > 12) {
          ctx.fillStyle = res === "miss" ? "rgba(236,235,242,0.6)" : "rgba(10,12,20,0.85)";
          ctx.font = `700 ${Math.min(11, w * 0.42)}px Figtree Variable, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(pitchName(n.pitch).replace(/\d+$/, ""), x + w / 2, bottom - 5);
        }
      }

      // Avisos: cuenta previa, espera, silencio largo
      const count = p.clock.countdown?.() ?? 0;
      if (!compact) {
        if (count > 0) {
          ctx.fillStyle = "rgba(243,240,232,0.92)";
          ctx.font = "900 120px 'Big Shoulders Display', Impact, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(String(count), W / 2, hitY / 2 + 40);
        } else if (p.clock.holding) {
          const names = p.clock.holding.pitches.map((x) => pitchName(x)).join(" · ");
          const text = `Te espero: ${names}`;
          ctx.font = "700 14px Figtree Variable, system-ui, sans-serif";
          const tw = ctx.measureText(text).width + 28;
          ctx.fillStyle = "rgba(20,21,29,0.85)";
          roundRect(W / 2 - tw / 2, 14, tw, 32, 16);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,209,102,0.6)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "#ffd166";
          ctx.textAlign = "center";
          ctx.fillText(text, W / 2, 35);
        } else if (active.size === 0) {
          const next = notes[firstFrom(now)];
          if (next && next.s - now > (hitY / pps) * 0.9) {
            const wait = (next.s - now) / speed;
            ctx.fillStyle = "rgba(236,235,242,0.55)";
            ctx.font = "600 15px Figtree Variable, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(`La próxima nota llega en ${Math.ceil(wait)} s`, W / 2, hitY / 2);
          }
        }
      }

      // Línea de golpe con el color de las dos manos
      const line = ctx.createLinearGradient(0, 0, W, 0);
      line.addColorStop(0, HAND_COLOR.left);
      line.addColorStop(1, HAND_COLOR.right);
      const glow = ctx.createLinearGradient(0, hitY - 28, 0, hitY);
      glow.addColorStop(0, "rgba(255,255,255,0)");
      glow.addColorStop(1, "rgba(255,255,255,0.08)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, hitY - 28, W, 28);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = line;
      ctx.fillRect(0, hitY - 2, W, 2);
      ctx.globalAlpha = 1;

      // Resplandor y chispas sobre las teclas que suenan
      // Chispas solo mientras el tiempo avanza (no en pausa ni esperando).
      const playing = now !== lastNow && !p.clock.holding && count === 0;
      lastNow = now;
      ctx.globalCompositeOperation = "lighter";
      for (const [pitch, hand] of active) {
        const k = byPitch.get(pitch)!;
        const cx = (k.x + k.w / 2) * unit;
        const r = unit * 1.8;
        const g = ctx.createRadialGradient(cx, hitY, 0, cx, hitY, r);
        g.addColorStop(0, hexA(HAND_COLOR[hand], 0.55));
        g.addColorStop(1, hexA(HAND_COLOR[hand], 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, hitY - r, r * 2, r);
        if (!calm && playing && sparks.length < 500 && Math.random() < 0.7) {
          sparks.push({
            x: cx + (Math.random() - 0.5) * k.w * unit,
            y: hitY - 2,
            vx: (Math.random() - 0.5) * 60,
            vy: -60 - Math.random() * 140,
            life: 0,
            max: 0.35 + Math.random() * 0.45,
            color: Math.random() < 0.35 ? "#ffffff" : HAND_COLOR_LIGHT[hand],
            r: 0.8 + Math.random() * 1.6,
          });
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life += dt;
        if (s.life >= s.max) {
          sparks.splice(i, 1);
          continue;
        }
        s.vy += 120 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        ctx.globalAlpha = 1 - s.life / s.max;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // Teclado: primero blancas, luego negras encima
      const you = p.pressed ?? new Set<number>();
      const touch = new Set(pointerKeys.current.values());
      const flashes = new Map<number, "hit" | "wrong">();
      for (const f of scorer?.flashes ?? []) if (nowMs - f.at < 380) flashes.set(f.pitch, f.kind);
      const holdNeed = new Set(p.clock.holding?.pitches ?? []);

      const drawKey = (k: KeyRect) => {
        const x = k.x * unit;
        const w = k.w * unit;
        const h = k.black ? kh * 0.62 : kh;
        const hand = active.get(k.pitch);
        const mine = you.has(k.pitch) || touch.has(k.pitch);
        const down = !!hand || mine;
        const dy = down ? (k.black ? 1.5 : 2.5) : 0;
        let top: string;
        let bottom: string;
        if (hand) {
          top = HAND_COLOR_LIGHT[hand];
          bottom = k.black ? HAND_COLOR_DARK[hand] : HAND_COLOR[hand];
        } else if (k.black) {
          top = mine ? "#6a6d7c" : "#2c2d37";
          bottom = mine ? "#4a4c58" : "#111118";
        } else {
          top = mine ? "#d9dce6" : "#fbf9f3";
          bottom = mine ? "#b9bdcb" : "#e4e0d5";
        }
        const flash = flashes.get(k.pitch);
        if (flash) {
          top = flash === "hit" ? "#c9ffe0" : "#ffc2c8";
          bottom = flash === "hit" ? HIT_COLOR : WRONG_COLOR;
        }
        const g = ctx.createLinearGradient(0, hitY, 0, hitY + h);
        g.addColorStop(0, top);
        g.addColorStop(1, bottom);
        ctx.fillStyle = g;
        roundRect(x + (k.black ? 0 : 0.5), hitY + dy - 4, w - (k.black ? 0 : 1), h - dy + 4, k.black ? 3 : 5);
        ctx.fill();
        if (holdNeed.has(k.pitch) && !mine) {
          // En modo esperar, las teclas que faltan laten.
          ctx.strokeStyle = `rgba(255,209,102,${0.55 + 0.45 * Math.sin(nowMs / 140)})`;
          ctx.lineWidth = 2;
          roundRect(x + 2, hitY + 2, w - 4, h - 4, k.black ? 3 : 5);
          ctx.stroke();
        }
        if (!k.black) {
          ctx.fillStyle = "rgba(0,0,0,0.14)";
          ctx.fillRect(x + w - 0.5, hitY, 1, h);
          if (!compact && k.pitch % 12 === 0 && unit > 14) {
            ctx.fillStyle = hand ? "rgba(10,12,20,0.7)" : "rgba(40,40,50,0.45)";
            ctx.font = `600 ${Math.min(11, unit * 0.45)}px Figtree Variable, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(pitchName(k.pitch), x + w / 2, hitY + h - 8);
          }
        } else if (!down) {
          ctx.fillStyle = "rgba(255,255,255,0.1)";
          ctx.fillRect(x + 2, hitY + h - 7, w - 4, 3);
        }
      };
      for (const k of keys) if (!k.black) drawKey(k);
      for (const k of keys) if (k.black) drawKey(k);

      // Sombra bajo la línea de golpe
      const sh = ctx.createLinearGradient(0, hitY, 0, hitY + 8);
      sh.addColorStop(0, "rgba(0,0,0,0.45)");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sh;
      ctx.fillRect(0, hitY, W, 8);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // geometry solo depende de prepared y compact
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, notes, compact]);

  const keyAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const { keys } = prepared;
    const { unit, kh, hitY } = geometry(r.width, r.height);
    if (y < hitY) return null;
    const inBlack = y < hitY + kh * 0.62;
    const hit =
      (inBlack && keys.find((k) => k.black && x >= k.x * unit && x <= (k.x + k.w) * unit)) ||
      keys.find((k) => !k.black && x >= k.x * unit && x < (k.x + 1) * unit);
    return hit ? hit.pitch : null;
  };

  const release = (id: number) => {
    const pitch = pointerKeys.current.get(id);
    if (pitch === undefined) return;
    pointerKeys.current.delete(id);
    live.current.onKeyUp?.(pitch);
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(e) => {
        const pitch = keyAt(e);
        if (pitch === null || !live.current.onKeyDown) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointerKeys.current.set(e.pointerId, pitch);
        live.current.onKeyDown(pitch);
      }}
      onPointerMove={(e) => {
        const cur = pointerKeys.current.get(e.pointerId);
        if (cur === undefined) return;
        const pitch = keyAt(e);
        if (pitch === null || pitch === cur) return;
        release(e.pointerId);
        pointerKeys.current.set(e.pointerId, pitch);
        live.current.onKeyDown?.(pitch);
      }}
      onPointerUp={(e) => release(e.pointerId)}
      onPointerCancel={(e) => release(e.pointerId)}
      className="block h-full w-full touch-none select-none"
      role="img"
      aria-label={`Notas cayendo del arreglo para piano: ${notes.filter((n) => n.hand === "right").length} notas para la mano derecha y ${notes.filter((n) => n.hand === "left").length} para la izquierda. Rango de ${pitchName(prepared.lo)} a ${pitchName(prepared.hi)}.`}
    />
  );
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
