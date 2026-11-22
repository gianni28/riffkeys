import { useEffect, useRef, useState } from "react";
import type { Song } from "../core/model";
import { importFile } from "../core/importFile";
import { parseAsciiTab } from "../core/importTab";
import { combineSongs } from "../core/smart";
import { isAudioFile, looksLikeAudio, transcribe } from "../core/transcribe";
import { aiRecommended } from "../core/cover/separate";
import { EXAMPLE_TAB } from "../core/example";
import { deleteSong, listSongs, type LibraryEntry } from "../lib/library";
import { DemoStage } from "./DemoStage";
import { SongSearch } from "./SongSearch";
import { Segmented, Toggle } from "./ui";
import { UploadIcon } from "./Icons";

const FEATURES: [string, string][] = [
  ["De audio a piano", "Sube una grabación y Riffkeys la escucha: melodía a la derecha, bajo a la izquierda. Sin salir de tu dispositivo."],
  ["Melodía automática", "Con varias guitarras y voz, junta sola lo que se oye arriba: la voz al cantar, el riff o el solo cuando no."],
  ["Suena a piano de verdad", "Un piano de cola sampleado con tres capas de intensidad y reverberación de sala."],
  ["Practica con tu teclado", "Conéctalo por USB: aciertos y fallos en tiempo real, modo «esperarme» y bucles que suben el tempo solos."],
];

export function ImportScreen({ onSong, onOpen }: { onSong: (s: Song) => void; onOpen: (e: LibraryEntry) => void }) {
  const [mode, setMode] = useState<"file" | "paste" | "audio">("file");
  const [progress, setProgress] = useState<{ p: number; stage: string } | null>(null);
  const [ai, setAi] = useState(() => aiRecommended());
  const audioRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("");
  const [charsPerBeat, setCharsPerBeat] = useState(4);
  const [bpm, setBpm] = useState(120);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listSongs().then(setLibrary);
  }, []);

  /** Varios archivos a la vez (p. ej. una tab por guitarra) se juntan en una sola canción. */
  const load = async (files: FileList | File[] | null | undefined) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setBusy(true);
    setError("");
    try {
      const audio = list.find(isAudioFile) ?? (list.length === 1 && looksLikeAudio(new Uint8Array(await list[0].slice(0, 16).arrayBuffer())) ? list[0] : undefined);
      if (audio) {
        // Una grabación: se escucha y se transcribe (pesa ~2 MB, solo se baja si hace falta).
        setMode("audio");
        // Que el celular no se duerma mientras escucha la canción.
        const lock = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock
          ?.request("screen")
          .catch(() => undefined);
        try {
          onSong(await transcribe(audio, (p, stage) => setProgress({ p, stage }), { ai }));
        } finally {
          void lock?.release();
        }
      } else onSong(combineSongs(await Promise.all(list.map((f) => importFile(f)))));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
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
    <>
      <div className="wrap grid gap-10 py-10 lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-16 lg:py-16">
        <section>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-lh" />
            <span className="h-1.5 w-1.5 rounded-full bg-rh" />
            Metal, rock y lo que quieras, en piano
          </p>
          <h1 className="font-display text-6xl font-black uppercase leading-[0.88] tracking-wide sm:text-8xl">
            De la tab
            <br />
            <span className="bg-gradient-to-r from-lh via-bone to-rh bg-clip-text text-transparent">al piano.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted">
            Pega una tablatura, sube un Guitar Pro, MIDI o MusicXML, o directamente una grabación. Riffkeys reparte las guitarras, el bajo y la voz entre tus dos manos, la toca con un
            piano de cola y te deja practicarla nota por nota.
          </p>
          <ol className="mt-8 hidden max-w-lg gap-3 sm:grid">
            {[
              ["Búscala", "Escribe el nombre y Riffkeys te abre sus tabs gratis para copiar y pegar."],
              ["O súbela en audio", "Un MP3 o un video: Riffkeys la escucha y saca la melodía y el bajo."],
              ["Practica o exporta", "Con tu teclado MIDI, en bucle y a tu velocidad, o ábrelo en MuseScore."],
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

        <section className="rounded-2xl border border-line bg-surface p-4 shadow-2xl shadow-black/30 sm:p-6" aria-label="Cargar canción">
          <SongSearch />
          <div className="mt-4" />
          <Segmented
            label="Forma de cargar"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError("");
            }}
            options={[
              ["file", "Archivo"],
              ["paste", "Pegar tab"],
              ["audio", "Desde audio"],
            ]}
          />

          {mode === "audio" ? (
            <div className="mt-4 rounded-xl border-2 border-dashed border-line px-5 py-10 text-center">
              <p className="font-display text-3xl font-black uppercase tracking-wide">De una grabación al piano</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                Sube un audio o un video (MP3, M4A, WAV, MP4…). Riffkeys separa la voz, el bajo y las guitarras, sigue el pulso, saca los acordes y arma el cover: melodía a
                la derecha y acompañamiento a la izquierda, a tempo. Todo pasa en tu dispositivo.
              </p>
              <div className="mx-auto mt-4 max-w-sm text-left">
                <Toggle
                  checked={ai}
                  onChange={setAi}
                  disabled={busy}
                  label="Aislar la voz con IA (mucho mejor melodía)"
                  hint="Descarga ~67 MB la primera vez. En computador tarda unos minutos; en celular puede tardar bastante más. Sin IA es rápido, pero la melodía sale peor."
                />
              </div>
              {progress ? (
                <div className="mx-auto mt-6 max-w-xs" aria-live="polite">
                  <div className="h-2 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-gradient-to-r from-lh to-rh transition-[width]" style={{ width: `${Math.round(progress.p * 100)}%` }} />
                  </div>
                  <p className="mt-2 text-sm">
                    {progress.stage}… <span className="num text-muted">{Math.round(progress.p * 100)} %</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">Una canción entera puede tardar un par de minutos. No cierres la página.</p>
                </div>
              ) : (
                <button type="button" className="btn-primary mt-6" onClick={() => audioRef.current?.click()} disabled={busy}>
                  Elegir audio o video
                </button>
              )}
              <input
                ref={audioRef}
                type="file"
                className="sr-only"
                aria-label="Elegir audio o video"
                onChange={(e) => {
                  void load(e.target.files);
                  e.target.value = "";
                }}
              />
              <p className="mx-auto mt-5 max-w-sm text-xs leading-relaxed text-muted">
                Una canción entera tarda unos minutos. Al terminar puedes cambiar qué toca cada mano: hay pistas con la voz sola, la guitarra principal, el bajo
                de la grabación y acordes para la derecha.
              </p>
            </div>
          ) : mode === "file" ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void load(e.dataTransfer.files);
              }}
              className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${dragging ? "border-bone bg-raised" : "border-line"}`}
            >
              <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-raised text-muted">
                <UploadIcon />
              </span>
              <p className="font-display text-3xl font-black uppercase tracking-wide">Arrastra tu archivo aquí</p>
              <p className="mt-2 text-sm text-muted">Guitar Pro · MusicXML · MIDI · tab en .txt · audio o video</p>
              <p className="mt-1 text-xs text-muted">¿Tienes cada guitarra en un archivo distinto? Súbelos todos juntos.</p>
              <button type="button" className="btn-primary mt-6" onClick={() => inputRef.current?.click()} disabled={busy}>
                {busy ? "Leyendo…" : "Elegir archivos"}
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                    className="sr-only"
                onChange={(e) => {
                  void load(e.target.files);
                  e.target.value = "";
                }}
                aria-label="Elegir archivos de canción"
              />
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

      {library.length > 0 && (
        <Library
          entries={library}
          onOpen={onOpen}
          onDelete={(id) => {
            void deleteSong(id);
            setLibrary((l) => l.filter((e) => e.id !== id));
          }}
        />
      )}

      <section className="wrap pb-16" aria-label="Así se ve">
        <div className="h-56 overflow-hidden rounded-2xl border border-line sm:h-72" aria-hidden="true">
          <DemoStage />
        </div>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(([t, d]) => (
            <li key={t}>
              <p className="font-display text-2xl font-black uppercase tracking-wide">{t}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const ago = (t: number) => {
  const d = Math.floor((Date.now() - t) / 86400000);
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : d < 30 ? `hace ${d} días` : new Date(t).toLocaleDateString("es");
};

function Library({ entries, onOpen, onDelete }: { entries: LibraryEntry[]; onOpen: (e: LibraryEntry) => void; onDelete: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const [all, setAll] = useState(false);
  const f = filter.trim().toLowerCase();
  const shown = entries.filter((e) => !f || `${e.title} ${e.artist}`.toLowerCase().includes(f));
  const visible = all || f ? shown : shown.slice(0, 6);
  return (
    <section className="wrap pb-12" aria-labelledby="mis-canciones">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="mis-canciones" className="font-display text-4xl font-black uppercase tracking-wide">
          Mis canciones
        </h2>
        {entries.length > 6 && (
          <input type="search" className="field w-56" placeholder="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar mis canciones" />
        )}
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((e) => (
          <li key={e.id} className="group relative rounded-xl border border-line bg-surface transition-colors hover:border-muted/60">
            <button type="button" className="block w-full p-4 pr-12 text-left" onClick={() => onOpen(e)}>
              <p className="truncate font-semibold">{e.title}</p>
              <p className="truncate text-sm text-muted">
                {e.artist ? `${e.artist} · ` : ""}
                {e.song.tracks.length} pistas · {ago(e.opened)}
              </p>
            </button>
            <button
              type="button"
              className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-lg text-muted opacity-70 hover:bg-raised hover:text-ink group-hover:opacity-100"
              aria-label={`Borrar «${e.title}» de mis canciones`}
              title="Borrar"
              onClick={() => {
                if (confirm(`¿Borrar «${e.title}» de tus canciones?`)) onDelete(e.id);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {!all && !f && shown.length > 6 && (
        <button type="button" className="btn-quiet mt-3" onClick={() => setAll(true)}>
          Ver todas ({shown.length})
        </button>
      )}
    </section>
  );
}
