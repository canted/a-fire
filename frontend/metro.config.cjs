const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Only repository-level server/client contracts remain outside this app.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../types')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
module.exports = config;
