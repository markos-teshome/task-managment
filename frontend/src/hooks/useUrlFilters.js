import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List filters stored in the URL: shareable, survive reloads, and Back undoes a filter.
 * Changing any filter other than `page` resets to page 1.
 */
export function useUrlFilters(keys) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => {
    const out = {};
    for (const key of keys) {
      const v = params.get(key);
      if (v !== null && v !== '') out[key] = key === 'page' ? Number(v) || 1 : v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, keys.join()]);

  const setFilters = useCallback(
    (patch) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const clear = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          keys.forEach((k) => next.delete(k));
          return next;
        },
        { replace: true },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams, keys.join()],
  );

  const activeCount = keys.filter((k) => k !== 'page' && k !== 'sort' && k !== 'search' && filters[k] !== undefined).length;
  const active = activeCount > 0 || !!filters.search;
  return { filters, setFilters, clear, active, activeCount };
}
