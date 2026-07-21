import React, { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { listNamespaces } from "@/api/client";
import SavedViews from "@/components/SavedViews";
import { useAuth } from "@/hooks/useAuth";
import ClusterSwitcher from "@/components/ClusterSwitcher";

// ── Breadcrumb builder ────────────────────────────────────────────────────

const sectionLabels: Record<string, string> = {
  workloads: "Workloads",
  networking: "Networking",
  storage: "Storage",
  config: "Configuration",
  observability: "Observability",
  operations: "Operations",
  topology: "Topology",
  nodes: "Nodes",
};

const pageLabels: Record<string, string> = {
  deployments: "Deployments",
  statefulsets: "StatefulSets",
  daemonsets: "DaemonSets",
  jobs: "Jobs",
  cronjobs: "CronJobs",
  pods: "Pods",
  services: "Services",
  ingress: "Ingress",
  endpoints: "Endpoints",
  policies: "Network Policies",
  loadbalancer: "Load Balancer",
  l2: "L2 Networks",
  pvcs: "Persistent Volume Claims",
  pvs: "Persistent Volumes",
  classes: "Storage Classes",
  configmaps: "ConfigMaps",
  secrets: "Secrets",
  rbac: "RBAC",
  quotas: "Resource Quotas",
  pdbs: "Pod Disruption Budgets",
  webhooks: "Webhooks",
  "pod-security": "Pod Security",
  crds: "Custom Resource Definitions",
  namespaces: "Namespaces",
  "service-accounts": "Service Accounts",
  "priority-classes": "Priority Classes",
  monitoring: "Monitoring",
  logs: "Logs",
  alerts: "Alerts",
  events: "Events",
  diagnostics: "Diagnostics",
  cost: "Cost Analysis",
  helm: "Helm Releases",
  cicd: "CI/CD Pipelines",
  backup: "Backup & Restore",
  upgrade: "Cluster Upgrade",
  terminal: "Terminal",
  resources: "Resource Map",
  "service-mesh": "Service Mesh",
  heatmap: "Resource Heatmap",
  labels: "Node Labels",
  operations: "Node Operations",
  templates: "Templates",
};

function buildBreadcrumbs(pathname: string): { label: string; path?: string }[] {
  if (pathname === "/") return [{ label: "Dashboard" }];
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; path?: string }[] = [];
  if (parts.length >= 1) {
    crumbs.push({
      label: sectionLabels[parts[0]] || parts[0],
      path: parts.length > 1 ? `/${parts[0]}` : undefined,
    });
  }
  if (parts.length >= 2) {
    crumbs.push({ label: pageLabels[parts[1]] || parts[1] });
  }
  return crumbs;
}

// ── TopBar Component ──────────────────────────────────────────────────────

interface TopBarProps {
  namespace: string;
  onNamespaceChange: (ns: string) => void;
  onOpenPalette?: () => void;
  onOpenApply?: () => void;
  onOpenMobileNav?: () => void;
}

export default function TopBar({ namespace, onNamespaceChange, onOpenPalette, onOpenApply, onOpenMobileNav }: TopBarProps) {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname);
  const { user, logout } = useAuth();
  const [namespaces, setNamespaces] = useState<string[]>(["all"]);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [compact, setCompact] = useState(() => document.documentElement.getAttribute("data-density") === "compact");

  useEffect(() => {
    listNamespaces().then((ns) => {
      setNamespaces(["all", ...ns.map((n) => n.name)]);
    }).catch(() => {});
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const toggleDensity = () => {
    const next = !compact;
    setCompact(next);
    if (next) document.documentElement.setAttribute("data-density", "compact");
    else document.documentElement.removeAttribute("data-density");
    localStorage.setItem("density", next ? "compact" : "comfortable");
  };

  return (
    <header className="h-14 bg-th-panel/80 backdrop-blur-md border-b border-th-line flex items-center px-4 md:px-6 gap-3 md:gap-4 shrink-0 sticky top-0 z-30">
      {/* Mobile nav toggle — opens the sidebar drawer on <md. */}
      {onOpenMobileNav && (
        <button
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="md:hidden -ml-1 p-2 rounded-lg text-th-dim hover:text-th-body hover:bg-th-hover transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}
      {/* Cluster switcher (only when launched with a multi-cluster context) */}
      <ClusterSwitcher />

      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm min-w-0">
        {crumbs.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <svg className="w-3.5 h-3.5 text-th-ghost flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            )}
            {crumb.path ? (
              <Link to={crumb.path} className="text-th-dim hover:text-th-accent transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-th-heading font-semibold truncate">{crumb.label}</span>
            )}
          </React.Fragment>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Global search / command palette */}
      {onOpenPalette && (
        <button
          onClick={onOpenPalette}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-th-subtle border border-th-line rounded-lg text-xs text-th-ghost hover:text-th-body hover:border-th-accent/50 transition-colors"
          title="Search everything (Ctrl+K)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <span>Search…</span>
          <kbd className="border border-th-line rounded px-1 text-[10px]">⌘K</kbd>
        </button>
      )}
      {/* Compact search trigger for mobile, where the full search box is hidden. */}
      {onOpenPalette && (
        <button
          onClick={onOpenPalette}
          aria-label="Search"
          className="flex md:hidden p-2 rounded-lg text-th-dim hover:text-th-body hover:bg-th-hover transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </button>
      )}

      {/* Global apply-YAML */}
      {onOpenApply && (
        <button
          onClick={onOpenApply}
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-th-subtle border border-th-line rounded-lg text-xs text-th-ghost hover:text-th-body hover:border-th-accent/50 transition-colors"
          title="Apply a YAML manifest to the cluster"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>YAML</span>
        </button>
      )}

      {/* Namespace selector */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-th-ghost uppercase tracking-wider font-medium">NS</label>
        <select
          value={namespace}
          onChange={(e) => onNamespaceChange(e.target.value)}
          className="bg-th-subtle border border-th-line rounded-lg px-2.5 py-1.5 text-xs text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent focus:border-th-accent transition-all"
        >
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns === "all" ? "All Namespaces" : ns}
            </option>
          ))}
        </select>
      </div>

      {/* User info */}
      {user && (
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-th-subtle/80 border border-th-line/50">
          {/* Avatar circle */}
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
            user.role === "admin" ? "bg-gradient-to-br from-indigo-500 to-violet-600" :
            user.role === "operator" ? "bg-gradient-to-br from-blue-500 to-cyan-600" :
            "bg-gradient-to-br from-gray-400 to-gray-500"
          }`}>
            {user.email?.[0]?.toUpperCase() || "?"}
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-th-body max-w-[120px] truncate leading-tight">{user.email}</span>
            <span className={`text-[9px] font-semibold uppercase tracking-wider leading-tight ${
              user.role === "admin" ? "text-th-accent" :
              user.role === "operator" ? "text-th-info" :
              "text-th-dim"
            }`}>{user.role}</span>
          </div>
          <button
            onClick={logout}
            className="p-1 rounded-md text-th-ghost hover:text-th-danger hover:bg-th-danger-s transition-all"
            title="Sign out"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      )}

      {/* Saved views (context-aware; self-hides when nothing to show) */}
      <SavedViews />

      {/* Density toggle */}
      <button
        onClick={toggleDensity}
        className="relative p-2 rounded-lg transition-all duration-300 bg-th-subtle text-th-dim hover:text-th-body hover:bg-th-hover"
        title={compact ? "Comfortable row spacing" : "Compact row spacing"}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          {compact ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6h16.5M3.75 12h16.5M3.75 18h16.5" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M3.75 9.75h16.5M3.75 14.25h16.5M3.75 18.75h16.5" />
          )}
        </svg>
      </button>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className={`relative p-2 rounded-lg transition-all duration-300 ${
          isDark
            ? "bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/15"
            : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
        }`}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        <div className="relative w-5 h-5 overflow-hidden">
          {isDark ? (
            <svg className="w-5 h-5 animate-fade-in" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 animate-fade-in" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
            </svg>
          )}
        </div>
      </button>
    </header>
  );
}
