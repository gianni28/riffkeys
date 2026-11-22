import { useState } from "react";
import type { Song } from "./core/model";
import { entryFor, saveSong, type LibraryEntry } from "./lib/library";
import { ImportScreen } from "./components/ImportScreen";
import { Workspace } from "./components/Workspace";
import { GithubIcon } from "./components/Icons";

export default function App() {
  const [entry, setEntry] = useState<LibraryEntry | null>(null);
  const openSong = async (song: Song) => {
    const e = await entryFor(song);
    void saveSong(e);
    setEntry(e);
    window.scrollTo(0, 0);
  };
  const openEntry = (e: LibraryEntry) => {
    setEntry({ ...e, opened: Date.now() });
    window.scrollTo(0, 0);
  };
  return (
    <div className="flex min-h-screen flex-col">
      <Header onHome={entry ? () => setEntry(null) : undefined} />
      <main id="contenido" className="flex-1">
        {entry ? <Workspace key={entry.id} entry={entry} onClose={() => setEntry(null)} /> : <ImportScreen onSong={(s) => void openSong(s)} onOpen={openEntry} />}
      </main>
      <footer className="border-t border-line">
        <div className="wrap flex flex-col gap-2 py-6 text-sm text-muted sm:flex-row sm:justify-between">
          <p>Todo se procesa en tu navegador. Tus archivos no se suben a ningún servidor.</p>
          <p>
            Piano: Salamander Grand Piano (CC BY 3.0) · Hecho por{" "}
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
    <header className="sticky top-0 z-40 border-b border-line bg-stage/85 backdrop-blur">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-bone focus:px-3 focus:py-2 focus:text-stage">
        Saltar al contenido
      </a>
      <div className="wrap flex h-16 items-center justify-between">
        {onHome ? (
          <button type="button" onClick={onHome} aria-label="Volver al inicio">
            <Logo />
          </button>
        ) : (
          <Logo />
        )}
        <a href="https://github.com/gianni28/riffkeys" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-ink">
          <GithubIcon width={18} height={18} /> <span className="hidden sm:inline">Código en GitHub</span>
        </a>
      </div>
    </header>
  );
}
