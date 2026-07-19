import js from '@eslint/js';
import globals from 'globals';

const correctnessRules = {
  ...js.configs.recommended.rules,
  // Introduce legacy cleanup separately; this gate targets correctness.
  'no-unused-vars': 'off',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: [
      'src/**/*.js',
      'scripts/**/*.mjs',
      '*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: correctnessRules,
  },
  {
    files: [
      'test/**/*.js',
      'test/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: correctnessRules,
  },
];
