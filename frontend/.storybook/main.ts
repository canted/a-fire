import type { StorybookConfig } from "@storybook/react-vite";
import { fileURLToPath } from "node:url";
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/react-vite", options: {} },
  addons: [],
  staticDirs: ["./assets"],
  async viteFinal(config) {
    // Keep the Expo React 19 runtime isolated from the public website’s React 18 runtime.
    config.resolve = {
      ...config.resolve,
      extensions: [
        ".web.tsx",
        ".web.ts",
        ".web.js",
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".json",
      ],
      alias: [
        { find: /^(.*\/)?api$/, replacement: local("./apiFixture.ts") },
        { find: /^(.*\/)?cable$/, replacement: local("./cableFixture.ts") },
        { find: /^(.*\/)?useRoomSubscription$/, replacement: local("./roomSubscriptionFixture.ts") },
        { find: /^(.*\/)?useAudioPlayback$/, replacement: local("./playbackFixture.ts") },
        { find: /^expo-audio$/, replacement: local("./audioFixture.ts") },
        {
          find: /^(.*\/)?useContentLink$/,
          replacement: local("./contentLinkFixture.ts"),
        },
        {
          find: /^(.*\/)?useRoomNavigation$/,
          replacement: local("./navigationFixture.ts"),
        },
        {
          find: /^react$/,
          replacement: local("../node_modules/react/index.js"),
        },
        { find: /^react\//, replacement: local("../node_modules/react/") },
        {
          find: /^react-dom$/,
          replacement: local("../node_modules/react-dom/index.js"),
        },
        {
          find: /^react-dom\//,
          replacement: local("../node_modules/react-dom/"),
        },
        {
          find: /^react-native$/,
          replacement: local("../node_modules/react-native-web/dist/index.js"),
        },
        {
          find: /^react-native-svg$/,
          replacement: local(
            "../node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js",
          ),
        },
        {
          find: /^expo-router(?:\/react-navigation)?$/,
          replacement: local("./routerFixture.ts"),
        },
        {
          find: /^(.*\/)?useMediaSource$/,
          replacement: local("./mediaFixture.ts"),
        },
      ],
    };
    config.optimizeDeps = { ...config.optimizeDeps, esbuildOptions: {
      ...config.optimizeDeps?.esbuildOptions,
      resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
    } };
    config.define = { ...config.define, __DEV__: "true", "process.env.EXPO_OS": '"web"' };
    return config;
  },
};
export default config;
