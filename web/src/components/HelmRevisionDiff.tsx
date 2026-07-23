import { useState } from "react";
import { getHelmReleaseValues, getHelmReleaseManifest } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useEscToClose } from "@/hooks/useEscToClose";
import DiffView from "@/components/DiffView";

/** Compares a past revision against the current one — values and rendered
 *  manifest — so you can see exactly what an upgrade/rollback changed. */
export default function HelmRevisionDiff({
  namespace,
  name,
  fromRevision,
  currentRevision,
  onClose,
}: {
  namespace: string;
  name: string;
  fromRevision: number;
  currentRevision: number;
  onClose: () => void;
}) {
  useEscToClose(true, onClose);
  const [tab, setTab] = useState<"values" | "manifest">("values");

  const values = useResource(
    () =>
      Promise.all([
        getHelmReleaseValues(namespace, name, fromRevision).then((r) => r.values).catch(() => ""),
        getHelmReleaseValues(namespace, name, currentRevision).then((r) => r.values).catch(() => ""),
      ]),
    [namespace, name, fromRevision, currentRevision],
  );
  const manifest = useResource(
    () =>
      Promise.all([
        getHelmReleaseManifest(namespace, name, fromRevision).then((r) => r.manifest).catch(() => ""),
        getHelmReleaseManifest(namespace, name, currentRevision).then((r) => r.manifest).catch(() => ""),
      ]),
    [namespace, name, fromRevision, currentRevision],
  );

  const active = tab === "values" ? values : manifest;
  const [before, after] = active.data ?? ["", ""];

  const TAB = (id: "values" | "manifest", labelText: string) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        tab === id ? "bg-th-accent text-white" : "text-th-dim hover:bg-th-hover hover:text-th-body"
      }`}
    >
      {labelText}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Revision diff"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-4xl rounded-xl border border-th-line bg-th-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-th-line px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-th-heading">Revision diff — {name}</h2>
            <p className="text-xs text-th-dim">
              revision {fromRevision} → {currentRevision} (current)
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-th-ghost hover:text-th-body">✕</button>
        </div>
        <div className="space-y-3 p-5">
          <div className="flex gap-1">
            {TAB("values", "Values")}
            {TAB("manifest", "Manifest")}
          </div>
          <DiffView
            before={before}
            after={after}
            loading={active.loading}
            height="55vh"
            label={`rev ${fromRevision} → ${currentRevision} · ${tab}`}
          />
        </div>
      </div>
    </div>
  );
}
