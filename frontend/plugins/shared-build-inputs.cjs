const { withAppBuildGradle } = require('expo/config-plugins');

// Metro watches these portable sources, but Gradle's default task inputs only
// cover the Expo project root. Track them so release bundles cannot go stale.
module.exports = config => withAppBuildGradle(config, config => {
  const marker = '// A Fire portable bundle inputs';
  if (!config.modResults.contents.includes(marker)) {
    config.modResults.contents += `
${marker}
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    inputs.files(fileTree("../../../types"))
}
`;
  }
  return config;
});
