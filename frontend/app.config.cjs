module.exports = ({ config }) => {
  const caFile = process.env.AFIRE_LOCAL_HTTPS_CA;
  if (process.env.EXPO_PUBLIC_ROOM_BENCHMARK === '1' && (process.env.EAS_BUILD || process.env.EXPO_PUBLIC_API_URL !== 'https://localhost:8443/api')) {
    throw new Error('Room benchmarking is only allowed in local HTTPS builds');
  }
  if (caFile && (process.env.EAS_BUILD || process.env.EXPO_PUBLIC_API_URL !== 'https://localhost:8443/api')) {
    throw new Error('Local HTTPS trust is only allowed in local builds using https://localhost:8443/api');
  }
  return {
    ...config,
    ...(caFile ? {
      name: 'A Fire Local HTTPS',
      scheme: 'afire-local-https',
      ios: { ...config.ios, bundleIdentifier: 'co.canted.afire.preview.localhttps' },
      android: { ...config.android, package: 'co.canted.afire.preview.localhttps' },
    } : {}),
    plugins: [...config.plugins, './plugins/shared-build-inputs.cjs', ['./plugins/local-https.cjs', { caFile }]],
  };
};
