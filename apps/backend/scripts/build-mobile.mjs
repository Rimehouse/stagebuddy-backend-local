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
import { mkdirSync, copyFileSync } from 'fs';

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
  // 'sql-asm.js' is copied separately to keep bundle small and parse fast
  external: ['bridge'],

  plugins: [{
    name: 'mobile-rewrites',
    setup(build) {
      // Redirect lib/prisma imports to sql.js layer
      build.onResolve({ filter: /[/\\]lib[/\\]prisma(\.js)?$/ }, () => ({
        path: resolve(rootDir, 'src/lib/prisma-mobile.ts'),
      }));
      // Don't bundle sql-asm.js — load it as a sibling file at runtime
      build.onResolve({ filter: /sql-asm\.js$/ }, () => ({
        path: './sql-asm.js',
        external: true,
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

// Copy sql-asm.js alongside index.js so require('./sql-asm.js') works at runtime
const sqljsSrc = resolve(rootDir, 'node_modules/sql.js/dist/sql-asm.js');
copyFileSync(sqljsSrc, resolve(outDir, 'sql-asm.js'));

console.log(`\n✓ Mobile bundle written to:\n  ${outDir}/index.js`);
console.log(`✓ sql-asm.js copied to:    ${outDir}/sql-asm.js\n`);
