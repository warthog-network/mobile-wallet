const { spawn } = require('child_process');

const GET_EXACT = new Set([
  '/trade/public/tickers/wartusdt',
  '/trade/account/balances/spot',
  '/trade/account/beneficiaries',
]);

const POST_EXACT = new Set([
  '/trade/market/orders',
  '/trade/account/withdraws',
  '/trade/account/withdraws/generate_code',
  '/trade/account/beneficiaries',
  '/trade/account/beneficiaries/generate_code',
]);

const AUTH = [
  ['x-auth-apikey', 'X-Auth-Apikey'],
  ['x-auth-nonce', 'X-Auth-Nonce'],
  ['x-auth-signature', 'X-Auth-Signature'],
];

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Same-origin forwarder for the web wallet. The browser cannot send SafeTrade's
 * X-Auth headers cross-origin. curl is used because Node's fetch is blocked by
 * Cloudflare on this host while curl is not.
 */
function pathAllowed(method, pathname) {
  if (method === 'GET' && (
    GET_EXACT.has(pathname)
    || /^\/trade\/market\/orders\/\d+$/.test(pathname)
    || /^\/trade\/account\/deposit_address\/(wart|usdt|btc|eth|sol|usdc)$/.test(pathname)
  )) {
    return true;
  }
  return method === 'POST' && POST_EXACT.has(pathname);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 16384) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function handleSafeTradeProxy(req, res) {
  const method = req.method || 'GET';
  let pathname = '';
  let search = '';
  try {
    const incoming = new URL(req.url, 'http://localhost');
    pathname = incoming.pathname.replace(/^\/safetrade-proxy/, '');
    search = incoming.search;
  } catch {
    sendJson(res, 400, { error: 'Bad SafeTrade proxy URL.' });
    return;
  }
  if (!pathAllowed(method, pathname)) {
    sendJson(res, 404, { error: 'Unknown SafeTrade path.' });
    return;
  }

  const args = [
    '-sS',
    // SafeTrade can only trust an IPv4. The default route to safe.trade is IPv6.
    '-4',
    '-m', '25',
    '-A', 'WarthogWallet/1.0',
    '-H', 'Accept: application/json',
  ];
  if (method === 'POST') args.push('-X', 'POST', '-H', 'Content-Type: application/json');
  for (const [incoming, outgoing] of AUTH) {
    const raw = req.headers[incoming];
    if (raw == null || raw === '') continue;
    const value = Array.isArray(raw) ? raw[0] : String(raw);
    if (/[\r\n]/.test(value)) {
      sendJson(res, 400, { error: 'Bad SafeTrade auth header.' });
      return;
    }
    args.push('-H', `${outgoing}: ${value}`);
  }
  if (method === 'POST') args.push('--data-binary', '@-');
  args.push('-w', '\n%{http_code}', `https://safe.trade/api/v2${pathname}${search}`);

  const child = spawn('curl', args);
  if (method === 'POST') {
    readBody(req).then(
      (body) => {
        child.stdin.write(body);
        child.stdin.end();
      },
      () => {
        child.kill();
        if (!res.writableEnded) sendJson(res, 400, { error: 'Bad SafeTrade request body.' });
      },
    );
  }
  let out = '';
  child.stdout.on('data', (chunk) => {
    out += chunk;
  });
  child.on('error', () => {
    sendJson(res, 502, { error: 'SafeTrade proxy could not start.' });
  });
  child.on('close', (code) => {
    if (res.writableEnded) return;
    if (code !== 0) {
      sendJson(res, 502, { error: 'SafeTrade proxy failed.' });
      return;
    }
    const match = out.match(/\n(\d{3})$/);
    const status = match ? Number(match[1]) : 502;
    const body = match ? out.slice(0, match.index) : out;
    res.statusCode = status >= 100 && status <= 599 ? status : 502;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(body);
  });
}

function isSafeTradeProxy(url) {
  return typeof url === 'string' && url.split('?')[0].startsWith('/safetrade-proxy/');
}

module.exports = { handleSafeTradeProxy, isSafeTradeProxy };
