// Cluster context for multi-cluster switching. The portal passes this into
// KubeUI at SSO-launch time (a base64 blob in the URL fragment) so the switcher
// can list sibling clusters — WITHOUT KubeUI ever holding another cluster's
// credentials. Switching navigates to a peer's portal deep-link, which mints
// that cluster's token and lands the user in its KubeUI (isolation preserved).

export interface ClusterPeer {
  id: string;
  name: string;
  /** Portal deep-link that auto-launches this cluster's KubeUI (via SSO). */
  switchUrl?: string;
}

export interface ClusterContext {
  current: { id: string; name: string };
  peers: ClusterPeer[];
}

const KEY = "kubeui_cluster_ctx";

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  // atob → binary; recover UTF-8.
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * If the fragment carries `kctx=<base64url json>`, adopt it into localStorage
 * and return the fragment with that param removed. No-op otherwise.
 */
export function adoptClusterContextFromHash(hash: string): string {
  const m = hash.match(/[#&]kctx=([^&]+)/);
  if (!m) return hash;
  try {
    const json = b64urlDecode(decodeURIComponent(m[1]));
    const ctx = JSON.parse(json) as ClusterContext;
    if (ctx && ctx.current && Array.isArray(ctx.peers)) {
      localStorage.setItem(KEY, JSON.stringify(ctx));
    }
  } catch {
    /* malformed context — ignore, switcher just won't render */
  }
  return hash.replace(/[#&]kctx=[^&]+/, "");
}

export function getClusterContext(): ClusterContext | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as ClusterContext) : null;
  } catch {
    return null;
  }
}
