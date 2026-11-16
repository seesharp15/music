import { lazy, Suspense, useMemo } from "react";
import { useFlag } from "../app/flags";
import { useHashQuery } from "../app/hashRoute";
import { TopBar } from "../app/TopBar";
import { useSongIndex } from "../app/useSongIndex";
import { GENRE_LABEL, genresIn, isSort, select, SORTS, type Filters } from "./filter";
import { readRecent } from "./recent";
import { SongCard, SongCardSkeleton } from "./SongCard";

const CONTINUE_MAX = 4;

// The author's own songs. Its own chunk, with the database code: downloaded only with the flag on.
const MySongs = lazy(() => import("./MySongs"));

/** `#/` — the song bank: every song as a card, with search, filters and what was played last. */
export default function LibraryRoute() {
  const index = useSongIndex();
  const studio = useFlag("studio");
  const [query, setQuery] = useHashQuery();
  const filters: Filters = {
    q: query.get("q") ?? "",
    genre: query.get("genre") ?? "",
    difficulty: query.get("difficulty") ?? "",
    sort: isSort(query.get("sort")) ? (query.get("sort") as Filters["sort"]) : "recent",
  };
  const entries = index.status === "ready" ? index.entries : null;

  const shown = useMemo(
    () => (entries ? select(entries, filters) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the four filter values are the dependencies
    [entries, filters.q, filters.genre, filters.difficulty, filters.sort],
  );
  const genres = useMemo(() => (entries ? genresIn(entries) : []), [entries]);
  const levels = useMemo(
    () => [...new Set((entries ?? []).map((e) => e.difficulty).filter((d): d is NonNullable<typeof d> => !!d))].sort(),
    [entries],
  );
  // What was played last, for songs still in the bank. Read once per visit to this screen.
  const recent = useMemo(() => {
    if (!entries) return [];
    return readRecent()
      .map((r) => ({ recent: r, entry: entries.find((e) => e.id === r.id) }))
      .filter((x): x is { recent: (typeof x)["recent"]; entry: NonNullable<(typeof x)["entry"]> } => !!x.entry)
      .slice(0, CONTINUE_MAX);
  }, [entries]);

  const filtering = !!(filters.q || filters.genre || filters.difficulty);
  const clear = () => setQuery({ q: null, genre: null, difficulty: null });

  return (
    <>
      <TopBar>
        <input
          className="lib-search"
          type="search"
          placeholder="Search songs…"
          aria-label="Search songs"
          value={filters.q}
          onChange={(e) => setQuery({ q: e.target.value }, { replace: true })}
        />
      </TopBar>
      <main className="library">
        {index.status === "error" && (
          <div className="message" role="alert">
            <p>The song list couldn’t be loaded.</p>
            <p className="message-detail">{index.message}</p>
            <button className="chip is-on" onClick={index.retry}>
              Try again
            </button>
          </div>
        )}

        {recent.length > 0 && !filtering && (
          <section aria-labelledby="continue-title">
            <h2 id="continue-title" className="lib-heading">
              Continue
            </h2>
            <div className="song-row">
              {recent.map(({ recent: r, entry }) => (
                <SongCard key={entry.id} entry={entry} recent={r} />
              ))}
            </div>
          </section>
        )}

        {studio && !filtering && (
          <Suspense fallback={null}>
            <MySongs />
          </Suspense>
        )}

        {index.status !== "error" && (
          <section aria-labelledby="bank-title">
            <div className="lib-toolbar">
              <h1 id="bank-title" className="lib-heading">
                Song bank
              </h1>
              <label className="lib-select">
                <span aria-hidden>Difficulty</span>
                <select
                  className="select"
                  aria-label="Difficulty"
                  value={filters.difficulty}
                  onChange={(e) => setQuery({ difficulty: e.target.value })}
                >
                  <option value="">Any</option>
                  {levels.map((d) => (
                    <option key={d} value={d}>
                      {d} of 5
                    </option>
                  ))}
                </select>
              </label>
              <label className="lib-select">
                <span aria-hidden>Sort</span>
                <select
                  className="select"
                  aria-label="Sort by"
                  value={filters.sort}
                  onChange={(e) => setQuery({ sort: e.target.value === "recent" ? null : e.target.value })}
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Shown while loading too, so the cards below do not jump when the genres arrive. */}
            {(!entries || genres.length > 0) && (
              <div className="lib-chips" role="group" aria-label="Genre">
                <button
                  className={`chip ${!filters.genre ? "is-on" : ""}`}
                  aria-pressed={!filters.genre}
                  onClick={() => setQuery({ genre: null })}
                >
                  All
                </button>
                {genres.map((g) => (
                  <button
                    key={g}
                    className={`chip ${filters.genre === g ? "is-on" : ""}`}
                    aria-pressed={filters.genre === g}
                    onClick={() => setQuery({ genre: filters.genre === g ? null : g })}
                  >
                    {GENRE_LABEL[g]}
                  </button>
                ))}
              </div>
            )}

            {!entries ? (
              <div className="song-grid" aria-busy="true" aria-label="Loading songs">
                {Array.from({ length: 6 }, (_, i) => (
                  <SongCardSkeleton key={i} />
                ))}
              </div>
            ) : shown.length > 0 ? (
              <div className="song-grid">
                {shown.map((e) => (
                  <SongCard key={e.id} entry={e} />
                ))}
              </div>
            ) : (
              <div className="message">
                <p>{entries.length === 0 ? "There are no songs yet." : "No songs match."}</p>
                {filtering && (
                  <button className="chip is-on" onClick={clear}>
                    Clear search and filters
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
