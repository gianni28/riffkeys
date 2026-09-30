import { useEffect, useRef, useState } from "react";
import * as alphaTab from "@coderline/alphatab";

/** Renderiza la partitura del arreglo (MusicXML) con alphaTab, sobre papel. */
export function SheetView({ musicXml }: { musicXml: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const el = ref.current!;
    const api = new alphaTab.AlphaTabApi(el, {
      core: { useWorkers: true, fontDirectory: "/font/" },
      display: { layoutMode: alphaTab.LayoutMode.Page, staveProfile: alphaTab.StaveProfile.Score, scale: 0.9 },
      player: { enablePlayer: false },
    } as unknown as alphaTab.Settings);
    api.renderFinished.on(() => setStatus("ready"));
    api.error.on(() => setStatus("error"));
    apiRef.current = api;
    return () => api.destroy();
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    setStatus("loading");
    api.load(new TextEncoder().encode(musicXml));
  }, [musicXml]);

  return (
    <div className="relative min-h-[320px] rounded-xl bg-[#fbf9f4] p-2 text-[#15161d] sm:p-4">
      {status === "loading" && <p className="absolute left-4 top-4 text-sm text-neutral-500">Dibujando la partitura…</p>}
      {status === "error" && <p className="p-4 text-sm text-red-700">No se pudo dibujar la partitura. Descarga el MusicXML y ábrelo en MuseScore.</p>}
      <div ref={ref} />
    </div>
  );
}
