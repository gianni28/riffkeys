import { useRef, useState } from "react";
import type { Song } from "../core/model";
import { importFile, ACCEPTED } from "../core/importFile";
import { parseAsciiTab } from "../core/importTab";
import { EXAMPLE_TAB } from "../core/example";
import { forgetLastSong, loadLastSong } from "../lib/settings";
import { DemoStage } from "./DemoStage";
import { Segmented } from "./ui";
import { UploadIcon } from "./Icons";

const FEATURES: [string, string][] = [
  ["Reparto a dos manos", "Melodía y voz a la derecha, bajo a la izquierda, batería fuera. Cada pista cae en el registro de su mano."],
  ["Suena a piano de verdad", "Un piano de cola sampleado con tres capas de intensidad y reverberación de sala."],
  ["Practica con tu teclado", "Conéctalo por USB: aciertos y fallos en tiempo real, modo «esperarme» y bucles que suben el tempo solos."],
  ["Llévalo a MuseScore", "Partitura con armadura estimada, imprimible, y exportación a MIDI y MusicXML."],
];

export function ImportScreen({ onSong }: { onSong: (s: Song) => void }) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("");
  const [charsPerBeat, setCharsPerBeat] = useState(4);
  const [bpm, setBpm] = useState(120);
  const [last, setLast] = useState(() => loadLastSong());
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
            Sube una canción en Guitar Pro, MusicXML o MIDI, o pega una tablatura. Riffkeys reparte las guitarras, el bajo y la voz entre tus dos manos, la toca con un
            piano de cola y te deja practicarla nota por nota.
          </p>
          <ol className="mt-8 grid max-w-lg gap-3">
            {[
              ["Carga la canción", "Guitar Pro, MusicXML, MIDI o texto. Guitar Pro es lo más preciso: trae el ritmo exacto."],
              ["Elige qué toca cada mano", "Riffkeys sugiere un reparto y ajusta el registro y la dificultad."],
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
          {last && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-stage p-3">
              <div className="min-w-0">
                <p className="text-xs text-muted">Seguir con</p>
                <p className="truncate font-semibold">{last.title}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" className="btn-primary h-9" onClick={() => onSong(last)}>
                  Abrir
                </button>
                <button
                  type="button"
                  className="btn-quiet h-9 w-9 px-0"
                  aria-label="Olvidar esta canción"
                  title="Olvidar"
                  onClick={() => {
                    forgetLastSong();
                    setLast(null);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          )}

          <Segmented
            label="Forma de cargar"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError("");
            }}
            options={[
              ["file", "Subir archivo"],
              ["paste", "Pegar tablatura"],
            ]}
          />

          {mode === "file" ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void load(e.dataTransfer.files[0]);
              }}
              className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${dragging ? "border-bone bg-raised" : "border-line"}`}
            >
              <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-raised text-muted">
                <UploadIcon />
              </span>
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
