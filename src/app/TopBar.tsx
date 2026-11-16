import type { ReactNode } from "react";

/** The bar across the top of every screen. The brand is the way home. */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="Piano Tutor: all songs">
        <span className="brand-mark" aria-hidden>
          ♪
        </span>
        Piano Tutor
      </a>
      {children}
    </header>
  );
}
