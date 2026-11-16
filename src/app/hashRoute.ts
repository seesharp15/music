import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useHashLocation } from "wouter/use-hash-location";

/**
 * Addresses look like `#/play/divenire` and, on the Library, `#/?q=einaudi&sort=title`.
 * The part before the `?` is the route; the part after it is that screen's own state.
 * Both live in the hash, which leaves the page's real query string to feature flags.
 */

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const currentHash = () => window.location.hash;
const queryOf = (hash: string) => hash.split("?")[1] ?? "";

/** The router's location hook: the route alone, without any `?…`. */
export const useHashPath = Object.assign(
  (options?: Parameters<typeof useHashLocation>[0]): ReturnType<typeof useHashLocation> => {
    const [location, navigate] = useHashLocation(options);
    return [location.split("?")[0], navigate];
  },
  // How the router writes an href for a route, should its <Link> ever be used.
  { hrefs: (href: string) => `#${href}` },
);

export type QueryPatch = Record<string, string | null | undefined>;

/**
 * This screen's state in the address. Setting a key to "", null or undefined removes it.
 * `replace` rewrites the current history entry (typing in a search box); otherwise a new entry is
 * added, so Back undoes the change.
 */
export function useHashQuery(): [URLSearchParams, (patch: QueryPatch, opts?: { replace?: boolean }) => void] {
  const hash = useSyncExternalStore(subscribe, currentHash);
  const params = useMemo(() => new URLSearchParams(queryOf(hash)), [hash]);

  const set = useCallback((patch: QueryPatch, opts: { replace?: boolean } = {}) => {
    const now = window.location.hash;
    const next = new URLSearchParams(queryOf(now));
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const path = now.split("?")[0] || "#/";
    const query = next.toString();
    const url = `${window.location.pathname}${window.location.search}${path}${query ? `?${query}` : ""}`;
    window.history[opts.replace ? "replaceState" : "pushState"](null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  return [params, set];
}
