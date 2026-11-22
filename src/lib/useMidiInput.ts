import { useCallback, useEffect, useRef, useState } from "react";

type MidiState = "unsupported" | "idle" | "connecting" | "connected" | "no-devices" | "denied";

export interface MidiHandlers {
  onNoteOn?: (pitch: number, velocity: number) => void;
  onNoteOff?: (pitch: number) => void;
  onSustain?: (down: boolean) => void;
}

/**
 * Escucha un teclado MIDI conectado por USB (Web MIDI API, Chrome/Edge).
 * Las teclas presionadas viven en un Set mutable (`pressed`) que la vista de
 * notas lee en cada cuadro, así tocar no vuelve a renderizar toda la app.
 */
export function useMidiInput(handlers: MidiHandlers) {
  const [state, setState] = useState<MidiState>(() => (typeof navigator !== "undefined" && "requestMIDIAccess" in navigator ? "idle" : "unsupported"));
  const [device, setDevice] = useState<string | null>(null);
  const pressed = useRef(new Set<number>()).current;
  const cb = useRef(handlers);
  cb.current = handlers;
  const accessRef = useRef<MIDIAccess | null>(null);

  const attach = useCallback(
    (access: MIDIAccess) => {
      const inputs = [...access.inputs.values()];
      setDevice(inputs.map((i) => i.name).filter(Boolean).join(", ") || null);
      setState(inputs.length ? "connected" : "no-devices");
      for (const input of inputs) {
        input.onmidimessage = (e: MIDIMessageEvent) => {
          const data = e.data;
          if (!data || data.length < 3) return;
          const [status, a, b] = data;
          const cmd = status & 0xf0;
          if (cmd === 0x90 && b > 0) {
            pressed.add(a);
            cb.current.onNoteOn?.(a, b);
          } else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) {
            pressed.delete(a);
            cb.current.onNoteOff?.(a);
          } else if (cmd === 0xb0 && a === 64) {
            cb.current.onSustain?.(b >= 64);
          }
        };
      }
    },
    [pressed],
  );

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
