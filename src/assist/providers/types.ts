/**
 * Outside the pure zone on purpose: `AbortSignal` is a platform type that the pure zone's compiler
 * settings do not include.
 */

import type { AssistKind, AssistRequest, Option } from "../core/types";

export interface AssistProvider {
  id: "local" | "ai";
  supports(kind: AssistKind): boolean;
  suggest(req: AssistRequest, signal: AbortSignal): Promise<Option[]>;
}
