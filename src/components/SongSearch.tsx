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
        if (ready) window.open(links.guitarPro, "_blank", "noopener");
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
          Buscar
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Te abre los archivos <strong className="text-ink">Guitar Pro</strong> de esa canción en Ultimate Guitar. Descarga uno y súbelo aquí abajo: trae todas las guitarras, el bajo y la voz, y
        Riffkeys arma solo la melodía y el bajo.
        {ready && (
          <>
            {" "}
            También puedes verla en{" "}
            <a className="font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-bone" href={links.songsterr} target="_blank" rel="noreferrer">
              Songsterr
            </a>{" "}
            o buscar un{" "}
            <a className="font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-bone" href={links.youtube} target="_blank" rel="noreferrer">
              tutorial en YouTube
            </a>
            .
          </>
        )}
      </p>
    </form>
  );
}
