import { useState, useEffect, useCallback, useRef } from "react";

interface UseResourceResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Generic hook for fetching a resource and managing loading/error state.
 * Re-fetches when deps change.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): UseResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Whether a fetch has ever settled (success OR failure), so refetches can tell
  // a first load from a background refresh without re-running the effect.
  // Keyed on "settled", not on data: a fetch that keeps failing leaves data null
  // forever, and gating on that re-showed the skeleton on every refresh —
  // unmount → skeleton → remount, i.e. a page that flickers once per refresh.
  const settled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Only show the skeleton on the very first load; live/manual refetches
    // update in place.
    if (!settled.current) setLoading(true);
    fetcher()
      .then((result) => {
        if (!cancelled) {
          settled.current = true;
          setData(result);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          settled.current = true;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, loading, error, refresh };
}
