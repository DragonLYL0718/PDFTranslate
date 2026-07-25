import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "theme";

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event("themechange"));
}

/** Toggle between light and dark. */
export function toggleTheme() {
  apply(current() === "dark" ? "light" : "dark");
}

function subscribe(cb: () => void) {
  window.addEventListener("themechange", cb);
  return () => window.removeEventListener("themechange", cb);
}

/** Reactive current theme. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "light");
}
