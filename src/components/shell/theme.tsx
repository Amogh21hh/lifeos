"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Minimal theme system: a pre-paint inline script (rendered in <head> by the root layout) applies
 * the stored or system theme before hydration, so there is no flash and no hydration mismatch.
 */
import { THEME_KEY } from "./theme-script";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "dark",
  );
  const setTheme = useCallback((t: "dark" | "light") => {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage unavailable: theme still applies for this page view */
    }
  }, []);
  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
