import { useEffect, useState } from "react";
import { ConfirmDialog, Dialog, PromptDialog } from "../app/ui/Dialog";
import { Menu } from "../app/ui/Menu";
import { exposeStudio } from "../app/testHooks";
import { exportProject } from "../storage";
import { installCommands, SHORTCUTS } from "./commands";
import { EditorCanvas } from "./EditorCanvas";
import { ViewMenu } from "./ViewMenu";
import { SessionContext, useSession, useStoreState, useUi } from "./context";
import { FirstRun } from "./FirstRun";
import { Inspector } from "./Inspector";
import { duplicateProject, removeProject, studioHref } from "./projects";
import type { Session } from "./session";
import { Sheet } from "./sheets/Sheet";
import { SongSettings } from "./SongSettings";
import { SelectionChip } from "./SelectionChip";
import { StepBar } from "./StepBar";
import { Toolbar } from "./Toolbar";
import { Transport } from "./Transport";
import { TrackTabs } from "./TrackTabs";
import "../app/ui/ui.css";
import "./studio.css";

/** The Studio for one open project. `banner` is shown above the editor (read-only notices). */
export function Studio({ session, banner }: { session: Session; banner?: React.ReactNode }) {
  useEffect(() => {
    exposeStudio(session);
    const offCommands = installCommands(session, {
      typing: (e, down) => session.keys.typing(e, down),
      record: () => session.keys.toggleRecord(),
      rest: () => session.keys.rest(),
      backspace: () => session.keys.backspace(),
    });
    return () => {
      offCommands();
      exposeStudio(null);
    };
  }, [session]);
  return (
    <SessionContext.Provider value={session}>
      <div className={`studio ${session.readOnly ? "is-readonly" : ""}`}>
        <StudioBar />
        {banner}
        <div className="studio-main">
          <div className="studio-editor">
            <EditorCanvas />
            <ViewMenu />
            <SelectionChip />
            <FirstRun />
          </div>
          <Sheet id="settings" title="Song settings">
            <SongSettings />
          </Sheet>
          <Sheet id="inspector" title="Selection">
            <Inspector />
          </Sheet>
        </div>
        {session.readOnly ? (
          <div className="studio-controls">
            <div className="toolbar">
              <Transport />
            </div>
          </div>
        ) : (
          <div className="studio-controls">
            <StepBar />
            <Toolbar>
              <Transport />
            </Toolbar>
            <TrackTabs />
          </div>
        )}
        <LiveRegion />
      </div>
    </SessionContext.Provider>
  );
}

function LiveRegion() {
  const said = useUi((s) => s.announcement);
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="studio-live">
      {said}
    </div>
  );
}

function StudioBar() {
  const session = useSession();
  const { store, ui, readOnly } = session;
  const { project, canUndo, canRedo, undoLabel, redoLabel, dirty, saveError } = useStoreState();
  const [dialog, setDialog] = useState<"rename" | "delete" | "keys" | null>(null);

  const duplicate = async () => {
    await store.flush();
    const copy = await duplicateProject(project.id);
    if (copy) window.location.hash = studioHref(copy.id);
  };
  const remove = async () => {
    await session.close();
    await removeProject(project.id);
    window.location.hash = "#/";
  };

  return (
    <header className="studio-bar">
      <a className="menu-btn" href="#/" aria-label="Back to the library" title="Back to the library">
        <span aria-hidden>←</span>
      </a>
      <button
        className="studio-title"
        onClick={() => ui.setState({ sheet: "settings" })}
        aria-label={`${project.title}: song settings`}
        title="Song settings"
      >
        <span className="studio-title-text">{project.title}</span>
        <span aria-hidden> ▾</span>
      </button>
      <span className="studio-save" role="status" aria-live="polite">
        {readOnly ? "Read only" : saveError ? "Not saved" : dirty ? "Saving…" : ""}
      </span>
      {!readOnly && (
        <>
          <button
            className="menu-btn"
            disabled={!canUndo}
            aria-label={undoLabel ? `Undo ${lower(undoLabel)}` : "Undo"}
            title={undoLabel ? `Undo ${lower(undoLabel)}` : "Undo"}
            onClick={() => store.undo()}
          >
            <span aria-hidden>↶</span>
          </button>
          <button
            className="menu-btn"
            disabled={!canRedo}
            aria-label={redoLabel ? `Redo ${lower(redoLabel)}` : "Redo"}
            title={redoLabel ? `Redo ${lower(redoLabel)}` : "Redo"}
            onClick={() => store.redo()}
          >
            <span aria-hidden>↷</span>
          </button>
          <Menu
            label="Song menu"
            items={[
              { label: "Rename…", onSelect: () => setDialog("rename") },
              { label: "Duplicate", onSelect: () => void duplicate() },
              { label: "Export project", onSelect: () => exportProject(store.getState().project) },
              { label: "Keyboard shortcuts", onSelect: () => setDialog("keys") },
              { label: "Delete…", danger: true, onSelect: () => setDialog("delete") },
            ]}
          />
        </>
      )}
      {dialog === "rename" && (
        <PromptDialog
          title="Rename song"
          label="Title"
          initial={project.title}
          confirm="Rename"
          onConfirm={(title) => store.apply([{ op: "patchSong", patch: { title } }], "Rename song")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "keys" && (
        <Dialog title="Keyboard shortcuts" onClose={() => setDialog(null)}>
          <dl className="shortcuts">
            {SHORTCUTS.map((k) => (
              <div key={k.keys}>
                <dt>{k.keys}</dt>
                <dd>{k.does}</dd>
              </div>
            ))}
          </dl>
          <div className="dialog-actions">
            <button className="btn is-primary" onClick={() => setDialog(null)}>
              Done
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title={`Delete “${project.title}”?`}
          body={<p>The song and its saved versions are removed from this device. This cannot be undone.</p>}
          confirm="Delete"
          danger
          onConfirm={() => void remove()}
          onClose={() => setDialog(null)}
        />
      )}
    </header>
  );
}

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
