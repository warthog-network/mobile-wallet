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

// Play Store bundles set EXPO_PUBLIC_PLAY_STORE=1. Swap the custodial
// SafeTrade screens for an empty module so that client is not in the AAB.
if (process.env.EXPO_PUBLIC_PLAY_STORE === '1') {
  const emptyModule = path.resolve(projectRoot, 'shims/empty.js');
  const exchangeShim = path.resolve(projectRoot, 'shims/playExchangeTool.js');
  const exchangeOption = path.resolve(projectRoot, 'components/tools/exchangeToolOption.tsx');
  const playBlocked = new Set(
    [
      'components/tools/SafeTradeTool.tsx',
      'components/tools/SafeTradeCard.tsx',
      'utils/exchange/safetrade.ts',
      'utils/exchange/walletSend.ts',
      'utils/exchange/http.ts',
    ].map((rel) => path.resolve(projectRoot, rel)),
  );
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolved = context.resolveRequest(context, moduleName, platform);
    if (resolved && resolved.type === 'sourceFile' && resolved.filePath === exchangeOption) {
      return { type: 'sourceFile', filePath: exchangeShim };
    }
    if (resolved && resolved.type === 'sourceFile' && playBlocked.has(resolved.filePath)) {
      return { type: 'sourceFile', filePath: emptyModule };
    }
    return resolved;
  };
}

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
