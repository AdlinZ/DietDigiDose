/* global module, require, __dirname */
const fs = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

function applySecurityPolicy(manifest, { allowInsecureHttp = false } = {}) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  application.$['android:allowBackup'] = 'false';
  application.$['android:fullBackupContent'] = '@xml/ddd_backup_rules';
  application.$['android:dataExtractionRules'] = '@xml/ddd_data_extraction_rules';
  if (!allowInsecureHttp) {
    application.$['android:networkSecurityConfig'] = '@xml/ddd_network_security_config';
  } else if (application.$['android:networkSecurityConfig'] === '@xml/ddd_network_security_config') {
    delete application.$['android:networkSecurityConfig'];
  }
  return manifest;
}

async function writeSecurityRules(platformProjectRoot) {
  const destination = path.join(platformProjectRoot, 'app/src/main/res/xml');
  await fs.mkdir(destination, { recursive: true });
  for (const filename of ['ddd_backup_rules.xml', 'ddd_data_extraction_rules.xml', 'ddd_network_security_config.xml']) {
    await fs.copyFile(path.join(__dirname, 'android-security', filename), path.join(destination, filename));
  }
}

module.exports = function withAndroidArtifactSecurity(config, options = {}) {
  config = withAndroidManifest(config, (result) => {
    applySecurityPolicy(result.modResults, options);
    return result;
  });
  return withDangerousMod(config, ['android', async (result) => {
    await writeSecurityRules(result.modRequest.platformProjectRoot);
    return result;
  }]);
};
module.exports.applySecurityPolicy = applySecurityPolicy;
module.exports.writeSecurityRules = writeSecurityRules;
