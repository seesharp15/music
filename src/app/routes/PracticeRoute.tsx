import { useEffect, useState } from "react";
import { Practice } from "../../components/Practice";
import { loadSong } from "../../song/load";
import type { Song } from "../../song/types";
import { TopBar } from "../TopBar";
import { useSongIndex } from "../useSongIndex";

/** `#/play/:songId` — the practice screen for one song. */
export default function PracticeRoute({ songId }: { songId: string }) {
  const index = useSongIndex();
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = index.status === "ready" ? index.entries : null;
  const entry = entries?.find((e) => e.id === songId) ?? null;
  const missing = !!entries && !entry;

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
      <TopBar>
        <a className="back-link" href="#/">
          ← Library
        </a>
      </TopBar>
      {missing ? (
        <div className="message" role="alert">
          <p>That song isn’t in the library.</p>
          <p>
            <a href="#/">See all the songs</a>
          </p>
        </div>
      ) : message ? (
        <div className="message" role="alert">
          {message}
        </div>
      ) : !song ? (
        <div className="message">Loading…</div>
      ) : (
        <Practice key={song.id} song={song} />
      )}
    </>
  );
}
