export type EditErrorCode = "unknownId" | "lockedTrack" | "outOfRange" | "overlap" | "badValue";

/** Thrown by `apply` when an edit is refused. The project is left unchanged. */
export class EditError extends Error {
  constructor(
    public readonly code: EditErrorCode,
    /** Index in the `ops` array of the op that was refused. */
    public readonly opIndex: number,
    message: string,
  ) {
    super(message);
    this.name = "EditError";
  }
}
