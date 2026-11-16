import { lazy, Suspense } from "react";
import { TopBar } from "../app/TopBar";
import "../app/ui/ui.css";

const MySongs = lazy(() => import("../library/MySongs"));
// The editor, with the audio engine behind it, is downloaded when a song is opened — not for the
// list of songs, which needs none of it.
const OpenProject = lazy(() => import("./OpenProject"));

/** `#/studio` lists the author's songs; `#/studio/:projectId` opens one in the editor. */
export default function StudioRoute({ projectId }: { projectId?: string }) {
  if (!projectId) {
    return (
      <>
        <TopBar>
          <a className="back-link" href="#/">
            ← Library
          </a>
        </TopBar>
        <main className="library">
          <Suspense fallback={null}>
            <MySongs heading="h1" />
          </Suspense>
        </main>
      </>
    );
  }
  return (
    <Suspense fallback={<div className="message">Opening…</div>}>
      <OpenProject key={projectId} projectId={projectId} />
    </Suspense>
  );
}
