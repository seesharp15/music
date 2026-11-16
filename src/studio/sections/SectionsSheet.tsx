import { useState } from "react";
import { Dialog } from "../../app/ui/Dialog";
import { announce, edit, setCursor } from "../actions";
import { useProject, useSession, useUi } from "../context";
import { CommitField } from "../SongSettings";
import {
  addSection,
  barsOf,
  deleteSection,
  duplicateSection,
  moveSection,
  patchSection,
  resizeSection,
  SECTION_COLORS,
  SECTION_NAMES,
  type DeleteHow,
  type SectionEdit,
} from "./ops";

/**
 * The song as a list of sections: name, colour and length; duplicate, move and delete carry the
 * music with them. Tapping a section's Loop button plays it round and puts the cursor at its start.
 */
export function SectionsSheet() {
  const session = useSession();
  const { ui, playback } = session;
  const project = useProject();
  const loop = useUi((s) => s.loop);
  const cursor = useUi((s) => s.cursor);
  const [deleting, setDeleting] = useState<string | null>(null);
  const time = playback.time();

  const run = (change: SectionEdit | null, said: string) => {
    if (change && edit(session, change.ops, change.label)) announce(session, said);
  };
  const toggleLoop = (start: number, end: number, name: string) => {
    const on = loop?.start === start && loop.end === end;
    ui.setState({ loop: on ? null : { start, end } });
    if (!on) setCursor(session, start, false);
    announce(session, on ? "Loop off" : `Looping ${name}`);
  };

  const doomed = project.sections.find((s) => s.id === deleting);
  return (
    <div className="sections">
      {project.sections.length === 0 && (
        <p className="hint-text">
          No sections yet. Name the parts of the song — intro, verse, chorus — and they can be looped, copied and moved
          as one.
        </p>
      )}
      <ol className="section-list">
        {project.sections.map((s, i) => {
          const bars = barsOf(s, time);
          const looping = loop?.start === s.tick && loop.end === s.tick + s.dur;
          const color = s.color ?? SECTION_COLORS[i % SECTION_COLORS.length];
          const overlapsNeighbour =
            (i > 0 && project.sections[i - 1].tick + project.sections[i - 1].dur > s.tick) ||
            (i < project.sections.length - 1 && s.tick + s.dur > project.sections[i + 1].tick);
          return (
            <li key={s.id} className="section-card" style={{ "--section": color } as React.CSSProperties}>
              <div className="section-top">
                <button
                  className="section-swatch"
                  aria-label={`Colour of ${s.name}: change`}
                  title="Change colour"
                  onClick={() =>
                    run(
                      patchSection(project, s.id, {
                        color: SECTION_COLORS[(SECTION_COLORS.indexOf(color) + 1) % SECTION_COLORS.length],
                      }),
                      "Colour changed",
                    )
                  }
                />
                <CommitField
                  label={`Name of section ${i + 1}`}
                  value={s.name}
                  list="section-names"
                  onCommit={(name) => run(patchSection(project, s.id, { name }), `Renamed to ${name}`)}
                />
                <label className="num-field">
                  <span>Bars</span>
                  <BarsField
                    value={bars}
                    label={`Bars in ${s.name}`}
                    onCommit={(b) => run(resizeSection(project, s.id, b), `${s.name} is ${b} bars`)}
                  />
                </label>
              </div>
              <p className="section-where">
                From bar {time.positionAt(s.tick).bar} · {bars} {bars === 1 ? "bar" : "bars"}
              </p>
              <div className="section-actions">
                <button
                  className={`chip ${looping ? "loop-on" : ""}`}
                  aria-pressed={looping}
                  aria-label={`Loop ${s.name}`}
                  onClick={() => toggleLoop(s.tick, s.tick + s.dur, s.name)}
                >
                  ⟲ Loop
                </button>
                <button
                  className="chip"
                  aria-label={`Move ${s.name} earlier`}
                  disabled={i === 0 || overlapsNeighbour}
                  onClick={() => run(moveSection(project, s.id, -1), `${s.name} moved earlier`)}
                >
                  ↑ Earlier
                </button>
                <button
                  className="chip"
                  aria-label={`Move ${s.name} later`}
                  disabled={i === project.sections.length - 1 || overlapsNeighbour}
                  onClick={() => run(moveSection(project, s.id, 1), `${s.name} moved later`)}
                >
                  ↓ Later
                </button>
                <button
                  className="chip"
                  aria-label={`Duplicate ${s.name}`}
                  onClick={() => run(duplicateSection(project, s.id), `${s.name} duplicated`)}
                >
                  Duplicate
                </button>
                <button className="chip is-danger" aria-label={`Delete ${s.name}`} onClick={() => setDeleting(s.id)}>
                  Delete…
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <datalist id="section-names">
        {SECTION_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="section-add">
        <button className="btn" onClick={() => run(addSection(project, "end"), "Section added at the end")}>
          Add at the end
        </button>
        <button className="btn" onClick={() => run(addSection(project, cursor), "Section added at the cursor")}>
          Add at the cursor
        </button>
      </div>
      {doomed && (
        <Dialog title={`Delete “${doomed.name}”?`} onClose={() => setDeleting(null)}>
          <div className="dialog-body">
            <p>
              {barsOf(doomed, time)} bars, from bar {time.positionAt(doomed.tick).bar}. Whichever you choose can be
              undone.
            </p>
          </div>
          <div className="delete-choices">
            {(
              [
                ["close", "Delete it and close the gap", "Its music goes; what follows moves up."],
                ["empty", "Delete its music, keep the bars", "Its bars are left empty; nothing else moves."],
                ["label", "Remove just the name", "The music stays exactly as it is."],
              ] as [DeleteHow, string, string][]
            ).map(([how, label, hint]) => (
              <button
                key={how}
                className="first-run-choice"
                onClick={() => {
                  run(
                    deleteSection(project, doomed.id, how),
                    how === "label" ? `${doomed.name} is no longer a section` : `${doomed.name} deleted`,
                  );
                  setDeleting(null);
                }}
              >
                <strong>{label}</strong>
                <span>{hint}</span>
              </button>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={() => setDeleting(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function BarsField(props: { value: number; label: string; onCommit: (bars: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = Math.round(Number(draft));
    setDraft(null);
    if (draft !== null && Number.isFinite(v) && v >= 1 && v <= 999 && v !== props.value) props.onCommit(v);
  };
  return (
    <input
      className="input"
      inputMode="numeric"
      aria-label={props.label}
      value={draft ?? String(props.value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
