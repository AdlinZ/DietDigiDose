import * as esbuild from 'esbuild';
import { createRequire } from 'module';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const rootPkg = require('../package.json');
const dependencies = pkg.dependencies || {};
const externalList = Object.keys(dependencies).filter(dep => dep !== 'dayjs');
try {
  rmSync(new URL('./dist/', import.meta.url), { recursive: true, force: true });
  await esbuild.build({
    entryPoints: {
      index: 'src/index.ts',
      worker: 'src/worker.ts',
      'database-backup': 'scripts/database-backup.ts',
      'database-rehearsal': 'scripts/database-rehearsal.ts',
      'migrate-community-media': 'scripts/migrate-community-media.ts',
    },
    bundle: true,
    splitting: true,
    platform: 'node',
    format: 'esm',
    outdir: 'dist',
    external: externalList,
    define: {
      'process.env.SERVER_VERSION': JSON.stringify(process.env.SERVER_VERSION || rootPkg.version),
      'process.env.SERVER_BUILD_TIME': JSON.stringify(process.env.SERVER_BUILD_TIME || new Date().toISOString()),
    },
  });
  console.log('⚡ Build complete!');
} catch (e) {
  console.error(e);
  process.exit(1);
}
