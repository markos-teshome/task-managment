import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Tasks open in a drawer on top of whatever page you are on, addressed by `?task=<id>`.
 * The URL is shareable and the browser Back button closes the drawer.
 */
export function useOpenTask() {
  const [, setParams] = useSearchParams();
  return useCallback(
    (id) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('task', id);
        return next;
      }),
    [setParams],
  );
}
