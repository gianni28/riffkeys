import { useState } from "react";
import { searchLinks } from "../lib/platform";

export function SongSearch() {
  const [q, setQ] = useState("");
  const links = searchLinks(q);
  const ready = q.trim().length > 1;
  return (
    <form
      className="rounded-xl border border-line bg-stage p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) window.open(links.tabs, "_blank", "noopener");
      }}
      role="search"
    >
      <label htmlFor="buscar" className="text-sm font-semibold">
        ¿Qué quieres tocar?
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="buscar"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Iron Maiden The Wicker Man"
          className="field min-w-0 flex-1"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={!ready}>
          Buscar tabs
        </button>
      </div>
      <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs leading-relaxed text-muted">
        <li>Te abre las tabs gratis de Ultimate Guitar. Elige una y copia el texto de la tab.</li>
        <li>
          Pégalo en <strong className="text-ink">«Pegar tablatura»</strong>, aquí abajo. ¿Otra guitarra? Dentro de la canción, <strong className="text-ink">«+ Añadir otra parte»</strong>.
        </li>
        <li>
          ¿Tienes la canción en audio o video? Súbela en <strong className="text-ink">«Desde audio»</strong> y Riffkeys saca el piano.
          {ready && (
            <>
              {" "}
              O mira un{" "}
              <a className="font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-bone" href={links.youtube} target="_blank" rel="noreferrer">
                tutorial en YouTube
              </a>
              .
            </>
          )}
        </li>
      </ol>
    </form>
  );
}
