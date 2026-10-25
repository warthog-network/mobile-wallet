/**
 * Smoke-test warthog-ts 0.4.3 without running the Expo app.
 * Run: npm run verify:warthog-ts
 */
import { Buffer } from 'buffer';
import {
  Account,
  Address,
  Wart,
  Funds,
  TokenDecimals,
  NonceId,
  RoundedFee,
  Liquidity,
  Price,
  ChainPin,
  WarthogLegacyApi,
  WarthogDeFiApi,
  WarthogLegacyTransactionContext,
  WarthogDeFiTransactionContext,
} from 'warthog-ts';
import { encodeLimitPrice } from '../utils/encodeLimitPrice.ts';
import { isValidAssetHash } from '../utils/warthogFormat.ts';

globalThis.Buffer = Buffer;

const pk = '966a71a98bb5d13e9116c0dffa3f1a7877e45c6f563897b96cfd5c59bf0803e0';
const account = Account.fromPrivateKeyHex(pk);
const recipient = Address.fromHex('3661579d61abde5837a8686dc4d65348a2fc61b1fe5f4093');

if (!recipient) throw new Error('recipient address invalid');
if (!Address.validate(account.address.hex)) throw new Error('account address invalid');

const wart = Wart.parse('0.1');
if (!wart) throw new Error('wart parse failed');

const fee = wart.roundedFee(true);
const nonce = NonceId.fromNumber(1);
if (!nonce) throw new Error('nonce invalid');

const pin = new ChainPin('a'.repeat(64), 128);
const legacy = new WarthogLegacyTransactionContext(pin, fee, nonce).transferWart(account, recipient, wart);
if (legacy.signature65.length !== 130) throw new Error('bad legacy signature length');
if (legacy.amountE8 !== wart.E8) throw new Error('legacy transfer must use amountE8');
if ('type' in legacy || 'wartE8' in legacy) throw new Error('legacy transfer must not send type or wartE8');

const defi = new WarthogDeFiTransactionContext(pin, fee, nonce).transferWart(account, recipient, wart);
if (defi.type !== 'wartTransfer') throw new Error('DeFi transfer must set type');
if (defi.wartE8 !== wart.E8) throw new Error('DeFi transfer must use wartE8');
if ('amountE8' in defi) throw new Error('DeFi transfer must not send amountE8');

const supply = Funds.parse('1000000', TokenDecimals.WART);
if (!supply) throw new Error('Funds parse failed');
const assetTx = new WarthogDeFiTransactionContext(pin, fee, nonce).createAssets(
  account,
  supply,
  TokenDecimals.WART,
  'HOG',
);
if (assetTx.decimals !== 8) throw new Error('assetCreation must expose decimals field for node API');
if (assetTx.precision !== undefined) throw new Error('assetCreation must not use precision field');

const limitHex = encodeLimitPrice('1.0', 8, { ceil: false });
if (limitHex.length !== 6) throw new Error('encodeLimitPrice failed');
if (!Price.fromHex(limitHex)) throw new Error('encoded limit is not a Price');

const assetHash = 'f45b113119c7f7c000234f1090d5d181ab60b8b24526f1edd2f563aa1ca329f2';
if (!isValidAssetHash(assetHash)) throw new Error('isValidAssetHash failed');

const lp = Liquidity.parse('1.5');
if (!lp) throw new Error('Liquidity parse failed');

const legacyApi = new WarthogLegacyApi('https://node.example.com');
const defiApi = new WarthogDeFiApi('https://defi.example.com');
if (typeof legacyApi.getWartBalance !== 'function') throw new Error('legacy client missing getWartBalance');
if (typeof defiApi.getTokenBalance !== 'function') throw new Error('DeFi client missing getTokenBalance');
if (typeof legacyApi.submitTransaction !== 'function') throw new Error('client missing submitTransaction');

console.log('warthog-ts 0.4.3 integration OK');
console.log('  account:', account.address.hex.slice(0, 12) + '...');
console.log('  legacy amountE8:', legacy.amountE8.toString());
console.log('  defi type:', defi.type);
console.log('  limit hex:', limitHex);
console.log('  liquidity E8:', lp.E8.toString());
