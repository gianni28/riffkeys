/**
 * Piano de cola sampleado (Salamander Grand Piano, CC BY 3.0).
 *
 * Hay una muestra cada tres semitonos (de La0 a Do8) en tres capas de
 * intensidad: p, mf y f. Cada nota usa la muestra más cercana, afinada con
 * playbackRate, y la capa según la velocidad. Primero se descarga la capa mf
 * (con eso ya suena todo) y luego las otras dos en segundo plano.
 */

export type Layer = "p" | "mf" | "f";
const LAYERS: Layer[] = ["mf", "p", "f"];
export const SAMPLE_PITCHES = Array.from({ length: 30 }, (_, i) => 21 + i * 3);

export type PianoStatus = "idle" | "loading" | "ready" | "error";

export interface PianoVoice {
  /** Suelta la tecla en `at` (con la caída natural del apagador). */
  release(at: number): void;
  /** Corta en seco (al pausar o saltar). */
  kill(at: number): void;
  pitch: number;
}

export class SampledPiano {
  private buffers: Record<Layer, Map<number, AudioBuffer>> = { p: new Map(), mf: new Map(), f: new Map() };
  status: PianoStatus = "idle";
  progress = 0;
  onStatus: ((s: PianoStatus, progress: number) => void) | null = null;
  private loading: Promise<void> | null = null;

  constructor(private base = `${import.meta.env?.BASE_URL ?? "/"}piano/`) {}

  get ready() {
    return this.status === "ready";
  }

  load(ctx: BaseAudioContext): Promise<void> {
    if (this.loading) return this.loading;
    this.status = "loading";
    this.onStatus?.(this.status, 0);
    this.loading = (async () => {
      try {
        await this.loadLayer(ctx, "mf", (p) => {
          this.progress = p;
          this.onStatus?.("loading", p);
        });
        this.status = "ready";
        this.onStatus?.("ready", 1);
        // Las otras capas no bloquean: si fallan, se usa mf para todo.
        for (const l of LAYERS.slice(1)) await this.loadLayer(ctx, l).catch(() => undefined);
      } catch {
        this.status = "error";
        this.onStatus?.("error", 0);
      }
    })();
    return this.loading;
  }

  private async loadLayer(ctx: BaseAudioContext, layer: Layer, onProgress?: (p: number) => void) {
    let done = 0;
    // De a seis descargas a la vez para no saturar conexiones móviles.
    const queue = [...SAMPLE_PITCHES];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift()!;
        const res = await fetch(`${this.base}${layer}/${p}.mp3`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers[layer].set(p, buf);
        onProgress?.(++done / SAMPLE_PITCHES.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  private pick(pitch: number, vel: number): { buf: AudioBuffer; root: number; layer: Layer } | null {
    const want: Layer = vel < 56 ? "p" : vel < 100 ? "mf" : "f";
    const layer = this.buffers[want].size === SAMPLE_PITCHES.length ? want : "mf";
    const root = nearestSample(pitch);
    const buf = this.buffers[layer].get(root);
    return buf ? { buf, root, layer } : null;
  }

  /** Toca una nota en `at` hacia `dest`. Devuelve null si aún no hay muestras. */
  play(ctx: BaseAudioContext, dest: AudioNode, pitch: number, vel: number, at: number): PianoVoice | null {
    const s = this.pick(pitch, vel);
    if (!s) return null;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = 2 ** ((pitch - s.root) / 12);
    const gain = ctx.createGain();
    gain.gain.value = layerGain(vel, s.layer);
    src.connect(gain).connect(dest);
    src.start(at);
    const maxEnd = at + s.buf.duration / src.playbackRate.value;
    let released = false;
    const stop = (t: number) => {
      try {
        src.stop(Math.min(maxEnd, t));
      } catch {
        /* ya detenido */
      }
    };
    return {
      pitch,
      release: (t) => {
        if (released) return;
        released = true;
        // Los apagadores tardan más en frenar las cuerdas graves.
        const tau = pitch < 48 ? 0.16 : pitch < 72 ? 0.11 : 0.07;
        const when = Math.max(t, ctx.currentTime);
        gain.gain.setTargetAtTime(0, when, tau);
        stop(when + tau * 8);
      },
      kill: (t) => {
        released = true;
        const when = Math.max(t, ctx.currentTime);
        gain.gain.cancelScheduledValues(when);
        gain.gain.setTargetAtTime(0, when, 0.015);
        stop(when + 0.12);
      },
    };
  }
}

export function nearestSample(pitch: number): number {
  const i = Math.round((Math.max(21, Math.min(108, pitch)) - 21) / 3);
  return SAMPLE_PITCHES[Math.max(0, Math.min(SAMPLE_PITCHES.length - 1, i))];
}

/** Dentro de cada capa, la velocidad ajusta el volumen; entre capas cambia también el timbre. */
function layerGain(vel: number, layer: Layer): number {
  const [lo, hi] = layer === "p" ? [1, 55] : layer === "mf" ? [56, 99] : [100, 127];
  const t = Math.max(0, Math.min(1, (vel - lo) / Math.max(1, hi - lo)));
  return 0.62 + 0.38 * t;
}
