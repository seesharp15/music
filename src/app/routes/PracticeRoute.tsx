import { useEffect, useState } from "react";
import { Practice } from "../../components/Practice";
import { loadSong } from "../../song/load";
import type { Song } from "../../song/types";
import { useFlag } from "../flags";
import { TopBar } from "../TopBar";
import { useSongIndex } from "../useSongIndex";

/** A song the author made lives on this device, under an id that starts `u-`. */
const isUserSongId = (id: string) => id.startsWith("u-");

/** `#/play/:songId` — the practice screen for one song: from the bank, or one of the author's own. */
export default function PracticeRoute({ songId }: { songId: string }) {
  return isUserSongId(songId) ? <OwnSong songId={songId} /> : <BankSong songId={songId} />;
}

function BankSong({ songId }: { songId: string }) {
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
  return <Frame song={song} missing={missing} message={message} />;
}

/** One of the author's own songs: read from this device through the catalog, never fetched. */
function OwnSong({ songId }: { songId: string }) {
  const studio = useFlag("studio");
  const [state, setState] = useState<{ song: Song | null; missing: boolean; message: string | null }>({
    song: null,
    missing: false,
    message: null,
  });
  useEffect(() => {
    let live = true;
    setState({ song: null, missing: false, message: null });
    // The catalog and the database behind it are downloaded only when one of these songs is opened.
    import("../../library/catalog")
      .then(({ catalog }) => catalog().load(songId))
      .then(
        (song) => live && setState({ song, missing: !song, message: null }),
        (e: Error) => live && setState({ song: null, missing: false, message: e.message }),
      );
    return () => {
      live = false;
    };
  }, [songId]);
  // Not on this device: it may still be a song the bank lists under such an id.
  if (state.missing) return <BankSong songId={songId} />;
  const projectId = state.song?.origin?.projectId;
  return (
    <Frame
      {...state}
      extra={
        studio && projectId ? (
          <a className="back-link edit-link" href={`#/studio/${projectId}`}>
            Edit in Studio
          </a>
        ) : undefined
      }
    />
  );
}

function Frame(props: { song: Song | null; missing: boolean; message: string | null; extra?: React.ReactNode }) {
  const { song, missing, message } = props;
  return (
    <>
      <TopBar>
        <a className="back-link" href="#/">
          ← Library
        </a>
        {props.extra}
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
