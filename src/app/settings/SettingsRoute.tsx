import { useEffect, useState } from "react";
import {
  exportAll,
  lastBackup,
  listProjects,
  persistenceAnswer,
  pickFile,
  requestPersistence,
  restoreBackup,
  type Persistence,
  type Restored,
} from "../../storage";
import { INSTALL_STEPS, installPlatform, isInstalled } from "../serviceWorker";
import { TopBar } from "../TopBar";
import "../ui/ui.css";
import "./settings.css";

const KEPT: Record<Persistence, { title: string; body: string }> = {
  persisted: {
    title: "This browser has agreed to keep your songs.",
    body: "They will not be cleared to make room for other sites.",
  },
  refused: {
    title: "This browser has not promised to keep your songs.",
    body: "It may clear them if the device runs short of space — and Safari may clear a site it has not seen for a week. Installing the app and keeping a backup both protect them.",
  },
  unsupported: {
    title: "This browser cannot say whether it will keep your songs.",
    body: "Keep a backup, and install the app if you can.",
  },
};

const when = (iso: string | null) => {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** `#/settings` — where the author's songs are kept, and how to keep them safe. */
export default function SettingsRoute() {
  const [kept, setKept] = useState<Persistence | null>(() => persistenceAnswer());
  const [count, setCount] = useState<number | null>(null);
  const [backedUp, setBackedUp] = useState(() => lastBackup());
  const [said, setSaid] = useState<{ text: string; bad?: boolean } | null>(null);
  const installed = isInstalled();

  useEffect(() => {
    listProjects().then(
      (list) => setCount(list.length),
      () => setCount(null),
    );
  }, []);

  const ask = async () => setKept(await requestPersistence());
  const backUp = async () => {
    try {
      const out = await exportAll();
      setBackedUp(lastBackup());
      setSaid({
        text: `${out.projects} ${out.projects === 1 ? "song" : "songs"} saved to a backup file.${out.damaged ? ` ${out.damaged} damaged ${out.damaged === 1 ? "song was" : "songs were"} left out.` : ""}`,
      });
    } catch (e) {
      setSaid({ text: `The backup could not be made (${e instanceof Error ? e.message : String(e)}).`, bad: true });
    }
  };
  const restore = async () => {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    let result: Restored;
    try {
      result = await restoreBackup(JSON.parse(await file.text()));
    } catch (e) {
      result = { ok: false, message: `This file could not be read (${e instanceof Error ? e.message : String(e)}).` };
    }
    if (!result.ok) return setSaid({ text: result.message, bad: true });
    const parts = [
      `${result.added} ${result.added === 1 ? "song" : "songs"} restored`,
      result.same ? `${result.same} already here` : "",
      result.besides ? `${result.besides} kept beside a different version already here` : "",
      result.skipped.length
        ? `${result.skipped.length} left out as damaged (${result.skipped.map((s) => s.title).join(", ")})`
        : "",
    ].filter(Boolean);
    setSaid({ text: `${parts.join("; ")}.`, bad: result.skipped.length > 0 });
    setCount((await listProjects()).length);
  };

  return (
    <>
      <TopBar>
        <a className="back-link" href="#/">
          ← Library
        </a>
      </TopBar>
      <main className="settings">
        <h1>Settings</h1>

        <section aria-labelledby="set-storage">
          <h2 id="set-storage">Where your songs are kept</h2>
          <p>
            On this device, in this browser
            {count === null ? "" : ` — ${count} ${count === 1 ? "song" : "songs"} at the moment`}. Nothing is sent
            anywhere.
          </p>
          {kept ? (
            <p className={`settings-status ${kept === "persisted" ? "is-good" : "is-warn"}`} role="status">
              <strong>{KEPT[kept].title}</strong> {KEPT[kept].body}
            </p>
          ) : (
            <p className="settings-status" role="status">
              The browser is asked to keep your songs the first time one is saved.
            </p>
          )}
          {kept !== "persisted" && (
            <button className="btn" onClick={() => void ask()}>
              Ask the browser to keep them
            </button>
          )}
        </section>

        <section aria-labelledby="set-install">
          <h2 id="set-install">Install the app</h2>
          {installed ? (
            <p className="settings-status is-good" role="status">
              <strong>Installed.</strong> It opens from your home screen, and works without a connection.
            </p>
          ) : (
            <>
              <p>
                Installed, the app opens from your home screen and works without a connection — and the browser stops
                treating your songs as a website’s leftovers.
              </p>
              <p className="settings-status">{INSTALL_STEPS[installPlatform()]}</p>
            </>
          )}
        </section>

        <section aria-labelledby="set-backup">
          <h2 id="set-backup">Backup</h2>
          <p>
            One file with every song you have written here. Keep it somewhere else — it is the only copy that is not on
            this device.
          </p>
          <p className="settings-status">Last backup: {when(backedUp)}.</p>
          <div className="settings-actions">
            <button className="btn is-primary" onClick={() => void backUp()}>
              Export all my songs
            </button>
            <button className="btn" onClick={() => void restore()}>
              Restore from a backup…
            </button>
          </div>
          {said && (
            <p className={`settings-said ${said.bad ? "is-bad" : ""}`} role={said.bad ? "alert" : "status"}>
              {said.text}
            </p>
          )}
        </section>
      </main>
    </>
  );
}
