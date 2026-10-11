import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retry only transient failures (network/5xx); 4xx answers are final.
      retry: (count, err) => err?.code !== 'TIMEOUT' && (err?.status === 0 || err?.status >= 500) && count < 2, // a timeout already waited long enough
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

/** Work data is interlinked (a task change moves project progress, dashboard counts, activity). */
const WORK_KEYS = ['projects', 'project', 'tasks', 'task', 'my-work', 'dashboard', 'activities', 'search', 'organization'];

export const invalidateWork = (qc) => Promise.all(WORK_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));

export const invalidate = (qc, ...keys) => Promise.all(keys.map((key) => qc.invalidateQueries({ queryKey: [key] })));
