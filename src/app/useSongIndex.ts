import { useEffect, useState } from "react";
import { loadIndex } from "../song/load";
import type { SongIndexEntry } from "../song/types";

let cached: Promise<SongIndexEntry[]> | null = null;

/** The song bank's index, fetched once and shared by every screen. */
export function songIndex(): Promise<SongIndexEntry[]> {
  cached ??= loadIndex().catch((e) => {
    cached = null; // a failed load may be retried
    throw e;
  });
  return cached;
}

export type IndexState =
  | { status: "loading" }
  | { status: "ready"; entries: SongIndexEntry[] }
  | { status: "error"; message: string; retry: () => void };

export function useSongIndex(): IndexState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<IndexState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    songIndex().then(
      (entries) => live && setState({ status: "ready", entries }),
      (e: Error) => live && setState({ status: "error", message: e.message, retry: () => setAttempt((n) => n + 1) }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  return state;
}
