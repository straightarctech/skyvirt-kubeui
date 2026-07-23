import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { adoptClusterContextFromHash } from "@/lib/clusterContext";

interface User {
  id: string;
  email: string;
  role: string;
  tenant_id?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  authRequired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = "skyvirt_token";
const USER_KEY = "skyvirt_user";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(USER_KEY);
    if (stored) {
      try { return JSON.parse(stored); } catch { return null; }
    }
    return null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(true);

  // On mount, check if auth is required and verify token.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Single-sign-on hand-off: the HCI portal launches us with a
      // cluster-scoped token in the URL fragment (#sso=<jwt>). Adopt it as our
      // session, then scrub the fragment from the URL and history so the token
      // isn't left in the address bar. Fragments are never sent to servers.
      let activeToken = token;
      const hash = window.location.hash;
      const ssoMatch = hash.match(/[#&]sso=([^&]+)/);
      // Adopt the cluster-switch context the portal passes alongside the token.
      const afterKctx = adoptClusterContextFromHash(hash);
      if (ssoMatch) {
        try {
          activeToken = decodeURIComponent(ssoMatch[1]);
          localStorage.setItem(TOKEN_KEY, activeToken);
          setToken(activeToken);
        } catch {
          /* malformed fragment — fall through to normal auth */
        }
      }
      if (ssoMatch || afterKctx !== hash) {
        const cleaned = afterKctx.replace(/[#&]sso=[^&]+/, "").replace(/^#$/, "");
        window.history.replaceState(null, "", window.location.pathname + window.location.search + cleaned);
      }

      // Check backend auth config.
      try {
        const res = await fetch("/api/v1/auth/config");
        if (res.ok) {
          const cfg = await res.json();
          if (!cancelled && cfg.auth_enabled === false) {
            setAuthRequired(false);
            setUser({ id: "anonymous", email: "anonymous@local", role: "admin" });
            setLoading(false);
            return;
          }
        }
      } catch {
        // If config endpoint fails, assume auth is required.
      }

      // Auth is required — validate existing token.
      if (!activeToken) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const parts = activeToken.split(".");
        if (parts.length !== 3) throw new Error("malformed");
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        const exp = payload.exp as number | undefined;
        if (exp && exp * 1000 < Date.now()) {
          throw new Error("expired");
        }
        if (!cancelled && (payload.email || payload.uid)) {
          const u: User = {
            id: payload.uid || payload.sub || user?.id || "",
            email: payload.email || user?.email || "",
            role: payload.role || user?.role || "viewer",
            tenant_id: payload.tid || user?.tenant_id,
          };
          setUser(u);
          localStorage.setItem(USER_KEY, JSON.stringify(u));
        }
      } catch {
        if (!cancelled) {
          clearAuth();
          setToken(null);
          setUser(null);
        }
      }
      if (!cancelled) setLoading(false);
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(body.error || "Login failed");
    }
    const data = await res.json();
    const t = data.token as string;
    const u: User = { id: data.user?.id || "", email: data.user?.email || email, role: data.user?.role || "viewer", tenant_id: data.user?.tenant_id };
    setToken(t);
    setUser(u);
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, authRequired, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
