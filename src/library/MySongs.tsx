import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog, PromptDialog } from "../app/ui/Dialog";
import { Menu } from "../app/ui/Menu";
import type { ProjectMeta } from "../project/meta";
import { listProjects } from "../storage";
import {
  createProject,
  duplicateProject,
  exportProjectById,
  removeProject,
  renameProject,
  settled,
  studioHref,
} from "../studio/projects";
import "../app/ui/ui.css";
import "./mysongs.css";

type State =
  { status: "loading" } | { status: "ready"; projects: ProjectMeta[] } | { status: "error"; message: string };

/**
 * The author's own songs: one card per project, and a card that starts a new one. Shown above the
 * song bank in the Library, and on its own at `#/studio`.
 */
export default function MySongs({ heading = "h2" }: { heading?: "h1" | "h2" }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete"; project: ProjectMeta } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      await settled();
      setState({ status: "ready", projects: await listProjects() });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const act = async (work: () => Promise<unknown>, failed: string) => {
    setNotice(null);
    try {
      const ok = await work();
      if (ok === false || ok === null) setNotice(failed);
    } catch (e) {
      setNotice(`${failed} (${e instanceof Error ? e.message : String(e)})`);
    }
    await refresh();
  };

  const startNew = async () => {
    try {
      const project = await createProject();
      window.location.hash = studioHref(project.id);
    } catch (e) {
      setNotice(`A new song could not be started: this device’s storage is not available (${(e as Error).message}).`);
    }
  };

  const Heading = heading;
  const projects = state.status === "ready" ? state.projects : [];
  return (
    <section aria-labelledby="mysongs-title" className="mysongs">
      <Heading id="mysongs-title" className="lib-heading">
        My songs
      </Heading>
      {state.status === "error" && (
        <p className="mysongs-notice" role="alert">
          Your songs could not be read from this device ({state.message}).
        </p>
      )}
      {notice && (
        <p className="mysongs-notice" role="alert">
          {notice}
        </p>
      )}
      <div className="song-grid" aria-busy={state.status === "loading"}>
        <button className="song-card new-song" onClick={() => void startNew()}>
          <span className="new-song-plus" aria-hidden>
            +
          </span>
          <span className="card-title">New song</span>
          <span className="card-artist">Start from an empty page</span>
        </button>
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            onRename={() => setDialog({ kind: "rename", project: p })}
            onDelete={() => setDialog({ kind: "delete", project: p })}
            onDuplicate={() => void act(() => duplicateProject(p.id), "That song could not be copied.")}
            onExport={() => void act(() => exportProjectById(p.id), "That song could not be exported.")}
          />
        ))}
      </div>
      {dialog?.kind === "rename" && (
        <PromptDialog
          title="Rename song"
          label="Title"
          initial={dialog.project.title}
          confirm="Rename"
          onConfirm={(title) =>
            void act(() => renameProject(dialog.project.id, title), "That song could not be renamed.")
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete “${dialog.project.title}”?`}
          body={<p>The song and its saved versions are removed from this device. This cannot be undone.</p>}
          confirm="Delete"
          danger
          onConfirm={() => void act(() => removeProject(dialog.project.id), "That song could not be deleted.")}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function ProjectCard(props: {
  project: ProjectMeta;
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const p = props.project;
  const bars = p.preview.length ? p.preview : new Array(48).fill(0.08);
  return (
    <div className="song-card project-card">
      <a className="project-link" href={studioHref(p.id)} aria-label={`Edit ${p.title}`}>
        <svg className="card-thumb" viewBox={`0 0 ${bars.length} 12`} preserveAspectRatio="none" aria-hidden>
          {bars.map((v, i) => {
            const h = Math.max(0.6, v * 12);
            return <rect key={i} x={i + 0.15} y={12 - h} width={0.7} height={h} rx={0.2} />;
          })}
        </svg>
        <span className="card-title">{p.title}</span>
        <span className="card-meta">
          <span className="mono">
            {p.bars} {p.bars === 1 ? "bar" : "bars"} · {ago(p.updatedAt)}
          </span>
        </span>
      </a>
      <Menu
        label={`More for ${p.title}`}
        className="project-menu"
        items={[
          { label: "Edit", onSelect: () => (window.location.hash = studioHref(p.id)) },
          { label: "Rename…", onSelect: props.onRename },
          { label: "Duplicate", onSelect: props.onDuplicate },
          { label: "Export", onSelect: props.onExport },
          { label: "Delete…", danger: true, onSelect: props.onDelete },
        ]}
      />
    </div>
  );
}

/** "today", "yesterday", "3 days ago", or the date. */
export function ago(iso: string, now = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const day = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  const days = day(now) - day(then);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { dateStyle: "medium" });
}
