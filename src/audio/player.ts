import type { Arrangement, Note } from "../core/model";
import type { HandId, WaitChord } from "../core/practice";
import { waitChords } from "../core/practice";
import { barLength, beatToSeconds, bpmAt, secondsToBeat } from "../core/tempo";
import { SampledPiano, type PianoStatus, type PianoVoice } from "./piano";

type PlayNote = Note & { hand: HandId };

/**
 * Reproductor propio sobre Web Audio.
 *
 * - Programa las notas con ~120 ms de anticipación (el patrón "two clocks" de
 *   Chris Wilson) para que el audio no dependa de que el hilo principal esté libre.
 * - Suena con un piano de cola sampleado, con reverberación de sala y paneo
 *   suave por registro; mientras se descargan las muestras usa un sintetizador.
 * - Metrónomo, cuenta previa, bucle A–B y modo «esperarme»: el reloj se detiene
 *   en cada acorde de las manos que practica el usuario hasta que lo toca.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null; // notas → (seco + reverb) → master
  private master: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private clickBus: GainNode | null = null;
  readonly piano = new SampledPiano();

  private arr: Arrangement | null = null;
  private notes: PlayNote[] = [];
  private cursor = 0;
  private startCtxTime = 0; // ctx.currentTime en el que la canción está en startSeconds
  private startSeconds = 0; // segundos de canción (ya escalados por la velocidad)
  private timer: number | null = null;
  private voices = new Set<PianoVoice>();
  private nextClick = 0; // próximo clic del metrónomo, en negras

  speed = 1;
  playing = false;
  muted: Record<HandId, boolean> = { right: false, left: false };
  loop: { from: number; to: number } | null = null;
  metronome = false;
  countIn = false;
  onEnd: (() => void) | null = null;
  /** Se llama al saltar a otra posición. */
  onSeek: (() => void) | null = null;
  /** Se llama cada vez que el bucle vuelve a empezar. */
  onLoop: (() => void) | null = null;
  onInstrument: ((s: PianoStatus, progress: number) => void) | null = null;

  // Modo esperar
  private waitHands: HandId[] = [];
  private waitList: WaitChord[] = [];
  private waitIdx = 0;
  holding: WaitChord | null = null;
  private got = new Set<number>();
  onWait: ((chord: WaitChord | null) => void) | null = null;

  // Teclas del usuario (teclado MIDI o en pantalla)
  private live = new Map<number, PianoVoice>();
  private sustained = new Set<PianoVoice>();
  private sustain = false;
  private lastPress = new Map<number, number>();
  private down = new Set<number>();

  constructor() {
    this.piano.onStatus = (s, p) => this.onInstrument?.(s, p);
  }

  load(arr: Arrangement) {
    this.stop();
    this.arr = arr;
    this.notes = [
      ...arr.right.map((n) => ({ ...n, hand: "right" as const })),
      ...arr.left.map((n) => ({ ...n, hand: "left" as const })),
    ].sort((a, b) => a.start - b.start);
    this.startSeconds = 0;
    this.setWait(this.waitHands);
  }

  get length() {
    return this.arr?.length ?? 0;
  }

  /** Posición actual en negras (negativa durante la cuenta previa). */
  position(): number {
    if (!this.arr) return 0;
    if (this.holding) return this.holding.beat;
    const secs = this.playing && this.ctx ? this.startSeconds + (this.ctx.currentTime - this.startCtxTime) : this.startSeconds;
    return secondsToBeat(secs, this.arr.tempos, this.speed);
  }

  /** Posición en segundos de canción a velocidad normal (lo que usan las vistas). */
  songSeconds(): number {
    return this.arr ? beatToSeconds(this.position(), this.arr.tempos) : 0;
  }

  /** Tiempos de la cuenta previa que faltan (0 si no hay). */
  countdown(): number {
    if (!this.ctx || !this.playing || !this.arr || this.holding) return 0;
    const left = this.startCtxTime - this.ctx.currentTime;
    if (left <= 0) return 0;
    return Math.ceil(left / this.clickSeconds() - 1e-3);
  }

  seek(beat: number) {
    if (!this.arr) return;
    const wasPlaying = this.playing;
    this.pause();
    this.startSeconds = beatToSeconds(Math.max(0, Math.min(beat, this.arr.length)), this.arr.tempos, this.speed);
    this.waitIdx = this.indexAfter(beat);
    this.onSeek?.();
    if (wasPlaying) void this.play({ countIn: false });
  }

  setSpeed(speed: number) {
    const beat = Math.max(0, this.position());
    const wasPlaying = this.playing;
    this.pause();
    this.speed = speed;
    this.seek(beat);
    if (wasPlaying) void this.play({ countIn: false });
  }

  /** Activa el modo esperar para estas manos (lista vacía = desactivado). */
  setWait(hands: HandId[]) {
    this.waitHands = hands;
    this.waitList = this.arr && hands.length ? waitChords(this.arr, hands) : [];
    if (this.holding) {
      this.holding = null;
      this.onWait?.(null);
    }
    this.waitIdx = this.indexAfter(this.position());
  }

  get waiting() {
    return this.waitHands.length > 0;
  }

  setReverb(on: boolean) {
    if (this.reverbSend && this.ctx) this.reverbSend.gain.setTargetAtTime(on ? 0.2 : 0, this.ctx.currentTime, 0.05);
    this.reverbOn = on;
  }
  private reverbOn = true;

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.03);
  }
  private volume = 1;

  /** Crea el contexto de audio y empieza a descargar el piano (se puede llamar antes de tocar nada). */
  preload() {
    const ctx = this.context();
    void this.piano.load(ctx);
  }

  private context(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);

    const out = ctx.createGain();
    out.connect(master);
    const send = ctx.createGain();
    send.gain.value = this.reverbOn ? 0.2 : 0;
    const conv = ctx.createConvolver();
    conv.buffer = roomImpulse(ctx);
    out.connect(send).connect(conv).connect(master);

    const click = ctx.createGain();
    click.gain.value = 0.5;
    click.connect(master);

    this.master = master;
    this.out = out;
    this.reverbSend = send;
    this.clickBus = click;
    return ctx;
  }

  private async ensureContext(): Promise<AudioContext> {
    const ctx = this.context();
    void this.piano.load(ctx);
    if (ctx.state !== "running") await ctx.resume();
    return ctx;
  }

  private clickUnit() {
    return this.arr ? 4 / this.arr.timeSignature[1] : 1;
  }

  private clickSeconds(beat = this.position()) {
    if (!this.arr) return 0.5;
    return (this.clickUnit() * 60) / (bpmAt(Math.max(0, beat), this.arr.tempos) * this.speed);
  }

  private indexAfter(beat: number) {
    const i = this.waitList.findIndex((c) => c.beat >= beat - 1e-4);
    return i < 0 ? this.waitList.length : i;
  }

  async play({ countIn = this.countIn }: { countIn?: boolean } = {}) {
    if (!this.arr || this.playing) return;
    const ctx = await this.ensureContext();
    if (this.playing) return;
    let beat = Math.max(0, this.position());
    if (beat >= this.arr.length - 0.01) beat = 0;
    if (this.loop && (beat < this.loop.from - 1e-4 || beat >= this.loop.to - 1e-4)) beat = this.loop.from;
    this.startSeconds = beatToSeconds(beat, this.arr.tempos, this.speed);

    const lead = countIn ? barLength(this.arr.timeSignature) * (60 / (bpmAt(beat, this.arr.tempos) * this.speed)) : 0;
    this.startCtxTime = ctx.currentTime + 0.06 + lead;
    if (lead) {
      const unit = this.clickSeconds(beat);
      const n = Math.round(lead / unit);
      for (let k = 0; k < n; k++) this.click(this.startCtxTime - lead + k * unit, k === 0);
    }
    this.cursor = this.notes.findIndex((n) => n.start >= beat - 1e-6);
    if (this.cursor < 0) this.cursor = this.notes.length;
    const unit = this.clickUnit();
    this.nextClick = Math.ceil(beat / unit - 1e-6) * unit;
    this.waitIdx = this.indexAfter(beat);
    this.playing = true;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  pause() {
    if (!this.playing || !this.ctx) return;
    if (this.holding) {
      this.startSeconds = beatToSeconds(this.holding.beat, this.arr!.tempos, this.speed);
      this.holding = null;
      this.onWait?.(null);
    } else {
      this.startSeconds = Math.max(0, this.startSeconds + (this.ctx.currentTime - this.startCtxTime));
    }
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
    const ctx = this.ctx;
    const arr = this.arr;
    if (!ctx || !arr || !this.playing) return;
    if (this.holding) return; // reloj detenido esperando al usuario

    const now = ctx.currentTime;
    const horizon = now + 0.12;
    const tempos = arr.tempos;
    const atOf = (beat: number) => this.startCtxTime + beatToSeconds(beat, tempos, this.speed) - this.startSeconds;
    const nextWait = this.waitHands.length ? this.waitList[this.waitIdx] : undefined;
    const limit = Math.min(nextWait ? nextWait.beat - 1e-6 : Infinity, this.loop ? this.loop.to - 1e-6 : Infinity);

    while (this.cursor < this.notes.length) {
      const n = this.notes[this.cursor];
      if (n.start >= limit) break;
      const at = atOf(n.start);
      if (at > horizon) break;
      if (!this.muted[n.hand] && !this.waitHands.includes(n.hand) && at >= now - 0.03) {
        const dur = beatToSeconds(n.start + n.dur, tempos, this.speed) - beatToSeconds(n.start, tempos, this.speed);
        this.voice(n.pitch, Math.max(at, now), dur, n.vel);
      }
      this.cursor++;
    }

    if (this.metronome) {
      const unit = this.clickUnit();
      const bar = barLength(arr.timeSignature);
      while (this.nextClick < Math.min(limit + 1e-5, arr.length) && atOf(this.nextClick) <= horizon) {
        const at = atOf(this.nextClick);
        if (at >= now - 0.02) this.click(at, Math.abs(this.nextClick / bar - Math.round(this.nextClick / bar)) < 1e-4);
        this.nextClick += unit;
      }
    }

    const beat = this.position();
    if (nextWait && beat >= nextWait.beat - 1e-4) {
      this.hold(nextWait);
      return;
    }
    if (this.loop && beat >= this.loop.to) {
      this.restartLoop();
      return;
    }
    if (beat >= arr.length + 0.25) {
      this.pause();
      this.startSeconds = 0;
      this.onEnd?.();
    }
  }

  private restartLoop() {
    if (!this.ctx || !this.arr || !this.loop) return;
    this.silence();
    const from = this.loop.from;
    this.startSeconds = beatToSeconds(from, this.arr.tempos, this.speed);
    this.startCtxTime = this.ctx.currentTime + 0.03;
    this.cursor = this.notes.findIndex((n) => n.start >= from - 1e-6);
    if (this.cursor < 0) this.cursor = this.notes.length;
    const unit = this.clickUnit();
    this.nextClick = Math.ceil(from / unit - 1e-6) * unit;
    this.waitIdx = this.indexAfter(from);
    this.onLoop?.();
  }

  private hold(chord: WaitChord) {
    if (!this.arr || !this.ctx) return;
    this.holding = chord;
    // Cuenta las teclas que el usuario ya tocó un pelín antes de tiempo.
    const t = performance.now();
    this.got = new Set(chord.pitches.filter((p) => this.down.has(p) && t - (this.lastPress.get(p) ?? -1e9) < 350));
    this.onWait?.(chord);
    if (this.got.size === chord.pitches.length) this.releaseHold();
  }

  private releaseHold() {
    if (!this.holding || !this.arr || !this.ctx) return;
    this.startSeconds = beatToSeconds(this.holding.beat, this.arr.tempos, this.speed);
    this.startCtxTime = this.ctx.currentTime + 0.005;
    this.holding = null;
    this.waitIdx++;
    this.onWait?.(null);
    this.tick();
  }

  /** El usuario presionó una tecla (teclado MIDI o en pantalla). */
  keyDown(pitch: number, vel = 90, sound = true) {
    this.lastPress.set(pitch, performance.now());
    this.down.add(pitch);
    if (sound) {
      const ctx = this.context();
      void this.ensureContext();
      this.live.get(pitch)?.release(ctx.currentTime);
      const v = this.voice(pitch, ctx.currentTime, null, vel);
      if (v) this.live.set(pitch, v);
    }
    if (this.holding && this.holding.pitches.includes(pitch)) {
      this.got.add(pitch);
      if (this.got.size === this.holding.pitches.length) this.releaseHold();
    }
  }

  keyUp(pitch: number) {
    this.down.delete(pitch);
    const v = this.live.get(pitch);
    if (!v || !this.ctx) return;
    this.live.delete(pitch);
    if (this.sustain) this.sustained.add(v);
    else v.release(this.ctx.currentTime);
  }

  setSustain(on: boolean) {
    this.sustain = on;
    if (!on && this.ctx) {
      for (const v of this.sustained) v.release(this.ctx.currentTime);
      this.sustained.clear();
    }
  }

  /** Toca una nota corta al instante (vista previa). */
  async preview(pitch: number, vel = 90) {
    const ctx = await this.ensureContext();
    this.voice(pitch, ctx.currentTime, 0.5, vel);
  }

  /** dur = null: suena hasta que se llame a release(). */
  private voice(pitch: number, at: number, dur: number | null, vel: number): PianoVoice | null {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.4, Math.min(0.4, ((pitch - 64) / 40) * 0.4));
    pan.connect(this.out!);
    const v = this.piano.play(ctx, pan, pitch, vel, at) ?? synthVoice(ctx, pan, pitch, vel, at);
    if (dur !== null) v.release(at + Math.max(0.06, dur));
    this.voices.add(v);
    if (this.voices.size > 160) {
      const oldest = this.voices.values().next().value as PianoVoice;
      oldest.kill(ctx.currentTime);
      this.voices.delete(oldest);
    }
    // Se limpian solos: la lista solo sirve para silenciar al pausar.
    window.setTimeout(() => this.voices.delete(v), ((dur ?? 30) + at - ctx.currentTime + 2) * 1000);
    return v;
  }

  private click(at: number, accent: boolean) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    o.connect(g).connect(this.clickBus!);
    o.start(at);
    o.stop(at + 0.08);
    this.clicks.add(o);
    o.onended = () => this.clicks.delete(o);
  }
  private clicks = new Set<OscillatorNode>();

  private silence() {
    const ctx = this.ctx;
    if (!ctx) return;
    const live = new Set(this.live.values());
    for (const v of this.voices) if (!live.has(v)) v.kill(ctx.currentTime);
    this.voices.clear();
    for (const v of live) this.voices.add(v);
    for (const o of this.clicks) {
      try {
        o.stop();
      } catch {
        /* ya detenido */
      }
    }
    this.clicks.clear();
  }
}

/** Sintetizador de respaldo mientras cargan las muestras: dos osciladores con caída. */
function synthVoice(ctx: BaseAudioContext, dest: AudioNode, pitch: number, vel: number, at: number): PianoVoice {
  const f = 440 * 2 ** ((pitch - 69) / 12);
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(9000, f * 6);
  const peak = 0.3 * (vel / 127) * (pitch < 48 ? 1.2 : 1);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.006);
  gain.gain.setTargetAtTime(peak * 0.25, at + 0.006, 0.6);
  const osc = [0, 1].map((i) => {
    const o = ctx.createOscillator();
    o.type = i === 0 ? "triangle" : "sine";
    o.frequency.value = i === 0 ? f : f * 2.001;
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 1 : 0.25;
    o.connect(g).connect(filter);
    o.start(at);
    o.stop(at + 8);
    return o;
  });
  filter.connect(gain).connect(dest);
  let released = false;
  const end = (t: number, tau: number) => {
    const when = Math.max(t, ctx.currentTime);
    gain.gain.cancelScheduledValues(when);
    gain.gain.setTargetAtTime(0, when, tau);
    osc.forEach((o) => {
      try {
        o.stop(when + tau * 8);
      } catch {
        /* ya detenido */
      }
    });
  };
  return {
    pitch,
    release: (t) => {
      if (released) return;
      released = true;
      end(t, 0.08);
    },
    kill: (t) => {
      released = true;
      end(t, 0.015);
    },
  };
}

/** Respuesta al impulso de una sala pequeña, generada (ruido con caída exponencial y algo de filtrado). */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 2.2);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const pre = t < 0.012 ? 0 : 1; // pre-delay
      // Paso bajo que se cierra con el tiempo: las colas graves duran más que los agudos.
      const k = 0.55 - 0.4 * Math.min(1, t / 2);
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = pre * lp * Math.exp(-t * 3.2);
    }
  }
  return buf;
}
