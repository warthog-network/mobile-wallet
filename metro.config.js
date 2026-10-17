const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
// Bake local warthog-ts into the app bundle (in-tree first, then legacy sibling).
const candidates = [
  path.resolve(projectRoot, 'warthog-ts'),
  path.resolve(projectRoot, 'node_modules/warthog-ts'),
  path.resolve(projectRoot, '../warthog-ts'),
];
const warthogTsRoot = fs.realpathSync(
  candidates.find((p) => fs.existsSync(p))
);

const { handleSafeTradeProxy, isSafeTradeProxy } = require('./scripts/safetrade-proxy');

const config = getDefaultConfig(projectRoot);

// The browser cannot send SafeTrade's X-Auth headers to safe.trade. This
// forwards those calls from the web dev server with curl.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (isSafeTradeProxy(req.url)) {
        handleSafeTradeProxy(req, res);
        return;
      }
      return middleware(req, res, next);
    };
  },
};

// Allow Metro to bundle the local file: warthog-ts dependency.
config.watchFolders = [warthogTsRoot];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Map warthog-ts explicitly so release/APK bundling follows the real package path.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'warthog-ts': warthogTsRoot,
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('stream-browserify'),
  buffer: require.resolve('buffer'),
  events: require.resolve('events'),
  process: require.resolve('process/browser'),
};

module.exports = config;
