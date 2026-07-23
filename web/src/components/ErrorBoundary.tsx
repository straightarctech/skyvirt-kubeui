import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** When this value changes, the boundary clears a caught error (e.g. on route
   *  change) so navigating away from a broken page recovers automatically. */
  resetKey?: string;
  /** Optional label for what failed, e.g. "this page". */
  scope?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors in its subtree and shows a recoverable fallback
 * instead of unmounting to a blank screen. Wrap the routed content so one page's
 * crash never takes down the whole console — the nav stays usable and the user
 * can retry or navigate away.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Surface for support/telemetry; the UI shows a friendly message.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const scope = this.props.scope ?? "this page";
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-th-line bg-th-panel p-8 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-th-danger-s text-th-danger">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-th-heading">Something went wrong on {scope}</h1>
          <p className="mt-1 text-sm text-th-dim">
            The console hit an unexpected error while rendering. Your session is still active — retry, or go back to the dashboard.
          </p>

          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg bg-th-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Try again
            </button>
            <a
              href="/"
              className="rounded-lg border border-th-line bg-th-subtle px-4 py-2 text-sm font-medium text-th-body transition-colors hover:bg-th-hover"
            >
              Back to dashboard
            </a>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg border border-th-line bg-th-subtle px-4 py-2 text-sm font-medium text-th-body transition-colors hover:bg-th-hover"
            >
              Reload
            </button>
          </div>

          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-xs font-medium text-th-dim hover:text-th-body">
              Technical details
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-th-subtle p-3 text-[11px] leading-relaxed text-th-dim whitespace-pre-wrap break-words">
              {error.message}
              {error.stack ? "\n\n" + error.stack : ""}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
