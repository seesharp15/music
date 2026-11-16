import { useState } from "react";
import { TopBar } from "../app/TopBar";
import type { Project } from "../project/types";
import { projectMeta } from "../project/meta";
import { download, saveProject } from "../storage";

const SHOWN = 5;

/**
 * A stored project that fails validation never reaches the editor. This screen says what is wrong,
 * and offers the newest saved version that is still sound: to look at, read-only, or to restore.
 */
export function Damaged(props: {
  projectId: string;
  errors: string[];
  snapshot: { project: Project; at: string } | null;
  /** Open the snapshot in the editor without being able to change it. */
  onLook: () => void;
  /** Called once the snapshot has been written back as the project. */
  onRestored: () => void;
}) {
  const { errors, snapshot } = props;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const meta = snapshot && projectMeta(snapshot.project);

  const restore = async () => {
    if (!snapshot) return;
    setBusy(true);
    try {
      await saveProject({ ...snapshot.project, updatedAt: new Date().toISOString() }, { snapshot: true });
      props.onRestored();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar>
        <a className="back-link" href="#/">
          ← Library
        </a>
      </TopBar>
      <main className="damaged" role="alert">
        <h1>This song can’t be opened for editing</h1>
        <p>What is stored for it on this device is damaged, so it has been left exactly as it is.</p>
        <h2>{errors.length === 1 ? "The problem" : `${errors.length} problems`}</h2>
        <ul className="damaged-errors">
          {errors.slice(0, SHOWN).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
          {errors.length > SHOWN && <li>… and {errors.length - SHOWN} more</li>}
        </ul>
        {snapshot && meta ? (
          <section className="damaged-snapshot" aria-label="Last good version">
            <h2>The last good version</h2>
            <p>
              “{meta.title}”, {meta.bars} {meta.bars === 1 ? "bar" : "bars"}, saved {when(snapshot.at)}.
            </p>
            <div className="damaged-actions">
              <button className="btn is-primary" disabled={busy} onClick={() => void restore()}>
                Restore this version
              </button>
              <button className="btn" disabled={busy} onClick={props.onLook}>
                Look at it first
              </button>
            </div>
          </section>
        ) : (
          <p>No earlier version of it was kept that is still sound.</p>
        )}
        {failed && <p className="damaged-failed">It could not be restored: {failed}</p>}
        <p>
          <a href="#/">Back to the library</a>
        </p>
      </main>
    </>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "earlier"
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** For Settings and support: the damaged data as a file, exactly as stored. */
export function downloadRaw(projectId: string, raw: unknown) {
  download(`${projectId}.damaged.json`, `${JSON.stringify(raw, null, 2)}\n`);
}
