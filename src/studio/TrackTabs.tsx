import { useProject, useSession, useUi } from "./context";

/** The row of tracks along the bottom: the one that is lit is where notes go. */
export function TrackTabs() {
  const { ui } = useSession();
  const project = useProject();
  const active = useUi((s) => s.activeTrack);
  return (
    <div className="track-tabs" role="tablist" aria-label="Track that input goes to">
      {project.tracks.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`track-tab ${t.id === active ? "is-on" : ""} ${t.muted ? "is-muted" : ""}`}
          data-kind={t.kind}
          onClick={() => ui.setState({ activeTrack: t.id, selection: [] })}
        >
          {t.name}
        </button>
      ))}
      <button
        className="track-tab is-more"
        aria-label="Tracks and mixer"
        onClick={() => ui.setState({ sheet: "tracks" })}
      >
        <span aria-hidden>≡</span>
      </button>
    </div>
  );
}
