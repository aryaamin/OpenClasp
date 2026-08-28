import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'apps/dashboard',
    plugins: [react()],
    define: {
      __CLERK_PUBLISHABLE_KEY__: JSON.stringify(
        process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
          env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
          '',
      ),
    },
    server: { port: 5173 },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
