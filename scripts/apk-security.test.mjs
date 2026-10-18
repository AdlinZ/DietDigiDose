import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

test('production APK gate passes safe synthetic artifacts and rejects unsafe fixtures', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_apk_security.py', '-v'], {
    cwd: root, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});

test('security plugin applies and writes the exact rules inspected in APK fixtures', async () => {
  const { applySecurityPolicy, writeSecurityRules } = require('../client/plugins/withAndroidArtifactSecurity.js');
  const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication', 'android:allowBackup': 'true' } }] } };
  const result = applySecurityPolicy(manifest);
  assert.deepEqual(result.manifest.application[0].$, {
    'android:name': '.MainApplication', 'android:allowBackup': 'false',
    'android:fullBackupContent': '@xml/ddd_backup_rules',
    'android:dataExtractionRules': '@xml/ddd_data_extraction_rules',
    'android:networkSecurityConfig': '@xml/ddd_network_security_config',
  });
  const directory = await mkdtemp(join(tmpdir(), 'ddd-backup-policy-'));
  try {
    await writeSecurityRules(directory);
    await writeSecurityRules(directory); // Idempotent prebuild.
    for (const name of ['ddd_backup_rules.xml', 'ddd_data_extraction_rules.xml', 'ddd_network_security_config.xml']) {
      assert.equal(await readFile(join(directory, 'app/src/main/res/xml', name), 'utf8'),
        await readFile(join(root, 'client/plugins/android-security', name), 'utf8'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const appConfig = require('../client/app.config.js')({ config: {} });
  assert.ok(appConfig.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === './plugins/withAndroidArtifactSecurity'));
  applySecurityPolicy(manifest, { allowInsecureHttp: true });
  assert.equal(manifest.manifest.application[0].$['android:networkSecurityConfig'], undefined);
  applySecurityPolicy(manifest, { allowInsecureHttp: false });
  assert.equal(manifest.manifest.application[0].$['android:networkSecurityConfig'], '@xml/ddd_network_security_config');
  manifest.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/custom_development_policy';
  applySecurityPolicy(manifest, { allowInsecureHttp: true });
  assert.equal(manifest.manifest.application[0].$['android:networkSecurityConfig'], '@xml/custom_development_policy');
});

test('release upload is downstream of the final artifact gate and cannot ignore failures', async () => {
  const workflow = await readFile(join(root, '.github/workflows/android-apk.yml'), 'utf8');
  const steps = ['Build signed release APK', 'Verify APK signature and package', 'Prepare artifact',
    'Gate final signed APK security before distribution', 'Upload APK'];
  const positions = steps.map((name) => workflow.indexOf(`- name: ${name}`));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
  const gate = workflow.slice(positions[3], positions[4]);
  assert.match(gate, /working-directory: client\/artifact/);
  assert.match(gate, /set -euo pipefail/);
  assert.match(gate, /python3 ..\/..\/scripts\/check-apk-security.py/);
  assert.match(gate, /--apk "\$APK_PATH"/);
  assert.match(gate, /--source-sha "\$SIGNED_SOURCE_SHA"/);
  assert.match(gate, /--certificate-sha256 "\$EXPECTED_CERT_SHA256"/);
  assert.match(gate, /sha256sum --check SHA256SUMS.txt/);
  assert.doesNotMatch(gate, /continue-on-error|\|\| true|\n\s+if: /);
  assert.doesNotMatch(workflow.slice(positions[4]), /always\(\)|continue-on-error/);
  assert.match(workflow.slice(positions[4]), /path: client\/artifact\//);
});
