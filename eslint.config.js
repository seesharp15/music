import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * The pure zone (docs/plan/contracts.md §12): musical logic that must run in the browser, on the
 * server and in unit tests alike. No DOM, no audio, no React.
 */
const PURE_ZONE = [
  "src/song/**/*.ts",
  "src/music/**/*.ts",
  "src/project/**/*.ts",
  "src/assist/core/**/*.ts",
  "src/capture/segment.ts",
  "src/capture/place.ts",
  "src/import/build/**/*.ts",
];
const NOT_PURE = ["src/song/load.ts", "src/project/store.ts", "**/*.test.ts"];

export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: PURE_ZONE,
    ignores: NOT_PURE,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "The pure zone has no UI: move this out, or the logic in." },
            { name: "react-dom", message: "The pure zone has no UI." },
            { name: "tone", message: "The pure zone makes no sound: call it from src/audio instead." },
          ],
          patterns: [
            {
              group: ["**/audio/**", "**/components/**", "**/studio/**", "**/library/**", "**/app/**"],
              message: "Pure-zone modules may only import other pure-zone modules.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "window", "document", "navigator", "localStorage", "sessionStorage"],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{js,ts}", "e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
);
