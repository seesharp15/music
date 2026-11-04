import { useEffect } from "react";

/**
 * Keep the screen awake while the page is visible, so a phone propped on the
 * music stand doesn't go dark mid-practice. Needs HTTPS (or localhost); where
 * the Wake Lock API is missing it quietly does nothing.
 */
export function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let pending = false;
    let done = false;
    const acquire = async () => {
      if (done || pending || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      pending = true;
      try {
        lock = await navigator.wakeLock.request("screen");
        if (done) void lock.release();
      } catch {
        // Refused (low-power mode, no user gesture yet); try again on the next tap.
      } finally {
        pending = false;
      }
    };
    // The system drops the lock whenever the page is hidden; take it back on return.
    const retry = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("pointerdown", retry);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", retry);
      window.removeEventListener("pointerdown", retry);
      void lock?.release();
    };
  }, []);
}
