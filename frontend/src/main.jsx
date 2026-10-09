import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import '@fontsource-variable/inter';
import './styles/index.css';
import { queryClient } from './lib/query.js';
import { AuthProvider } from './features/auth/AuthProvider.jsx';
import { router } from './app/router.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" closeButton duration={3500} toastOptions={{ className: 'text-[13px]' }} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
