// Descarga el modelo de separación de voz (MDX-Net «Kim Vocal 2», de los
// modelos públicos de Ultimate Vocal Remover) y lo parte en trozos de 24 MB
// para servirlo desde el mismo dominio. Si falla, la app usa el método sin IA.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const URL = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx";
const DIR = "public/models";
const PART = 24 * 1024 * 1024;
if (existsSync(`${DIR}/voz.json`)) process.exit(0);
try {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  mkdirSync(DIR, { recursive: true });
  const parts = [];
  for (let i = 0, k = 0; i < buf.length; i += PART, k++) {
    const name = `voz.${k}.bin`;
    writeFileSync(`${DIR}/${name}`, buf.subarray(i, i + PART));
    parts.push(name);
  }
  writeFileSync(`${DIR}/voz.json`, JSON.stringify({ size: buf.length, parts }));
  console.log(`Modelo de voz listo: ${parts.length} partes, ${(buf.length / 1e6).toFixed(1)} MB`);
} catch (e) {
  console.warn("No se pudo descargar el modelo de voz; la app usará la separación sin IA.", e.message);
}
