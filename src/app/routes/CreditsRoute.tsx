import { setStoredFlag, storedFlag } from "../flags";
import { TopBar } from "../TopBar";

/** `#/credits` — whose work this app is built on, and under which licences. */
export default function CreditsRoute() {
  return (
    <>
      <TopBar />
      <main className="credits">
        <h1>Credits</h1>
        <h2>Sounds</h2>
        <p>
          The “Grand piano” sound is the <strong>Salamander Grand Piano</strong> by Alexander Holm, used under the{" "}
          <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">
            Creative Commons Attribution 3.0
          </a>{" "}
          licence, in the edition published with{" "}
          <a href="https://github.com/Tonejs/audio" target="_blank" rel="noreferrer">
            Tone.js
          </a>
          . The other sounds are synthesized in the browser.
        </p>
        <h2>Software</h2>
        <p>
          Sound and timing by{" "}
          <a href="https://tonejs.github.io/" target="_blank" rel="noreferrer">
            Tone.js
          </a>{" "}
          (MIT). Interface built with React (MIT).
        </p>
        <h2>Unfinished</h2>
        <label className="credits-flag">
          <input
            type="checkbox"
            checked={storedFlag("studio")}
            onChange={(e) => {
              // Flags are read when the page loads: keep the choice, then load the Library with it.
              if (!setStoredFlag("studio", e.target.checked)) return;
              window.location.hash = "#/";
              window.location.reload();
            }}
          />
          <span>
            <strong>Song builder on this device.</strong> A studio for writing your own songs. It is built but not yet
            tried on a real phone; switching it on shows “My songs” in the library.
          </span>
        </label>
        <p>
          <a href="#/">Back to the songs</a>
        </p>
      </main>
    </>
  );
}
