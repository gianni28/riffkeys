import type { Hand, Song } from "../core/model";
import { AUTO_ID } from "../core/smart";

/** Una canción guardada en «Mis canciones», con el reparto y la transposición que dejaste. */
export interface LibraryEntry {
  id: string;
  title: string;
  artist: string;
  song: Song;
  hands?: Record<string, Hand>;
  transpose?: number;
  added: number;
  opened: number;
}

const DB = "riffkeys";
const STORE = "canciones";
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Sin IndexedDB"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Huella para no guardar dos veces la misma canción si se vuelve a subir. */
export function fingerprint(song: Song): string {
  const tracks = song.tracks.filter((t) => t.id !== AUTO_ID);
  return `${song.title}|${tracks.length}|${tracks.map((t) => t.notes.length).join(",")}`;
}

export async function listSongs(): Promise<LibraryEntry[]> {
  await migrateLastSong();
  try {
    const all = await run<LibraryEntry[]>("readonly", (s) => s.getAll() as IDBRequest<LibraryEntry[]>);
    return all.sort((a, b) => b.opened - a.opened);
  } catch {
    return [];
  }
}

export async function saveSong(entry: LibraryEntry): Promise<void> {
  const clean = { ...entry, song: { ...entry.song, tracks: entry.song.tracks.filter((t) => t.id !== AUTO_ID) } };
  await run("readwrite", (s) => s.put(clean)).catch(() => undefined);
}

export async function deleteSong(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id)).catch(() => undefined);
}

/** Crea la entrada para una canción recién subida, o reutiliza la que ya estaba guardada. */
export async function entryFor(song: Song): Promise<LibraryEntry> {
  const now = Date.now();
  const existing = (await listSongs()).find((e) => fingerprint(e.song) === fingerprint(song));
  if (existing) return { ...existing, opened: now };
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`;
  return { id, title: song.title, artist: song.artist, song, added: now, opened: now };
}

/** La versión anterior guardaba solo la última canción en localStorage: se pasa a la biblioteca. */
let migrated = false;
async function migrateLastSong() {
  if (migrated) return;
  migrated = true;
  try {
    const raw = localStorage.getItem("riffkeys:ultima-cancion");
    if (!raw) return;
    const song = JSON.parse(raw) as Song;
    if (Array.isArray(song.tracks)) {
      const now = Date.now();
      await run("readwrite", (s) => s.put({ id: `migrada-${now}`, title: song.title, artist: song.artist, song, added: now, opened: now }));
    }
    localStorage.removeItem("riffkeys:ultima-cancion");
  } catch {
    /* nada que migrar */
  }
}
