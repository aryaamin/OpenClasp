import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'apps/dashboard',
    plugins: [react()],
    define: {
      __DESCOPE_PROJECT_ID__: JSON.stringify(
        process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID ??
          process.env.DESCOPE_PROJECT_ID ??
          env.NEXT_PUBLIC_DESCOPE_PROJECT_ID ??
          env.DESCOPE_PROJECT_ID ??
          '',
      ),
    },
    server: { port: 5173 },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
