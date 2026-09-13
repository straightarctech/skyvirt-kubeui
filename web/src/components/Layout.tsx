import { useEffect, useState } from "react";
import { Outlet, useOutletContext, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import CommandPalette from "./CommandPalette";
import CreateYAMLModal from "./CreateYAMLModal";
import { ErrorBoundary } from "./ErrorBoundary";

interface LayoutContext {
  namespace: string;
}

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [namespace, setNamespace] = useState("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-th-page">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ml-0 ${
          sidebarCollapsed ? "md:ml-16" : "md:ml-56"
        }`}
      >
        <TopBar
          namespace={namespace}
          onNamespaceChange={setNamespace}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenApply={() => setApplyOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet context={{ namespace } satisfies LayoutContext} />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {applyOpen && (
        <CreateYAMLModal
          title="Apply YAML"
          template={""}
          onClose={() => setApplyOpen(false)}
        />
      )}
    </div>
  );
}

/** Hook for child pages to access the selected namespace. */
export function useNamespace(): string {
  const { namespace } = useOutletContext<LayoutContext>();
  return namespace;
}
