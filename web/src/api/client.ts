import { getAuthToken, clearAuth } from "@/hooks/useAuth";

const API_BASE = "/api/v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.headers as Record<string, string>),
  };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    clearAuth();
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    throw new Error(await humanizeError(res));
  }
  return res.json();
}

// Turn an error response into a readable message. The backend sends
// {"error": "..."} and Kubernetes Status objects carry {"message": "..."} —
// surface those instead of dumping raw JSON with a bare status code into the UI.
async function humanizeError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const j = JSON.parse(raw);
    const msg = j.error || j.message || (typeof j === "string" ? j : "");
    if (msg) return msg;
  } catch {
    if (raw.trim()) return raw.trim();
  }
  return `Request failed (${res.status} ${res.statusText})`.trim();
}


export function nsPath(namespace: string): string {
  return namespace && namespace !== "all" ? `/namespaces/${namespace}` : "";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeSummary {
  name: string;
  status: string;
  roles: string[];
  version: string;
  internal_ip: string;
  os: string;
  architecture: string;
  container_runtime: string;
  kernel_version: string;
  cpu_capacity: string;
  memory_capacity: string;
  pod_capacity: string;
  cpu_allocatable: string;
  memory_allocatable: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  taints: TaintInfo[];
  created_at: string;
  unschedulable: boolean;
  conditions: ConditionInfo[];
}

export interface TaintInfo {
  key: string;
  value: string;
  effect: string;
}

export interface ConditionInfo {
  type: string;
  status: string;
  reason: string;
  message: string;
}

export interface PodSummary {
  name: string;
  namespace: string;
  status: string;
  node: string;
  ip: string;
  containers: ContainerInfo[];
  labels: Record<string, string>;
  created_at: string;
  owner_kind: string;
  owner_name: string;
}

export interface ContainerInfo {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
}

export interface DeploymentSummary {
  name: string;
  namespace: string;
  replicas: number;
  ready_replicas: number;
  updated_replicas: number;
  available_replicas: number;
  strategy: string;
  images: string[];
  labels: Record<string, string>;
  created_at: string;
  conditions: { type: string; status: string; reason: string; message: string }[];
}

export interface StatefulSetSummary {
  name: string;
  namespace: string;
  replicas: number;
  ready_replicas: number;
  service_name: string;
  images: string[];
  labels: Record<string, string>;
  created_at: string;
}

export interface DaemonSetSummary {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  up_to_date: number;
  images: string[];
  labels: Record<string, string>;
  node_selector: Record<string, string>;
  created_at: string;
}

export interface ServiceSummary {
  name: string;
  namespace: string;
  type: string;
  cluster_ip: string;
  external_ip: string;
  ports: ServicePort[];
  selector: Record<string, string>;
  labels: Record<string, string>;
  created_at: string;
}

export interface ServicePort {
  name: string;
  port: number;
  target_port: string;
  node_port: number;
  protocol: string;
}

export interface NamespaceSummary {
  name: string;
  status: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  created_at: string;
}

export interface NamespaceResources {
  pod_count: number;
  deployment_count: number;
  service_count: number;
  configmap_count: number;
  secret_count: number;
}

export interface EventSummary {
  namespace: string;
  name: string;
  type: string;
  reason: string;
  message: string;
  regarding_kind: string;
  regarding_name: string;
  source: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export interface NodeMetrics {
  name: string;
  cpu_usage: string;
  memory_usage: string;
  cpu_percent: number;
  memory_percent: number;
}

export interface PodMetrics {
  name: string;
  namespace: string;
  containers: { name: string; cpu_usage: string; memory_usage: string }[];
}

export interface ConfigMapSummary {
  name: string;
  namespace: string;
  data_count: number;
  labels: Record<string, string>;
  created_at: string;
}

export interface ConfigMapDetail extends ConfigMapSummary {
  data: Record<string, string>;
}

export interface SecretSummary {
  name: string;
  namespace: string;
  type: string;
  data_keys: string[];
  labels: Record<string, string>;
  created_at: string;
}

export interface IngressSummary {
  name: string;
  namespace: string;
  class: string;
  rules: { host: string; paths: { path: string; path_type: string; service_name: string; service_port: string }[] }[];
  tls: { hosts: string[]; secret_name: string }[];
  labels: Record<string, string>;
  created_at: string;
}

export interface RoleSummary {
  name: string;
  namespace: string;
  rules_count: number;
  labels: Record<string, string>;
  created_at: string;
  is_cluster_role: boolean;
}

export interface RoleBindingSummary {
  name: string;
  namespace: string;
  role_ref_kind: string;
  role_ref_name: string;
  subjects: { kind: string; name: string; namespace: string }[];
  created_at: string;
  is_cluster_binding: boolean;
}

export interface PVSummary {
  name: string;
  capacity: string;
  access_modes: string[];
  reclaim_policy: string;
  status: string;
  storage_class: string;
  claim_ref: string;
  created_at: string;
}

export interface PVCSummary {
  name: string;
  namespace: string;
  status: string;
  volume: string;
  capacity: string;
  used_bytes?: number;
  capacity_bytes?: number;
  available_bytes?: number;
  used_percent?: number;
  access_modes: string[];
  storage_class: string;
  created_at: string;
}

export interface StorageClassSummary {
  name: string;
  provisioner: string;
  reclaim_policy: string;
  volume_binding_mode: string;
  allow_volume_expansion: boolean;
  is_default: boolean;
  created_at: string;
}

export interface NetworkPolicySummary {
  name: string;
  namespace: string;
  pod_selector: Record<string, string>;
  ingress_rules_count: number;
  egress_rules_count: number;
  policy_types: string[];
  created_at: string;
}

export interface HPASummary {
  name: string;
  namespace: string;
  target_kind: string;
  target_name: string;
  min_replicas: number;
  max_replicas: number;
  current_replicas: number;
  desired_replicas: number;
  metrics: string[];
  created_at: string;
}

export interface JobSummary {
  name: string;
  namespace: string;
  completions: number;
  succeeded: number;
  failed: number;
  active: number;
  duration: string;
  conditions: { type: string; status: string }[];
  created_at: string;
}

export interface CronJobSummary {
  name: string;
  namespace: string;
  schedule: string;
  suspend: boolean;
  active_count: number;
  last_schedule: string;
  created_at: string;
}

export interface CRDSummary {
  name: string;
  group: string;
  version: string;
  kind: string;
  scope: string;
  created_at: string;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  chart: string;
  version: string;
  status: string;
  revision: string;
  updated_at: string;
  app_version?: string;
}

export interface ServiceAccountSummary {
  name: string;
  namespace: string;
  secrets: number;
  image_pull_secrets: string[];
  automount_token: boolean | null;
  labels: Record<string, string>;
  created_at: string;
}

export interface ResourceQuotaSummary {
  name: string;
  namespace: string;
  hard: Record<string, string>;
  used: Record<string, string>;
  labels: Record<string, string>;
  created_at: string;
}

export interface PDBSummary {
  name: string;
  namespace: string;
  min_available: string;
  max_unavailable: string;
  current_healthy: number;
  desired_healthy: number;
  disruptions_allowed: number;
  expected_pods: number;
  selector: Record<string, string>;
  labels: Record<string, string>;
  created_at: string;
}

export interface PriorityClassSummary {
  name: string;
  value: number;
  global_default: boolean;
  preemption_policy: string;
  description: string;
  created_at: string;
}

export interface WebhookSummary {
  name: string;
  kind: string;
  webhooks: number;
  failure_policy: string;
  side_effects: string;
  created_at: string;
}

export interface EndpointAddress {
  ip: string;
  node_name: string;
  target_ref: string;
}

export interface EndpointSummary {
  name: string;
  namespace: string;
  subsets: number;
  addresses: number;
  ports: { name: string; port: number; protocol: string }[];
  ready: number;
  not_ready: number;
  ready_addrs?: EndpointAddress[];
  not_ready_addrs?: EndpointAddress[];
  labels: Record<string, string>;
  created_at: string;
}

export interface LimitRangeItem {
  type: string;
  max: Record<string, string>;
  min: Record<string, string>;
  default: Record<string, string>;
  default_request: Record<string, string>;
}

export interface LimitRangeSummary {
  name: string;
  namespace: string;
  limits: LimitRangeItem[];
  labels: Record<string, string>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export async function listNodes(): Promise<NodeSummary[]> {
  return request("/nodes");
}

export async function getNode(name: string): Promise<NodeSummary> {
  return request(`/nodes/${name}`);
}

export async function cordonNode(name: string): Promise<void> {
  await request(`/nodes/${name}/cordon`, { method: "POST" });
}

export async function uncordonNode(name: string): Promise<void> {
  await request(`/nodes/${name}/uncordon`, { method: "POST" });
}

export async function drainNode(name: string): Promise<void> {
  await request(`/nodes/${name}/drain`, { method: "POST" });
}

export async function setNodeLabels(name: string, labels: Record<string, string>): Promise<void> {
  await request(`/nodes/${name}/labels`, { method: "PUT", body: JSON.stringify(labels) });
}

export async function addNodeTaint(name: string, taint: TaintInfo): Promise<void> {
  await request(`/nodes/${name}/taint`, { method: "POST", body: JSON.stringify(taint) });
}

export async function removeNodeTaint(name: string, key: string): Promise<void> {
  await request(`/nodes/${name}/taint/${key}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Pods
// ---------------------------------------------------------------------------

export async function listPods(namespace?: string): Promise<PodSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/pods`);
  return request("/pods");
}

export async function getPod(namespace: string, name: string): Promise<PodSummary> {
  return request(`/namespaces/${namespace}/pods/${name}`);
}

export async function deletePod(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/pods/${name}`, { method: "DELETE" });
}

export async function getPodLogs(namespace: string, name: string, container?: string, tailLines?: number): Promise<string> {
  const params = new URLSearchParams();
  if (container) params.set("container", container);
  if (tailLines) params.set("tailLines", String(tailLines));
  const q = params.toString();
  const res = await request<{ logs: string }>(`/namespaces/${namespace}/pods/${name}/logs${q ? "?" + q : ""}`);
  return res.logs ?? "";
}

export interface DiagnosisFinding {
  severity: "critical" | "warning" | "info" | "ok";
  title: string;
  detail?: string;
  evidence?: string[];
  suggestion?: string;
}

export interface Diagnosis {
  namespace: string;
  name: string;
  phase: string;
  node: string;
  healthy: boolean;
  findings: DiagnosisFinding[];
}

export async function diagnosePod(namespace: string, name: string): Promise<Diagnosis> {
  return request(`/diagnose/pod/${namespace}/${name}`);
}

export interface WorkloadDiagnosis {
  kind: string;
  namespace: string;
  name: string;
  healthy: boolean;
  summary: string;
  findings: DiagnosisFinding[];
  pods: Diagnosis[];
}

export async function diagnoseWorkload(kind: string, namespace: string, name: string): Promise<WorkloadDiagnosis> {
  return request(`/diagnose/workload/${kind}/${namespace}/${name}`);
}

let _serverConfig: Promise<{ auth_enabled: boolean; ai_enabled: boolean }> | null = null;
/** Cached server capability flags (auth + AI). */
export function getServerConfig(): Promise<{ auth_enabled: boolean; ai_enabled: boolean }> {
  if (!_serverConfig) _serverConfig = request("/auth/config");
  return _serverConfig;
}

/** A whitelisted, correctly-targeted remediation the UI can apply after approval. */
export interface ProposedFix {
  action: "restart" | "delete_pod" | "uncordon" | "cordon";
  kind: string;
  namespace?: string;
  name: string;
  label: string;
  danger?: boolean;
}

export interface ExplainRequest {
  namespace: string;
  name: string;
  phase: string;
  node: string;
  title: string;
  detail?: string;
  evidence?: string[];
  suggestion?: string;
  /** Pre-validated safe fixes; the model may only pick one of these. */
  allowed_fixes?: ProposedFix[];
}

/**
 * Ask the on-prem LLM to explain a diagnosis finding (advisory). It may also
 * return `fix` = the single candidate remediation it recommends (echoed from
 * allowed_fixes) — the caller applies it only after the human approves.
 */
export async function explainFinding(req: ExplainRequest): Promise<{ explanation: string; fix?: ProposedFix | null }> {
  return request("/diagnose/explain", { method: "POST", body: JSON.stringify(req) });
}

/**
 * Execute an approved fix via the existing (RBAC'd, audited) action endpoints —
 * with a client-side action whitelist as defense in depth.
 */
export async function applyProposedFix(fix: ProposedFix): Promise<void> {
  switch (fix.action) {
    case "delete_pod":
      return deletePod(fix.namespace ?? "", fix.name);
    case "restart":
      if (fix.kind === "Deployment") return restartDeployment(fix.namespace ?? "", fix.name);
      if (fix.kind === "StatefulSet") return restartStatefulSet(fix.namespace ?? "", fix.name);
      if (fix.kind === "DaemonSet") return restartDaemonSet(fix.namespace ?? "", fix.name);
      break;
    case "uncordon":
      return uncordonNode(fix.name);
    case "cordon":
      return cordonNode(fix.name);
  }
  throw new Error(`Unsupported fix action: ${fix.action} on ${fix.kind}`);
}

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

export async function listDeployments(namespace?: string): Promise<DeploymentSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/deployments`);
  return request("/deployments");
}

export async function getDeployment(namespace: string, name: string): Promise<DeploymentSummary> {
  return request(`/namespaces/${namespace}/deployments/${name}`);
}

export async function scaleDeployment(namespace: string, name: string, replicas: number): Promise<void> {
  await request(`/namespaces/${namespace}/deployments/${name}/scale`, {
    method: "POST",
    body: JSON.stringify({ replicas }),
  });
}

export async function restartDeployment(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/deployments/${name}/restart`, { method: "POST" });
}

export async function rollbackDeployment(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/deployments/${name}/rollback`, { method: "POST" });
}

export async function deleteDeployment(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/deployments/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// StatefulSets
// ---------------------------------------------------------------------------

export async function listStatefulSets(namespace?: string): Promise<StatefulSetSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/statefulsets`);
  return request("/statefulsets");
}

export async function scaleStatefulSet(namespace: string, name: string, replicas: number): Promise<void> {
  await request(`/namespaces/${namespace}/statefulsets/${name}/scale`, {
    method: "POST",
    body: JSON.stringify({ replicas }),
  });
}

export async function restartStatefulSet(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/statefulsets/${name}/restart`, { method: "POST" });
}

export async function deleteStatefulSet(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/statefulsets/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// DaemonSets
// ---------------------------------------------------------------------------

export async function listDaemonSets(namespace?: string): Promise<DaemonSetSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/daemonsets`);
  return request("/daemonsets");
}

export async function restartDaemonSet(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/daemonsets/${name}/restart`, { method: "POST" });
}

export async function deleteDaemonSet(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/daemonsets/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function listServices(namespace?: string): Promise<ServiceSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/services`);
  return request("/services");
}

export async function getService(namespace: string, name: string): Promise<ServiceSummary> {
  return request(`/namespaces/${namespace}/services/${name}`);
}

export async function deleteService(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/services/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

export async function listNamespaces(): Promise<NamespaceSummary[]> {
  return request("/namespaces");
}

export async function createNamespace(name: string, labels?: Record<string, string>): Promise<void> {
  await request("/namespaces", { method: "POST", body: JSON.stringify({ name, labels }) });
}

export async function deleteNamespace(name: string): Promise<void> {
  await request(`/namespaces/${name}`, { method: "DELETE" });
}

export async function getNamespaceResources(name: string): Promise<NamespaceResources> {
  return request(`/namespaces/${name}/resources`);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function listEvents(namespace?: string): Promise<EventSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/events`);
  return request("/events");
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function topNodes(): Promise<NodeMetrics[]> {
  return request("/metrics/nodes");
}

export async function topPods(namespace?: string): Promise<PodMetrics[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/metrics/pods`);
  return request("/metrics/pods");
}

// ---------------------------------------------------------------------------
// ConfigMaps
// ---------------------------------------------------------------------------

export async function listConfigMaps(namespace?: string): Promise<ConfigMapSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/configmaps`);
  return request("/configmaps");
}

export async function getConfigMap(namespace: string, name: string): Promise<ConfigMapDetail> {
  return request(`/namespaces/${namespace}/configmaps/${name}`);
}

export async function createConfigMap(namespace: string, name: string, data: Record<string, string>): Promise<void> {
  await request(`/namespaces/${namespace}/configmaps`, { method: "POST", body: JSON.stringify({ name, data }) });
}

export async function updateConfigMap(namespace: string, name: string, data: Record<string, string>): Promise<void> {
  await request(`/namespaces/${namespace}/configmaps/${name}`, { method: "PUT", body: JSON.stringify({ data }) });
}

export async function deleteConfigMap(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/configmaps/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export async function listSecrets(namespace?: string): Promise<SecretSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/secrets`);
  return request("/secrets");
}

export async function getSecret(namespace: string, name: string): Promise<SecretSummary> {
  return request(`/namespaces/${namespace}/secrets/${name}`);
}

export async function deleteSecret(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/secrets/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Ingresses
// ---------------------------------------------------------------------------

export async function listIngresses(namespace?: string): Promise<IngressSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/ingresses`);
  return request("/ingresses");
}

export async function getIngress(namespace: string, name: string): Promise<IngressSummary> {
  return request(`/namespaces/${namespace}/ingresses/${name}`);
}

export async function deleteIngress(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/ingresses/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

export async function listClusterRoles(): Promise<RoleSummary[]> {
  return request("/clusterroles");
}

export async function listRoles(namespace: string): Promise<RoleSummary[]> {
  return request(`/namespaces/${namespace}/roles`);
}

export async function listClusterRoleBindings(): Promise<RoleBindingSummary[]> {
  return request("/clusterrolebindings");
}

export async function listRoleBindings(namespace: string): Promise<RoleBindingSummary[]> {
  return request(`/namespaces/${namespace}/rolebindings`);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function listPVs(): Promise<PVSummary[]> {
  return request("/pvs");
}

export async function listPVCs(namespace?: string): Promise<PVCSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/pvcs`);
  return request("/pvcs");
}

export async function deletePVC(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/pvcs/${name}`, { method: "DELETE" });
}

export async function resizePVC(namespace: string, name: string, capacity: string): Promise<void> {
  await request(`/namespaces/${namespace}/pvcs/${name}/resize`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capacity }),
  });
}

export async function listStorageClasses(): Promise<StorageClassSummary[]> {
  return request("/storageclasses");
}

// ---------------------------------------------------------------------------
// Network Policies
// ---------------------------------------------------------------------------

export async function listNetworkPolicies(namespace?: string): Promise<NetworkPolicySummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/networkpolicies`);
  return request("/networkpolicies");
}

export async function deleteNetworkPolicy(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/networkpolicies/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// HPAs
// ---------------------------------------------------------------------------

export async function listHPAs(namespace?: string): Promise<HPASummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/hpas`);
  return request("/hpas");
}

export async function deleteHPA(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/hpas/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Jobs & CronJobs
// ---------------------------------------------------------------------------

export async function listJobs(namespace?: string): Promise<JobSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/jobs`);
  return request("/jobs");
}

export async function deleteJob(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/jobs/${name}`, { method: "DELETE" });
}

export async function listCronJobs(namespace?: string): Promise<CronJobSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/cronjobs`);
  return request("/cronjobs");
}

export async function deleteCronJob(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/cronjobs/${name}`, { method: "DELETE" });
}

export async function suspendCronJob(namespace: string, name: string, suspend: boolean): Promise<void> {
  await request(`/namespaces/${namespace}/cronjobs/${name}/suspend`, {
    method: "PUT",
    body: JSON.stringify({ suspend }),
  });
}

// ---------------------------------------------------------------------------
// CRDs
// ---------------------------------------------------------------------------

export async function listCRDs(): Promise<CRDSummary[]> {
  return request("/crds");
}

export async function listCRDInstances(group: string, version: string, resource: string, namespace?: string): Promise<Record<string, unknown>[]> {
  if (namespace) return request(`/namespaces/${namespace}/crds/${group}/${version}/${resource}`);
  return request(`/crds/${group}/${version}/${resource}`);
}

// ---------------------------------------------------------------------------
// Helm
// ---------------------------------------------------------------------------

export async function listHelmReleases(namespace?: string): Promise<HelmRelease[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/helm/releases`);
  return request("/helm/releases");
}

export async function getHelmRelease(namespace: string, name: string): Promise<HelmRelease> {
  return request(`/namespaces/${namespace}/helm/releases/${name}`);
}

export async function installHelmChart(data: {
  release_name: string;
  namespace: string;
  repo_url: string;
  chart: string;
  version?: string;
  values?: Record<string, string>;
  values_yaml?: string;
}): Promise<{ message: string; output: string }> {
  return request("/helm/install", { method: "POST", body: JSON.stringify(data) });
}

export async function upgradeHelmRelease(namespace: string, name: string, data: {
  repo_url?: string;
  chart?: string;
  version?: string;
  values?: Record<string, string>;
}): Promise<{ message: string; output: string }> {
  return request(`/namespaces/${namespace}/helm/releases/${name}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function uninstallHelmRelease(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/helm/releases/${name}`, { method: "DELETE" });
}

export async function rollbackHelmRelease(namespace: string, name: string, revision: number): Promise<void> {
  await request(`/namespaces/${namespace}/helm/releases/${name}/rollback`, {
    method: "POST",
    body: JSON.stringify({ revision }),
  });
}

export async function getHelmReleaseValues(namespace: string, name: string, revision?: number): Promise<{ values: string }> {
  const q = revision ? `?revision=${revision}` : "";
  return request(`/namespaces/${namespace}/helm/releases/${name}/values${q}`);
}

export async function getHelmReleaseManifest(namespace: string, name: string, revision?: number): Promise<{ manifest: string }> {
  const q = revision ? `?revision=${revision}` : "";
  return request(`/namespaces/${namespace}/helm/releases/${name}/manifest${q}`);
}

export async function getHelmReleaseNotes(namespace: string, name: string): Promise<{ notes: string }> {
  return request(`/namespaces/${namespace}/helm/releases/${name}/notes`);
}

export async function getHelmReleaseHistory(namespace: string, name: string): Promise<Record<string, unknown>[]> {
  return request(`/namespaces/${namespace}/helm/releases/${name}/history`);
}

export async function searchHelmRepo(repoURL: string, keyword?: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ repo_url: repoURL });
  if (keyword) params.set("keyword", keyword);
  return request(`/helm/search?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// App Catalog — Helm repositories + chart browse/install
// ---------------------------------------------------------------------------

export interface HelmRepo {
  name: string;
  url: string;
}

export interface CatalogChart {
  name: string; // "repo/chart"
  version: string;
  app_version: string;
  description: string;
}

export async function listHelmRepos(): Promise<HelmRepo[]> {
  return request("/helm/repos");
}

export async function addHelmRepo(name: string, url: string): Promise<void> {
  await request("/helm/repos", { method: "POST", body: JSON.stringify({ name, url }) });
}

export async function removeHelmRepo(name: string): Promise<void> {
  await request(`/helm/repos/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function searchCatalog(q?: string): Promise<CatalogChart[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return request(`/catalog/charts${qs}`);
}

/** show one of: "chart" (Chart.yaml), "values" (default values.yaml), "readme". */
export async function showChart(chart: string, what: "chart" | "values" | "readme", version?: string): Promise<string> {
  const params = new URLSearchParams({ chart, what });
  if (version) params.set("version", version);
  const res = await request<{ content: string }>(`/catalog/chart?${params.toString()}`);
  return res.content;
}

/** Ask the on-prem AI about a chart's values (explain / recommend). */
export async function aiHelmValues(chart: string, values: string, ask?: string): Promise<string> {
  const res = await request<{ answer: string }>("/catalog/ai-values", {
    method: "POST",
    body: JSON.stringify({ chart, values, ask }),
  });
  return res.answer;
}

// ---------------------------------------------------------------------------
// Backup / DR (Velero)
// ---------------------------------------------------------------------------

export interface VeleroStatus { installed: boolean; namespace: string; }
export type VeleroObject = Record<string, unknown>;

export async function veleroStatus(): Promise<VeleroStatus> {
  return request("/velero/status");
}
export async function listVelero(resource: "backups" | "restores" | "schedules" | "backupstoragelocations"): Promise<VeleroObject[]> {
  return request(`/velero/${resource}`);
}
export async function createVeleroBackup(data: { name: string; namespaces?: string[]; ttl_hours?: number; snapshot_volumes?: boolean }): Promise<void> {
  await request("/velero/backups", { method: "POST", body: JSON.stringify(data) });
}
export async function createVeleroSchedule(data: { name: string; schedule: string; namespaces?: string[]; ttl_hours?: number; snapshot_volumes?: boolean }): Promise<void> {
  await request("/velero/schedules", { method: "POST", body: JSON.stringify(data) });
}
export async function createVeleroRestore(data: { name: string; backup_name: string }): Promise<void> {
  await request("/velero/restores", { method: "POST", body: JSON.stringify(data) });
}
export async function deleteVelero(resource: string, name: string): Promise<void> {
  await request(`/velero/${resource}/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Upgrade readiness — deprecated/removed API scan
// ---------------------------------------------------------------------------

export interface APIFinding {
  api_version: string;
  kind: string;
  removed_in: string;
  replacement: string;
  name: string;
  source: string;
}
export async function scanDeprecatedAPIs(): Promise<APIFinding[]> {
  return request("/upgrade/api-scan");
}

// ---------------------------------------------------------------------------
// Certificate expiry radar
// ---------------------------------------------------------------------------

export interface CertInfo {
  namespace: string;
  secret: string;
  common_name: string;
  dns_names: string[];
  issuer: string;
  not_after: string;
  days_left: number;
  expired: boolean;
}
export async function scanCertExpiry(): Promise<CertInfo[]> {
  return request("/certs/expiry");
}

// ---------------------------------------------------------------------------
// Image vulnerabilities (Trivy Operator reports)
// ---------------------------------------------------------------------------

export interface VulnReport {
  namespace: string; workload: string; container: string; image: string;
  critical: number; high: number; medium: number; low: number; unknown: number;
}
export async function vulnStatus(): Promise<{ installed: boolean }> {
  return request("/vuln/status");
}
export async function listVulnReports(): Promise<VulnReport[]> {
  return request("/vuln/reports");
}

// ---------------------------------------------------------------------------
// SIEM / SecSphere forwarding
// ---------------------------------------------------------------------------

export async function forwardSecurity(data: { syslog_addr?: string; http_url?: string; hec_url?: string; hec_token?: string }): Promise<{ collected: number; sent: number; errors: string[] }> {
  return request("/forward/security", { method: "POST", body: JSON.stringify(data) });
}

export interface ForwardSignals { vuln: boolean; cert: boolean; config: boolean; rbac: boolean; }
export interface ForwardTarget { syslog_addr?: string; http_url?: string; hec_url?: string; hec_token?: string; }
export interface ForwardConfig {
  enabled: boolean;
  interval_minutes: number;
  signals: ForwardSignals;
  target: ForwardTarget;
  last_run?: string;
  last_result?: string;
  hec_token_set?: boolean;
}
export async function getForwardConfig(): Promise<ForwardConfig> {
  return request("/forward/config");
}
export async function putForwardConfig(cfg: ForwardConfig): Promise<ForwardConfig> {
  return request("/forward/config", { method: "PUT", body: JSON.stringify(cfg) });
}

// ---------------------------------------------------------------------------
// RBAC access review
// ---------------------------------------------------------------------------

export interface AccessReviewResult { allowed: boolean; denied: boolean; reason: string; }
export async function accessReview(data: {
  subject_kind: string; subject_name: string; subject_namespace?: string;
  verb: string; group?: string; resource: string; name?: string; namespace?: string;
}): Promise<AccessReviewResult> {
  return request("/rbac/access-review", { method: "POST", body: JSON.stringify(data) });
}

export interface RiskyBinding { name: string; role: string; subjects: string[]; reasons: string[]; }
export async function listRiskyBindings(): Promise<RiskyBinding[]> {
  return request("/rbac/risky-bindings");
}

// ---------------------------------------------------------------------------
// Service Accounts
// ---------------------------------------------------------------------------

export async function listServiceAccounts(namespace?: string): Promise<ServiceAccountSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/serviceaccounts`);
  return request("/serviceaccounts");
}

export async function deleteServiceAccount(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/serviceaccounts/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Resource Quotas
// ---------------------------------------------------------------------------

export async function listResourceQuotas(namespace?: string): Promise<ResourceQuotaSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/resourcequotas`);
  return request("/resourcequotas");
}

export async function deleteResourceQuota(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/resourcequotas/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// PodDisruptionBudgets
// ---------------------------------------------------------------------------

export async function listPDBs(namespace?: string): Promise<PDBSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/pdbs`);
  return request("/pdbs");
}

export async function deletePDB(namespace: string, name: string): Promise<void> {
  await request(`/namespaces/${namespace}/pdbs/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Priority Classes
// ---------------------------------------------------------------------------

export async function listPriorityClasses(): Promise<PriorityClassSummary[]> {
  return request("/priorityclasses");
}

export async function deletePriorityClass(name: string): Promise<void> {
  await request(`/priorityclasses/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export async function listValidatingWebhooks(): Promise<WebhookSummary[]> {
  return request("/webhooks/validating");
}

export async function listMutatingWebhooks(): Promise<WebhookSummary[]> {
  return request("/webhooks/mutating");
}

export async function deleteValidatingWebhook(name: string): Promise<void> {
  await request(`/webhooks/validating/${name}`, { method: "DELETE" });
}

export async function deleteMutatingWebhook(name: string): Promise<void> {
  await request(`/webhooks/mutating/${name}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function listEndpoints(namespace?: string): Promise<EndpointSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/endpoints`);
  return request("/endpoints");
}

// ---------------------------------------------------------------------------
// Limit Ranges
// ---------------------------------------------------------------------------

export async function listLimitRanges(namespace?: string): Promise<LimitRangeSummary[]> {
  if (namespace && namespace !== "all") return request(`/namespaces/${namespace}/limitranges`);
  return request("/limitranges");
}

// ---------------------------------------------------------------------------
// Apply / Generic Resources
// ---------------------------------------------------------------------------

export interface ApplyResult {
  kind: string;
  name: string;
  namespace?: string;
  action: string;
}

export async function applyManifest(manifest: string): Promise<ApplyResult[]> {
  return request("/apply", {
    method: "POST",
    body: JSON.stringify({ manifest }),
  });
}

/** GitOps-lite: clone a repo and return the manifests under a path. */
export async function fetchGitManifests(repo_url: string, ref: string, path: string, auth?: { username?: string; token?: string }): Promise<string> {
  const res = await request<{ manifests: string }>("/gitops/fetch", {
    method: "POST",
    body: JSON.stringify({ repo_url, ref, path, username: auth?.username, token: auth?.token }),
  });
  return res.manifests;
}

export async function getResourceYAML(kind: string, namespace: string, name: string): Promise<Record<string, unknown>> {
  return request(`/resources/${kind}/namespaces/${namespace}/${name}`);
}

export async function updateResourceYAML(kind: string, namespace: string, name: string, manifest: string): Promise<void> {
  await request(`/resources/${kind}/namespaces/${namespace}/${name}`, {
    method: "PUT",
    body: JSON.stringify({ manifest }),
  });
}

export async function getClusterResourceYAML(kind: string, name: string): Promise<Record<string, unknown>> {
  return request(`/resources/${kind}/${name}`);
}

export async function updateClusterResourceYAML(kind: string, name: string, manifest: string): Promise<void> {
  await request(`/resources/${kind}/${name}`, {
    method: "PUT",
    body: JSON.stringify({ manifest }),
  });
}

// Generic delete by kind — resolves the GVR server-side (CRD-aware), so it works
// for any kind incl. CRDs like IPAddressPool / L2Advertisement.
export async function deleteResource(kind: string, namespace: string, name: string): Promise<void> {
  await request(`/resources/${kind}/namespaces/${namespace}/${name}`, { method: "DELETE" });
}

export async function deleteClusterResource(kind: string, name: string): Promise<void> {
  await request(`/resources/${kind}/${name}`, { method: "DELETE" });
}

export async function listDeploymentReplicaSets(namespace: string, name: string): Promise<ReplicaSetSummary[]> {
  return request(`/namespaces/${namespace}/deployments/${name}/replicasets`);
}

export interface ReplicaSetSummary {
  name: string;
  namespace: string;
  revision: string;
  replicas: number;
  ready_replicas: number;
  images: string[];
  labels: Record<string, string>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface LoginResponse {
  token: string;
  expires_at: string;
  user: {
    id: string;
    email: string;
    role: string;
    tenant_id?: string;
  };
}

export async function loginUser(email: string, password: string): Promise<LoginResponse> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function refreshToken(): Promise<LoginResponse> {
  return request("/auth/refresh", { method: "POST" });
}

export interface CurrentUser {
  id: string;
  email: string;
  role: string;
  tenant_id?: string;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return request("/auth/me");
}

// ---------------------------------------------------------------------------
// Resource Protection
// ---------------------------------------------------------------------------

export async function setResourceProtection(
  kind: string,
  namespace: string | undefined,
  name: string,
  protect: boolean,
): Promise<{ protected: boolean }> {
  return request("/protect", {
    method: "PUT",
    body: JSON.stringify({ kind, namespace: namespace || "", name, protected: protect }),
  });
}

export async function getResourceProtection(
  kind: string,
  namespace: string | undefined,
  name: string,
): Promise<{ protected: boolean }> {
  const params = new URLSearchParams({ kind, name });
  if (namespace) params.set("namespace", namespace);
  return request(`/protect?${params.toString()}`);
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  user: string;
  email?: string;
  role?: string;
  action: string;
  kind?: string;
  namespace?: string;
  name?: string;
  resource: string;
  method: string;
  path: string;
  status: number;
}

export async function listAuditLog(limit = 1000, offset = 0): Promise<{ entries: AuditEntry[]; total: number }> {
  return request(`/audit?limit=${limit}&offset=${offset}`);
}

export interface SecurityFinding {
  severity: string;
  category: string;
  title: string;
  kind: string;
  namespace?: string;
  name: string;
  detail?: string;
  remediation?: string;
}

export interface SecurityPosture {
  score: number;
  counts: Record<string, number>;
  scanned: Record<string, number>;
  findings: SecurityFinding[];
}

export async function getSecurityPosture(): Promise<SecurityPosture> {
  return request("/security/posture");
}
