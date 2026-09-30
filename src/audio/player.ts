import type { Arrangement, Note } from "../core/model";
import { beatToSeconds, secondsToBeat } from "../core/tempo";

interface Voice {
  osc: OscillatorNode[];
  gain: GainNode;
}

/**
 * Reproductor propio sobre Web Audio. Programa las notas con ~120 ms de
 * anticipación (el patrón "two clocks" de Chris Wilson) para que el audio
 * no dependa de que el hilo principal esté libre, y expone la posición en
 * negras para sincronizar la vista de notas cayendo.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private arr: Arrangement | null = null;
  private notes: (Note & { hand: "right" | "left" })[] = [];
  private cursor = 0; // índice de la próxima nota por programar
  private startCtxTime = 0; // ctx.currentTime al empezar
  private startSeconds = 0; // segundos de canción al empezar
  private timer: number | null = null;
  private voices = new Set<Voice>();
  speed = 1;
  playing = false;
  muted: Record<"right" | "left", boolean> = { right: false, left: false };
  loop: { from: number; to: number } | null = null;
  onEnd: (() => void) | null = null;

  load(arr: Arrangement) {
    this.stop();
    this.arr = arr;
    this.notes = [
      ...arr.right.map((n) => ({ ...n, hand: "right" as const })),
      ...arr.left.map((n) => ({ ...n, hand: "left" as const })),
    ].sort((a, b) => a.start - b.start);
    this.startSeconds = 0;
  }

  /** Posición actual en negras. */
  position(): number {
    if (!this.arr) return 0;
    const secs = this.playing && this.ctx ? this.startSeconds + (this.ctx.currentTime - this.startCtxTime) : this.startSeconds;
    return secondsToBeat(secs, this.arr.tempos, this.speed);
  }

  seek(beat: number) {
    if (!this.arr) return;
    const wasPlaying = this.playing;
    this.pause();
    this.startSeconds = beatToSeconds(Math.max(0, Math.min(beat, this.arr.length)), this.arr.tempos, this.speed);
    if (wasPlaying) void this.play();
  }

  setSpeed(speed: number) {
    const beat = this.position();
    const wasPlaying = this.playing;
    this.pause();
    this.speed = speed;
    this.seek(beat);
    if (wasPlaying) void this.play();
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
    }
    await this.ctx.resume();
    return this.ctx;
  }

  async play() {
    if (!this.arr || this.playing) return;
    await this.ensureContext();
    if (!this.ctx) return;
    const beat = this.position();
    if (beat >= this.arr.length - 0.01) this.startSeconds = 0;
    this.startCtxTime = this.ctx.currentTime + 0.05;
    const from = secondsToBeat(this.startSeconds, this.arr.tempos, this.speed);
    this.cursor = this.notes.findIndex((n) => n.start >= from - 1e-6);
    if (this.cursor < 0) this.cursor = this.notes.length;
    this.playing = true;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  pause() {
    if (!this.playing || !this.ctx) return;
    this.startSeconds += this.ctx.currentTime - this.startCtxTime;
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.silence();
  }

  stop() {
    this.pause();
    this.startSeconds = 0;
  }

  private tick() {
    if (!this.ctx || !this.arr) return;
    const horizon = this.ctx.currentTime + 0.12;
    const tempos = this.arr.tempos;
    while (this.cursor < this.notes.length) {
      const n = this.notes[this.cursor];
      const at = this.startCtxTime + beatToSeconds(n.start, tempos, this.speed) - this.startSeconds;
      if (at > horizon) break;
      if (!this.muted[n.hand] && at >= this.ctx.currentTime - 0.02) {
        const dur = beatToSeconds(n.start + n.dur, tempos, this.speed) - beatToSeconds(n.start, tempos, this.speed);
        this.voice(n.pitch, Math.max(at, this.ctx.currentTime), dur, n.vel);
      }
      this.cursor++;
    }
    const beat = this.position();
    if (this.loop && beat >= this.loop.to) {
      this.seek(this.loop.from);
      return;
    }
    if (beat >= this.arr.length + 0.25) {
      this.pause();
      this.startSeconds = 0;
      this.onEnd?.();
    }
  }

  /** Un piano eléctrico sencillo: dos osciladores con envolvente de caída y un filtro. */
  private voice(pitch: number, at: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const f = 440 * 2 ** ((pitch - 69) / 12);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = Math.min(9000, f * 6);
    const peak = 0.18 * (vel / 127) * (pitch < 48 ? 1.2 : 1);
    const release = 0.25;
    const end = at + Math.max(0.08, dur);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(peak * 0.35, at + Math.min(1.2, dur + 0.3));
    gain.gain.setTargetAtTime(0.0001, end, release / 3);
    const osc = [0, 1].map((i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = i === 0 ? f : f * 2.001;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0.25;
      o.connect(g).connect(filter);
      o.start(at);
      o.stop(end + release + 0.1);
      return o;
    });
    filter.connect(gain).connect(this.master!);
    const v: Voice = { osc, gain };
    this.voices.add(v);
    osc[0].onended = () => this.voices.delete(v);
  }

  /** Toca una nota al instante (para el teclado en pantalla o un teclado MIDI). */
  async preview(pitch: number, vel = 90) {
    const ctx = await this.ensureContext();
    this.voice(pitch, ctx.currentTime, 0.4, vel);
  }

  private silence() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(ctx.currentTime);
      v.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
      v.osc.forEach((o) => {
        try {
          o.stop(ctx.currentTime + 0.1);
        } catch {
          /* ya detenido */
        }
      });
    }
    this.voices.clear();
  }
}
