import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { PAGE_SIZES } from '../components/ui/Misc.jsx';

/**
 * List filters stored in the URL: shareable, survive reloads, and Back undoes a filter.
 * Changing any filter other than `page` (including the page size) resets to page 1.
 */
export function useUrlFilters(keys) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => {
    const out = {};
    for (const key of keys) {
      const v = params.get(key);
      if (v === null || v === '') continue;
      if (key === 'page') out.page = Math.max(1, Number(v) || 1);
      else if (key === 'pageSize') out.pageSize = PAGE_SIZES.includes(Number(v)) ? Number(v) : undefined; // only the offered sizes
      else out[key] = v;
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
        // Turning pages adds history entries (Back returns to the previous page); filter edits replace.
        { replace: !(Object.keys(patch).length === 1 && 'page' in patch) },
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

  const activeCount = keys.filter((k) => !['page', 'pageSize', 'sort', 'search'].includes(k) && filters[k] !== undefined).length;
  const active = activeCount > 0 || !!filters.search;
  return { filters, setFilters, clear, active, activeCount };
}
