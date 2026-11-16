import { useState } from "react";
import { ConfirmDialog } from "../../app/ui/Dialog";
import { SOUNDS } from "../../audio/player";
import type { EditOp, Track } from "../../project/types";
import type { Hand, TrackRole } from "../../song/types";
import { announce, edit } from "../actions";
import { useProject, useSession, useUi } from "../context";
import { trackColor } from "../layers";
import { CommitField } from "../SongSettings";
import { addTrack, isEmptyTrack, moveTrack, removeTrack } from "./ops";

const ROLES: { id: TrackRole; label: string }[] = [
  { id: "melody", label: "Melody" },
  { id: "chords", label: "Chords" },
  { id: "bass", label: "Bass" },
  { id: "counter", label: "Counter-melody" },
  { id: "free", label: "Anything" },
];

type TrackPatch = Extract<EditOp, { op: "patchTrack" }>["patch"];

/** Every track: what it is called and sounds like, how loud it is, and which hand practises it. */
export function TracksSheet() {
  const session = useSession();
  const { ui } = session;
  const project = useProject();
  const active = useUi((s) => s.activeTrack);
  const solo = useUi((s) => s.solo);
  const hidden = useUi((s) => s.hiddenTracks);
  const [deleting, setDeleting] = useState<Track | null>(null);

  const patch = (t: Track, p: TrackPatch, label: string, said?: string) => {
    if (edit(session, [{ op: "patchTrack", trackId: t.id, patch: p }], label) && said) announce(session, said);
  };
  const remove = (t: Track) => {
    const change = removeTrack(project, t.id);
    if (!change || !edit(session, change.ops, change.label)) return;
    const rest = session.store.getState().project.tracks;
    ui.setState({
      activeTrack: active === t.id ? (rest.find((x) => x.kind === "notes")?.id ?? rest[0]?.id ?? "") : active,
      solo: solo === t.id ? null : solo,
      hiddenTracks: hidden.filter((id) => id !== t.id),
      selection: [],
    });
    announce(session, `${t.name} deleted`);
  };
  const add = (kind: Track["kind"]) => {
    const change = addTrack(project, kind);
    if (edit(session, change.ops, change.label)) {
      ui.setState({ activeTrack: change.trackId!, selection: [] });
      announce(session, "Track added");
    }
  };
  const move = (t: Track, direction: 1 | -1) => {
    const change = moveTrack(project, t.id, direction);
    if (change && edit(session, change.ops, change.label)) {
      ui.setState({ selection: [] });
      announce(session, `${t.name} moved ${direction < 0 ? "up" : "down"}`);
    }
  };

  return (
    <div className="tracks">
      <ol className="track-list">
        {project.tracks.map((t, i) => {
          const isHidden = hidden.includes(t.id);
          return (
            <li
              key={t.id}
              className={`track-card ${t.id === active ? "is-active" : ""}`}
              style={
                { "--track": t.kind === "notes" ? trackColor(project, t.id).fill : "#ffb84d" } as React.CSSProperties
              }
            >
              <div className="track-top">
                <button
                  className={`track-pick ${t.id === active ? "is-on" : ""}`}
                  aria-pressed={t.id === active}
                  aria-label={`Write to ${t.name}`}
                  title="Make this the track that keys and tools write to"
                  onClick={() => ui.setState({ activeTrack: t.id, selection: [] })}
                />
                <CommitField
                  label={`Name of track ${i + 1}`}
                  value={t.name}
                  onCommit={(name) => patch(t, { name }, "Rename track", `Renamed to ${name}`)}
                />
              </div>
              <VolumeRow track={t} />
              <div className="track-switches">
                <Toggle
                  label="Solo"
                  title="Hear this track alone"
                  on={solo === t.id}
                  onChange={(on) => ui.setState({ solo: on ? t.id : null })}
                  name={t.name}
                />
                <Toggle
                  label="Lock"
                  title="A locked track cannot be changed"
                  on={t.locked}
                  onChange={(on) =>
                    patch(
                      t,
                      { locked: on },
                      on ? "Lock track" : "Unlock track",
                      `${t.name} ${on ? "locked" : "unlocked"}`,
                    )
                  }
                  name={t.name}
                />
                <Toggle
                  label="Hide"
                  title="Hide this track's notes in the editor (it still plays)"
                  on={isHidden}
                  onChange={(on) =>
                    ui.setState({ hiddenTracks: on ? [...hidden, t.id] : hidden.filter((id) => id !== t.id) })
                  }
                  name={t.name}
                />
              </div>
              {t.kind === "notes" && (
                <div className="track-fields">
                  <label className="field">
                    <span>For</span>
                    <select
                      className="select"
                      aria-label={`What ${t.name} is for`}
                      value={t.role}
                      disabled={t.locked}
                      onChange={(e) => patch(t, { role: e.target.value as TrackRole }, "Change what the track is for")}
                    >
                      {ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Sound</span>
                    <select
                      className="select"
                      aria-label={`Sound of ${t.name}`}
                      value={t.sound}
                      disabled={t.locked}
                      onChange={(e) =>
                        patch(t, { sound: e.target.value as (typeof SOUNDS)[number]["id"] }, "Change sound")
                      }
                    >
                      {SOUNDS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field" role="group" aria-label={`Hand that practises ${t.name}`}>
                    <span>Hand</span>
                    <div className="hand-pick">
                      {(["L", "R"] as Hand[]).map((h) => (
                        <button
                          key={h}
                          className={`chip ${t.hand === h ? "is-on" : ""}`}
                          aria-pressed={t.hand === h}
                          disabled={t.locked}
                          onClick={() =>
                            patch(t, { hand: h }, "Change hand", `${t.name}: ${h === "L" ? "left" : "right"} hand`)
                          }
                        >
                          {h === "L" ? "Left" : "Right"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="track-actions">
                <button
                  className="chip"
                  aria-label={`Move ${t.name} up`}
                  disabled={i === 0 || t.locked}
                  onClick={() => move(t, -1)}
                >
                  ↑ Up
                </button>
                <button
                  className="chip"
                  aria-label={`Move ${t.name} down`}
                  disabled={i === project.tracks.length - 1 || t.locked}
                  onClick={() => move(t, 1)}
                >
                  ↓ Down
                </button>
                <button
                  className="chip is-danger"
                  aria-label={`Delete ${t.name}`}
                  disabled={t.locked || project.tracks.length <= 1}
                  onClick={() => (isEmptyTrack(t) ? remove(t) : setDeleting(t))}
                >
                  Delete…
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="section-add">
        <button className="btn" onClick={() => add("notes")}>
          Add a track
        </button>
        {!project.tracks.some((t) => t.kind === "drums") && (
          <button className="btn" onClick={() => add("drums")}>
            Add drums
          </button>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          body={<p>Everything written on this track goes with it. Undo brings it back.</p>}
          confirm="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function Toggle(props: { label: string; title: string; on: boolean; name: string; onChange: (on: boolean) => void }) {
  return (
    <button
      className={`chip ${props.on ? "is-on toggle-on" : ""}`}
      aria-pressed={props.on}
      aria-label={`${props.label} ${props.name}`}
      title={props.title}
      onClick={() => props.onChange(!props.on)}
    >
      {props.label}
    </button>
  );
}

/** Volume and mute: the control the hands have in Practice. The slider is one undo step per drag. */
function VolumeRow({ track }: { track: Track }) {
  const session = useSession();
  const [draft, setDraft] = useState<number | null>(null);
  const volume = draft ?? track.volume;
  const percent = Math.round(volume * 100);
  const commit = () => {
    if (draft === null) return;
    const value = draft;
    setDraft(null);
    if (value !== track.volume)
      edit(session, [{ op: "patchTrack", trackId: track.id, patch: { volume: value } }], "Change volume");
  };
  const preview = (value: number) => {
    setDraft(value);
    // Heard at once, while dragging; written when the slider is let go.
    if (track.kind === "notes") session.playback.player.setTrackMix(track.id, { volume: value });
    else session.playback.player.setDrumMix({ volume: value });
  };
  return (
    <div
      className={`hand-row ${track.muted ? "is-muted" : ""}`}
      style={{ "--hand": "var(--track)", "--fill": volume } as React.CSSProperties}
    >
      <span className="hand-name">
        <span className="dot" aria-hidden />
        Volume
      </span>
      <button
        className="icon-btn mute-btn"
        aria-pressed={track.muted}
        aria-label={`Mute ${track.name}`}
        disabled={track.locked}
        onClick={() =>
          edit(
            session,
            [{ op: "patchTrack", trackId: track.id, patch: { muted: !track.muted } }],
            track.muted ? "Un-mute track" : "Mute track",
          )
        }
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
          <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
          {track.muted || volume === 0 ? (
            <path
              d="M15.5 9.5l5 5m0-5l-5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M15.2 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>
      <input
        className="hand-slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        disabled={track.locked}
        aria-label={`${track.name} volume`}
        aria-valuetext={track.muted ? `Muted, ${percent} percent` : `${percent} percent`}
        onChange={(e) => preview(Number(e.target.value) / 100)}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="hand-value mono">{track.muted ? "Muted" : `${percent}%`}</span>
    </div>
  );
}
