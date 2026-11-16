/**
 * The project store: one open project, changed only through `apply`, with undo, redo and autosave.
 * See docs/plan/contracts.md §5. Selection, cursor and view are not here and are not undoable.
 *
 * Not part of the pure zone: it keeps time and listens for the page going away.
 */
import { createStore } from "zustand/vanilla";
import { applyDelta, diff, type Delta } from "./delta";
import { applyOps } from "./ops";
import type { EditOp, Project, ProjectStore } from "./types";

/** Where the store saves. `src/storage/projects.ts` implements it over IndexedDB; tests use a list. */
export interface ProjectPersistence {
  /** Write the project. With `snapshot`, keep a restore point as well. */
  save(project: Project, opts: { snapshot: boolean }): Promise<void>;
  /**
   * A last-moment write for when the page is going away and an asynchronous save may not finish.
   * Must not wait for anything.
   */
  saveNow?(project: Project): void;
}

export interface ProjectStoreState {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  /** There are changes that have not been saved yet. */
  dirty: boolean;
  /** What the next undo and redo would take back or put back, for the menu. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** Why the last save failed, if it did. Cleared by the next save that works. */
  saveError: string | null;
}

export interface ProjectStoreOptions {
  persistence?: ProjectPersistence;
  /** Quiet time after the last change before saving, ms. Default 800. */
  debounceMs?: number;
  /** Every how many saves a snapshot is kept. Default 5. */
  snapshotEvery?: number;
  /** Steps of undo kept. Default 200. */
  undoDepth?: number;
  now?: () => Date;
}

export interface ProjectStoreHandle extends ProjectStore {
  getState(): ProjectStoreState;
  /** Save now, if there is anything to save. Resolves when it is written (or has failed). */
  flush(): Promise<void>;
  /** Bytes the undo and redo history holds on to, roughly. */
  historySize(): number;
  /** Stop saving and listening. Does not save: call `flush` first. */
  dispose(): void;
}

export const UNDO_DEPTH = 200;
export const AUTOSAVE_MS = 800;
export const SNAPSHOT_EVERY = 5;

interface Step {
  label: string;
  delta: Delta;
}

export function createProjectStore(initial: Project, opts: ProjectStoreOptions = {}): ProjectStoreHandle {
  const { persistence } = opts;
  const debounceMs = opts.debounceMs ?? AUTOSAVE_MS;
  const snapshotEvery = opts.snapshotEvery ?? SNAPSHOT_EVERY;
  const undoDepth = opts.undoDepth ?? UNDO_DEPTH;
  const now = opts.now ?? (() => new Date());

  const undoStack: Step[] = [];
  const redoStack: Step[] = [];
  const store = createStore<ProjectStoreState>(() => ({
    project: initial,
    canUndo: false,
    canRedo: false,
    dirty: false,
    undoLabel: null,
    redoLabel: null,
    saveError: null,
  }));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let saves = 0;
  /** Counts changes, so a save knows whether the project moved on while it was being written. */
  let version = 0;
  let savedVersion = 0;
  let writing: Promise<void> = Promise.resolve();
  let disposed = false;

  const stamped = (project: Project): Project => ({ ...project, updatedAt: now().toISOString() });

  function changed(project: Project) {
    version++;
    store.setState({
      project,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      dirty: true,
      undoLabel: undoStack[undoStack.length - 1]?.label ?? null,
      redoLabel: redoStack[redoStack.length - 1]?.label ?? null,
    });
    if (!persistence || disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
  }

  function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!persistence || version === savedVersion) return writing;
    const writingVersion = version;
    const project = stamped(store.getState().project);
    const snapshot = ++saves % snapshotEvery === 0;
    // One write at a time, in order: a slow save must not land after a newer one.
    writing = writing.then(async () => {
      try {
        await persistence.save(project, { snapshot });
        savedVersion = Math.max(savedVersion, writingVersion);
        store.setState({ dirty: version !== savedVersion, saveError: null });
      } catch (err) {
        store.setState({ saveError: err instanceof Error ? err.message : String(err) });
      }
    });
    return writing;
  }

  /** The page is being hidden or closed: write what can be written without waiting, then save properly. */
  function leaving() {
    if (!persistence || version === savedVersion) return;
    try {
      persistence.saveNow?.(stamped(store.getState().project));
    } catch {
      /* the proper save below is still tried */
    }
    void flush();
  }
  const onVisibility = () => {
    if (document.visibilityState === "hidden") leaving();
  };
  const listening = !!persistence && typeof window !== "undefined" && typeof document !== "undefined";
  if (listening) {
    window.addEventListener("pagehide", leaving);
    document.addEventListener("visibilitychange", onVisibility);
  }

  return {
    getState: store.getState,
    subscribe: (fn) => store.subscribe(() => fn()),

    apply(ops: EditOp[], label: string) {
      const before = store.getState().project;
      const after = applyOps(before, ops); // throws EditError, leaving everything as it was
      if (after === before) return;
      undoStack.push({ label, delta: diff(before, after) });
      if (undoStack.length > undoDepth) undoStack.shift();
      redoStack.length = 0;
      changed(after);
    },

    undo() {
      const step = undoStack.pop();
      if (!step) return;
      redoStack.push(step);
      changed(applyDelta(store.getState().project, step.delta, "undo"));
    },

    redo() {
      const step = redoStack.pop();
      if (!step) return;
      undoStack.push(step);
      changed(applyDelta(store.getState().project, step.delta, "redo"));
    },

    preview: (ops: EditOp[]) => applyOps(store.getState().project, ops),

    flush,
    historySize: () => JSON.stringify([undoStack, redoStack]).length,

    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (listening) {
        window.removeEventListener("pagehide", leaving);
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
  };
}
