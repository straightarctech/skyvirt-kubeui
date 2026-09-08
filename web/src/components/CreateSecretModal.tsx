import { useState } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import FormField from "@/components/FormField";
import YAMLEditor from "@/components/YAMLEditor";
import { applyManifest } from "@/api/client";

interface Props {
  onClose: () => void;
  onCreated?: () => void;
  defaultNamespace?: string;
}

interface DataEntry {
  key: string;
  value: string;
}

const SECRET_TYPES = [
  { label: "Opaque", value: "Opaque" },
  { label: "TLS", value: "kubernetes.io/tls" },
  { label: "Docker Registry", value: "kubernetes.io/dockerconfigjson" },
] as const;

// UTF-8-safe base64 (btoa is latin1-only: it mangles chars U+0080–U+00FF and
// throws above U+00FF). Matches EditSecretModal's encoder.
function b64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

export default function CreateSecretModal({ onClose, onCreated, defaultNamespace }: Props) {
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState(defaultNamespace || "default");
  const [secretType, setSecretType] = useState("Opaque");

  // Opaque data
  const [dataEntries, setDataEntries] = useState<DataEntry[]>([{ key: "", value: "" }]);

  // TLS data
  const [tlsCert, setTlsCert] = useState("");
  const [tlsKey, setTlsKey] = useState("");

  // Docker registry data
  const [dockerServer, setDockerServer] = useState("");
  const [dockerUsername, setDockerUsername] = useState("");
  const [dockerPassword, setDockerPassword] = useState("");
  const [dockerEmail, setDockerEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  useEscToClose(!submitting, onClose);
  const [error, setError] = useState<string | null>(null);
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlValue, setYamlValue] = useState("");

  const addDataEntry = () => setDataEntries([...dataEntries, { key: "", value: "" }]);
  const removeDataEntry = (idx: number) => setDataEntries(dataEntries.filter((_, i) => i !== idx));
  const updateDataEntry = (idx: number, field: "key" | "value", val: string) => {
    const updated = [...dataEntries];
    updated[idx] = { ...updated[idx], [field]: val };
    setDataEntries(updated);
  };

  const buildManifest = () => {
    const data: Record<string, string> = {};

    if (secretType === "Opaque") {
      for (const entry of dataEntries) {
        if (entry.key.trim()) {
          data[entry.key.trim()] = b64(entry.value);
        }
      }
    } else if (secretType === "kubernetes.io/tls") {
      data["tls.crt"] = b64(tlsCert);
      data["tls.key"] = b64(tlsKey);
    } else if (secretType === "kubernetes.io/dockerconfigjson") {
      const dockerConfig = {
        auths: {
          [dockerServer.trim() || "https://index.docker.io/v1/"]: {
            username: dockerUsername,
            password: dockerPassword,
            email: dockerEmail,
            auth: b64(`${dockerUsername}:${dockerPassword}`),
          },
        },
      };
      data[".dockerconfigjson"] = b64(JSON.stringify(dockerConfig));
    }

    return {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: name.trim(),
        namespace: namespace.trim(),
      },
      type: secretType,
      data,
    };
  };

  const generateYAML = () => jsYaml.dump(buildManifest(), { noRefs: true });

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const yaml = yamlMode ? yamlValue : generateYAML();
      await applyManifest(yaml);
      toast.success("Secret created"); onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

  const textareaClass =
    "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent font-mono resize-y";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div role="dialog" aria-modal="true" className="bg-th-panel border border-th-line rounded-xl shadow-card w-full max-w-2xl max-h-[85vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-th-line">
          <h2 className="text-lg font-semibold text-th-heading">Create Secret</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setYamlMode(!yamlMode);
                if (!yamlMode) setYamlValue(generateYAML());
              }}
              className="px-2 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
            >
              {yamlMode ? "Form" : "YAML"}
            </button>
            <button onClick={onClose} aria-label="Close dialog" className="text-th-dim hover:text-th-body">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

          {yamlMode ? (
            <YAMLEditor value={yamlValue} onChange={setYamlValue} height="400px" />
          ) : (
            <>
              <FormField label="Name" required>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-secret"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Namespace">
                <input
                  type="text"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  placeholder="default"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Type">
                <div className="flex gap-1">
                  {SECRET_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setSecretType(t.value)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        secretType === t.value
                          ? "bg-th-accent text-white border-th-accent"
                          : "bg-th-subtle text-th-body border-th-line hover:bg-th-hover"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </FormField>

              {secretType === "Opaque" && (
                <FormField label="Data" description="Key-value pairs (values will be base64 encoded)">
                  <div className="space-y-2">
                    {dataEntries.map((entry, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={entry.key}
                          onChange={(e) => updateDataEntry(idx, "key", e.target.value)}
                          placeholder="key"
                          className={inputClass}
                        />
                        <span className="text-th-dim">=</span>
                        <input
                          type="password"
                          value={entry.value}
                          onChange={(e) => updateDataEntry(idx, "value", e.target.value)}
                          placeholder="value"
                          autoComplete="new-password"
                          className={inputClass}
                        />
                        <button
                          type="button"
                          onClick={() => removeDataEntry(idx)}
                          className="px-2 py-1 text-xs text-th-danger hover:opacity-80 shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addDataEntry}
                      className="px-3 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                    >
                      + Add Entry
                    </button>
                  </div>
                </FormField>
              )}

              {secretType === "kubernetes.io/tls" && (
                <>
                  <FormField label="TLS Certificate" required description="PEM-encoded certificate">
                    <textarea
                      value={tlsCert}
                      onChange={(e) => setTlsCert(e.target.value)}
                      placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                      rows={6}
                      className={textareaClass}
                    />
                  </FormField>
                  <FormField label="TLS Key" required description="PEM-encoded private key">
                    <textarea
                      value={tlsKey}
                      onChange={(e) => setTlsKey(e.target.value)}
                      placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                      rows={6}
                      className={textareaClass}
                    />
                  </FormField>
                </>
              )}

              {secretType === "kubernetes.io/dockerconfigjson" && (
                <>
                  <FormField label="Registry Server" required>
                    <input
                      type="text"
                      value={dockerServer}
                      onChange={(e) => setDockerServer(e.target.value)}
                      placeholder="https://index.docker.io/v1/"
                      className={inputClass}
                    />
                  </FormField>
                  <FormField label="Username" required>
                    <input
                      type="text"
                      value={dockerUsername}
                      onChange={(e) => setDockerUsername(e.target.value)}
                      placeholder="username"
                      className={inputClass}
                    />
                  </FormField>
                  <FormField label="Password" required>
                    <input
                      type="password"
                      value={dockerPassword}
                      onChange={(e) => setDockerPassword(e.target.value)}
                      placeholder="password"
                      className={inputClass}
                    />
                  </FormField>
                  <FormField label="Email">
                    <input
                      type="email"
                      value={dockerEmail}
                      onChange={(e) => setDockerEmail(e.target.value)}
                      placeholder="user@example.com"
                      className={inputClass}
                    />
                  </FormField>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-th-line">
          <button onClick={onClose} className="px-4 py-2 text-sm text-th-dim hover:text-th-body">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              submitting || !name.trim() ||
              (secretType === "kubernetes.io/tls" && (!tlsCert.trim() || !tlsKey.trim())) ||
              (secretType === "kubernetes.io/dockerconfigjson" && (!dockerUsername.trim() || !dockerPassword.trim()))
            }
            className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
