import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: true,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Don't bundle dependencies — let Node resolve them at runtime.
  // This avoids CJS-in-ESM issues with packages like inquirer/yoctocolors.
  noExternal: [],
  external: [
    /^node:/,
    /^@legion\//,
    'commander',
    'chalk',
    '@inquirer/prompts',
    'inquirer',
    'ora',
  ],
});
