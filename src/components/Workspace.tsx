import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hand, Song } from "../core/model";
import { arrange, suggestHands } from "../core/arrange";
import { AUTO_ID, suggestWithAuto, withAutoMelody } from "../core/smart";
import { toMidi } from "../core/exportMidi";
import { toMusicXml } from "../core/exportMusicXml";
import { estimateKey, keyName, pitchName } from "../core/key";
import { barLength, barStarts, beatToSeconds } from "../core/tempo";
import { ROLE_LABEL } from "../core/roles";
import { PracticeScorer, timedNotes, type HandId } from "../core/practice";
import { Player } from "../audio/player";
import type { PianoStatus } from "../audio/piano";
import { FallingNotes } from "./FallingNotes";
import { Transport } from "./Transport";
import { StageOverlay } from "./StageOverlay";
import { SPEEDS } from "../lib/transport";
import { Panel, Segmented, Toggle } from "./ui";
import { DownloadIcon, KeyboardIcon } from "./Icons";
import { HAND_COLOR } from "../lib/colors";
import { useMidiInput } from "../lib/useMidiInput";
import { useSettings } from "../lib/settings";
import { saveSong, type LibraryEntry } from "../lib/library";
import { AddPart } from "./AddPart";

const SheetView = lazy(() => import("./SheetView").then((m) => ({ default: m.SheetView })));

const SOURCE_LABEL: Record<Song["source"], string> = { "guitar-pro": "Guitar Pro", musicxml: "MusicXML", midi: "MIDI", tab: "Tablatura" };
type Practice = "none" | "left" | "right" | "both";
const PRACTICE_HANDS: Record<Practice, HandId[]> = { none: [], left: ["left"], right: ["right"], both: ["left", "right"] };

function download(data: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "arreglo";

export function Workspace({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const [settings, set] = useSettings();
  const [raw, setRaw] = useState<Song>(entry.song);
  const { song, auto } = useMemo(() => withAutoMelody(raw), [raw]);
  const [hands, setHands] = useState<Record<string, Hand>>(() => entry.hands ?? suggestWithAuto(song, suggestHands));
  const [transpose, setTranspose] = useState(entry.transpose ?? 0);
  const [view, setView] = useState<"falling" | "sheet">("falling");
  const [side, setSide] = useState<"tracks" | "arrange" | "practice">("tracks");
  const [playing, setPlaying] = useState(false);
  const [practice, setPractice] = useState<Practice>("none");
  const [wait, setWait] = useState(false);
  const [loop, setLoop] = useState<{ from: number; to: number } | null>(null); // en compases (0 = primero), `to` exclusivo
  const [fullscreen, setFullscreen] = useState(false);
  const [instrument, setInstrument] = useState<{ status: PianoStatus; progress: number }>({ status: "idle", progress: 0 });
  const player = useMemo(() => new Player(), []);
  const stageRef = useRef<HTMLDivElement>(null);

  // Guarda la canción, el reparto y la transposición en «Mis canciones».
  useEffect(() => {
    const id = window.setTimeout(() => void saveSong({ ...entry, song: raw, hands, transpose, opened: Date.now() }), 400);
    return () => clearTimeout(id);
  }, [entry, raw, hands, transpose]);

  /** Añade o quita partes y reparte las nuevas sin tocar lo que ya elegiste. */
  const changeSong = useCallback(
    (next: Song) => {
      const { song: withAuto } = withAutoMelody(next);
      const suggested = suggestWithAuto(withAuto, suggestHands);
      const hadAuto = song.tracks.some((t) => t.id === AUTO_ID);
      const hasAuto = withAuto.tracks.some((t) => t.id === AUTO_ID);
      setHands((prev) => {
        if (hasAuto && !hadAuto) return suggested;
        const out: Record<string, Hand> = {};
        for (const t of withAuto.tracks) out[t.id] = prev[t.id] ?? suggested[t.id] ?? "off";
        return out;
      });
      setRaw(next);
    },
    [song],
  );

  const arrangement = useMemo(
    () => arrange(song, hands, { transpose, maxNotesPerHand: settings.maxNotes, leftOctaves: settings.leftOctaves, simplify: settings.simplify }),
    [song, hands, transpose, settings.maxNotes, settings.leftOctaves, settings.simplify],
  );
  const notes = useMemo(() => timedNotes(arrangement), [arrangement]);
  const bar = barLength(arrangement.timeSignature);
  const bars = useMemo(() => barStarts(arrangement.length, arrangement.timeSignature).map((b) => beatToSeconds(b, arrangement.tempos)), [arrangement]);
  const totalBars = Math.max(1, Math.ceil(arrangement.length / bar - 1e-6));
  const musicXml = useMemo(() => (view === "sheet" ? toMusicXml(arrangement) : ""), [arrangement, view]);
  const key = useMemo(() => estimateKey([...arrangement.right, ...arrangement.left]), [arrangement]);
  const empty = !arrangement.right.length && !arrangement.left.length;
  const practiceHands = PRACTICE_HANDS[practice];
  const loopBeats = loop ? { from: loop.from * bar, to: Math.min(arrangement.length, loop.to * bar) } : null;

  const scorer = useMemo(() => new PracticeScorer(notes, practiceHands), [notes, practiceHands]);

  // --- Sincronizar el reproductor con el estado -------------------------------------
  useEffect(() => {
    player.onInstrument = (status, progress) => setInstrument({ status, progress });
    player.preload();
  }, [player]);

  useEffect(() => {
    const beat = player.position();
    player.load(arrangement);
    player.seek(Math.max(0, Math.min(beat, arrangement.length)));
    setPlaying(false);
  }, [arrangement, player]);

  useEffect(() => {
    player.onEnd = () => setPlaying(false);
    return () => player.stop();
  }, [player]);

  useEffect(() => {
    player.muted = { left: practiceHands.includes("left"), right: practiceHands.includes("right") };
    player.setWait(wait ? practiceHands : []);
    scorer.reset(player.songSeconds());
  }, [player, practiceHands, wait, scorer, arrangement]);

  useEffect(() => {
    player.loop = loopBeats;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, loopBeats?.from, loopBeats?.to]);

  useEffect(() => {
    player.metronome = settings.metronome;
    player.countIn = settings.countIn;
    player.setReverb(settings.reverb);
    player.setVolume(settings.volume);
    if (player.speed !== settings.speed) player.setSpeed(settings.speed);
    scorer.setWindow(0.18 * settings.speed);
  }, [player, scorer, settings.metronome, settings.countIn, settings.reverb, settings.volume, settings.speed]);

  // Al repetir el bucle: borra los resultados del pasaje y, si está activo, sube un poco el tempo.
  const trainerRef = useRef(settings.trainer);
  trainerRef.current = settings.trainer;
  useEffect(() => {
    player.onSeek = () => scorer.rewind(player.songSeconds());
    player.onLoop = () => {
      if (player.loop) scorer.rewind(beatToSeconds(player.loop.from, arrangement.tempos));
      if (trainerRef.current && player.speed < 1) {
        const next = SPEEDS.find((s) => s > player.speed + 0.001) ?? 1;
        set("speed", Math.min(1, next));
      }
    };
  }, [player, scorer, arrangement.tempos, set]);

  // Los fallos se marcan cuando una nota pasa sin tocarse.
  useEffect(() => {
    if (!scorer.active) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (player.playing) scorer.advance(player.songSeconds());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player, scorer]);

  const toggle = useCallback(async () => {
    if (player.playing) {
      player.pause();
      setPlaying(false);
    } else {
      if (player.position() >= arrangement.length - 0.01 || player.position() <= 0.01) scorer.reset(0);
      await player.play();
      setPlaying(true);
    }
  }, [player, scorer, arrangement.length]);

  // --- Teclado MIDI y teclas en pantalla ------------------------------------------
  const soundRef = useRef(settings.soundMyKeys);
  soundRef.current = settings.soundMyKeys;
  const onKeyDown = useCallback(
    (pitch: number, vel = 90, fromScreen = false) => {
      player.keyDown(pitch, vel, fromScreen || soundRef.current);
      if (scorer.active && player.playing && player.countdown() === 0) scorer.noteOn(pitch, player.songSeconds());
    },
    [player, scorer],
  );
  const midi = useMidiInput({
    onNoteOn: (p, v) => onKeyDown(p, v),
    onNoteOff: (p) => player.keyUp(p),
    onSustain: (on) => player.setSustain(on),
  });
  // Si el navegador ya dio permiso antes, conecta solo.
  useEffect(() => {
    const perms = navigator.permissions as Permissions | undefined;
    perms
      ?.query({ name: "midi" as PermissionName })
      .then((r) => {
        if (r.state === "granted") void midi.connect();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Pantalla completa ---------------------------------------------------------------
  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => setFullscreen((f) => !f));
    else setFullscreen((f) => !f); // iPhone: pantalla completa simulada
  }, []);
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // --- Bucle ----------------------------------------------------------------------------
  const loopHere = useCallback(() => {
    const cur = Math.floor(Math.max(0, player.position()) / bar + 1e-6);
    const from = Math.min(cur, Math.max(0, totalBars - 1));
    setLoop({ from, to: Math.min(totalBars, from + 4) });
  }, [player, bar, totalBars]);
  const toggleLoop = useCallback(() => (loop ? setLoop(null) : loopHere()), [loop, loopHere]);

  // --- Atajos de teclado ------------------------------------------------------------------
  const live = useRef({ toggle, toggleLoop, toggleFullscreen, settings, set });
  live.current = { toggle, toggleLoop, toggleFullscreen, settings, set };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const isRange = t.tagName === "INPUT" && (t as HTMLInputElement).type === "range";
      if ((t.tagName === "INPUT" && !isRange) || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if (isRange && e.code !== "Space") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const L = live.current;
      const pos = Math.max(0, player.position());
      const cur = Math.floor(pos / bar + 1e-6);
      const speedIdx = SPEEDS.indexOf(L.settings.speed);
      const keys: Record<string, () => void> = {
        Space: () => void L.toggle(),
        ArrowLeft: () => player.seek((cur - (pos - cur * bar < 0.25 ? 1 : 0)) * bar),
        ArrowRight: () => player.seek((cur + 1) * bar),
        Home: () => player.seek(0),
        KeyL: L.toggleLoop,
        KeyM: () => L.set("metronome", !L.settings.metronome),
        KeyF: L.toggleFullscreen,
        KeyN: () => L.set("showNames", !L.settings.showNames),
        BracketLeft: () => L.set("speed", SPEEDS[Math.max(0, speedIdx - 1)] ?? 1),
        BracketRight: () => L.set("speed", SPEEDS[Math.min(SPEEDS.length - 1, speedIdx + 1)] ?? 1),
      };
      const fn = keys[e.code];
      if (!fn || (e.code === "Space" && t.tagName === "BUTTON")) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, bar]);

  const base = slug(song.title);
  const usedTracks = song.tracks.filter((t) => (hands[t.id] ?? "off") !== "off").length;

  return (
    <div className="wrap py-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{SOURCE_LABEL[song.source]}</span>·<span>{keyName(key)}</span>·<span className="num">{Math.round(song.tempos[0].bpm)} bpm</span>·
            <span className="num">{totalBars} compases</span>
          </p>
          <h1 className="truncate font-display text-4xl font-black uppercase leading-none tracking-wide sm:text-6xl">{song.title}</h1>
          {song.artist && <p className="mt-1 text-muted">{song.artist}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-quiet" disabled={empty} onClick={() => download(toMidi(arrangement), `${base}-piano.mid`, "audio/midi")}>
            <DownloadIcon width={16} height={16} /> MIDI
          </button>
          <button type="button" className="btn-quiet" disabled={empty} onClick={() => download(toMusicXml(arrangement), `${base}-piano.musicxml`, "application/vnd.recordare.musicxml+xml")}>
            <DownloadIcon width={16} height={16} /> MusicXML
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Otra canción
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
        {/* Escenario */}
        <section className="min-w-0 lg:order-2" aria-label="Arreglo para piano">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="Vista"
              value={view}
              onChange={setView}
              options={[
                ["falling", "Notas cayendo"],
                ["sheet", "Partitura"],
              ]}
            />
            <div className="flex items-center gap-4 text-sm">
              <InstrumentBadge {...instrument} />
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: HAND_COLOR.left }} /> Izquierda
              </span>
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: HAND_COLOR.right }} /> Derecha
              </span>
            </div>
          </div>

          {empty ? (
            <div className="mt-4 grid h-[62vh] min-h-[360px] place-items-center rounded-2xl border border-dashed border-line p-6 text-center">
              <div>
                <p className="font-semibold">Ninguna pista está asignada a una mano.</p>
                <p className="mt-1 text-sm text-muted">Elige «Izquierda» o «Derecha» en al menos una pista.</p>
              </div>
            </div>
          ) : view === "falling" ? (
            <div
              ref={stageRef}
              className={`mt-4 flex flex-col overflow-hidden border-line bg-stage ${fullscreen ? "fixed inset-0 z-50 h-[100dvh] rounded-none border-0" : "h-[64vh] min-h-[380px] rounded-2xl border"}`}
            >
              {scorer.active && <Stats scorer={scorer} playing={playing} midi={midi.state === "connected"} />}
              <div className="relative min-h-0 flex-1">
                <FallingNotes
                  notes={notes}
                  clock={player}
                  pressed={midi.pressed}
                  showNames={settings.showNames}
                  lookahead={settings.zoom}
                  bars={bars}
                  loop={loopBeats ? { from: beatToSeconds(loopBeats.from, arrangement.tempos), to: beatToSeconds(loopBeats.to, arrangement.tempos) } : null}
                  scorer={scorer.active ? scorer : null}
                  onKeyDown={(p) => onKeyDown(p, 90, true)}
                  onKeyUp={(p) => player.keyUp(p)}
                />
                <StageOverlay player={player} notes={notes} bar={bar} tempos={arrangement.tempos} />
                <div className="absolute right-2 top-2 flex flex-col gap-1">
                  <button type="button" className="zoom-btn" onClick={() => set("zoom", Math.max(1.5, settings.zoom - 0.5))} aria-label="Acercar (notas más separadas)" title="Acercar">
                    +
                  </button>
                  <button type="button" className="zoom-btn" onClick={() => set("zoom", Math.min(8, settings.zoom + 0.5))} aria-label="Alejar (ver más notas)" title="Alejar">
                    −
                  </button>
                </div>
              </div>
              <Transport
                player={player}
                arrangement={arrangement}
                playing={playing}
                onToggle={() => void toggle()}
                speed={settings.speed}
                onSpeed={(s) => set("speed", s)}
                metronome={settings.metronome}
                onMetronome={(v) => set("metronome", v)}
                loop={loopBeats}
                onLoopToggle={toggleLoop}
                volume={settings.volume}
                onVolume={(v) => set("volume", v)}
                fullscreen={fullscreen}
                onFullscreen={toggleFullscreen}
              />
            </div>
          ) : (
            <div className="mt-4">
              <Suspense fallback={<p className="rounded-xl bg-[#fbf9f4] p-6 text-sm text-neutral-600">Cargando el motor de partituras…</p>}>
                <SheetView musicXml={musicXml} title={song.title} />
              </Suspense>
            </div>
          )}
          <p className="mt-2 hidden text-xs text-muted sm:block">
            <kbd>Espacio</kbd> tocar/pausar · <kbd>←</kbd> <kbd>→</kbd> compás · <kbd>[</kbd> <kbd>]</kbd> velocidad · <kbd>L</kbd> bucle · <kbd>M</kbd> metrónomo · <kbd>N</kbd>{" "}
            nombres · <kbd>F</kbd> pantalla completa
          </p>
        </section>

        {/* Panel lateral */}
        <aside className="min-w-0 lg:order-1">
          <div className="rounded-2xl border border-line bg-surface">
            <div className="border-b border-line p-2">
              <Segmented
                label="Panel"
                value={side}
                onChange={setSide}
                options={[
                  ["tracks", `Pistas · ${usedTracks}`],
                  ["arrange", "Arreglo"],
                  ["practice", "Práctica"],
                ]}
              />
            </div>
            <div className="grid gap-6 p-4">
              {side === "tracks" && (
                <>
                  <p className="text-xs leading-relaxed text-muted">
                    Elige qué toca cada mano. «Dividir» manda los graves a la izquierda y el resto a la derecha. Riffkeys ajusta la octava para que todo quepa.
                    {auto && " La melodía automática ya junta la voz y las guitarras: normalmente basta con ella y el bajo."}
                  </p>
                  <ul className="-mt-2 space-y-2">
                    {song.tracks.map((t) => {
                      const pitches = t.notes.map((n) => n.pitch);
                      const range = t.isPercussion || !pitches.length ? "Percusión" : `${pitchName(Math.min(...pitches))}–${pitchName(Math.max(...pitches))}`;
                      return (
                        <li key={t.id} className={`rounded-xl border bg-stage p-3 ${t.id === AUTO_ID ? "border-gold/40" : "border-line"}`}>
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate font-semibold" title={t.name}>
                              {t.id === AUTO_ID && <span aria-hidden="true">✦ </span>}
                              {t.name}
                            </p>
                            <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                              {t.id === AUTO_ID ? "Voz + guitarras" : ROLE_LABEL[t.role]}
                              {t.id !== AUTO_ID && raw.tracks.length > 1 && (
                                <button
                                  type="button"
                                  className="-my-1 ml-1 grid h-6 w-6 place-items-center rounded text-base leading-none hover:bg-raised hover:text-ink"
                                  aria-label={`Quitar la pista ${t.name}`}
                                  title="Quitar pista"
                                  onClick={() => changeSong({ ...raw, tracks: raw.tracks.filter((x) => x.id !== t.id) })}
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          </div>
                          {t.id === AUTO_ID && auto ? (
                            <p className="mt-1 text-xs leading-snug text-muted">
                              Junta lo que se oye arriba, compás por compás:{" "}
                              {auto.sources
                                .slice(0, 4)
                                .map((x) => `${x.name} (${x.bars} c.)`)
                                .join(", ")}
                              {auto.sources.length > 4 ? "…" : "."}
                            </p>
                          ) : (
                            <p className="num text-xs text-muted">
                              {t.notes.length} notas · {range}
                            </p>
                          )}
                          {t.isPercussion ? (
                            <p className="mt-2 text-xs text-muted">La batería no se toca en el piano.</p>
                          ) : (
                            <HandPicker value={hands[t.id] ?? "off"} onChange={(h) => setHands((prev) => ({ ...prev, [t.id]: h }))} label={t.name} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <AddPart song={raw} onAdd={changeSong} />
                </>
              )}

              {side === "arrange" && (
                <>
                  <Panel title="Tonalidad y dificultad" id="p-dif">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">Transponer</span>
                      <div className="flex items-center gap-1">
                        <button type="button" className="btn-quiet h-9 w-9 px-0" onClick={() => setTranspose((t) => Math.max(-12, t - 1))} aria-label="Bajar un semitono">
                          −
                        </button>
                        <span className="num w-16 text-center text-sm font-semibold" aria-live="polite">
                          {transpose > 0 ? `+${transpose}` : transpose} st
                        </span>
                        <button type="button" className="btn-quiet h-9 w-9 px-0" onClick={() => setTranspose((t) => Math.min(12, t + 1))} aria-label="Subir un semitono">
                          +
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm">Notas por mano</p>
                      <Segmented
                        label="Notas por mano"
                        size="sm"
                        value={String(settings.maxNotes)}
                        onChange={(v) => set("maxNotes", Number(v))}
                        options={[
                          ["2", "2 · fácil"],
                          ["3", "3"],
                          ["4", "4"],
                          ["5", "5 · todo"],
                        ]}
                      />
                    </div>
                    <Toggle
                      checked={settings.simplify}
                      onChange={(v) => set("simplify", v)}
                      label="Simplificar ritmos rápidos"
                      hint="Las repeticiones en semicorcheas (palm mute) pasan a corcheas."
                    />
                  </Panel>
                  <Panel title="Sonido de metal" id="p-metal">
                    <Toggle
                      checked={settings.leftOctaves}
                      onChange={(v) => set("leftOctaves", v)}
                      label="Octavas en la izquierda"
                      hint="Dobla el bajo una octava abajo: más peso, como en los covers de metal en piano."
                    />
                  </Panel>
                  <Panel title="Vista" id="p-vista">
                    <Toggle checked={settings.showNames} onChange={(v) => set("showNames", v)} label="Nombres de las notas" />
                  </Panel>
                </>
              )}

              {side === "practice" && (
                <>
                  <Panel title="Tú tocas" id="p-tu">
                    <Segmented
                      label="Qué mano tocas tú"
                      size="sm"
                      value={practice}
                      onChange={setPractice}
                      options={[
                        ["none", "Nada"],
                        ["left", "Izq."],
                        ["right", "Der."],
                        ["both", "Ambas"],
                      ]}
                    />
                    <p className="text-xs leading-snug text-muted">
                      {practice === "none"
                        ? "Riffkeys toca todo. Elige una mano para practicarla: deja de sonar y la tocas tú."
                        : midi.state === "connected"
                          ? "Riffkeys cuenta tus aciertos y fallos en tiempo real."
                          : "Conecta tu teclado MIDI para ver aciertos y fallos."}
                    </p>
                    <Toggle
                      checked={wait}
                      onChange={setWait}
                      disabled={practice === "none"}
                      label="Esperarme en cada nota"
                      hint="La canción se detiene hasta que toques las teclas correctas, como en Synthesia."
                    />
                  </Panel>

                  <Panel title="Repetir un pasaje" id="p-bucle">
                    <Toggle checked={!!loop} onChange={(v) => (v ? loopHere() : setLoop(null))} label="Bucle activado" />
                    <div className={`grid grid-cols-2 gap-2 ${loop ? "" : "pointer-events-none opacity-50"}`}>
                      <label className="block">
                        <span className="label">Desde el compás</span>
                        <input
                          type="number"
                          className="field num mt-1 w-full"
                          min={1}
                          max={totalBars}
                          value={(loop?.from ?? 0) + 1}
                          onChange={(e) => {
                            const from = Math.max(0, Math.min(totalBars - 1, Number(e.target.value) - 1 || 0));
                            setLoop((l) => (l ? { from, to: Math.max(from + 1, l.to) } : l));
                          }}
                        />
                      </label>
                      <label className="block">
                        <span className="label">Hasta el compás</span>
                        <input
                          type="number"
                          className="field num mt-1 w-full"
                          min={1}
                          max={totalBars}
                          value={loop?.to ?? 4}
                          onChange={(e) => {
                            const to = Math.max(1, Math.min(totalBars, Number(e.target.value) || 1));
                            setLoop((l) => (l ? { from: Math.min(l.from, to - 1), to } : l));
                          }}
                        />
                      </label>
                    </div>
                    <button type="button" className="btn-quiet" onClick={loopHere}>
                      Repetir 4 compases desde aquí
                    </button>
                    <Toggle
                      checked={settings.trainer}
                      onChange={(v) => set("trainer", v)}
                      label="Subir la velocidad en cada vuelta"
                      hint="Empieza lento: cada repetición va un paso más rápido hasta llegar al 100 %."
                    />
                  </Panel>

                  <Panel title="Tiempo" id="p-tiempo">
                    <Toggle checked={settings.metronome} onChange={(v) => set("metronome", v)} label="Metrónomo" />
                    <Toggle checked={settings.countIn} onChange={(v) => set("countIn", v)} label="Cuenta previa de un compás" />
                  </Panel>

                  <Panel title="Tu teclado" id="p-midi">
                    {midi.state === "connected" ? (
                      <p className="flex items-center gap-2 text-sm">
                        <span className="h-2 w-2 rounded-full bg-hit" /> <span className="font-semibold">{midi.device}</span>
                      </p>
                    ) : midi.state === "unsupported" ? (
                      <p className="text-sm text-muted">Este navegador no permite teclados MIDI. Usa Chrome o Edge en computador.</p>
                    ) : (
                      <>
                        <p className="text-sm text-muted">
                          {midi.state === "no-devices"
                            ? "No encontré ningún teclado. Conéctalo por USB y vuelve a intentarlo."
                            : midi.state === "denied"
                              ? "El navegador bloqueó el acceso MIDI. Permítelo en la barra de direcciones."
                              : "Conecta tu piano por USB para practicar con él."}
                        </p>
                        <button type="button" className="btn-quiet w-full" onClick={() => void midi.connect()} disabled={midi.state === "connecting"}>
                          <KeyboardIcon width={18} height={18} /> {midi.state === "connecting" ? "Conectando…" : "Conectar teclado MIDI"}
                        </button>
                      </>
                    )}
                    <Toggle
                      checked={settings.soundMyKeys}
                      onChange={(v) => set("soundMyKeys", v)}
                      label="Que suene mi teclado en la app"
                      hint="Actívalo si tu teclado no tiene parlantes propios."
                    />
                    <Toggle checked={settings.reverb} onChange={(v) => set("reverb", v)} label="Reverberación de sala" />
                  </Panel>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function InstrumentBadge({ status, progress }: { status: PianoStatus; progress: number }) {
  if (status === "ready") return <span className="hidden text-xs text-muted sm:inline">Piano de cola</span>;
  if (status === "error") return <span className="text-xs text-muted">Sonido sencillo (no cargó el piano)</span>;
  return (
    <span className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
      <span className="relative h-1 w-14 overflow-hidden rounded-full bg-line">
        <span className="absolute inset-y-0 left-0 bg-bone transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
      </span>
      Cargando piano
    </span>
  );
}

function Stats({ scorer, playing, midi }: { scorer: PracticeScorer; playing: boolean; midi: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);
  const s = scorer.stats;
  if (!midi && !s.hits && !s.wrong) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-surface px-4 py-2 text-sm" aria-live="off">
      <span>
        Precisión <span className="num font-display text-2xl font-black leading-none">{s.accuracy ?? "—"}</span>
        {s.accuracy !== null && <span className="text-muted"> %</span>}
      </span>
      <span>
        Racha <span className="num font-semibold">{s.streak}</span> <span className="text-xs text-muted">(mejor {s.best})</span>
      </span>
      <span className="num text-hit">{s.hits} aciertos</span>
      <span className="num text-muted">{s.misses} sin tocar</span>
      <span className="num text-danger">{s.wrong} de más</span>
      {!playing && s.hits + s.misses > 0 && <span className="text-xs text-muted">Dale a reproducir para seguir.</span>}
    </div>
  );
}

function HandPicker({ value, onChange, label }: { value: Hand; onChange: (h: Hand) => void; label: string }) {
  const opts: [Hand, string][] = [
    ["left", "Izq."],
    ["split", "Dividir"],
    ["right", "Der."],
    ["off", "No usar"],
  ];
  return (
    <div role="radiogroup" aria-label={`Mano para ${label}`} className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-surface p-1">
      {opts.map(([h, text]) => {
        const on = value === h;
        return (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(h)}
            title={h === "split" ? "Graves a la izquierda, el resto a la derecha" : undefined}
            className={`h-8 rounded-md text-xs font-semibold transition-colors ${on ? (h === "off" ? "bg-raised text-ink" : "text-stage") : "text-muted hover:text-ink"}`}
            style={on && h !== "off" ? { background: h === "split" ? `linear-gradient(90deg, ${HAND_COLOR.left} 50%, ${HAND_COLOR.right} 50%)` : HAND_COLOR[h] } : undefined}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
