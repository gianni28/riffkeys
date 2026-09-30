import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hand, Song } from "./core/model";
import { importFile, ACCEPTED } from "./core/importFile";
import { parseAsciiTab } from "./core/importTab";
import { arrange, suggestHands } from "./core/arrange";
import { toMidi } from "./core/exportMidi";
import { toMusicXml } from "./core/exportMusicXml";
import { estimateKey, keyName, pitchName } from "./core/key";
import { beatToSeconds } from "./core/tempo";
import { ROLE_LABEL } from "./core/roles";
import { EXAMPLE_TAB } from "./core/example";
import { Player } from "./audio/player";
import { FallingNotes } from "./components/FallingNotes";
import { HAND_COLOR } from "./lib/colors";
import { useMidiInput } from "./lib/useMidiInput";

const SheetView = lazy(() => import("./components/SheetView").then((m) => ({ default: m.SheetView })));

export default function App() {
  const [song, setSong] = useState<Song | null>(null);
  return (
    <div className="flex min-h-screen flex-col">
      <Header onHome={song ? () => setSong(null) : undefined} />
      <main id="contenido" className="flex-1">
        {song ? <Workspace song={song} onClose={() => setSong(null)} /> : <ImportScreen onSong={setSong} />}
      </main>
      <footer className="border-t border-line">
        <div className="wrap flex flex-col gap-2 py-6 text-sm text-muted sm:flex-row sm:justify-between">
          <p>Todo se procesa en tu navegador. Tus archivos no se suben a ningún servidor.</p>
          <p>
            Hecho por{" "}
            <a className="font-semibold text-ink hover:text-bone" href="https://giovanniraffa.netlify.app" target="_blank" rel="noreferrer">
              Giovanni Raffa
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#23242f" />
        <rect x="12" y="12" width="12" height="40" rx="3" fill="#f3f0e8" />
        <rect x="26" y="12" width="12" height="40" rx="3" fill="#f3f0e8" />
        <rect x="40" y="12" width="12" height="40" rx="3" fill="#f3f0e8" />
        <rect x="20" y="12" width="8" height="24" rx="2" fill="#6b93ff" />
        <rect x="36" y="12" width="8" height="24" rx="2" fill="#ff9a4d" />
      </svg>
      <span className="font-display text-3xl font-black uppercase leading-none tracking-wide">Riffkeys</span>
    </span>
  );
}

function Header({ onHome }: { onHome?: () => void }) {
  return (
    <header className="border-b border-line">
      <div className="wrap flex h-16 items-center justify-between">
        {onHome ? (
          <button type="button" onClick={onHome} aria-label="Volver al inicio">
            <Logo />
          </button>
        ) : (
          <Logo />
        )}
        <a href="https://github.com/gianni28/riffkeys" target="_blank" rel="noreferrer" className="text-sm font-semibold text-muted hover:text-ink">
          Código en GitHub
        </a>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Importar                                                            */
/* ------------------------------------------------------------------ */

function ImportScreen({ onSong }: { onSong: (s: Song) => void }) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("");
  const [charsPerBeat, setCharsPerBeat] = useState(4);
  const [bpm, setBpm] = useState(120);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onSong(await importFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const convertTab = (text = tab, opts = { charsPerBeat, bpm }) => {
    setError("");
    try {
      onSong(parseAsciiTab(text, opts).song);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="wrap grid gap-10 py-10 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-16 lg:py-20">
      <section>
        <h1 className="font-display text-6xl font-black uppercase leading-[0.88] tracking-wide sm:text-8xl">
          De la tab
          <br />
          al piano.
        </h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted">
          Sube una canción en Guitar Pro, MusicXML o MIDI, o pega una tablatura. Riffkeys reparte las guitarras, el bajo y la voz entre tus dos manos y te lo
          muestra como notas cayendo y como partitura.
        </p>
        <ol className="mt-8 grid max-w-lg gap-3">
          {[
            ["Carga la canción", "Guitar Pro, MusicXML, MIDI o texto."],
            ["Elige qué toca cada mano", "Riffkeys sugiere un reparto y ajusta el registro."],
            ["Toca o exporta", "Practica con tu teclado MIDI o abre el arreglo en MuseScore."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line font-display text-lg font-black">{i + 1}</span>
              <div>
                <p className="font-semibold">{t}</p>
                <p className="text-sm text-muted">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6" aria-label="Cargar canción">
        <div role="tablist" aria-label="Forma de cargar" className="grid grid-cols-2 gap-1 rounded-xl bg-stage p-1">
          {(
            [
              ["file", "Subir archivo"],
              ["paste", "Pegar tablatura"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              onClick={() => (setMode(m), setError(""))}
              className={`h-10 rounded-lg text-sm font-semibold transition-colors ${mode === m ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "file" ? (
          <div
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void load(e.dataTransfer.files[0]);
            }}
            className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${dragging ? "border-bone bg-raised" : "border-line"}`}
          >
            <p className="font-display text-3xl font-black uppercase tracking-wide">Arrastra tu archivo aquí</p>
            <p className="mt-2 text-sm text-muted">.gp · .gp5 · .gpx · .musicxml · .mxl · .mid · .txt</p>
            <button type="button" className="btn-primary mt-6" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? "Leyendo…" : "Elegir archivo"}
            </button>
            <input ref={inputRef} type="file" accept={ACCEPTED} className="sr-only" onChange={(e) => void load(e.target.files?.[0])} aria-label="Elegir archivo de canción" />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="label">Tablatura (una línea por cuerda)</span>
              <textarea
                value={tab}
                onChange={(e) => setTab(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={"e|-------------------|\nB|-------------------|\nG|-------------------|\nD|-------------------|\nA|-----5-----7-------|\nE|-0-0---0-0---8-7-5-|"}
                className="mt-1 w-full resize-y rounded-lg border border-line bg-stage p-3 font-mono text-sm leading-snug text-ink placeholder:text-muted/50 focus:border-bone focus:outline-none"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Cada guion vale</span>
                <select className="field mt-1 w-full" value={charsPerBeat} onChange={(e) => setCharsPerBeat(Number(e.target.value))}>
                  <option value={4}>una semicorchea (lo más común)</option>
                  <option value={2}>una corchea</option>
                  <option value={3}>un tresillo de corchea</option>
                  <option value={8}>una fusa</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Tempo (negras por minuto)</span>
                <input type="number" min={30} max={320} className="field num mt-1 w-full" value={bpm} onChange={(e) => setBpm(Number(e.target.value) || 120)} />
              </label>
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Las tabs en texto no suelen indicar el ritmo, así que Riffkeys lo deduce del espaciado. Si puedes, usa un archivo Guitar Pro: es mucho más preciso.
            </p>
            <button type="button" className="btn-primary w-full" disabled={!tab.trim()} onClick={() => convertTab()}>
              Convertir a piano
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-sm text-muted">¿No tienes una canción a mano?</p>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setMode("paste");
              setTab(EXAMPLE_TAB.text);
              setCharsPerBeat(EXAMPLE_TAB.options.charsPerBeat);
              setBpm(EXAMPLE_TAB.options.bpm);
              convertTab(EXAMPLE_TAB.text, EXAMPLE_TAB.options);
            }}
          >
            Probar con un riff de ejemplo
          </button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Espacio de trabajo                                                  */
/* ------------------------------------------------------------------ */

const SOURCE_LABEL: Record<Song["source"], string> = { "guitar-pro": "Guitar Pro", musicxml: "MusicXML", midi: "MIDI", tab: "Tablatura" };

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

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Workspace({ song, onClose }: { song: Song; onClose: () => void }) {
  const [hands, setHands] = useState<Record<string, Hand>>(() => suggestHands(song));
  const [transpose, setTranspose] = useState(0);
  const [maxNotes, setMaxNotes] = useState(4);
  const [view, setView] = useState<"falling" | "sheet">("falling");
  const [showNames, setShowNames] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState({ right: false, left: false });
  const [pos, setPos] = useState(0);
  const player = useMemo(() => new Player(), []);

  const arrangement = useMemo(() => arrange(song, hands, { transpose, maxNotesPerHand: maxNotes }), [song, hands, transpose, maxNotes]);
  const musicXml = useMemo(() => (view === "sheet" ? toMusicXml(arrangement) : ""), [arrangement, view]);
  const key = useMemo(() => estimateKey([...arrangement.right, ...arrangement.left]), [arrangement]);
  const totalSec = beatToSeconds(arrangement.length, arrangement.tempos);
  const empty = !arrangement.right.length && !arrangement.left.length;

  useEffect(() => {
    const beat = player.position();
    player.load(arrangement);
    player.seek(Math.min(beat, arrangement.length));
    setPlaying(false);
  }, [arrangement, player]);

  useEffect(() => {
    player.onEnd = () => setPlaying(false);
    return () => player.stop();
  }, [player]);

  // Posición para la barra de progreso (la vista de notas lee el reproductor directamente).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setPos(player.position());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  const toggle = useCallback(async () => {
    if (player.playing) {
      player.pause();
      setPlaying(false);
    } else {
      await player.play();
      setPlaying(true);
    }
  }, [player]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(t.tagName)) {
        e.preventDefault();
        void toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const midi = useMidiInput((pitch, vel) => void player.preview(pitch, vel));
  const base = slug(song.title);

  return (
    <div className="wrap py-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            {SOURCE_LABEL[song.source]} · {song.tracks.length} {song.tracks.length === 1 ? "pista" : "pistas"} · {keyName(key)} · <span className="num">{Math.round(song.tempos[0].bpm)} bpm</span>
          </p>
          <h1 className="truncate font-display text-4xl font-black uppercase leading-none tracking-wide sm:text-5xl">{song.title}</h1>
          {song.artist && <p className="mt-1 text-muted">{song.artist}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-quiet" disabled={empty} onClick={() => download(toMidi(arrangement), `${base}-piano.mid`, "audio/midi")}>
            Descargar MIDI
          </button>
          <button type="button" className="btn-quiet" disabled={empty} onClick={() => download(toMusicXml(arrangement), `${base}-piano.musicxml`, "application/vnd.recordare.musicxml+xml")}>
            Descargar MusicXML
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Otra canción
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4" aria-labelledby="pistas">
            <h2 id="pistas" className="font-display text-2xl font-black uppercase tracking-wide">
              Pistas
            </h2>
            <p className="mt-1 text-xs text-muted">Elige qué toca cada mano. «Dividir» manda los graves a la izquierda y el resto a la derecha. Riffkeys ajusta la octava para que todo quepa.</p>
            <ul className="mt-3 space-y-2">
              {song.tracks.map((t) => {
                const pitches = t.notes.map((n) => n.pitch);
                const range = t.isPercussion ? "Percusión" : `${pitchName(Math.min(...pitches))}–${pitchName(Math.max(...pitches))}`;
                return (
                  <li key={t.id} className="rounded-xl border border-line bg-stage p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-semibold" title={t.name}>
                        {t.name}
                      </p>
                      <span className="shrink-0 text-xs text-muted">{ROLE_LABEL[t.role]}</span>
                    </div>
                    <p className="num text-xs text-muted">
                      {t.notes.length} notas · {range}
                    </p>
                    {t.isPercussion ? (
                      <p className="mt-2 text-xs text-muted">La batería no se toca en el piano.</p>
                    ) : (
                      <HandPicker value={hands[t.id] ?? "off"} onChange={(h) => setHands((prev) => ({ ...prev, [t.id]: h }))} label={t.name} />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4" aria-labelledby="ajustes">
            <h2 id="ajustes" className="font-display text-2xl font-black uppercase tracking-wide">
              Ajustes
            </h2>
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
            <label className="flex items-center justify-between gap-3 text-sm">
              Notas por mano
              <select className="field h-9" value={maxNotes} onChange={(e) => setMaxNotes(Number(e.target.value))}>
                <option value={2}>2 (más fácil)</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5 (completo)</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              Nombres de las notas
              <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} className="h-5 w-5 accent-bone" />
            </label>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4" aria-labelledby="midi">
            <h2 id="midi" className="font-display text-2xl font-black uppercase tracking-wide">
              Tu teclado
            </h2>
            {midi.state === "connected" ? (
              <p className="mt-1 text-sm">
                Conectado: <span className="font-semibold">{midi.device}</span>. Las teclas que tocas se iluminan en el teclado.
              </p>
            ) : midi.state === "unsupported" ? (
              <p className="mt-1 text-sm text-muted">Este navegador no permite teclados MIDI. Usa Chrome o Edge en computador.</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted">
                  {midi.state === "no-devices"
                    ? "No encontré ningún teclado. Conéctalo por USB y vuelve a intentarlo."
                    : midi.state === "denied"
                      ? "El navegador bloqueó el acceso MIDI. Permítelo en la barra de direcciones."
                      : "Conecta tu piano por USB para ver tus teclas junto a las del arreglo."}
                </p>
                <button type="button" className="btn-quiet mt-3 w-full" onClick={() => void midi.connect()} disabled={midi.state === "connecting"}>
                  {midi.state === "connecting" ? "Conectando…" : "Conectar teclado MIDI"}
                </button>
              </>
            )}
          </section>
        </aside>

        <section className="min-w-0" aria-label="Arreglo para piano">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Vista" className="inline-grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
              {(
                [
                  ["falling", "Notas cayendo"],
                  ["sheet", "Partitura"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  role="tab"
                  type="button"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`h-9 rounded-lg px-4 text-sm font-semibold ${view === v ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: HAND_COLOR.left }} /> Izquierda
              </span>
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: HAND_COLOR.right }} /> Derecha
              </span>
            </div>
          </div>

          {empty ? (
            <div className="mt-4 grid h-[60vh] min-h-[360px] place-items-center rounded-2xl border border-dashed border-line p-6 text-center">
              <div>
                <p className="font-semibold">Ninguna pista está asignada a una mano.</p>
                <p className="mt-1 text-sm text-muted">Elige «Izquierda» o «Derecha» en al menos una pista.</p>
              </div>
            </div>
          ) : view === "falling" ? (
            <div className="mt-4 h-[60vh] min-h-[360px] overflow-hidden rounded-2xl border border-line">
              <FallingNotes arrangement={arrangement} player={player} pressed={midi.pressed} showNames={showNames} onKey={(p) => void player.preview(p)} />
            </div>
          ) : (
            <div className="mt-4">
              <Suspense fallback={<p className="rounded-xl bg-[#fbf9f4] p-6 text-sm text-neutral-600">Cargando el motor de partituras…</p>}>
                <SheetView musicXml={musicXml} />
              </Suspense>
            </div>
          )}

          {!empty && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              <button type="button" onClick={() => void toggle()} className="btn-primary h-11 w-28" aria-label={playing ? "Pausar" : "Reproducir"}>
                {playing ? "Pausar" : "Reproducir"}
              </button>
              <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                <span className="num w-10 text-right text-sm text-muted">{fmtTime(beatToSeconds(pos, arrangement.tempos) / speed)}</span>
                <input
                  type="range"
                  min={0}
                  max={arrangement.length}
                  step={0.25}
                  value={Math.min(pos, arrangement.length)}
                  onChange={(e) => player.seek(Number(e.target.value))}
                  className="flex-1 accent-bone"
                  aria-label="Posición en la canción"
                />
                <span className="num w-10 text-sm text-muted">{fmtTime(totalSec / speed)}</span>
              </div>
              <label className="flex items-center gap-2 text-sm">
                Velocidad
                <select
                  className="field h-9"
                  value={speed}
                  onChange={(e) => {
                    const s = Number(e.target.value);
                    setSpeed(s);
                    player.setSpeed(s);
                  }}
                >
                  {[0.5, 0.6, 0.75, 0.9, 1, 1.25].map((s) => (
                    <option key={s} value={s}>
                      {Math.round(s * 100)} %
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-1" role="group" aria-label="Escuchar manos">
                {(["left", "right"] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={!muted[h]}
                    onClick={() =>
                      setMuted((m) => {
                        const next = { ...m, [h]: !m[h] };
                        player.muted = next;
                        return next;
                      })
                    }
                    className={`h-9 rounded-lg border px-3 text-sm font-semibold ${muted[h] ? "border-line text-muted line-through" : "border-transparent text-stage"}`}
                    style={muted[h] ? undefined : { background: HAND_COLOR[h] }}
                    title={muted[h] ? "Activar sonido" : "Silenciar para practicar esta mano"}
                  >
                    {h === "left" ? "Izq." : "Der."}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Barra espaciadora: reproducir o pausar. Silencia una mano para practicarla tú mientras suena la otra.</p>
        </section>
      </div>
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
