const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const { readFile, mkdir, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { X509Certificate } = require('node:crypto');

// Release-mode test builds trust exactly the local CA for localhost. Normal
// builds remove these generated resources and retain Android's default trust.
module.exports = (config, { caFile } = {}) => {
  config = withAndroidManifest(config, config => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    if (caFile) app.$['android:networkSecurityConfig'] = '@xml/afire_local_https';
    else if (app.$['android:networkSecurityConfig'] === '@xml/afire_local_https') delete app.$['android:networkSecurityConfig'];
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const res = join(config.modRequest.platformProjectRoot, 'app/src/main/res');
    const certificate = join(res, 'raw/afire_local_ca.pem');
    const policy = join(res, 'xml/afire_local_https.xml');
    if (!caFile) {
      await rm(certificate, { force: true });
      await rm(policy, { force: true });
      return config;
    }
    const pem = await readFile(caFile, 'utf8');
    if (pem.includes('PRIVATE KEY') || !new X509Certificate(pem).ca) throw new Error('Supply only the public local CA certificate');
    await mkdir(join(res, 'raw'), { recursive: true });
    await mkdir(join(res, 'xml'), { recursive: true });
    await writeFile(certificate, pem);
    await writeFile(policy, `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system" /></trust-anchors></base-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="false">localhost</domain>
    <trust-anchors><certificates src="@raw/afire_local_ca" /></trust-anchors>
  </domain-config>
</network-security-config>
`);
    return config;
  }]);
};
