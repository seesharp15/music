/**
 * A MIDI keyboard, through the Web MIDI API. Chrome, Edge and Android browsers have it, Firefox
 * behind a permission prompt; Safari and every browser on iPhone and iPad do not — there
 * `midiSupported()` is false and the option is not shown at all.
 */

export interface MidiHandlers {
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
  /** Controller 64, the sustain pedal. */
  pedal?(down: boolean): void;
  /** The names of the keyboards now connected. */
  devices?(names: string[]): void;
}

export interface MidiConnection {
  close(): void;
}

// The parts of the Web MIDI API used here; TypeScript's DOM library may not have them.
interface MidiMessage {
  data: Uint8Array | null;
}
interface MidiInput {
  name?: string | null;
  state?: string;
  onmidimessage: ((e: MidiMessage) => void) | null;
}
interface MidiAccess {
  inputs: { values(): IterableIterator<MidiInput> };
  onstatechange: (() => void) | null;
}
type MidiNavigator = Navigator & { requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MidiAccess> };

export const midiSupported = (): boolean =>
  typeof navigator !== "undefined" && typeof (navigator as MidiNavigator).requestMIDIAccess === "function";

/** What a MIDI message means to a keyboard player. Exported for its unit test. */
export function readMidi(data: ArrayLike<number> | null, to: MidiHandlers): void {
  if (!data || data.length < 2) return;
  const kind = data[0] & 0xf0;
  const a = data[1];
  const b = data.length > 2 ? data[2] : 0;
  if (kind === 0x90 && b > 0) to.noteOn(a, b / 127);
  // A note-on with no velocity is a note-off: many keyboards send only those.
  else if (kind === 0x80 || (kind === 0x90 && b === 0)) to.noteOff(a);
  else if (kind === 0xb0 && a === 64) to.pedal?.(b >= 64);
}

/** Listen to every connected keyboard, including ones plugged in later. Rejects if access is refused. */
export async function openMidi(handlers: MidiHandlers): Promise<MidiConnection> {
  const request = (navigator as MidiNavigator).requestMIDIAccess;
  if (!request) throw new Error("This browser has no Web MIDI.");
  const access = await request.call(navigator, { sysex: false });
  const listening = new Set<MidiInput>();
  const attach = () => {
    const names: string[] = [];
    for (const input of access.inputs.values()) {
      if (input.state === "disconnected") continue;
      names.push(input.name || "MIDI keyboard");
      if (listening.has(input)) continue;
      listening.add(input);
      input.onmidimessage = (e) => readMidi(e.data, handlers);
    }
    handlers.devices?.(names);
  };
  access.onstatechange = attach;
  attach();
  return {
    close() {
      access.onstatechange = null;
      for (const input of listening) input.onmidimessage = null;
      listening.clear();
    },
  };
}
