import type { Player } from "../audio/player";
import { flag } from "./flags";

/**
 * What end-to-end tests can reach on `window.__app`. Present in development builds, and in a
 * production build only when the `test-hooks` flag is on. The testing module is loaded on demand,
 * so none of it is in the bundle Practice downloads.
 */
export interface AppHooks {
  player: Player | null;
  testing: () => Promise<typeof import("../audio/testing")>;
  /** Projects, storage and the catalog: no audio code, so it loads in any browser. */
  kit: () => Promise<typeof import("./testKit") & { storage: typeof import("../storage") }>;
}

declare global {
  interface Window {
    __app?: AppHooks;
  }
}

const enabled = () => import.meta.env.DEV || flag("test-hooks");

function hooks(): AppHooks | null {
  if (!enabled()) return null;
  return (window.__app ??= {
    player: null,
    testing: () => import("../audio/testing"),
    kit: async () => ({ ...(await import("./testKit")), storage: await import("../storage") }),
  });
}

/** Called once at start-up, so tests can reach the harness before any screen has loaded. */
export function installTestHooks() {
  hooks();
}

export function exposePlayer(player: Player | null) {
  const h = hooks();
  if (h) h.player = player;
}
