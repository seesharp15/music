import { useEffect, useState } from "react";
import type { EditOp, Project } from "../project/types";
import { useProject, useSession } from "./context";

type SongPatch = Extract<EditOp, { op: "patchSong" }>["patch"];

/** Apply one change to the song's own fields as one undo step. */
export function usePatchSong() {
  const { store, readOnly } = useSession();
  return (patch: SongPatch, label: string) => {
    if (!readOnly) store.apply([{ op: "patchSong", patch }], label);
  };
}

/** A text field that writes when it loses focus or Enter is pressed, so typing is one undo step. */
export function CommitField(props: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  allowEmpty?: boolean;
  /** The id of a <datalist> of suggestions. */
  list?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    const v = draft.trim();
    if (v === props.value) return;
    if (!v && !props.allowEmpty) return setDraft(props.value);
    props.onCommit(v);
  };
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        className="input"
        value={draft}
        placeholder={props.placeholder}
        list={props.list}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** Song settings: what the song is called and who wrote it. Tempo, meter and key join it in S3.7. */
export function SongSettings() {
  const project: Project = useProject();
  const patch = usePatchSong();
  return (
    <div className="settings-form">
      <CommitField label="Title" value={project.title} onCommit={(title) => patch({ title }, "Rename song")} />
      <CommitField
        label="Written by"
        value={project.author ?? ""}
        placeholder="Your name"
        allowEmpty
        onCommit={(author) => patch({ author: author || undefined }, "Change author")}
      />
    </div>
  );
}
