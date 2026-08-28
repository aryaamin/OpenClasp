import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'apps/dashboard',
    plugins: [react()],
    define: {
      __AUTH0_DOMAIN__: JSON.stringify(
        process.env.NEXT_PUBLIC_AUTH0_DOMAIN ??
          process.env.AUTH0_DOMAIN ??
          env.NEXT_PUBLIC_AUTH0_DOMAIN ??
          env.AUTH0_DOMAIN ??
          'icfg-0ua6bab8d4omtfolx72mrhzo.us.auth0.com',
      ),
      __AUTH0_CLIENT_ID__: JSON.stringify(
        process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ??
          process.env.AUTH0_CLIENT_ID ??
          env.NEXT_PUBLIC_AUTH0_CLIENT_ID ??
          env.AUTH0_CLIENT_ID ??
          'vGxzZd4LiO7TqH4U61QblwH96YcimpcA',
      ),
      __AUTH0_AUDIENCE__: JSON.stringify(
        process.env.NEXT_PUBLIC_AUTH0_AUDIENCE ??
          process.env.AUTH0_AUDIENCE ??
          process.env.OPENCLASP_MCP_URL ??
          env.NEXT_PUBLIC_AUTH0_AUDIENCE ??
          env.AUTH0_AUDIENCE ??
          env.OPENCLASP_MCP_URL ??
          'https://openclasp.vercel.app/mcp',
      ),
    },
    server: { port: 5173 },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
