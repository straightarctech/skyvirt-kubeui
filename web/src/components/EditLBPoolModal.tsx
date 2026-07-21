import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import FormField from "@/components/FormField";
import { getResourceYAML, updateResourceYAML, listCRDInstances } from "@/api/client";

const POOL_ANN = "metallb.universe.tf/address-pool";
const IP_ANN = "metallb.universe.tf/loadBalancerIPs";

interface Props {
  namespace: string;
  name: string;
  onClose: () => void;
  onUpdated?: () => void;
}

/**
 * Edit which MetalLB address pool (VLAN / external network) a LoadBalancer
 * service draws its IP from — reads the current annotations, lets you switch
 * pool / pin an IP, and updates the Service in place.
 */
export default function EditLBPoolModal({ namespace, name, onClose, onUpdated }: Props) {
  const [pools, setPools] = useState<string[]>([]);
  const [obj, setObj] = useState<Record<string, unknown> | null>(null);
  const [addressPool, setAddressPool] = useState("");
  const [lbIP, setLbIP] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEscToClose(!saving, onClose);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listCRDInstances("metallb.io", "v1beta1", "ipaddresspools").catch(() => [] as Record<string, unknown>[]),
      getResourceYAML("Service", namespace, name),
    ])
      .then(([pl, svc]) => {
        setPools(pl.map((i) => String((i as { metadata?: { name?: string } }).metadata?.name || "")).filter(Boolean));
        setObj(svc);
        const ann = ((svc.metadata as { annotations?: Record<string, string> })?.annotations) || {};
        setAddressPool(ann[POOL_ANN] || "");
        setLbIP(ann[IP_ANN] || String((svc.spec as { loadBalancerIP?: string })?.loadBalancerIP || ""));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [namespace, name]);

  const save = async () => {
    if (!obj) return;
    setSaving(true);
    setError(null);
    try {
      const meta = { ...((obj.metadata as Record<string, unknown>) || {}) };
      const ann = { ...((meta.annotations as Record<string, string>) || {}) };
      if (addressPool) ann[POOL_ANN] = addressPool; else delete ann[POOL_ANN];
      if (lbIP.trim()) ann[IP_ANN] = lbIP.trim(); else delete ann[IP_ANN];
      meta.annotations = ann;
      await updateResourceYAML("Service", namespace, name, jsYaml.dump({ ...obj, metadata: meta }));
      toast.success("Address pool updated");
      onUpdated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={saving ? undefined : onClose}>
      <div role="dialog" aria-modal="true" className="bg-th-panel border border-th-line rounded-xl shadow-card w-full max-w-md m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-th-line">
          <h2 className="text-lg font-semibold text-th-heading">Address Pool</h2>
          <button onClick={onClose} className="text-th-dim hover:text-th-body" disabled={saving}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-xs text-th-dim"><span className="font-medium text-th-body">{namespace}/{name}</span></p>
          {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm break-words">{error}</div>}
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <FormField label="Address Pool" description="Which MetalLB pool (VLAN / external network) this LoadBalancer draws its IP from">
                {pools.length > 0 ? (
                  <select value={addressPool} onChange={(e) => setAddressPool(e.target.value)} className={inputClass}>
                    <option value="">Auto (default pool)</option>
                    {pools.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <p className="text-xs text-th-ghost">
                    No MetalLB address pools found. Create one per VLAN/network under Networking → L2 Networks.
                  </p>
                )}
              </FormField>
              <FormField label="Specific IP" description="Optional — must fall within the selected pool's range">
                <input type="text" value={lbIP} onChange={(e) => setLbIP(e.target.value)} placeholder="e.g. 192.168.10.240" className={inputClass} />
              </FormField>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-th-line">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-th-dim hover:text-th-body">Cancel</button>
          <button onClick={save} disabled={saving || loading} className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
