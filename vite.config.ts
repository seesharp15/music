import { defineConfig } from "vite";
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

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: sharedWithPractice } } },
});
