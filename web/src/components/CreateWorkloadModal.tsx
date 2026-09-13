import { useState, useMemo } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import StepWizard from "./StepWizard";
import FormField from "./FormField";
import YAMLEditor from "./YAMLEditor";
import { applyManifest } from "@/api/client";

type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet" | "Job" | "CronJob";

interface ContainerPort {
  containerPort: number;
  protocol: string;
}

interface EnvVar {
  name: string;
  value: string;
}

interface ContainerSpec {
  name: string;
  image: string;
  ports: ContainerPort[];
  env: EnvVar[];
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

interface VolumeMount {
  name: string;
  mountPath: string;
  containerName: string;
}

interface VolumeSpec {
  name: string;
  type: "emptyDir" | "configMap" | "secret" | "pvc";
  sourceName: string;
  mounts: VolumeMount[];
}

interface KeyValue {
  key: string;
  value: string;
}

interface CreateWorkloadModalProps {
  defaultKind: WorkloadKind;
  defaultNamespace?: string;
  onClose: () => void;
  onCreated?: () => void;
}

const kindOptions: WorkloadKind[] = ["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"];

const inputClass =
  "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

const smallInputClass =
  "w-full px-2 py-1.5 bg-th-subtle border border-th-line rounded text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

function emptyContainer(index: number): ContainerSpec {
  return {
    name: index === 0 ? "main" : `container-${index + 1}`,
    image: "",
    ports: [],
    env: [],
    cpuRequest: "",
    cpuLimit: "",
    memoryRequest: "",
    memoryLimit: "",
  };
}

function buildManifest(
  kind: WorkloadKind,
  name: string,
  namespace: string,
  replicas: number,
  schedule: string,
  completions: number,
  parallelism: number,
  containers: ContainerSpec[],
  volumes: VolumeSpec[],
  labels: KeyValue[],
  annotations: KeyValue[],
  nodeSelector: KeyValue[],
  serviceAccountName: string,
): Record<string, unknown> {
  // Build container specs
  const containerSpecs = containers.map((c) => {
    const spec: Record<string, unknown> = {
      name: c.name || "main",
      image: c.image,
    };

    if (c.ports.length > 0) {
      spec.ports = c.ports
        .filter((p) => p.containerPort > 0)
        .map((p) => ({
          containerPort: p.containerPort,
          protocol: p.protocol || "TCP",
        }));
    }

    if (c.env.length > 0) {
      const envFiltered = c.env.filter((e) => e.name.trim() !== "");
      if (envFiltered.length > 0) {
        spec.env = envFiltered.map((e) => ({ name: e.name, value: e.value }));
      }
    }

    const resources: Record<string, Record<string, string>> = {};
    const requests: Record<string, string> = {};
    const limits: Record<string, string> = {};

    if (c.cpuRequest) requests.cpu = c.cpuRequest;
    if (c.memoryRequest) requests.memory = c.memoryRequest;
    if (c.cpuLimit) limits.cpu = c.cpuLimit;
    if (c.memoryLimit) limits.memory = c.memoryLimit;

    if (Object.keys(requests).length > 0) resources.requests = requests;
    if (Object.keys(limits).length > 0) resources.limits = limits;
    if (Object.keys(resources).length > 0) spec.resources = resources;

    // Volume mounts for this container
    const mounts = volumes.flatMap((v) =>
      v.mounts
        .filter((m) => m.containerName === c.name && m.mountPath.trim() !== "")
        .map((m) => ({ name: v.name, mountPath: m.mountPath })),
    );
    if (mounts.length > 0) spec.volumeMounts = mounts;

    return spec;
  });

  // Build volume specs
  const volumeSpecs = volumes
    .filter((v) => v.name.trim() !== "")
    .map((v) => {
      const vol: Record<string, unknown> = { name: v.name };
      switch (v.type) {
        case "emptyDir":
          vol.emptyDir = {};
          break;
        case "configMap":
          vol.configMap = { name: v.sourceName || v.name };
          break;
        case "secret":
          vol.secret = { secretName: v.sourceName || v.name };
          break;
        case "pvc":
          vol.persistentVolumeClaim = { claimName: v.sourceName || v.name };
          break;
      }
      return vol;
    });

  // Build labels and annotations maps
  const extraLabels: Record<string, string> = {};
  labels.filter((l) => l.key.trim() !== "").forEach((l) => (extraLabels[l.key] = l.value));

  const annotationsMap: Record<string, string> = {};
  annotations.filter((a) => a.key.trim() !== "").forEach((a) => (annotationsMap[a.key] = a.value));

  const nodeSelectorMap: Record<string, string> = {};
  nodeSelector.filter((n) => n.key.trim() !== "").forEach((n) => (nodeSelectorMap[n.key] = n.value));

  const allLabels = { app: name, ...extraLabels };

  // Build metadata
  const metadata: Record<string, unknown> = {
    name,
    namespace,
  };
  if (Object.keys(allLabels).length > 0) metadata.labels = allLabels;
  if (Object.keys(annotationsMap).length > 0) metadata.annotations = annotationsMap;

  // Build pod spec
  const podSpec: Record<string, unknown> = {
    containers: containerSpecs,
  };
  if (volumeSpecs.length > 0) podSpec.volumes = volumeSpecs;
  if (Object.keys(nodeSelectorMap).length > 0) podSpec.nodeSelector = nodeSelectorMap;
  if (serviceAccountName.trim()) podSpec.serviceAccountName = serviceAccountName.trim();

  // Build podTemplateSpec
  const podTemplate = {
    metadata: {
      labels: allLabels,
    },
    spec: podSpec,
  };

  switch (kind) {
    case "Deployment":
      return {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata,
        spec: {
          replicas,
          selector: { matchLabels: { app: name } },
          template: podTemplate,
        },
      };

    case "StatefulSet":
      return {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata,
        spec: {
          replicas,
          serviceName: name,
          selector: { matchLabels: { app: name } },
          template: podTemplate,
        },
      };

    case "DaemonSet":
      return {
        apiVersion: "apps/v1",
        kind: "DaemonSet",
        metadata,
        spec: {
          selector: { matchLabels: { app: name } },
          template: podTemplate,
        },
      };

    case "Job":
      return {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata,
        spec: {
          completions,
          parallelism,
          template: {
            metadata: { labels: allLabels },
            spec: { ...podSpec, restartPolicy: "Never" },
          },
        },
      };

    case "CronJob":
      return {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata,
        spec: {
          schedule,
          jobTemplate: {
            spec: {
              completions,
              parallelism,
              template: {
                metadata: { labels: allLabels },
                spec: { ...podSpec, restartPolicy: "Never" },
              },
            },
          },
        },
      };
  }
}

export default function CreateWorkloadModal({
  defaultKind,
  defaultNamespace,
  onClose,
  onCreated,
}: CreateWorkloadModalProps) {
  // Mode: form vs yaml
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  useEscToClose(!submitting, onClose);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 1: Basic Info
  const [kind, setKind] = useState<WorkloadKind>(defaultKind);
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState(defaultNamespace || "default");
  const [replicas, setReplicas] = useState(1);
  const [schedule, setSchedule] = useState("*/5 * * * *");
  const [completions, setCompletions] = useState(1);
  const [parallelism, setParallelism] = useState(1);

  // Step 2: Containers
  const [containers, setContainers] = useState<ContainerSpec[]>([emptyContainer(0)]);

  // Step 3: Volumes
  const [volumes, setVolumes] = useState<VolumeSpec[]>([]);

  // Step 4: Advanced
  const [labels, setLabels] = useState<KeyValue[]>([]);
  const [annotations, setAnnotations] = useState<KeyValue[]>([]);
  const [nodeSelector, setNodeSelector] = useState<KeyValue[]>([]);
  const [serviceAccountName, setServiceAccountName] = useState("");

  // YAML mode state
  const [yamlText, setYamlText] = useState("");

  const steps = [
    { title: "Basic Info" },
    { title: "Containers" },
    { title: "Volumes", optional: true },
    { title: "Advanced", optional: true },
  ];

  const showReplicas = kind === "Deployment" || kind === "StatefulSet";
  const showSchedule = kind === "CronJob";
  const showJobParams = kind === "Job" || kind === "CronJob";

  // Generate YAML from current form state
  const generatedYaml = useMemo(() => {
    try {
      const manifest = buildManifest(
        kind,
        name || "my-workload",
        namespace,
        replicas,
        schedule,
        completions,
        parallelism,
        containers,
        volumes,
        labels,
        annotations,
        nodeSelector,
        serviceAccountName,
      );
      return jsYaml.dump(manifest, { noRefs: true, indent: 2, lineWidth: -1 });
    } catch {
      return "# Error generating YAML";
    }
  }, [kind, name, namespace, replicas, schedule, completions, parallelism, containers, volumes, labels, annotations, nodeSelector, serviceAccountName]);

  // When switching to YAML mode, sync from form
  const handleModeToggle = () => {
    if (mode === "form") {
      setYamlText(generatedYaml);
      setMode("yaml");
    } else {
      setMode("form");
    }
  };

  // Validate step 1
  const canProceedStep0 = name.trim() !== "" && namespace.trim() !== "" && (showSchedule ? schedule.trim() !== "" : true);

  // Validate step 2
  const canProceedStep1 = containers.length > 0 && containers.every((c) => c.name.trim() !== "" && c.image.trim() !== "");

  const canProceed = currentStep === 0 ? canProceedStep0 : currentStep === 1 ? canProceedStep1 : true;

  // Container handlers
  const updateContainer = (index: number, update: Partial<ContainerSpec>) => {
    setContainers((prev) => prev.map((c, i) => (i === index ? { ...c, ...update } : c)));
  };

  const addContainer = () => {
    setContainers((prev) => [...prev, emptyContainer(prev.length)]);
  };

  const removeContainer = (index: number) => {
    if (containers.length <= 1) return;
    setContainers((prev) => prev.filter((_, i) => i !== index));
  };

  // Port handlers
  const addPort = (containerIndex: number) => {
    updateContainer(containerIndex, {
      ports: [...containers[containerIndex].ports, { containerPort: 80, protocol: "TCP" }],
    });
  };

  const updatePort = (containerIndex: number, portIndex: number, update: Partial<ContainerPort>) => {
    const newPorts = containers[containerIndex].ports.map((p, i) =>
      i === portIndex ? { ...p, ...update } : p,
    );
    updateContainer(containerIndex, { ports: newPorts });
  };

  const removePort = (containerIndex: number, portIndex: number) => {
    updateContainer(containerIndex, {
      ports: containers[containerIndex].ports.filter((_, i) => i !== portIndex),
    });
  };

  // Env handlers
  const addEnv = (containerIndex: number) => {
    updateContainer(containerIndex, {
      env: [...containers[containerIndex].env, { name: "", value: "" }],
    });
  };

  const updateEnv = (containerIndex: number, envIndex: number, update: Partial<EnvVar>) => {
    const newEnv = containers[containerIndex].env.map((e, i) =>
      i === envIndex ? { ...e, ...update } : e,
    );
    updateContainer(containerIndex, { env: newEnv });
  };

  const removeEnv = (containerIndex: number, envIndex: number) => {
    updateContainer(containerIndex, {
      env: containers[containerIndex].env.filter((_, i) => i !== envIndex),
    });
  };

  // Volume handlers
  const addVolume = () => {
    setVolumes((prev) => [
      ...prev,
      {
        name: `vol-${prev.length + 1}`,
        type: "emptyDir",
        sourceName: "",
        mounts: containers.map((c) => ({ name: "", mountPath: "", containerName: c.name })),
      },
    ]);
  };

  const updateVolume = (index: number, update: Partial<VolumeSpec>) => {
    setVolumes((prev) => prev.map((v, i) => (i === index ? { ...v, ...update } : v)));
  };

  const removeVolume = (index: number) => {
    setVolumes((prev) => prev.filter((_, i) => i !== index));
  };

  const updateVolumeMount = (volIndex: number, mountIndex: number, update: Partial<VolumeMount>) => {
    const newMounts = volumes[volIndex].mounts.map((m, i) =>
      i === mountIndex ? { ...m, ...update } : m,
    );
    updateVolume(volIndex, { mounts: newMounts });
  };

  // KeyValue handlers
  const addKV = (setter: React.Dispatch<React.SetStateAction<KeyValue[]>>) => {
    setter((prev) => [...prev, { key: "", value: "" }]);
  };

  const updateKV = (
    setter: React.Dispatch<React.SetStateAction<KeyValue[]>>,
    index: number,
    update: Partial<KeyValue>,
  ) => {
    setter((prev) => prev.map((kv, i) => (i === index ? { ...kv, ...update } : kv)));
  };

  const removeKV = (setter: React.Dispatch<React.SetStateAction<KeyValue[]>>, index: number) => {
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const yaml = mode === "yaml" ? yamlText : generatedYaml;
      await applyManifest(yaml);
      toast.success("Workload created"); onCreated?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create workload");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Render helpers for each step ----

  const renderStep0 = () => (
    <div className="space-y-5">
      {/* Kind selector */}
      <FormField label="Kind" required>
        <div className="flex flex-wrap gap-2">
          {kindOptions.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                kind === k
                  ? "border-th-accent bg-th-accent text-white"
                  : "border-th-line bg-th-subtle text-th-body hover:bg-th-hover"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </FormField>

      {/* Name */}
      <FormField label="Name" required description="Must be lowercase, alphanumeric, hyphens allowed">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-workload"
          className={inputClass}
        />
      </FormField>

      {/* Namespace */}
      <FormField label="Namespace" required>
        <input
          type="text"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          placeholder="default"
          className={inputClass}
        />
      </FormField>

      {/* Replicas */}
      {showReplicas && (
        <FormField label="Replicas" description="Number of pod replicas to run">
          <input
            type="number"
            min={1}
            value={replicas}
            onChange={(e) => setReplicas(Math.max(1, parseInt(e.target.value) || 1))}
            className={inputClass + " max-w-[120px]"}
          />
        </FormField>
      )}

      {/* Schedule (CronJob) */}
      {showSchedule && (
        <FormField label="Schedule" required description="Cron expression (e.g. */5 * * * *)">
          <input
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="*/5 * * * *"
            className={inputClass + " max-w-xs"}
          />
        </FormField>
      )}

      {/* Completions / Parallelism (Job, CronJob) */}
      {showJobParams && (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Completions" description="Number of successful completions needed">
            <input
              type="number"
              min={1}
              value={completions}
              onChange={(e) => setCompletions(parseInt(e.target.value) || 1)}
              className={inputClass}
            />
          </FormField>
          <FormField label="Parallelism" description="Max pods running in parallel">
            <input
              type="number"
              min={1}
              value={parallelism}
              onChange={(e) => setParallelism(parseInt(e.target.value) || 1)}
              className={inputClass}
            />
          </FormField>
        </div>
      )}
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-4">
      {containers.map((container, ci) => (
        <div key={ci} className="border border-th-line rounded-lg bg-th-subtle/30 p-4 space-y-4">
          {/* Container header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-th-heading">Container {ci + 1}</h3>
            {containers.length > 1 && (
              <button
                type="button"
                onClick={() => removeContainer(ci)}
                className="text-xs text-th-danger hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          {/* Name & Image */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name" required>
              <input
                type="text"
                value={container.name}
                onChange={(e) => updateContainer(ci, { name: e.target.value })}
                placeholder="main"
                className={inputClass}
              />
            </FormField>
            <FormField label="Image" required>
              <input
                type="text"
                value={container.image}
                onChange={(e) => updateContainer(ci, { image: e.target.value })}
                placeholder="nginx:latest"
                className={inputClass}
              />
            </FormField>
          </div>

          {/* Ports */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-th-body">Ports</span>
              <button
                type="button"
                onClick={() => addPort(ci)}
                className="text-xs text-th-accent hover:underline"
              >
                + Add Port
              </button>
            </div>
            {container.ports.length === 0 && (
              <p className="text-xs text-th-ghost">No ports configured</p>
            )}
            {container.ports.map((port, pi) => (
              <div key={pi} className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port.containerPort}
                  onChange={(e) => updatePort(ci, pi, { containerPort: parseInt(e.target.value) || 0 })}
                  placeholder="80"
                  className={smallInputClass + " w-24"}
                />
                <select
                  value={port.protocol}
                  onChange={(e) => updatePort(ci, pi, { protocol: e.target.value })}
                  className={smallInputClass + " w-24"}
                >
                  <option value="TCP">TCP</option>
                  <option value="UDP">UDP</option>
                  <option value="SCTP">SCTP</option>
                </select>
                <button
                  type="button"
                  onClick={() => removePort(ci, pi)}
                  className="text-xs text-th-danger hover:underline shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {/* Environment Variables */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-th-body">Environment Variables</span>
              <button
                type="button"
                onClick={() => addEnv(ci)}
                className="text-xs text-th-accent hover:underline"
              >
                + Add Variable
              </button>
            </div>
            {container.env.length === 0 && (
              <p className="text-xs text-th-ghost">No environment variables</p>
            )}
            {container.env.map((env, ei) => (
              <div key={ei} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={env.name}
                  onChange={(e) => updateEnv(ci, ei, { name: e.target.value })}
                  placeholder="KEY"
                  className={smallInputClass + " w-36"}
                />
                <input
                  type="text"
                  value={env.value}
                  onChange={(e) => updateEnv(ci, ei, { value: e.target.value })}
                  placeholder="value"
                  className={smallInputClass + " flex-1"}
                />
                <button
                  type="button"
                  onClick={() => removeEnv(ci, ei)}
                  className="text-xs text-th-danger hover:underline shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {/* Resources */}
          <div>
            <span className="text-sm font-medium text-th-body block mb-2">Resources</span>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="CPU Request" description="e.g. 100m, 0.5">
                <input
                  type="text"
                  value={container.cpuRequest}
                  onChange={(e) => updateContainer(ci, { cpuRequest: e.target.value })}
                  placeholder="100m"
                  className={inputClass}
                />
              </FormField>
              <FormField label="CPU Limit" description="e.g. 500m, 1">
                <input
                  type="text"
                  value={container.cpuLimit}
                  onChange={(e) => updateContainer(ci, { cpuLimit: e.target.value })}
                  placeholder="500m"
                  className={inputClass}
                />
              </FormField>
              <FormField label="Memory Request" description="e.g. 128Mi, 1Gi">
                <input
                  type="text"
                  value={container.memoryRequest}
                  onChange={(e) => updateContainer(ci, { memoryRequest: e.target.value })}
                  placeholder="128Mi"
                  className={inputClass}
                />
              </FormField>
              <FormField label="Memory Limit" description="e.g. 256Mi, 2Gi">
                <input
                  type="text"
                  value={container.memoryLimit}
                  onChange={(e) => updateContainer(ci, { memoryLimit: e.target.value })}
                  placeholder="256Mi"
                  className={inputClass}
                />
              </FormField>
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addContainer}
        className="w-full py-2 border border-dashed border-th-line rounded-lg text-sm text-th-accent hover:bg-th-hover transition-colors"
      >
        + Add Container
      </button>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      {volumes.length === 0 && (
        <p className="text-sm text-th-ghost py-4 text-center">No volumes configured. This step is optional.</p>
      )}

      {volumes.map((vol, vi) => (
        <div key={vi} className="border border-th-line rounded-lg bg-th-subtle/30 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-th-heading">Volume {vi + 1}</h3>
            <button
              type="button"
              onClick={() => removeVolume(vi)}
              className="text-xs text-th-danger hover:underline"
            >
              Remove
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField label="Name" required>
              <input
                type="text"
                value={vol.name}
                onChange={(e) => updateVolume(vi, { name: e.target.value })}
                placeholder="data-vol"
                className={inputClass}
              />
            </FormField>

            <FormField label="Type">
              <select
                value={vol.type}
                onChange={(e) => updateVolume(vi, { type: e.target.value as VolumeSpec["type"] })}
                className={inputClass}
              >
                <option value="emptyDir">emptyDir</option>
                <option value="configMap">ConfigMap</option>
                <option value="secret">Secret</option>
                <option value="pvc">PVC</option>
              </select>
            </FormField>

            {vol.type !== "emptyDir" && (
              <FormField
                label={vol.type === "configMap" ? "ConfigMap Name" : vol.type === "secret" ? "Secret Name" : "PVC Name"}
              >
                <input
                  type="text"
                  value={vol.sourceName}
                  onChange={(e) => updateVolume(vi, { sourceName: e.target.value })}
                  placeholder="source-name"
                  className={inputClass}
                />
              </FormField>
            )}
          </div>

          {/* Mount paths per container */}
          <div>
            <span className="text-sm font-medium text-th-body block mb-2">Mount Paths</span>
            {vol.mounts.map((mount, mi) => (
              <div key={mi} className="flex items-center gap-2 mb-2">
                <span className="text-xs text-th-dim w-28 shrink-0 truncate" title={mount.containerName}>
                  {mount.containerName}:
                </span>
                <input
                  type="text"
                  value={mount.mountPath}
                  onChange={(e) => updateVolumeMount(vi, mi, { mountPath: e.target.value })}
                  placeholder="/mnt/data"
                  className={smallInputClass + " flex-1"}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addVolume}
        className="w-full py-2 border border-dashed border-th-line rounded-lg text-sm text-th-accent hover:bg-th-hover transition-colors"
      >
        + Add Volume
      </button>
    </div>
  );

  const renderKVSection = (
    title: string,
    items: KeyValue[],
    setter: React.Dispatch<React.SetStateAction<KeyValue[]>>,
    keyPlaceholder = "key",
    valuePlaceholder = "value",
  ) => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-th-body">{title}</span>
        <button
          type="button"
          onClick={() => addKV(setter)}
          className="text-xs text-th-accent hover:underline"
        >
          + Add
        </button>
      </div>
      {items.length === 0 && <p className="text-xs text-th-ghost">None configured</p>}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 mb-2">
          <input
            type="text"
            value={item.key}
            onChange={(e) => updateKV(setter, i, { key: e.target.value })}
            placeholder={keyPlaceholder}
            className={smallInputClass + " w-40"}
          />
          <input
            type="text"
            value={item.value}
            onChange={(e) => updateKV(setter, i, { value: e.target.value })}
            placeholder={valuePlaceholder}
            className={smallInputClass + " flex-1"}
          />
          <button
            type="button"
            onClick={() => removeKV(setter, i)}
            className="text-xs text-th-danger hover:underline shrink-0"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      {renderKVSection("Labels", labels, setLabels, "label-key", "label-value")}
      <div className="border-t border-th-line" />
      {renderKVSection("Annotations", annotations, setAnnotations, "annotation-key", "annotation-value")}
      <div className="border-t border-th-line" />
      {renderKVSection("Node Selector", nodeSelector, setNodeSelector, "node-label-key", "node-label-value")}
      <div className="border-t border-th-line" />
      <FormField label="Service Account Name" description="Name of the ServiceAccount to use for pods">
        <input
          type="text"
          value={serviceAccountName}
          onChange={(e) => setServiceAccountName(e.target.value)}
          placeholder="default"
          className={inputClass + " max-w-sm"}
        />
      </FormField>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return renderStep0();
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={submitting ? undefined : onClose} />

      {/* Modal card */}
      <div role="dialog" aria-modal="true" className="relative bg-th-panel rounded-lg shadow-card max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
          <h2 className="text-lg font-semibold text-th-heading">Create {kind}</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleModeToggle}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                mode === "yaml"
                  ? "border-th-accent bg-th-accent text-white"
                  : "border-th-line bg-th-subtle text-th-body hover:bg-th-hover"
              }`}
            >
              {mode === "form" ? "YAML" : "Form"}
            </button>
            <button
              onClick={onClose}
              className="text-th-dim hover:text-th-body transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Error banner */}
        {submitError && (
          <div className="mx-6 mt-4 p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">
            {submitError}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {mode === "yaml" ? (
            <div className="px-6 py-4">
              <YAMLEditor
                value={yamlText}
                onChange={setYamlText}
                height="calc(90vh - 220px)"
              />
              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-th-dim hover:text-th-body transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || yamlText.trim() === ""}
                  className="px-4 py-2 text-sm rounded bg-th-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          ) : (
            <StepWizard
              steps={steps}
              currentStep={currentStep}
              onStepChange={setCurrentStep}
              onCancel={onClose}
              onSubmit={handleSubmit}
              canProceed={canProceed}
              submitting={submitting}
            >
              {renderCurrentStep()}
            </StepWizard>
          )}
        </div>
      </div>
    </div>
  );
}
