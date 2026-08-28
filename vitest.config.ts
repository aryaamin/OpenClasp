import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@openclasp/protocol': fromRoot('./packages/protocol/src/index.ts'),
      '@openclasp/core': fromRoot('./packages/core/src/index.ts'),
      '@openclasp/sdk': fromRoot('./packages/sdk/src/index.ts'),
      '@openclasp/sidecar': fromRoot('./packages/sidecar/src/index.ts'),
      '@openclasp/persistence': fromRoot('./packages/persistence/src/index.ts'),
    },
  },
  test: { coverage: { reporter: ['text', 'html'] } },
});
