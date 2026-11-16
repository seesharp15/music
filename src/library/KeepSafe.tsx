import { useState } from "react";
import { INSTALL_STEPS, installPlatform, isInstalled } from "../app/serviceWorker";
import { backupDue } from "../project/backup";
import type { ProjectMeta } from "../project/meta";
import { exportAll, lastBackup } from "../storage";

const INSTALL_KEY = "piano-tutor:install-hint";
const SNOOZE_KEY = "piano-tutor:backup-snooze";
const SNOOZE_DAYS = 7;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* it will be said again next time */
  }
};

/**
 * Two quiet notes under My songs, for work that cannot be downloaded again: once, how to install
 * the app (so the browser keeps its data); and, when songs have changed and the last backup is
 * more than two weeks old, a reminder to make another.
 */
export function KeepSafe({ projects, now = new Date() }: { projects: ProjectMeta[]; now?: Date }) {
  const [installSeen, setInstallSeen] = useState(() => read(INSTALL_KEY) !== null);
  const [backedUp, setBackedUp] = useState(() => lastBackup());
  const [snoozedUntil, setSnoozed] = useState(() => read(SNOOZE_KEY));
  const [said, setSaid] = useState<string | null>(null);

  const showInstall = projects.length > 0 && !installSeen && !isInstalled();
  const snoozed = !!snoozedUntil && Date.parse(snoozedUntil) > now.getTime();
  const showBackup = !snoozed && backupDue(projects, backedUp, now);

  const dismissInstall = () => {
    write(INSTALL_KEY, now.toISOString());
    setInstallSeen(true);
  };
  const backUp = async () => {
    try {
      const out = await exportAll();
      setBackedUp(lastBackup());
      setSaid(`${out.projects} ${out.projects === 1 ? "song" : "songs"} saved to a backup file.`);
    } catch (e) {
      setSaid(`The backup could not be made (${e instanceof Error ? e.message : String(e)}).`);
    }
  };
  const later = () => {
    const until = new Date(now.getTime() + SNOOZE_DAYS * 86_400_000).toISOString();
    write(SNOOZE_KEY, until);
    setSnoozed(until);
  };

  if (!showInstall && !showBackup && !said) return null;
  return (
    <div className="keep-safe">
      {showInstall && (
        <div className="keep-note" role="note" aria-label="Install the app">
          <p>
            <strong>Your songs live on this device.</strong> Install the app and the browser will keep them — Safari
            clears a site’s data after a week unused unless it is installed. {INSTALL_STEPS[installPlatform()]}
          </p>
          <div className="keep-actions">
            <a className="chip" href="#/settings">
              Storage and backup
            </a>
            <button className="chip" onClick={dismissInstall}>
              Got it
            </button>
          </div>
        </div>
      )}
      {showBackup && (
        <div className="keep-note" role="note" aria-label="Back up your songs">
          <p>
            {backedUp
              ? "You have changed songs since your last backup, more than two weeks ago."
              : "Your songs have not been backed up yet."}
          </p>
          <div className="keep-actions">
            <button className="chip is-on" onClick={() => void backUp()}>
              Back up now
            </button>
            <button className="chip" onClick={later}>
              Not now
            </button>
          </div>
        </div>
      )}
      {said && (
        <p className="mysongs-notice is-good" role="status">
          {said}
        </p>
      )}
    </div>
  );
}
