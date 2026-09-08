import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * State that optionally mirrors into a URL query param, so a list's view
 * (search, filter, sort, page) survives reload and can be shared by copying the
 * link. Loop-free: when URL-backed, the value is derived directly from the query
 * string each render (no separate state to fall out of sync), and writes merge
 * into the existing params with `replace` so they don't spam history.
 *
 * `urlKey === undefined` disables URL backing entirely (plain local state) — the
 * escape hatch multi-table pages use so their two tables don't collide on the
 * same param names. `urlKey === ""` enables bare params (q/sort/page/…); a
 * non-empty urlKey prefixes them (jobs_sort, …).
 */
export function useMaybeUrlState<T>(
  urlKey: string | undefined,
  param: string,
  initial: T,
  parse: (s: string) => T,
  serialize: (v: T) => string,
): [T, (v: T) => void] {
  const [sp, setSp] = useSearchParams();
  const [local, setLocal] = useState<T>(initial);
  const enabled = urlKey !== undefined;
  const fullKey = urlKey ? `${urlKey}_${param}` : param;

  const value = enabled ? (sp.has(fullKey) ? parse(sp.get(fullKey) as string) : initial) : local;

  const setValue = useCallback(
    (v: T) => {
      if (!enabled) { setLocal(v); return; }
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          const s = serialize(v);
          if (s === "" || s === serialize(initial)) next.delete(fullKey);
          else next.set(fullKey, s);
          return next;
        },
        { replace: true },
      );
    },
    // serialize/initial are stable (module-level fns / primitives) in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, fullKey],
  );

  return [value, setValue];
}

const str = (s: string) => s;

/** Drop-in for `useState("")` that mirrors a search box into the URL (`?q=`). */
export function useUrlSearch(param = "q"): [string, (v: string) => void] {
  return useMaybeUrlState<string>("", param, "", str, str);
}
