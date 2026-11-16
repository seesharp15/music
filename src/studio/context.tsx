import { createContext, useContext, useSyncExternalStore } from "react";
import type { ProjectStoreState } from "../project/store";
import type { Project } from "../project/types";
import type { Session } from "./session";
import type { UiState } from "./ui-store";

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("No project is open here.");
  return s;
}

/** The whole store state: the project, and what can be undone. */
export function useStoreState(): ProjectStoreState {
  const { store } = useSession();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useProject(): Project {
  const { store } = useSession();
  return useSyncExternalStore(store.subscribe, () => store.getState().project);
}

/** One value out of the editor's state; the component re-renders only when that value changes. */
export function useUi<T>(select: (s: UiState) => T): T {
  const { ui } = useSession();
  return useSyncExternalStore(ui.subscribe, () => select(ui.getState()));
}
