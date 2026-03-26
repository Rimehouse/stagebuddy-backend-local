/**
 * esbuild script: bundles the backend for @capacitor-community/capacitor-nodejs.
 *
 * - Replaces all imports of lib/prisma.ts with lib/prisma-mobile.ts (sql.js)
 * - Marks the nodejs-mobile 'bridge' module as external
 * - Outputs a single CommonJS bundle to apps/android/nodejs-assets/nodejs-project/main.js
 */

import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir   = resolve(__dirname, '..');
const outDir    = resolve(__dirname, '../../android/nodejs-assets/nodejs-project');

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(rootDir, 'src/index-mobile.ts')],
  bundle:      true,
  platform:    'node',
  format:      'cjs',
  target:      'node18',
  outfile:     resolve(outDir, 'main.js'),

  // 'bridge' is injected by nodejs-mobile at runtime
  external: ['bridge'],

  plugins: [{
    name: 'prisma-to-sqljs',
    setup(build) {
      // Redirect every import that ends with lib/prisma(.js) to lib/prisma-mobile.ts
      build.onResolve({ filter: /[/\\]lib[/\\]prisma(\.js)?$/ }, () => ({
        path: resolve(rootDir, 'src/lib/prisma-mobile.ts'),
      }));
    },
  }],

  define: {
    'process.env.NODE_ENV': '"production"',
  },

  minify:    false,
  sourcemap: false,
  logLevel:  'info',
});

console.log(`\n✓ Mobile bundle written to:\n  ${outDir}/main.js\n`);
