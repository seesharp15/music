/**
 * Registering the service worker (src/sw.ts) that keeps the app's files for offline use. Only in a
 * built app, and only when asked: while the Studio is behind its flag, so is this.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = () =>
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* no service worker: the app works as it always has, only not offline */
    });
  // After the page has loaded, so keeping files for later never competes with showing it now.
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register(), { once: true });
}

/** Whether the app is running as an installed app (from the home screen), not in a browser tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** What kind of device this is, for saying how to install on it. */
export function installPlatform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent;
  // iPadOS calls itself a Mac; it is the one "Mac" with a touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export const INSTALL_STEPS: Record<ReturnType<typeof installPlatform>, string> = {
  ios: "In Safari, tap the Share button, then “Add to Home Screen”. Make a backup here first: on an iPhone or iPad the installed app may start with none of your songs, and Restore brings them into it.",
  android: "Open the browser’s menu (⋮) and choose “Install app” or “Add to Home screen”.",
  desktop:
    "In Chrome or Edge, use the install button at the end of the address bar, or the menu’s “Install Piano Tutor”.",
};
