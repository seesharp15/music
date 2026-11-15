import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Practice } from "../../components/Practice";
import { loadSong } from "../../song/load";
import type { Song } from "../../song/types";
import { useSongIndex } from "../useSongIndex";

/** `#/play/:songId` — the practice screen for one song. */
export default function PracticeRoute({ songId }: { songId: string }) {
  const index = useSongIndex();
  const [, navigate] = useLocation();
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = index.status === "ready" ? index.entries : null;
  const entry = entries?.find((e) => e.id === songId) ?? null;

  // An id that isn't in the bank falls back to the first song, as it always has.
  useEffect(() => {
    if (entries && !entry && entries[0]) navigate(`/play/${entries[0].id}`, { replace: true });
  }, [entries, entry, navigate]);

  useEffect(() => {
    if (!entry) return;
    let live = true;
    setSong(null);
    setError(null);
    loadSong(entry.file).then(
      (s) => live && setSong(s),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [entry]);

  const message = index.status === "error" ? index.message : error;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ♪
          </span>
          Piano Tutor
        </div>
        {entries && entries.length > 1 && (
          <select
            className="song-select"
            value={entry?.id ?? ""}
            onChange={(e) => navigate(`/play/${e.target.value}`)}
            aria-label="Song"
          >
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
                {e.artist ? ` — ${e.artist}` : ""}
              </option>
            ))}
          </select>
        )}
      </header>
      {message && <div className="message">{message}</div>}
      {!message && !song && <div className="message">Loading…</div>}
      {song && <Practice key={song.id} song={song} />}
    </>
  );
}
