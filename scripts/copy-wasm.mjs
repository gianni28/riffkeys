// Copia los binarios WebAssembly de ONNX Runtime y TensorFlow.js a public/,
// para servirlos desde el mismo dominio (no se guardan en git).
import { cpSync, mkdirSync, readdirSync } from "node:fs";
const jobs = [
  ["node_modules/onnxruntime-web/dist", "public/ort", (f) => f.startsWith("ort-wasm-simd-threaded.jsep")],
  ["node_modules/@tensorflow/tfjs-backend-wasm/dist", "public/tfjs", (f) => f.endsWith(".wasm")],
];
for (const [from, to, keep] of jobs) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from).filter(keep)) cpSync(`${from}/${f}`, `${to}/${f}`);
}
