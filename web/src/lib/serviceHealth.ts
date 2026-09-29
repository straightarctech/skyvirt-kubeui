import type { ServiceSummary, EndpointSummary } from "@/api/client";
import type { StatusKind } from "@/lib/status";

/**
 * Backend (endpoint) health for a Service — the "is anything actually serving
 * this?" signal, joined from the matching Endpoints object. Returns a status
 * kind (for the shared STATUS palette) and a compact label.
 */
export function backendHealth(svc: ServiceSummary, ep?: EndpointSummary): { kind: StatusKind; label: string } {
  const hasSelector = Object.keys(svc.selector || {}).length > 0;
  const ready = ep?.ready ?? 0;
  const notReady = ep?.not_ready ?? 0;
  if (!hasSelector) return { kind: "unknown", label: "manual" };
  if (ready === 0) return { kind: "error", label: "no endpoints" };
  if (notReady > 0) return { kind: "warn", label: `${ready}/${ready + notReady} ready` };
  return { kind: "ok", label: `${ready} ready` };
}
