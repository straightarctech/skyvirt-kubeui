import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { APP_VERSION_LABEL, APP_BUILD_LABEL } from "@/version";

// ── Icons (inline SVG for zero deps) ──────────────────────────────────────

const icons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  nodes: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7" />
    </svg>
  ),
  workloads: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>
  ),
  networking: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  ),
  storage: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  ),
  config: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  observability: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  operations: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21M3 21V3" />
    </svg>
  ),
  topology: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  ),
  chevron: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  ),
  collapse: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  ),
};

// ── Navigation structure ──────────────────────────────────────────────────

interface NavItem {
  label: string;
  path: string;
}

interface NavGroup {
  label: string;
  icon: keyof typeof icons;
  items: NavItem[];
}

// A nav item needs exact-match highlighting when another item is nested under
// it (e.g. /nodes vs /nodes/labels) — otherwise the parent stays lit on the
// child's route and two items highlight at once.
function needsExactMatch(path: string, all: string[]): boolean {
  return path === "/" || all.some((p) => p !== path && p.startsWith(path + "/"));
}

export const navigation: NavGroup[] = [
  {
    label: "Dashboard",
    icon: "dashboard",
    items: [{ label: "Overview", path: "/" }],
  },
  {
    label: "Nodes",
    icon: "nodes",
    items: [
      { label: "List", path: "/nodes" },
      { label: "Labels", path: "/nodes/labels" },
      { label: "Operations", path: "/nodes/operations" },
    ],
  },
  {
    label: "Workloads",
    icon: "workloads",
    items: [
      { label: "Deployments", path: "/workloads/deployments" },
      { label: "StatefulSets", path: "/workloads/statefulsets" },
      { label: "DaemonSets", path: "/workloads/daemonsets" },
      { label: "Jobs", path: "/workloads/jobs" },
      { label: "CronJobs", path: "/workloads/cronjobs" },
      { label: "Autoscalers", path: "/workloads/hpas" },
      { label: "Pods", path: "/workloads/pods" },
    ],
  },
  {
    label: "Networking",
    icon: "networking",
    items: [
      { label: "Services", path: "/networking/services" },
      { label: "Ingress", path: "/networking/ingress" },
      { label: "Endpoints", path: "/networking/endpoints" },
      { label: "Net Policies", path: "/networking/policies" },
      { label: "Load Balancer", path: "/networking/loadbalancer" },
      { label: "L2 Networks", path: "/networking/l2" },
    ],
  },
  {
    label: "Storage",
    icon: "storage",
    items: [
      { label: "PVCs", path: "/storage/pvcs" },
      { label: "PVs", path: "/storage/pvs" },
      { label: "Classes", path: "/storage/classes" },
    ],
  },
  {
    label: "Config",
    icon: "config",
    items: [
      { label: "ConfigMaps", path: "/config/configmaps" },
      { label: "Secrets", path: "/config/secrets" },
      { label: "RBAC", path: "/config/rbac" },
      { label: "Access Review", path: "/config/access-review" },
      { label: "Drift", path: "/config/drift" },
      { label: "Quotas", path: "/config/quotas" },
      { label: "Limit Ranges", path: "/config/limit-ranges" },
      { label: "PDBs", path: "/config/pdbs" },
      { label: "Webhooks", path: "/config/webhooks" },
      { label: "Pod Security", path: "/config/pod-security" },
      { label: "CRDs", path: "/config/crds" },
      { label: "Namespaces", path: "/config/namespaces" },
      { label: "Service Accounts", path: "/config/service-accounts" },
      { label: "Priority Classes", path: "/config/priority-classes" },
    ],
  },
  {
    label: "Observability",
    icon: "observability",
    items: [
      { label: "Monitoring", path: "/observability/monitoring" },
      { label: "Logs", path: "/observability/logs" },
      { label: "Alerts", path: "/observability/alerts" },
      { label: "Events", path: "/observability/events" },
      { label: "Diagnostics", path: "/observability/diagnostics" },
      { label: "Audit Log", path: "/observability/audit" },
      { label: "Security", path: "/observability/security" },
      { label: "Certificates", path: "/observability/certificates" },
      { label: "Vulnerabilities", path: "/observability/vulnerabilities" },
      { label: "Cost", path: "/observability/cost" },
    ],
  },
  {
    label: "Operations",
    icon: "operations",
    items: [
      { label: "App Catalog", path: "/operations/catalog" },
      { label: "Helm", path: "/operations/helm" },
      { label: "GitOps", path: "/operations/cicd" },
      { label: "Backup", path: "/operations/backup" },
      { label: "Upgrade", path: "/operations/upgrade" },
      { label: "Terminal", path: "/operations/terminal" },
      { label: "Integrations", path: "/integrations" },
    ],
  },
  {
    label: "Topology",
    icon: "topology",
    items: [
      { label: "Resource Map", path: "/topology/resources" },
      { label: "Service Mesh", path: "/topology/service-mesh" },
      { label: "Heatmap", path: "/topology/heatmap" },
    ],
  },
];

// ── Sidebar Component ─────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Mobile drawer state — on <md the sidebar is an overlay drawer. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const ALL_NAV_PATHS = navigation.flatMap((g) => g.items.map((i) => i.path));

export default function Sidebar({ collapsed, onToggle, mobileOpen = false, onMobileClose }: SidebarProps) {
  const location = useLocation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    // Auto-expand the group matching current path.
    const init: Record<string, boolean> = {};
    for (const group of navigation) {
      if (group.items.some((i) => location.pathname === i.path || location.pathname.startsWith(i.path + "/"))) {
        init[group.label] = true;
      }
    }
    return init;
  });

  const toggleGroup = (label: string) => {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // Desktop can collapse to an icon rail; the mobile drawer is always full width,
  // so render full content whenever it's open on mobile.
  const contentCollapsed = collapsed && !mobileOpen;

  return (
    <>
      {/* Mobile backdrop — tap to dismiss the drawer. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed top-0 left-0 h-screen bg-th-sidebar backdrop-blur-xl flex flex-col z-40 transition-all duration-200 border-r border-th-line w-56 ${
          collapsed ? "md:w-16" : "md:w-56"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
      >
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-th-line shrink-0">
        {!contentCollapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#326ce5] to-[#1e4fc0] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
              </svg>
            </div>
            <span className="text-th-sidebar-text font-semibold text-sm tracking-wide truncate">
              SkyVirt <span className="text-th-accent font-normal opacity-70">KubeUI</span>
            </span>
          </div>
        )}
        <button
          onClick={onToggle}
          className={`text-th-sidebar-text-dim hover:text-th-sidebar-text hover:bg-th-sidebar-hover rounded-md p-1 transition-all ${contentCollapsed ? "mx-auto" : "ml-auto"}`}
        >
          {icons.collapse}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navigation.map((group) => {
          const isActive = group.items.some(
            (i) => location.pathname === i.path || location.pathname.startsWith(i.path + "/"),
          );
          const isExpanded = expanded[group.label] ?? false;

          return (
            <div key={group.label} className="mb-0.5">
              {/* Group header */}
              <button
                onClick={() => {
                  if (contentCollapsed) {
                    onToggle();
                    setExpanded((p) => ({ ...p, [group.label]: true }));
                  } else {
                    toggleGroup(group.label);
                  }
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                  isActive
                    ? "bg-th-sidebar-active text-white"
                    : "text-th-sidebar-text-dim hover:bg-th-sidebar-hover hover:text-th-sidebar-text"
                }`}
                title={contentCollapsed ? group.label : undefined}
              >
                <span className={`shrink-0 transition-colors ${isActive ? "text-white" : ""}`}>{icons[group.icon]}</span>
                {!contentCollapsed && (
                  <>
                    <span className="flex-1 text-left truncate">{group.label}</span>
                    <span
                      className={`shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-0" : "-rotate-90"}`}
                    >
                      {icons.chevron}
                    </span>
                  </>
                )}
              </button>

              {/* Sub-items */}
              {!contentCollapsed && isExpanded && (
                <div className="ml-5 mt-0.5 space-y-0.5 animate-fade-in border-l border-th-line pl-0">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={needsExactMatch(item.path, ALL_NAV_PATHS)}
                      onClick={onMobileClose}
                      className={({ isActive: active }) =>
                        `block px-3 py-1.5 rounded-md text-[13px] transition-all duration-150 ml-1 ${
                          active
                            ? "text-th-accent bg-th-accent/10 font-medium"
                            : "text-th-sidebar-text-dim hover:text-th-sidebar-text hover:bg-th-sidebar-hover"
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      {!contentCollapsed && (
        <div className="px-4 py-3 border-t border-th-line text-[10px] text-th-sidebar-text-dim flex items-center justify-between">
          <a
            href="https://github.com/straightarctech/skyvirt-kubeui"
            target="_blank"
            rel="noreferrer noopener"
            title={`KubeUI ${APP_BUILD_LABEL} — open source on GitHub`}
            className="transition-colors hover:text-th-sidebar-text"
          >
            KubeUI {APP_VERSION_LABEL}
          </a>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-th-ok animate-pulse-soft" />
            Connected
          </span>
        </div>
      )}
    </aside>
    </>
  );
}
