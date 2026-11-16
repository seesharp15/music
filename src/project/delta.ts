/**
 * The difference between two versions of a project, small enough to keep two hundred of.
 *
 * `applyOps` returns a project that shares every unchanged part with the one before, so the
 * difference can be found by identity: walk both, and wherever they part company record either a
 * changed value or, for a list, which items left and which arrived. A delta holds references to
 * those items, never copies, and its size follows the size of the edit, not of the song.
 *
 * (Immer's own patches address list items by position, so inserting one note near the start of a
 * 3,000-note track records 3,000 changes. See the build notes in docs/plan/02-music-core.md.)
 */
import { produce } from "immer";

type Path = (string | number)[];

export type Change =
  /** A value replaced. `undefined` on either side means the key was absent. */
  | { path: Path; before: unknown; after: unknown }
  /** Items that left a list (with where they were) and items that arrived (with where they are). */
  | { path: Path; removed: [number, unknown][]; added: [number, unknown][] };

export type Delta = Change[];

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const sameId = (a: unknown, b: unknown) =>
  isObject(a) && isObject(b) && a.id !== undefined && a.id === b.id && Array.isArray(a) === Array.isArray(b);

const isFlat = (x: Record<string, unknown>) => Object.values(x).every((v) => typeof v !== "object" || v === null);

/** What changed between two values, of which `after` was made from `before` with structural sharing. */
export function diff(before: unknown, after: unknown): Delta {
  const out: Delta = [];
  walk(before, after, [], out);
  return out;
}

function walk(a: unknown, b: unknown, path: Path, out: Delta) {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) return walkList(a, b, path, out);
  if (isObject(a) && isObject(b)) {
    // A small record (a note, a hit) that gained or lost a field is swapped whole, so undoing gives
    // back the very object, fields in their original order.
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if ((keysA.length !== keysB.length || keysA.some((k) => !(k in b))) && isFlat(a) && isFlat(b)) {
      out.push({ path, before: a, after: b });
      return;
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], [...path, key], out);
    return;
  }
  out.push({ path, before: a, after: b });
}

function walkList(a: unknown[], b: unknown[], path: Path, out: Delta) {
  // The same items in the same places, some of them changed inside: look inside those.
  if (a.length === b.length && a.every((x, i) => x === b[i] || sameId(x, b[i]))) {
    a.forEach((x, i) => walk(x, b[i], [...path, i], out));
    return;
  }
  // Otherwise: which items left, and which arrived. Only meaningful for lists of objects, and only
  // if the items that stayed are still in the same order.
  if (a.every(isObject) && b.every(isObject)) {
    const inA = new Set(a);
    const inB = new Set(b);
    const removed: [number, unknown][] = [];
    const added: [number, unknown][] = [];
    const stayedA: unknown[] = [];
    a.forEach((x, i) => (inB.has(x) ? stayedA.push(x) : removed.push([i, x])));
    let k = 0;
    let inOrder = true;
    b.forEach((x, i) => {
      if (!inA.has(x)) added.push([i, x]);
      else if (stayedA[k++] !== x) inOrder = false;
    });
    if (inOrder && k === stayedA.length) {
      out.push({ path, removed, added });
      return;
    }
  }
  out.push({ path, before: a, after: b });
}

/** Take a delta back out of the value it led to ("undo"), or put it into the value it came from ("redo"). */
export function applyDelta<T>(value: T, delta: Delta, direction: "undo" | "redo"): T {
  return produce(value, (draft) => {
    for (const change of delta) {
      const parent = change.path
        .slice(0, -1)
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], draft);
      const key = change.path[change.path.length - 1];
      if ("removed" in change) {
        const list = (change.path.length ? (parent as Record<string, unknown>)[key] : draft) as unknown[];
        const leave = direction === "undo" ? change.added : change.removed;
        const arrive = direction === "undo" ? change.removed : change.added;
        for (let i = leave.length - 1; i >= 0; i--) list.splice(leave[i][0], 1);
        for (const [index, item] of arrive) list.splice(index, 0, item);
      } else {
        const next = direction === "undo" ? change.before : change.after;
        if (next === undefined) delete (parent as Record<string, unknown>)[key];
        else (parent as Record<string, unknown>)[key] = next;
      }
    }
  });
}

/** Roughly how many bytes a delta holds on to: the size of what it would take to write it down. */
export function deltaSize(delta: Delta): number {
  return JSON.stringify(delta).length;
}
