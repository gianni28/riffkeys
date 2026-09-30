import { useCallback, useEffect, useRef, useState } from "react";

type MidiState = "unsupported" | "idle" | "connecting" | "connected" | "no-devices" | "denied";

/**
 * Escucha un teclado MIDI conectado por USB (Web MIDI API, Chrome/Edge).
 * Devuelve las teclas presionadas y el nombre del dispositivo.
 */
export function useMidiInput(onNoteOn?: (pitch: number, velocity: number) => void) {
  const [state, setState] = useState<MidiState>(() => (typeof navigator !== "undefined" && "requestMIDIAccess" in navigator ? "idle" : "unsupported"));
  const [device, setDevice] = useState<string | null>(null);
  const [pressed, setPressed] = useState<Set<number>>(new Set());
  const cb = useRef(onNoteOn);
  cb.current = onNoteOn;
  const accessRef = useRef<MIDIAccess | null>(null);

  const attach = useCallback((access: MIDIAccess) => {
    const inputs = [...access.inputs.values()];
    setDevice(inputs[0]?.name ?? null);
    setState(inputs.length ? "connected" : "no-devices");
    for (const input of inputs) {
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const data = e.data;
        if (!data || data.length < 3) return;
        const [status, pitch, vel] = data;
        const cmd = status & 0xf0;
        if (cmd === 0x90 && vel > 0) {
          setPressed((prev) => new Set(prev).add(pitch));
          cb.current?.(pitch, vel);
        } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
          setPressed((prev) => {
            const next = new Set(prev);
            next.delete(pitch);
            return next;
          });
        }
      };
    }
  }, []);

  const connect = useCallback(async () => {
    if (state === "unsupported") return;
    setState("connecting");
    try {
      const access = await navigator.requestMIDIAccess();
      accessRef.current = access;
      attach(access);
      access.onstatechange = () => attach(access);
    } catch {
      setState("denied");
    }
  }, [attach, state]);

  useEffect(
    () => () => {
      const access = accessRef.current;
      if (access) for (const input of access.inputs.values()) input.onmidimessage = null;
    },
    [],
  );

  return { state, device, pressed, connect };
}
