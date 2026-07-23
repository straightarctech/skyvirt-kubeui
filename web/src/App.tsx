import { Suspense, lazy } from "react";
import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import { ToastProvider } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Lazy-loaded pages
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/dashboard/Dashboard"));
const NodeList = lazy(() => import("@/pages/nodes/NodeList"));
const NodeLabels = lazy(() => import("@/pages/nodes/NodeLabels"));
const NodeOperations = lazy(() => import("@/pages/nodes/NodeOperations"));
const Deployments = lazy(() => import("@/pages/workloads/Deployments"));
const StatefulSets = lazy(() => import("@/pages/workloads/StatefulSets"));
const DaemonSets = lazy(() => import("@/pages/workloads/DaemonSets"));
const Jobs = lazy(() => import("@/pages/workloads/Jobs"));
const CronJobs = lazy(() => import("@/pages/workloads/CronJobs"));
const HPAs = lazy(() => import("@/pages/workloads/HPAs"));
const Pods = lazy(() => import("@/pages/workloads/Pods"));
const Services = lazy(() => import("@/pages/networking/Services"));
const IngressPage = lazy(() => import("@/pages/networking/Ingress"));
const Endpoints = lazy(() => import("@/pages/networking/Endpoints"));
const NetPolicies = lazy(() => import("@/pages/networking/NetPolicies"));
const LoadBalancer = lazy(() => import("@/pages/networking/LoadBalancer"));
const L2Networks = lazy(() => import("@/pages/networking/L2Networks"));
const PVCs = lazy(() => import("@/pages/storage/PVCs"));
const PVs = lazy(() => import("@/pages/storage/PVs"));
const StorageClasses = lazy(() => import("@/pages/storage/StorageClasses"));
const ConfigMaps = lazy(() => import("@/pages/config/ConfigMaps"));
const Secrets = lazy(() => import("@/pages/config/Secrets"));
const RBAC = lazy(() => import("@/pages/config/RBAC"));
const AccessReview = lazy(() => import("@/pages/config/AccessReview"));
const Drift = lazy(() => import("@/pages/config/Drift"));
const Quotas = lazy(() => import("@/pages/config/Quotas"));
const PDBs = lazy(() => import("@/pages/config/PDBs"));
const WebhooksPage = lazy(() => import("@/pages/config/Webhooks"));
const PodSecurity = lazy(() => import("@/pages/config/PodSecurity"));
const CRDs = lazy(() => import("@/pages/config/CRDs"));
const Namespaces = lazy(() => import("@/pages/config/Namespaces"));
const ServiceAccounts = lazy(() => import("@/pages/config/ServiceAccounts"));
const PriorityClasses = lazy(() => import("@/pages/config/PriorityClasses"));
const LimitRanges = lazy(() => import("@/pages/config/LimitRanges"));
const Monitoring = lazy(() => import("@/pages/observability/Monitoring"));
const Logs = lazy(() => import("@/pages/observability/Logs"));
const Alerts = lazy(() => import("@/pages/observability/Alerts"));
const Events = lazy(() => import("@/pages/observability/Events"));
const Diagnostics = lazy(() => import("@/pages/observability/Diagnostics"));
const AuditLog = lazy(() => import("@/pages/observability/AuditLog"));
const SecurityPosture = lazy(() => import("@/pages/observability/SecurityPosture"));
const Cost = lazy(() => import("@/pages/observability/Cost"));
const Certificates = lazy(() => import("@/pages/observability/Certificates"));
const Vulnerabilities = lazy(() => import("@/pages/observability/Vulnerabilities"));
const Catalog = lazy(() => import("@/pages/operations/Catalog"));
const Helm = lazy(() => import("@/pages/operations/Helm"));
const CICD = lazy(() => import("@/pages/operations/CICD"));
const Backup = lazy(() => import("@/pages/operations/Backup"));
const Upgrade = lazy(() => import("@/pages/operations/Upgrade"));
const Terminal = lazy(() => import("@/pages/operations/Terminal"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const ResourceMap = lazy(() => import("@/pages/topology/ResourceMap"));
const ServiceMesh = lazy(() => import("@/pages/topology/ServiceMesh"));
const DesignTokens = lazy(() => import("@/pages/DesignTokens"));
const Heatmap = lazy(() => import("@/pages/topology/Heatmap"));
const PodDetail = lazy(() => import("@/pages/workloads/PodDetail"));
const DeploymentDetail = lazy(() => import("@/pages/workloads/DeploymentDetail"));
const WorkloadDetail = lazy(() => import("@/pages/workloads/WorkloadDetail"));
const ServiceDetail = lazy(() => import("@/pages/networking/ServiceDetail"));
const NodeDetail = lazy(() => import("@/pages/nodes/NodeDetail"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { token, loading, authRequired } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-th-page">
        <div className="w-8 h-8 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Skip login when backend has auth disabled.
  if (!authRequired) {
    return children;
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <ErrorBoundary scope="the console">
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            {/* Dashboard */}
            <Route index element={<Dashboard />} />

            {/* Nodes */}
            <Route path="nodes" element={<NodeList />} />
            <Route path="nodes/labels" element={<NodeLabels />} />
            <Route path="nodes/operations" element={<NodeOperations />} />

            {/* Workloads */}
            <Route path="workloads/deployments" element={<Deployments />} />
            <Route path="workloads/statefulsets" element={<StatefulSets />} />
            <Route path="workloads/daemonsets" element={<DaemonSets />} />
            <Route path="workloads/jobs" element={<Jobs />} />
            <Route path="workloads/cronjobs" element={<CronJobs />} />
            <Route path="workloads/hpas" element={<HPAs />} />
            <Route path="workloads/pods" element={<Pods />} />

            {/* Networking */}
            <Route path="networking/services" element={<Services />} />
            <Route path="networking/ingress" element={<IngressPage />} />
            <Route path="networking/endpoints" element={<Endpoints />} />
            <Route path="networking/policies" element={<NetPolicies />} />
            <Route path="networking/loadbalancer" element={<LoadBalancer />} />
            <Route path="networking/l2" element={<L2Networks />} />

            {/* Storage */}
            <Route path="storage/pvcs" element={<PVCs />} />
            <Route path="storage/pvs" element={<PVs />} />
            <Route path="storage/classes" element={<StorageClasses />} />

            {/* Config */}
            <Route path="config/configmaps" element={<ConfigMaps />} />
            <Route path="config/secrets" element={<Secrets />} />
            <Route path="config/rbac" element={<RBAC />} />
            <Route path="config/access-review" element={<AccessReview />} />
            <Route path="config/drift" element={<Drift />} />
            <Route path="config/quotas" element={<Quotas />} />
            <Route path="config/pdbs" element={<PDBs />} />
            <Route path="config/webhooks" element={<WebhooksPage />} />
            <Route path="config/pod-security" element={<PodSecurity />} />
            <Route path="config/crds" element={<CRDs />} />
            <Route path="config/namespaces" element={<Namespaces />} />
            <Route path="config/service-accounts" element={<ServiceAccounts />} />
            <Route path="config/priority-classes" element={<PriorityClasses />} />
            <Route path="config/limit-ranges" element={<LimitRanges />} />

            {/* Observability */}
            <Route path="observability/monitoring" element={<Monitoring />} />
            <Route path="observability/logs" element={<Logs />} />
            <Route path="observability/alerts" element={<Alerts />} />
            <Route path="observability/events" element={<Events />} />
            <Route path="observability/diagnostics" element={<Diagnostics />} />
            <Route path="observability/audit" element={<AuditLog />} />
            <Route path="observability/security" element={<SecurityPosture />} />
            <Route path="observability/certificates" element={<Certificates />} />
            <Route path="observability/vulnerabilities" element={<Vulnerabilities />} />
            <Route path="observability/cost" element={<Cost />} />

            {/* Operations */}
            <Route path="operations/catalog" element={<Catalog />} />
            <Route path="operations/helm" element={<Helm />} />
            <Route path="operations/cicd" element={<CICD />} />
            <Route path="operations/backup" element={<Backup />} />
            <Route path="operations/upgrade" element={<Upgrade />} />
            <Route path="operations/terminal" element={<Terminal />} />
            <Route path="integrations" element={<Integrations />} />

            {/* Topology */}
            <Route path="topology/resources" element={<ResourceMap />} />
            <Route path="topology/service-mesh" element={<ServiceMesh />} />
            {/* Unlinked maintainer/contributor reference — not in the sidebar. */}
            <Route path="design" element={<DesignTokens />} />
            <Route path="topology/heatmap" element={<Heatmap />} />

            {/* Detail pages */}
            <Route path="workloads/pods/:namespace/:name" element={<PodDetail />} />
            <Route path="workloads/deployments/:namespace/:name" element={<DeploymentDetail />} />
            <Route path="workloads/statefulsets/:namespace/:name" element={<WorkloadDetail kind="StatefulSet" />} />
            <Route path="workloads/daemonsets/:namespace/:name" element={<WorkloadDetail kind="DaemonSet" />} />
            <Route path="workloads/jobs/:namespace/:name" element={<WorkloadDetail kind="Job" />} />
            <Route path="workloads/cronjobs/:namespace/:name" element={<WorkloadDetail kind="CronJob" />} />
            <Route path="networking/services/:namespace/:name" element={<ServiceDetail />} />
            <Route path="nodes/:name" element={<NodeDetail />} />

            {/* 404 */}
            <Route path="*" element={
              <div className="flex flex-col items-center justify-center h-64 text-th-dim">
                <h2 className="text-2xl font-semibold text-th-heading mb-2">404</h2>
                <p>We couldn't find that page.</p>
                <Link to="/" className="mt-4 rounded-lg bg-th-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
                  Go to Dashboard
                </Link>
              </div>
            } />
          </Route>
        </Routes>
      </Suspense>
      </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  );
}
