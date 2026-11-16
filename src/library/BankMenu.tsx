import { useState } from "react";
import { Menu } from "../app/ui/Menu";
import type { SongIndexEntry } from "../song/types";
import { studioHref } from "../studio/projects";
import "../app/ui/ui.css";
import "./mysongs.css";

/** What can be done with a bank song besides playing it: make it one's own. */
export default function BankMenu({ entry }: { entry: SongIndexEntry }) {
  const [failed, setFailed] = useState<string | null>(null);
  const openCopy = async () => {
    setFailed(null);
    try {
      // The conversion (and the music theory behind it) is downloaded when it is asked for.
      const { openCopy } = await import("../studio/io");
      const project = await openCopy(entry);
      window.location.hash = studioHref(project.id);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <Menu
        label={`More for ${entry.title}`}
        className="project-menu"
        items={[
          { label: "Practice", onSelect: () => (window.location.hash = `#/play/${entry.id}`) },
          { label: "Open a copy in Studio", onSelect: () => void openCopy() },
        ]}
      />
      {failed && (
        <span className="card-failed" role="alert">
          A copy could not be made ({failed}).
        </span>
      )}
    </>
  );
}
