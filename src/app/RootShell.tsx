import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useSettings } from "@/store/useSettings";
import { setProxyConfig, setRelayBackend } from "@/features/providers/net";
import { probeEngineB, resetEngineBProbe, setEngineBConfig } from "@/features/engine/engineB";
import { useDesktopBackend } from "@/store/desktopBackend";
import { usePendingFile } from "@/store/pendingFile";
import { ProxySetupDialog } from "@/features/proxy/ProxySetupDialog";
import { BabelDocSetupDialog } from "@/features/engine/BabelDocSetupDialog";
import { ensureDefaultGlossary } from "@/features/glossary/store";
import { isDesktop } from "@/platform";

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
  // On desktop the backend is app-managed and lands on a free port, so its
  // address comes from Rust rather than from the (ignored) stored setting.
  const managedUrl = useDesktopBackend((b) => b.url);
  const backendUrl = isDesktop ? managedUrl : s.babelDocUrl;
  useEffect(() => {
    if (backendUrl) setEngineBConfig(backendUrl);
    // No relay in the shell — requests go out through Rust.
    if (!isDesktop) setRelayBackend(s.babelDocUrl); // the backend also serves /proxy
    resetEngineBProbe();
    probeEngineB();
  }, [backendUrl, s.babelDocUrl]);

  // A file opened from the OS can land while the reader is showing, where the
  // import dialog has nowhere to appear — so bring the library forward and let
  // it pick the file up.
  const incoming = usePendingFile((p) => p.file);
  const navigate = useNavigate();
  useEffect(() => {
    if (incoming) navigate("/");
  }, [incoming, navigate]);

  return (
    <>
      <Outlet />
      {/* Nothing to relay around in the shell — see src/platform. */}
      {!isDesktop && <ProxySetupDialog />}
      <BabelDocSetupDialog />
    </>
  );
}
