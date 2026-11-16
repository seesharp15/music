import { useEffect, useState } from "react";
import { TopBar } from "../app/TopBar";
import { loadProject, type LoadedProject } from "../storage";
import { Damaged } from "./Damaged";
import { loadSavedUi, openSession, type Session } from "./session";
import { Studio } from "./Studio";
import "../app/ui/ui.css";
import "./studio.css";

type Opened =
  | { status: "loading" }
  | { status: "failed"; loaded: Exclude<LoadedProject, { ok: true }> }
  | { status: "open"; session: Session; snapshotAt?: string };

/** One project, opened: the editor, or the screen that says why it cannot be. */
export default function OpenProject({ projectId }: { projectId: string }) {
  const [opened, setOpened] = useState<Opened>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** Looking at a restore point of a damaged project, read-only. */
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    let live = true;
    let session: Session | null = null;
    setOpened({ status: "loading" });
    void Promise.all([loadProject(projectId), loadSavedUi(projectId)]).then(([loaded, savedUi]) => {
      if (!live) return;
      if (loaded.ok) {
        session = openSession(loaded.project, savedUi);
        setOpened({ status: "open", session });
      } else if (looking && loaded.reason === "invalid" && loaded.snapshot) {
        session = openSession(loaded.snapshot.project, undefined, { readOnly: true });
        setOpened({ status: "open", session, snapshotAt: loaded.snapshot.at });
      } else setOpened({ status: "failed", loaded });
    });
    return () => {
      live = false;
      void session?.close();
    };
  }, [projectId, attempt, looking]);

  if (opened.status === "loading") return <div className="message">Opening…</div>;
  if (opened.status === "open") {
    return (
      <Studio
        session={opened.session}
        banner={
          opened.session.readOnly ? (
            <div className="studio-banner" role="status">
              <span>You are looking at the last good version. Nothing here can be changed.</span>
              <button className="btn" onClick={() => setLooking(false)}>
                Back
              </button>
            </div>
          ) : undefined
        }
      />
    );
  }

  const { loaded } = opened;
  if (loaded.reason === "invalid") {
    return (
      <Damaged
        projectId={projectId}
        errors={loaded.errors}
        snapshot={loaded.snapshot}
        onLook={() => setLooking(true)}
        onRestored={() => setAttempt((n) => n + 1)}
      />
    );
  }
  return (
    <>
      <TopBar>
        <a className="back-link" href="#/">
          ← Library
        </a>
      </TopBar>
      <div className="message" role="alert">
        {loaded.reason === "missing" ? (
          <p>That song isn’t on this device.</p>
        ) : (
          <>
            <p>This device’s storage could not be opened, so your songs cannot be shown.</p>
            <p className="message-detail">{loaded.message}</p>
          </>
        )}
        <p>
          <a href="#/">Go to the library</a>
        </p>
      </div>
    </>
  );
}
