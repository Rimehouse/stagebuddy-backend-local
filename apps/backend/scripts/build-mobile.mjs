/**
 * esbuild script: bundles the backend for capacitor-nodejs (hampoelz/Capacitor-NodeJS).
 *
 * - Replaces all imports of lib/prisma.ts with lib/prisma-mobile.ts (sql.js)
 * - Marks the capacitor-nodejs 'bridge' module as external
 * - Outputs to apps/android/public/nodejs/index.js so Vite copies it into dist/nodejs/
 *   (capacitor.config.json: { "CapacitorNodeJS": { "nodeDir": "nodejs" } })
 */

import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir   = resolve(__dirname, '..');
const outDir    = resolve(__dirname, '../../android/public/nodejs');

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(rootDir, 'src/index-mobile.ts')],
  bundle:      true,
  platform:    'node',
  format:      'cjs',
  target:      'node18',
  outfile:     resolve(outDir, 'index.js'),

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

console.log(`\n✓ Mobile bundle written to:\n  ${outDir}/index.js\n`);
