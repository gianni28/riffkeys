/**
 * Separación de voz con IA en el navegador (MDX-Net, ver `mdx.ts`). El modelo
 * (~67 MB) se sirve desde el mismo dominio en tres partes, se descarga una vez
 * y queda guardado en el navegador (Cache API). Corre con WebGPU si hay; si no,
 * con WebAssembly (en varios hilos cuando la página está aislada).
 */

import { separateVocals } from "./mdx";

const CACHE = "riffkeys-modelos-v1";

/** ¿Vale la pena usar la IA por defecto? En computador sí; en celular tarda mucho sin GPU. */
export function aiRecommended(): boolean {
  if (typeof navigator === "undefined") return false;
  const mobile = navigator.maxTouchPoints > 1 && /Mobi|iPhone|iPad|Android/i.test(navigator.userAgent);
  return !mobile || "gpu" in navigator;
}

async function modelBytes(onProgress: (p: number) => void): Promise<ArrayBuffer> {
  const base = `${import.meta.env.BASE_URL}models/`;
  const meta = (await (await fetch(`${base}voz.json`)).json()) as { size: number; parts: string[] };
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  const out = new Uint8Array(meta.size);
  let off = 0;
  for (const part of meta.parts) {
    const url = `${base}${part}`;
    let res = await cache?.match(url);
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await cache?.put(url, res.clone()).catch(() => undefined);
    }
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.set(value, off);
      off += value.length;
      onProgress(off / meta.size);
    }
  }
  if (off !== meta.size) throw new Error("Modelo incompleto");
  return out.buffer;
}

export interface VocalSplit {
  vocals: { L: Float32Array; R: Float32Array };
  instrumental: { L: Float32Array; R: Float32Array };
  engine: "webgpu" | "wasm";
}

/** Separa voz e instrumental de una mezcla estéreo a 44,1 kHz (salida a 22 050 Hz). */
export async function separateWithAI(L: Float32Array, R: Float32Array, onProgress: (p: number, stage: string) => void): Promise<VocalSplit> {
  onProgress(0, "Descargando la IA de voz (solo la primera vez)");
  const ort = await import("onnxruntime-web/webgpu");
  ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  const bytes = await modelBytes((p) => onProgress(0.1 * p, "Descargando la IA de voz (solo la primera vez)"));
  onProgress(0.1, "Preparando la IA");
  let session: import("onnxruntime-web").InferenceSession;
  let engine: VocalSplit["engine"] = "wasm";
  try {
    if (!("gpu" in navigator)) throw new Error("sin WebGPU");
    session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"] });
    engine = "webgpu";
  } catch {
    session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  }
  try {
    const res = await separateVocals(ort, session, L, R, (p) => onProgress(0.12 + 0.88 * p, "Separando la voz con IA"));
    return { ...res, engine };
  } finally {
    await session.release().catch(() => undefined);
  }
}
