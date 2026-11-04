import { useState, type ReactNode } from "react";

const KEY = "piano-tutor:open:";

/** Open/closed state for a panel, remembered across visits. */
export function useOpen(id: string, initial = true): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(KEY + id);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(KEY + id, o ? "0" : "1");
      } catch {
        /* storage unavailable; the panel just won't remember */
      }
      return !o;
    });
  return [open, toggle];
}

/** The header button that opens and closes a panel. */
export function CollapseButton({
  open,
  onToggle,
  children,
  summary,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Shown beside the title while closed, so the state is visible at a glance. */
  summary?: ReactNode;
}) {
  return (
    <button className="collapse-btn" aria-expanded={open} onClick={onToggle}>
      <svg className="collapse-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden>
        <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
      {!open && summary && <span className="collapse-summary">{summary}</span>}
    </button>
  );
}

/** A titled panel whose body can be folded away. */
export function Collapsible({
  id,
  title,
  summary,
  className = "",
  children,
}: {
  id: string;
  title: ReactNode;
  summary?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, toggle] = useOpen(id);
  return (
    <div className={`collapsible ${className}`}>
      <CollapseButton open={open} onToggle={toggle} summary={summary}>
        {title}
      </CollapseButton>
      {/* Hidden rather than unmounted, so what's inside keeps its state while folded. */}
      <div className="collapsible-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
