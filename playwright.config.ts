import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
// WebKit runs the smoke test only, and only where it is installed (CI, or PW_WEBKIT=1 locally).
const withWebKit = !!process.env.CI || process.env.PW_WEBKIT === "1";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    // The built app, with the test hooks switched on (see src/app/flags.ts).
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
      },
    },
    ...(withWebKit ? [{ name: "webkit", use: { ...devices["iPhone 14"] }, testMatch: /smoke\.spec\.ts/ }] : []),
  ],
  webServer: {
    // `npm run test:e2e` builds first; this only serves what was built.
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
