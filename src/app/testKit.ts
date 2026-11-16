/**
 * Everything a browser test needs to build, edit, store and reload projects, in one module that the
 * test hooks load on demand, together with the storage layer. It imports no audio code, so tests that use only this can run in
 * browsers where Tone.js cannot (see e2e/helpers.ts).
 */
export { catalog, createCatalog } from "../library/catalog";
export { readFile, writeProjectFile, projectFileName } from "../project/file";
export { newProject } from "../project/new";
export { applyOps } from "../project/ops";
export { parseProject } from "../project/schema";
export { createProjectStore } from "../project/store";
// What the Library remembers of what was played. Also here for a second reason: the bundler files
// small shared modules by which screens use them, and this module using the bank's index (through
// the catalog) but not `recent` would split the one small file the Library and Practice share in two.
export { noteRecent, readRecent } from "../library/recent";
