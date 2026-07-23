import { useState } from "react";
import { Link } from "react-router-dom";
import {
  veleroStatus,
  listVelero,
  createVeleroBackup,
  createVeleroSchedule,
  createVeleroRestore,
  deleteVelero,
} from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useToast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useEscToClose } from "@/hooks/useEscToClose";

const INPUT =
  "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";
const BTN = "px-3 py-1.5 text-sm font-medium bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50";
const BTN_GHOST = "px-3 py-1.5 text-sm bg-th-subtle border border-th-line text-th-body rounded-lg hover:bg-th-hover transition-colors";

const get = (o: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
const str = (o: unknown, path: string): string => {
  const v = get(o, path);
  return v == null ? "" : String(v);
};
const ago = (iso: string): string => {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function Phase({ phase }: { phase: string }) {
  const p = phase.toLowerCase();
  const cls =
    p === "completed" || p === "available"
      ? "bg-th-ok-s text-th-ok"
      : p.includes("fail")
        ? "bg-th-danger-s text-th-danger"
        : p === "deleting" || p === "inprogress" || p === "new" || p === ""
          ? "bg-th-warn-s text-th-warn"
          : "bg-th-subtle text-th-dim";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{phase || "New"}</span>;
}

type Tab = "backups" | "schedules" | "restores" | "backupstoragelocations";
const TABS: { id: Tab; label: string }[] = [
  { id: "backups", label: "Backups" },
  { id: "schedules", label: "Schedules" },
  { id: "restores", label: "Restores" },
  { id: "backupstoragelocations", label: "Storage" },
];

export default function VeleroConsole() {
  const toast = useToast();
  const status = useResource(() => veleroStatus(), []);
  const [tab, setTab] = useState<Tab>("backups");
  const list = useResource(() => listVelero(tab), [tab]);
  const [modal, setModal] = useState<null | "backup" | "schedule">(null);
  const [restoreOf, setRestoreOf] = useState<string | null>(null);

  if (status.loading) return <TableSkeleton rows={4} />;

  if (!status.data?.installed) {
    return (
      <div className="rounded-xl border border-th-line bg-th-panel p-1 shadow-card">
        <EmptyState
          title="Cluster backup (Velero) is not installed"
          hint="Install Velero to enable scheduled backups, one-click restore, and CSI volume snapshots — to S3 or an air-gapped NFS target. It installs in one step from the App Catalog."
          action={
            <Link to="/operations/catalog" className={BTN}>
              Install from App Catalog
            </Link>
          }
        />
      </div>
    );
  }

  const refresh = () => list.refresh();
  const rows = list.data ?? [];

  const del = async (name: string) => {
    try {
      await deleteVelero(tab, name);
      toast.success(`Deleted ${name}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                tab === t.id ? "bg-th-accent text-white" : "text-th-dim hover:bg-th-hover hover:text-th-body"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal("backup")} className={BTN}>Create backup</button>
          <button onClick={() => setModal("schedule")} className={BTN_GHOST}>New schedule</button>
          <button onClick={refresh} className={BTN_GHOST}>Refresh</button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-th-line bg-th-panel shadow-card">
        {list.loading ? (
          <TableSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState compact title={`No ${tab === "backupstoragelocations" ? "storage locations" : tab} yet`} />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-th-subtle text-left text-xs text-th-ghost">
              <tr>
                <th className="px-4 py-2">Name</th>
                {tab === "schedules" ? <th className="px-4 py-2">Schedule</th> : <th className="px-4 py-2">Status</th>}
                <th className="px-4 py-2">{tab === "restores" ? "Backup" : tab === "backupstoragelocations" ? "Provider" : "Scope"}</th>
                <th className="px-4 py-2">{tab === "schedules" ? "Last backup" : "Created"}</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-th-line">
              {rows.map((o, i) => {
                const name = str(o, "metadata.name");
                const nsScope = (get(o, "spec.includedNamespaces") as string[] | undefined)?.join(", ")
                  || (get(o, "spec.template.includedNamespaces") as string[] | undefined)?.join(", ")
                  || "whole cluster";
                return (
                  <tr key={i} className="hover:bg-th-hover">
                    <td className="px-4 py-2 font-medium text-th-body">{name}</td>
                    {tab === "schedules" ? (
                      <td className="px-4 py-2 font-mono text-xs text-th-dim">{str(o, "spec.schedule")}</td>
                    ) : (
                      <td className="px-4 py-2"><Phase phase={str(o, "status.phase")} /></td>
                    )}
                    <td className="px-4 py-2 text-th-dim">
                      {tab === "restores" ? str(o, "spec.backupName") : tab === "backupstoragelocations" ? str(o, "spec.provider") : nsScope}
                    </td>
                    <td className="px-4 py-2 text-th-dim">
                      {tab === "schedules" ? ago(str(o, "status.lastBackup")) : ago(str(o, "metadata.creationTimestamp"))}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">
                        {tab === "backups" && str(o, "status.phase") === "Completed" && (
                          <button onClick={() => setRestoreOf(name)} className="rounded bg-th-info-s px-2 py-0.5 text-xs text-th-info hover:opacity-80">Restore</button>
                        )}
                        {(tab === "backups" || tab === "schedules") && (
                          <button onClick={() => del(name)} className="rounded bg-th-danger-s px-2 py-0.5 text-xs text-th-danger hover:opacity-80">Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <BackupModal
          kind={modal}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {restoreOf && (
        <RestoreModal backup={restoreOf} onClose={() => setRestoreOf(null)} onDone={() => { setRestoreOf(null); setTab("restores"); refresh(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscToClose(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-th-line bg-th-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-th-line px-5 py-3">
          <h2 className="text-base font-semibold text-th-heading">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-th-ghost hover:text-th-body">✕</button>
        </div>
        <div className="space-y-3 p-5">{children}</div>
      </div>
    </div>
  );
}

function BackupModal({ kind, onClose, onDone }: { kind: "backup" | "schedule"; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 2 * * *");
  const [namespaces, setNamespaces] = useState("");
  const [ttl, setTtl] = useState(720); // 30 days
  const [snap, setSnap] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const ns = namespaces.split(",").map((s) => s.trim()).filter(Boolean);
      if (kind === "backup") {
        await createVeleroBackup({ name: name.trim(), namespaces: ns, ttl_hours: ttl, snapshot_volumes: snap });
        toast.success(`Backup "${name.trim()}" started`);
      } else {
        await createVeleroSchedule({ name: name.trim(), schedule: cron.trim(), namespaces: ns, ttl_hours: ttl, snapshot_volumes: snap });
        toast.success(`Schedule "${name.trim()}" created`);
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={kind === "backup" ? "Create backup" : "New scheduled backup"} onClose={onClose}>
      <label className="block text-sm"><span className="mb-1 block text-th-dim">Name</span>
        <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "backup" ? "daily-2026-07-22" : "nightly"} />
      </label>
      {kind === "schedule" && (
        <label className="block text-sm"><span className="mb-1 block text-th-dim">Cron schedule</span>
          <input className={INPUT + " font-mono"} value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 2 * * *" />
        </label>
      )}
      <label className="block text-sm"><span className="mb-1 block text-th-dim">Namespaces (comma-separated, blank = whole cluster)</span>
        <input className={INPUT} value={namespaces} onChange={(e) => setNamespaces(e.target.value)} placeholder="default, prod" />
      </label>
      <div className="flex items-center gap-4">
        <label className="block flex-1 text-sm"><span className="mb-1 block text-th-dim">Retention (hours)</span>
          <input type="number" className={INPUT} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
        </label>
        <label className="mt-5 flex items-center gap-2 text-sm text-th-dim">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="accent-th-accent" />
          Snapshot volumes
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={BTN_GHOST}>Cancel</button>
        <button onClick={submit} disabled={busy || !name.trim()} className={BTN}>{busy ? "Working…" : kind === "backup" ? "Start backup" : "Create schedule"}</button>
      </div>
    </Modal>
  );
}

function RestoreModal({ backup, onClose, onDone }: { backup: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(`restore-${backup}`.slice(0, 63));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await createVeleroRestore({ name: name.trim(), backup_name: backup });
      toast.success(`Restore from "${backup}" started`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Restore from ${backup}`} onClose={onClose}>
      <p className="text-sm text-th-dim">This recreates the backed-up objects in the cluster. Existing objects are not overwritten by Velero.</p>
      <label className="block text-sm"><span className="mb-1 block text-th-dim">Restore name</span>
        <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={BTN_GHOST}>Cancel</button>
        <button onClick={submit} disabled={busy || !name.trim()} className={BTN}>{busy ? "Starting…" : "Start restore"}</button>
      </div>
    </Modal>
  );
}
