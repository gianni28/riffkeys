import { useRef, useState } from "react";
import type { Song } from "../core/model";
import { importFile } from "../core/importFile";
import { parseAsciiTab } from "../core/importTab";
import { mergeSongs } from "../core/smart";
import { barLength } from "../core/tempo";
import { Segmented } from "./ui";

/** Suma otra guitarra, el bajo o un solo (archivo o tab pegada) a la canción abierta. */
export function AddPart({ song, onAdd }: { song: Song; onAdd: (s: Song) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [name, setName] = useState("");
  const [startBar, setStartBar] = useState(1);
  const [tab, setTab] = useState("");
  const [charsPerBeat, setCharsPerBeat] = useState(4);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const offset = Math.max(0, startBar - 1) * barLength(song.timeSignature);

  const finish = (next: Song) => {
    onAdd(next);
    setTab("");
    setName("");
    setError("");
    setOpen(false);
  };

  const addTab = () => {
    try {
      const extra = parseAsciiTab(tab, { charsPerBeat, bpm: song.tempos[0]?.bpm ?? 120 }).song;
      finish(mergeSongs(song, extra, offset, name.trim() || `Parte ${song.tracks.length + 1}`, true));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      let next = song;
      for (const f of files) next = mergeSongs(next, await importFile(f), offset, name.trim() || f.name.replace(/\.[^.]+$/, ""), !!name.trim());
      finish(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" className="btn-quiet w-full" onClick={() => setOpen(true)}>
        + Añadir otra parte (guitarra, bajo, solo…)
      </button>
    );

  return (
    <div className="grid gap-3 rounded-xl border border-line bg-stage p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Añadir otra parte</p>
        <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      <Segmented
        label="Cómo añadir la parte"
        size="sm"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError("");
        }}
        options={[
          ["paste", "Pegar tab"],
          ["file", "Archivo"],
        ]}
      />
      <div className="grid grid-cols-[1fr_6.5rem] gap-2">
        <label className="block">
          <span className="label">Nombre</span>
          <input className="field mt-1 w-full" placeholder={`Guitarra ${song.tracks.length + 1}`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Desde compás</span>
          <input type="number" min={1} className="field num mt-1 w-full" value={startBar} onChange={(e) => setStartBar(Math.max(1, Number(e.target.value) || 1))} />
        </label>
      </div>
      {mode === "paste" ? (
        <>
          <textarea
            value={tab}
            onChange={(e) => setTab(e.target.value)}
            rows={7}
            spellCheck={false}
            aria-label="Tablatura de la parte"
            placeholder={"e|----------------|\nB|----------------|\nG|-----9-7--------|\nD|-7-9-----9-7----|\nA|----------------|\nE|----------------|"}
            className="w-full resize-y rounded-lg border border-line bg-surface p-2 font-mono text-xs leading-snug text-ink placeholder:text-muted/50 focus:border-bone focus:outline-none"
          />
          <label className="block">
            <span className="label">Cada guion vale</span>
            <select className="field mt-1 w-full" value={charsPerBeat} onChange={(e) => setCharsPerBeat(Number(e.target.value))}>
              <option value={4}>una semicorchea</option>
              <option value={2}>una corchea</option>
              <option value={3}>un tresillo</option>
              <option value={8}>una fusa</option>
            </select>
          </label>
          <button type="button" className="btn-primary" disabled={!tab.trim()} onClick={addTab}>
            Añadir a la canción
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Leyendo…" : "Elegir archivos"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Archivos de la parte"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      )}
      <p className="text-xs leading-snug text-muted">Se usa el tempo de la canción. Si la parte entra más tarde (un solo, por ejemplo), indica el compás.</p>
      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
