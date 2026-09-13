module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'tests/**'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react-refresh'],
  overrides: [
    {
      // Node.js runtime files (Vite config, build/test scripts, tile-generator) — no browser env.
      files: ['vite.config.js', 'scripts/**/*.mjs', 'scripts/**/*.js', 'e2e/**/*.ts', 'e2e/**/*.js', 'playwright.config.ts', 'tools/tile-generator/**/*.mjs'],
      env: { node: true },
    },
  ],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    // Downgraded from error to warn to reduce noise on pre-existing code
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    'no-case-declarations': 'warn',
  },
}