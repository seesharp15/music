/**
 * One open project in the Studio: its store (the song, with undo and autosave) and its UI store
 * (cursor, selection, tools), and the saving of the editor state that is remembered per project.
 */
import { createProjectStore, type ProjectStoreHandle } from "../project/store";
import type { Project } from "../project/types";
import { kvGet, kvSet, projectPersistence } from "../storage";
import type { Editor } from "./editor";
import { createPlayback, type Playback } from "./playback";
import { noteClosing, studioKey } from "./projects";
import { createUiStore, sanitizeSavedUi, savedUiOf, type SavedUi, type UiStore } from "./ui-store";

export interface Session {
  projectId: string;
  store: ProjectStoreHandle;
  ui: UiStore;
  /** The project as sound: the player, and notes played by hand. */
  playback: Playback;
  /** The canvas's controller, while the canvas is on screen. */
  editor: Editor | null;
  /** Nothing can be changed: the project on screen is a restore point being looked at. */
  readOnly: boolean;
  /** Save what is unsaved, then stop saving and listening. */
  close(): Promise<void>;
}

const UI_SAVE_MS = 300;
/** A copy written synchronously as the page goes away, when a database write may not finish. */
const lastMomentKey = (projectId: string) => `piano-tutor:${studioKey(projectId)}`;

/** The editor state stored for a project: the last-moment copy if there is one, else the database's. */
export async function loadSavedUi(projectId: string): Promise<unknown> {
  try {
    const text = localStorage.getItem(lastMomentKey(projectId));
    if (text) return JSON.parse(text);
  } catch {
    /* fall through to the database */
  }
  try {
    return await kvGet(studioKey(projectId));
  } catch {
    return undefined;
  }
}

export function openSession(project: Project, savedUi: unknown, opts: { readOnly?: boolean } = {}): Session {
  const readOnly = !!opts.readOnly;
  const store = createProjectStore(project, readOnly ? {} : { persistence: projectPersistence });
  const trackIds = project.tracks.map((t) => t.id);
  const firstNotes = project.tracks.find((t) => t.kind === "notes")?.id ?? trackIds[0] ?? "";
  const ui = createUiStore(firstNotes, sanitizeSavedUi(savedUi, trackIds));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: SavedUi = savedUiOf(ui.getState());
  let pending = false;
  const key = lastMomentKey(project.id);

  const write = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return Promise.resolve();
    pending = false;
    return kvSet(studioKey(project.id), last).then(
      () => {
        // The database has it now: the last-moment copy would only shadow later changes.
        try {
          if (!pending) localStorage.removeItem(key);
        } catch {
          /* nothing to remove */
        }
      },
      () => undefined,
    );
  };
  const leaving = () => {
    if (!pending) return;
    try {
      localStorage.setItem(key, JSON.stringify(last));
    } catch {
      /* the database write below is still tried */
    }
    void write();
  };
  const onVisibility = () => document.visibilityState === "hidden" && leaving();

  let unsubscribe = () => {};
  if (!readOnly) {
    unsubscribe = ui.subscribe((state) => {
      const next = savedUiOf(state);
      if ((Object.keys(next) as (keyof SavedUi)[]).every((k) => next[k] === last[k])) return;
      last = next;
      pending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void write(), UI_SAVE_MS);
    });
    window.addEventListener("pagehide", leaving);
    window.addEventListener("beforeunload", leaving);
    document.addEventListener("visibilitychange", onVisibility);
  }

  const playback = createPlayback({ store, ui });

  return {
    projectId: project.id,
    store,
    ui,
    playback,
    editor: null,
    readOnly,
    close() {
      unsubscribe();
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("beforeunload", leaving);
      document.removeEventListener("visibilitychange", onVisibility);
      playback.dispose();
      const done = Promise.all([write(), store.flush()]).then(() => store.dispose());
      noteClosing(done);
      return done;
    },
  };
}
