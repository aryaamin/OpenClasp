import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.agents',
      '.vercel',
      'dist',
      'coverage',
      '**/.botpress/**',
      'apps/dashboard/dist',
      'schemas/v0.1/*.json',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
