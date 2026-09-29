import { useState, FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { APP_VERSION_LABEL, APP_COMMIT } from "@/version";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Validate redirect target to prevent open redirect attacks.
  const rawFrom = (location.state as { from?: string })?.from || "/";
  const from = rawFrom.startsWith("/") && !rawFrom.startsWith("//") ? rawFrom : "/";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-th-page p-4">
      <div className="w-full max-w-sm">
        <div className="bg-th-panel rounded-2xl shadow-modal p-8 border border-th-line animate-slide-up">
          {/* Logo/Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-th-accent/10 mb-4">
              <svg className="w-7 h-7 text-th-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-th-heading">SkyVirt HCI</h1>
            <p className="text-sm text-th-dim mt-1">Sign in to continue</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-th-danger-s text-th-danger text-sm border border-th-danger/20">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-th-label mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className="w-full px-3 py-2 rounded-lg bg-th-subtle border border-th-line text-th-body placeholder-th-ghost text-sm focus:outline-none focus:ring-2 focus:ring-th-accent/40 focus:border-th-accent transition-colors"
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-th-label mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 rounded-lg bg-th-subtle border border-th-line text-th-body placeholder-th-ghost text-sm focus:outline-none focus:ring-2 focus:ring-th-accent/40 focus:border-th-accent transition-colors"
                placeholder="Enter password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-th-accent text-white font-medium text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-th-accent/40 focus:ring-offset-2 focus:ring-offset-th-panel disabled:opacity-50 transition-all"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-th-ghost mt-6" title={`Build ${APP_COMMIT}`}>
          SkyVirt KubeUI {APP_VERSION_LABEL} &middot;{" "}
          <a
            href="https://github.com/straightarctech/skyvirt-kubeui"
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:text-th-accent hover:underline"
          >
            Open source on GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
