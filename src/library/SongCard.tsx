import type { ReactNode } from "react";
import type { SongIndexEntry } from "../song/types";
import { clock, GENRE_LABEL } from "./filter";
import type { Recent } from "./recent";

/** The song's shape over time, drawn from the index's 48-point preview. */
function Thumbnail({ preview }: { preview?: number[] }) {
  const bars = preview?.length ? preview : new Array(48).fill(0.08);
  return (
    <svg className="card-thumb" viewBox={`0 0 ${bars.length} 12`} preserveAspectRatio="none" aria-hidden>
      {bars.map((v, i) => {
        const h = Math.max(0.6, v * 12);
        return <rect key={i} x={i + 0.15} y={12 - h} width={0.7} height={h} rx={0.2} />;
      })}
    </svg>
  );
}

function Difficulty({ level }: { level: number }) {
  return (
    <span className="card-difficulty" role="img" aria-label={`Difficulty ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= level ? "is-on" : ""} />
      ))}
    </span>
  );
}

/** One song. The whole card is a link, so middle-click, long-press and the keyboard all just work. */
export function SongCard({ entry, recent, menu }: { entry: SongIndexEntry; recent?: Recent; menu?: ReactNode }) {
  const facts = [
    entry.duration ? clock(entry.duration) : null,
    entry.bpm ? `${entry.bpm} BPM` : null,
    entry.key ?? null,
  ].filter(Boolean);
  const progress = recent && recent.duration > 0 ? Math.min(1, recent.time / recent.duration) : null;
  // With a menu beside it, the card is a box holding the link and the menu; otherwise it is the link.
  if (menu) {
    return (
      <div className="song-card has-menu">
        <a className="card-link" href={`#/play/${entry.id}`}>
          <Thumbnail preview={entry.preview} />
          <span className="card-title">{entry.title}</span>
          {entry.artist && <span className="card-artist">{entry.artist}</span>}
          <span className="card-meta">
            <span className="mono">{facts.join(" · ")}</span>
            {entry.difficulty && <Difficulty level={entry.difficulty} />}
            {entry.genre && <span className="card-genre">{GENRE_LABEL[entry.genre]}</span>}
          </span>
        </a>
        {menu}
      </div>
    );
  }
  return (
    <a className="song-card" href={`#/play/${entry.id}`}>
      <Thumbnail preview={entry.preview} />
      <span className="card-title">{entry.title}</span>
      {entry.artist && <span className="card-artist">{entry.artist}</span>}
      {progress !== null ? (
        <span className="card-progress">
          <span className="card-progress-bar" aria-hidden>
            <span style={{ width: `${progress * 100}%` }} />
          </span>
          <span className="mono">
            Resume at {clock(recent!.time)} of {clock(recent!.duration)}
          </span>
        </span>
      ) : (
        <span className="card-meta">
          <span className="mono">{facts.join(" · ")}</span>
          {entry.difficulty && <Difficulty level={entry.difficulty} />}
          {entry.genre && <span className="card-genre">{GENRE_LABEL[entry.genre]}</span>}
        </span>
      )}
    </a>
  );
}

/** The same footprint as a card, while the index loads: no jump when the real cards arrive. */
export function SongCardSkeleton() {
  return (
    <div className="song-card is-skeleton" aria-hidden>
      <span className="card-thumb" />
      <span className="card-title">&nbsp;</span>
      <span className="card-artist">&nbsp;</span>
      <span className="card-meta">&nbsp;</span>
    </div>
  );
}
