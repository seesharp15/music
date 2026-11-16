import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** A modal dialog: the browser's own, so focus is trapped and Escape closes it. */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current!;
    if (!el.open) el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

/** "Delete this?" — a question with one way forward and one way back. */
export function ConfirmDialog(props: {
  title: string;
  body?: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      {props.body && <div className="dialog-body">{props.body}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className={`btn ${props.danger ? "is-danger" : "is-primary"}`}
          onClick={() => {
            props.onConfirm();
            props.onClose();
          }}
        >
          {props.confirm}
        </button>
      </div>
    </Dialog>
  );
}

/** Ask for one line of text: a name. */
export function PromptDialog(props: {
  title: string;
  label: string;
  initial: string;
  confirm: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const clean = value.trim();
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean) return;
          props.onConfirm(clean);
          props.onClose();
        }}
      >
        <label className="field">
          <span>{props.label}</span>
          <input
            className="input"
            value={value}
            maxLength={120}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn is-primary" disabled={!clean}>
            {props.confirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
