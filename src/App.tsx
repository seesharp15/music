import { useEffect, useState } from "react";
import { loadIndex, loadSong } from "./song/load";
import type { Song, SongIndexEntry } from "./song/types";
import { Practice } from "./components/Practice";

export function App() {
  const [index, setIndex] = useState<SongIndexEntry[]>([]);
  const [songId, setSongId] = useState<string | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIndex()
      .then((entries) => {
        setIndex(entries);
        const fromHash = window.location.hash.slice(1);
        setSongId(entries.find((e) => e.id === fromHash)?.id ?? entries[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const entry = index.find((e) => e.id === songId);
    if (!entry) return;
    setSong(null);
    window.history.replaceState(null, "", `#${entry.id}`);
    loadSong(entry.file)
      .then(setSong)
      .catch((e: Error) => setError(e.message));
  }, [songId, index]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ♪
          </span>
          Piano Tutor
        </div>
        {index.length > 1 && (
          <select
            className="song-select"
            value={songId ?? ""}
            onChange={(e) => setSongId(e.target.value)}
            aria-label="Song"
          >
            {index.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
                {e.artist ? ` — ${e.artist}` : ""}
              </option>
            ))}
          </select>
        )}
      </header>
      {error && <div className="message">{error}</div>}
      {!error && !song && <div className="message">Loading…</div>}
      {song && <Practice key={song.id} song={song} />}
    </div>
  );
}
