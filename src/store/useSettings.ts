import { useLiveQuery } from "dexie-react-hooks";
import { DEFAULT_SETTINGS, readSettings } from "@/db/db";
import type { AppSettings } from "@/types";

/** Reactive app settings (read-only query; backfills defaults for new fields). */
export function useSettings(): AppSettings {
  return useLiveQuery(readSettings, [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS;
}
