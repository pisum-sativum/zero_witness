const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const jsbiShimPath = path.resolve(__dirname, "jsbi.mjs");
const jsbiCjsPath = require.resolve("jsbi/dist/jsbi-cjs.js");

// 1. Support modern file types
config.resolver.sourceExts.push("mjs");

// 2. Force Native-first resolution
config.resolver.resolverMainFields = ["react-native", "browser", "main"];

// 3. Disable unstable exports to prevent hangs
config.resolver.unstable_enablePackageExports = false;

// 4. Unified Resolver (Handles Polyfills and ZK Libraries)
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // JSBI Interceptor
  if (moduleName === "jsbi") {
    return {
      filePath: jsbiCjsPath,
      type: "sourceFile",
    };
  }
  if (moduleName.endsWith("jsbi.mjs")) {
    return {
      filePath: jsbiShimPath,
      type: "sourceFile",
    };
  }
  // Barretenberg Interceptor
  if (
    moduleName === "@aztec/bb.js" ||
    moduleName.includes("backend_barretenberg")
  ) {
    return {
      filePath: path.resolve(
        __dirname,
        "node_modules/@aztec/bb.js/dest/browser/index.js",
      ),
      type: "sourceFile",
    };
  }
  // Node Polyfills Interceptor
  const polyfills = {
    fs: "path-browserify",
    "fs/promises": "path-browserify",
    os: "path-browserify",
    path: "path-browserify",
    stream: "stream-browserify",
    crypto: "react-native-get-random-values",
    process: "process/browser",
  };
  if (polyfills[moduleName]) {
    try {
      return {
        filePath: require.resolve(polyfills[moduleName]),
        type: "sourceFile",
      };
    } catch (e) {
      // Fallback if require.resolve fails
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
