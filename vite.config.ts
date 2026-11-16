import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The bundler gives a module shared by two screens a file of its own, however small. Practice is
 * used on a phone, where each extra file is another request before the first note: so the few
 * small modules it shares with the Studio ride along in files it already downloads.
 */
function sharedWithPractice(id: string): string | undefined {
  // What the Library and Practice have always shared, plus the song check the Studio also needs.
  if (/\/src\/(library\/recent|song\/normalize|song\/load|app\/useSongIndex)\.ts$/.test(id)) return "recent";
  // The waterfall's drawing helpers, used by Practice and by the editor: with the audio code,
  // which both of those screens load anyway and the Library never does.
  if (/\/src\/(components\/(stage-draw|keyboard|colors)|audio\/player)\.ts$/.test(id)) return "player";
  return undefined;
}

/**
 * Tell the service worker (src/sw.ts, built to /sw.js) which files make up the app, so it can keep
 * them all for offline use, and give that set of files a name that changes when any of them does.
 * Files only tests load are left out.
 */
function precacheList(): Plugin {
  return {
    name: "precache-list",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f !== "sw.js" && !/^assets\/(testKit|testing)-/.test(f) && !f.endsWith(".html"))
        .concat(["manifest.webmanifest", ...readdirSync("public/icons").map((f) => `icons/${f}`)])
        .sort();
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      const sw = bundle["sw.js"];
      if (sw?.type !== "chunk") throw new Error("the service worker was not built");
      sw.code = sw.code
        .replace(/__PRECACHE__/g, JSON.stringify(files))
        .replace(/__VERSION__/g, JSON.stringify(version));
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheList()],
  build: {
    rollupOptions: {
      input: { main: "index.html", sw: "src/sw.ts" },
      output: {
        manualChunks: sharedWithPractice,
        // The service worker lives at the root, under a name that never changes: a browser looks
        // for it there to see whether there is a new one.
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
