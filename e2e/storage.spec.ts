import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers";

/**
 * Storage, against the browser's real IndexedDB: projects saved, reloaded, damaged, exported and
 * imported. Nothing here loads audio code, so it runs in WebKit too — which matters, because Safari
 * is where stored songs are most at risk. Each test starts with an empty database.
 */

/** Make a project with a few notes, chords and a drum pattern, store it, and return it. */
async function seed(page: Page, id = "tune") {
  return page.evaluate(async (id) => {
    const kit = await window.__app!.kit();
    const project = kit.applyOps(kit.newProject({ id, title: "A Small Tune", bpm: 96 }), [
      {
        op: "addNotes",
        trackId: "melody",
        notes: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
          pitch: 60 + [0, 2, 4, 5, 7, 5, 4, 2][i],
          tick: i * 480,
          dur: 480,
          vel: 0.7,
          origin: i % 2 ? ("manual" as const) : ("hummed" as const),
          ...(i % 3 === 0 ? { offset: 7 } : {}),
        })),
      },
      {
        op: "addNotes",
        trackId: "bass",
        notes: [{ pitch: 36, tick: 0, dur: 1920, vel: 0.6, origin: "suggested", sid: "s1" }],
      },
      {
        op: "setChords",
        range: { start: 0, end: 3840 },
        chords: [
          { tick: 0, dur: 1920, symbol: "C", origin: "manual" },
          { tick: 1920, dur: 1920, symbol: "G7", origin: "manual" },
        ],
      },
      {
        op: "putPattern",
        trackId: "drums",
        pattern: {
          id: "beat",
          name: "Beat",
          stepsPerBar: 16,
          bars: 1,
          lanes: { kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
        },
      },
      { op: "placeClip", trackId: "drums", patternId: "beat", tick: 0, repeats: 2 },
      { op: "setSections", sections: [{ id: "a", name: "Verse", tick: 0, dur: 3840 }] },
      { op: "patchSong", patch: { brief: { mood: "bright" } } },
    ]);
    await kit.storage.saveProject(project);
    return project;
  }, id);
}

const addNote = (pitch: number) => ({
  op: "addNotes" as const,
  trackId: "melody",
  notes: [{ pitch, tick: 7680, dur: 240, vel: 0.8, origin: "manual" as const }],
});

test("a database made from nothing has every store", async ({ page }) => {
  await open(page);
  const stores = await page.evaluate(async () => {
    const { storage } = await window.__app!.kit();
    const db = await storage.openDb();
    return {
      version: db.version,
      stores: [...db.objectStoreNames].sort(),
      index: [...db.transaction("snapshots").store.indexNames],
    };
  });
  expect(stores).toEqual({
    version: 1,
    stores: ["blobs", "kv", "projectMeta", "projects", "snapshots", "songs", "takes"],
    index: ["projectId"],
  });
});

test("a saved project loads back deep-equal, and is listed", async ({ page }) => {
  await open(page);
  const project = await seed(page);
  const out = await page.evaluate(async () => {
    const { storage } = await window.__app!.kit();
    return {
      loaded: await storage.loadProject("tune"),
      list: await storage.listProjects(),
      missing: await storage.loadProject("nope"),
    };
  });
  expect(out.loaded).toEqual({ ok: true, project });
  expect(out.list).toHaveLength(1);
  expect(out.list[0]).toMatchObject({ id: "tune", title: "A Small Tune", bars: 8 });
  expect(out.list[0].preview).toHaveLength(48);
  expect(out.missing).toEqual({ ok: false, reason: "missing" });
});

// ── Acceptance criterion 7, first half ───────────────────────────────────────

test.describe("a project edited, then the tab closed without an explicit save, reopens with the edits", () => {
  /** Edit the stored project through a store that autosaves, and leave before the autosave is due. */
  async function editWithoutSaving(page: Page) {
    await page.evaluate(async (op) => {
      const kit = await window.__app!.kit();
      const loaded = await kit.storage.loadProject("tune");
      if (!loaded.ok) throw new Error("the seeded project did not load");
      const store = kit.createProjectStore(loaded.project, { persistence: kit.storage.projectPersistence });
      store.apply([op], "Add a note");
      store.apply([{ op: "patchSong", patch: { title: "Edited" } }], "Rename");
      if (!store.getState().dirty) throw new Error("expected unsaved changes");
    }, addNote(72));
  }
  async function reopened(page: Page) {
    await open(page);
    return page.evaluate(async () => {
      const kit = await window.__app!.kit();
      const loaded = await kit.storage.loadProject("tune");
      if (!loaded.ok) return { ok: false as const };
      const melody = loaded.project.tracks[0];
      return {
        ok: true as const,
        title: loaded.project.title,
        top: melody.kind === "notes" ? Math.max(...melody.notes.map((n) => n.pitch)) : 0,
        listed: (await kit.storage.listProjects())[0].title,
      };
    });
  }

  test("when the page is left for another", async ({ page }) => {
    await open(page);
    await seed(page);
    await editWithoutSaving(page);
    await page.goto("about:blank");
    expect(await reopened(page)).toEqual({ ok: true, title: "Edited", top: 72, listed: "Edited" });
  });

  test("when the tab is closed", async ({ page, context }) => {
    await open(page);
    await seed(page);
    await editWithoutSaving(page);
    await page.close({ runBeforeUnload: true });
    const again = await context.newPage();
    expect(await reopened(again)).toEqual({ ok: true, title: "Edited", top: 72, listed: "Edited" });
  });

  test("when the page is reloaded", async ({ page }) => {
    await open(page);
    await seed(page);
    await editWithoutSaving(page);
    await page.reload();
    expect(await reopened(page)).toEqual({ ok: true, title: "Edited", top: 72, listed: "Edited" });
  });

  test("even if only the last-moment copy was written, and then it is tidied away", async ({ page }) => {
    await open(page);
    const project = await seed(page);
    const out = await page.evaluate(
      async ({ project, op }) => {
        const kit = await window.__app!.kit();
        const edited = { ...kit.applyOps(project, [op]), updatedAt: new Date(Date.now() + 1000).toISOString() };
        kit.storage.projectPersistence.saveNow!(edited); // the page "closes" here: nothing else is written
        const leftBehind = Object.keys(localStorage).filter((k) => k.startsWith("piano-tutor:unsaved:"));
        const first = await kit.storage.loadProject("tune");
        const second = await kit.storage.loadProject("tune");
        return {
          leftBehind,
          first,
          second,
          edited,
          after: Object.keys(localStorage).filter((k) => k.startsWith("piano-tutor:unsaved:")),
        };
      },
      { project, op: addNote(72) },
    );
    expect(out.leftBehind).toEqual(["piano-tutor:unsaved:tune"]);
    expect(out.first).toEqual({ ok: true, project: out.edited, recovered: "unsaved" });
    expect(out.second).toEqual({ ok: true, project: out.edited });
    expect(out.after).toEqual([]);
  });

  test("but a last-moment copy older than what is stored is ignored", async ({ page }) => {
    await open(page);
    const project = await seed(page);
    const out = await page.evaluate(
      async ({ project, op }) => {
        const kit = await window.__app!.kit();
        kit.storage.projectPersistence.saveNow!({ ...project, title: "Stale", updatedAt: "2020-01-01T00:00:00.000Z" });
        const newer = { ...kit.applyOps(project, [op]), updatedAt: new Date(Date.now() + 1000).toISOString() };
        const db = await kit.storage.openDb();
        await db.put("projects", newer); // as another tab would have saved it
        const loaded = await kit.storage.loadProject("tune");
        return loaded.ok ? loaded.project.title : "failed";
      },
      { project, op: addNote(72) },
    );
    expect(out).toBe("A Small Tune");
  });
});

test("autosave writes the project 800 ms after the last change", async ({ page }) => {
  await open(page);
  await seed(page);
  const out = await page.evaluate(async (op) => {
    const kit = await window.__app!.kit();
    const loaded = await kit.storage.loadProject("tune");
    if (!loaded.ok) throw new Error("no project");
    const store = kit.createProjectStore(loaded.project, { persistence: kit.storage.projectPersistence });
    const saved = new Promise<void>((resolve) => {
      const stop = store.subscribe(() => {
        if (!store.getState().dirty) {
          stop();
          resolve();
        }
      });
    });
    const t0 = performance.now();
    store.apply([op], "Add a note");
    await saved;
    const took = performance.now() - t0;
    store.dispose();
    const db = await kit.storage.openDb();
    const stored = (await db.get("projects", "tune")) as unknown as typeof loaded.project;
    const melody = stored.tracks[0];
    return {
      took,
      notes: melody.kind === "notes" ? melody.notes.length : 0,
      fresher: stored.updatedAt > loaded.project.updatedAt,
    };
  }, addNote(72));
  expect(out.took).toBeGreaterThanOrEqual(790);
  expect(out.took).toBeLessThan(3000);
  expect(out.notes).toBe(9);
  expect(out.fresher).toBe(true);
});

test("every fifth save keeps a snapshot, and only the newest twenty are kept", async ({ page }) => {
  await open(page);
  await seed(page);
  const out = await page.evaluate(async () => {
    const kit = await window.__app!.kit();
    const loaded = await kit.storage.loadProject("tune");
    if (!loaded.ok) throw new Error("no project");
    const store = kit.createProjectStore(loaded.project, { persistence: kit.storage.projectPersistence });
    for (let i = 0; i < 12; i++) {
      store.apply([{ op: "patchSong", patch: { title: `Version ${i + 1}` } }], "Rename");
      await store.flush();
    }
    const afterTwelve = (await kit.storage.listSnapshots("tune")).map((s) => s.project?.title);
    // Now many more snapshots than are kept.
    for (let i = 0; i < 25; i++)
      await kit.storage.saveProject({ ...loaded.project, title: `Snap ${i}` }, { snapshot: true });
    await kit.storage.saveProject({ ...loaded.project, id: "other", title: "Other" }, { snapshot: true });
    const all = await kit.storage.listSnapshots("tune");
    return {
      afterTwelve,
      count: all.length,
      newest: all[0].project?.title,
      oldest: all[all.length - 1].project?.title,
      other: (await kit.storage.listSnapshots("other")).length,
    };
  });
  expect(out.afterTwelve).toEqual(["Version 10", "Version 5"]);
  expect(out).toMatchObject({ count: 20, newest: "Snap 24", oldest: "Snap 5", other: 1 });
});

// ── Acceptance criterion 7, second half ──────────────────────────────────────

test.describe("loading a damaged project returns a typed failure, never a throw and never half a project", () => {
  test("with the validation errors and the newest sound snapshot", async ({ page }) => {
    await open(page);
    const project = await seed(page);
    const out = await page.evaluate(async (project) => {
      const kit = await window.__app!.kit();
      const db = await kit.storage.openDb();
      await kit.storage.saveProject({ ...project, title: "Older snapshot" }, { snapshot: true });
      await kit.storage.saveProject({ ...project, title: "Newer snapshot" }, { snapshot: true });
      // Damage the stored project in three ways at once.
      const damaged = JSON.parse(JSON.stringify(project));
      damaged.tracks[0].notes[0].pitch = 400;
      damaged.tempo = [];
      delete damaged.title;
      await db.put("projects", damaged);
      return kit.storage.loadProject("tune");
    }, project);
    expect(out.ok).toBe(false);
    if (out.ok || out.reason !== "invalid")
      throw new Error(`expected an invalid project, got ${JSON.stringify(out).slice(0, 200)}`);
    expect(out.errors.join("\n")).toMatch(/title/);
    expect(out.errors.join("\n")).toMatch(/tracks\.0\.notes\.0\.pitch/);
    expect(out.errors.join("\n")).toMatch(/tempo/);
    expect(out.snapshot?.project).toEqual({ ...project, title: "Newer snapshot" });
    expect("project" in out).toBe(false);
  });

  test("skipping snapshots that are damaged too, and saying so when there is none", async ({ page }) => {
    await open(page);
    const project = await seed(page);
    const out = await page.evaluate(async (project) => {
      const kit = await window.__app!.kit();
      const db = await kit.storage.openDb();
      await kit.storage.saveProject({ ...project, title: "Sound" }, { snapshot: true });
      await db.add("snapshots", {
        projectId: "tune",
        at: "2030-01-01",
        project: { format: "piano-project/v1", id: "tune", nonsense: true },
      });
      await db.put("projects", { id: "tune", format: "piano-project/v1", tracks: "none" } as { id: string });
      const withOlder = await kit.storage.loadProject("tune");
      // A second project with no snapshot at all, stored as something that is not a project.
      await db.put("projects", { id: "junk", hello: "world" } as { id: string });
      const none = await kit.storage.loadProject("junk");
      return { withOlder, none };
    }, project);
    expect(out.withOlder).toMatchObject({ ok: false, reason: "invalid", snapshot: { project: { title: "Sound" } } });
    expect(out.none).toMatchObject({ ok: false, reason: "invalid", snapshot: null });
    if (!out.none.ok && out.none.reason === "invalid") expect(out.none.errors[0]).toMatch(/not a project/);
  });
});

// ── Acceptance criterion 13 ──────────────────────────────────────────────────

test.describe("export and import", () => {
  /** A button the test can really click: browsers open a file picker only for a user's own gesture. */
  async function importButton(page: Page) {
    await page.evaluate(async () => {
      const kit = await window.__app!.kit();
      const button = document.createElement("button");
      button.id = "test-import";
      button.textContent = "Import";
      button.onclick = () =>
        void kit.storage.pickAndImport().then((r) => ((window as unknown as { imported: unknown }).imported = r));
      document.body.append(button);
    });
  }
  const imported = (page: Page) =>
    page
      .waitForFunction(() => (window as unknown as { imported?: unknown }).imported)
      .then((h) => h.jsonValue() as Promise<Record<string, unknown>>);

  test("exporting a project and importing the file yields a deep-equal project", async ({ page }) => {
    await open(page);
    const project = await seed(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.evaluate(async (project) => (await window.__app!.kit()).storage.exportProject(project), project),
    ]);
    expect(download.suggestedFilename()).toBe("a-small-tune.piano-project.json");
    const text = readFileSync(await download.path(), "utf8");
    expect(JSON.parse(text)).toEqual(project);

    // On a clean database, as on another device.
    await page.evaluate(async () => (await window.__app!.kit()).storage.deleteDb());
    await importButton(page);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#test-import")]);
    await chooser.setFiles({
      name: download.suggestedFilename(),
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
    expect(await imported(page)).toEqual({ ok: true, kind: "project", project, renamed: false });
    const loaded = await page.evaluate(async () => (await window.__app!.kit()).storage.loadProject("tune"));
    expect(loaded).toEqual({ ok: true, project });
  });

  test("importing a project that is already here keeps both", async ({ page }) => {
    await open(page);
    const project = await seed(page);
    const out = await page.evaluate(async (project) => {
      const kit = await window.__app!.kit();
      const result = await kit.storage.importFile(new Blob([kit.writeProjectFile(project)]));
      return { result, list: (await kit.storage.listProjects()).map((p) => p.title).sort() };
    }, project);
    expect(out.result).toMatchObject({
      ok: true,
      kind: "project",
      renamed: true,
      project: { title: "A Small Tune (imported)" },
    });
    expect(out.list).toEqual(["A Small Tune", "A Small Tune (imported)"]);
  });

  const malformed: [string, string, RegExp][] = [
    ["a file that is not JSON", "this is my shopping list", /not valid JSON/],
    ["a project file cut off part-way", '{"format":"piano-project/v1","id":"tune","title":"A Sm', /not valid JSON/],
    ["a file of some other kind", '{"name":"something-else","version":2}', /no "format" field/],
    ["a project from a newer version", '{"format":"piano-project/v2","id":"x"}', /"piano-project\/v2".*cannot open/],
    ["an empty file", "", /empty/],
  ];
  for (const [name, text, message] of malformed) {
    test(`importing ${name} is refused with a message that names the problem`, async ({ page }) => {
      await open(page);
      await importButton(page);
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#test-import")]);
      await chooser.setFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from(text) });
      const result = await imported(page);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(message);
      const stored = await page.evaluate(async () => (await (await window.__app!.kit()).storage.listProjects()).length);
      expect(stored).toBe(0);
    });
  }

  test("importing a project with one bad value is refused, naming the value, and nothing is stored", async ({
    page,
  }) => {
    await open(page);
    const project = await seed(page);
    const out = await page.evaluate(async (project) => {
      const kit = await window.__app!.kit();
      await kit.storage.deleteDb();
      const damaged = JSON.parse(kit.writeProjectFile(project));
      damaged.tracks[0].notes[2].dur = -480;
      const result = await kit.storage.importFile(new Blob([JSON.stringify(damaged)]));
      return { result, stored: (await kit.storage.listProjects()).length };
    }, project);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.message).toMatch(/project file is damaged — tracks\.0\.notes\.2\.dur/);
    expect(out.stored).toBe(0);
  });
});

// ── The catalog and user songs ───────────────────────────────────────────────

test("a user song is stored, listed ahead of the bank, and resolved by its id like a bank song", async ({ page }) => {
  await open(page);
  const out = await page.evaluate(async () => {
    const kit = await window.__app!.kit();
    await kit.storage.saveSong({
      format: "piano-song/v2",
      id: "u-tune",
      title: "My Tune",
      bpm: 96,
      notes: [
        { pitch: 64, time: 0.5, duration: 0.5, hand: "R" },
        { pitch: 60, time: 0, duration: 0.5, hand: "R" },
      ],
      origin: { kind: "studio", projectId: "tune" },
    });
    const c = kit.catalog();
    const list = await c.list();
    const mine = await c.load("u-tune");
    const bank = await c.load("rewrite-the-stars");
    return {
      first: list[0],
      ids: list.map((e) => `${e.source}:${e.id}`),
      found: (await c.find("u-tune"))?.source,
      bankFound: (await c.find("divenire"))?.source,
      mine: mine?.notes.map((n) => n.pitch),
      bankNotes: bank?.notes.length,
      nope: await c.load("u-nope"),
    };
  });
  expect(out.ids).toEqual(["user:u-tune", "bank:rewrite-the-stars", "bank:divenire"]);
  expect(out.first).toMatchObject({
    id: "u-tune",
    title: "My Tune",
    noteCount: 2,
    range: [60, 64],
    bpm: 96,
    projectId: "tune",
    genre: "original",
  });
  expect(out).toMatchObject({ found: "user", bankFound: "bank", mine: [60, 64], bankNotes: 1400, nope: null });
});

test("deleting a project removes it, its listing and its snapshots", async ({ page }) => {
  await open(page);
  const project = await seed(page);
  const out = await page.evaluate(async (project) => {
    const kit = await window.__app!.kit();
    await kit.storage.saveProject(project, { snapshot: true });
    await kit.storage.deleteProject("tune");
    return {
      loaded: await kit.storage.loadProject("tune"),
      list: await kit.storage.listProjects(),
      snapshots: await kit.storage.listSnapshots("tune"),
    };
  }, project);
  expect(out).toEqual({ loaded: { ok: false, reason: "missing" }, list: [], snapshots: [] });
});

test("the first save asks the browser to keep the data, and remembers the answer", async ({ page }) => {
  await open(page);
  const before = await page.evaluate(async () => (await window.__app!.kit()).storage.persistenceAnswer());
  expect(before).toBeNull();
  await seed(page);
  await expect
    .poll(() => page.evaluate(async () => (await window.__app!.kit()).storage.persistenceAnswer()))
    .toMatch(/^(persisted|refused|unsupported)$/);
});
