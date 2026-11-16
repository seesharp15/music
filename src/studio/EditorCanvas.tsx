import { useEffect, useRef } from "react";
import { useProject, useSession, useUi } from "./context";
import { createEditor } from "./editor";
import { describeCursor } from "./describe";

/**
 * The waterfall: time runs up the screen, the keyboard is along the bottom, and the cursor line is
 * where the next note goes. It is one picture to a screen reader; the cursor, the selection and
 * every edit are also reachable from the keyboard and spoken by the live region.
 */
export function EditorCanvas() {
  const session = useSession();
  const ref = useRef<HTMLCanvasElement>(null);
  const project = useProject();
  const cursor = useUi((s) => s.cursor);

  useEffect(() => {
    const editor = createEditor(ref.current!, session);
    session.editor = editor;
    return () => {
      session.editor = null;
      editor.dispose();
    };
  }, [session]);

  return (
    <canvas
      ref={ref}
      className="editor-canvas"
      role="img"
      aria-label={`${project.title}: the notes, with later music higher. ${describeCursor(project, cursor)}.`}
    />
  );
}
