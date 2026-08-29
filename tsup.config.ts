import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    api: 'apps/api/src/index.ts',
    demo: 'apps/demo/src/index.ts',
    mcp: 'packages/mcp-server/src/index.ts',
    'runtime-sidecar': 'apps/runtime-sidecar/src/index.ts',
  },
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
});
