import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useSettings } from "@/store/useSettings";
import { setProxyConfig, setRelayBackend } from "@/features/providers/net";
import { probeEngineB, setEngineBConfig } from "@/features/engine/engineB";
import { ProxySetupDialog } from "@/features/proxy/ProxySetupDialog";
import { BabelDocSetupDialog } from "@/features/engine/BabelDocSetupDialog";
import { ensureDefaultGlossary } from "@/features/glossary/store";

/** App root: keeps proxies in sync and probes for engine B on mount. */
export function RootShell() {
  const s = useSettings();
  // Give extracted terms a shared home from the first run, so they don't pile
  // up in throwaway per-document glossaries.
  useEffect(() => {
    ensureDefaultGlossary();
  }, []);
  useEffect(() => {
    setProxyConfig({ enabled: s.proxyEnabled, url: s.proxyUrl });
  }, [s.proxyEnabled, s.proxyUrl]);
  useEffect(() => {
    setEngineBConfig(s.babelDocUrl);
    setRelayBackend(s.babelDocUrl); // the backend also serves /proxy (CORS relay)
    probeEngineB();
  }, [s.babelDocUrl]);

  return (
    <>
      <Outlet />
      <ProxySetupDialog />
      <BabelDocSetupDialog />
    </>
  );
}
