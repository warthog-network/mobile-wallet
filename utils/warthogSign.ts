/**
 * Sign one Warthog transaction with a private key the caller already holds.
 * The session module passes its own key and returns only the signed JSON.
 */
import {
  Account,
  Address,
  ChainPin,
  Funds,
  Liquidity,
  NonceId,
  Price,
  RoundedFee,
  TokenDecimals,
  Wart,
  WarthogDeFiTransactionContext,
  WarthogLegacyTransactionContext,
  type LegacyTransactionJson,
  type TransactionJson,
} from 'warthog-ts';

type ContextFields = {
  family: 'legacy' | 'defi';
  pinHash: string;
  pinHeight: number;
  nonceId: number;
  feeE8: string;
};

export type WarthogSignOp =
  | { op: 'wartTransfer'; toAddr: string; amountE8: string }
  | { op: 'tokenTransfer'; assetHash: string; isLiquidity: boolean; toAddr: string; amountU64: string }
  | { op: 'limitSwap'; assetHash: string; isBuy: boolean; amountU64: string; limitHex: string }
  | { op: 'liquidityDeposit'; assetHash: string; amountU64: string; wartE8: string }
  | { op: 'liquidityWithdrawal'; assetHash: string; amountE8: string }
  | { op: 'cancelation'; cancelHeight: number; cancelNonceId: number }
  | { op: 'assetCreation'; supplyU64: string; decimals: number; name: string };

export type WarthogSignRequest = ContextFields & WarthogSignOp;

function readUint(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}`);
  return BigInt(value);
}

function requireAddress(hex: string): Address {
  const address = Address.fromHex(hex);
  if (!address) throw new Error('Invalid recipient address');
  return address;
}

/** Use the fee the page already rounded. Re-rounding would change the signature. */
function exactFee(e8: bigint): RoundedFee {
  const floor = RoundedFee.fromE8(e8, false);
  if (floor && floor.E8 === e8) return floor;
  const ceil = RoundedFee.fromE8(e8, true);
  if (ceil && ceil.E8 === e8) return ceil;
  throw new Error('Invalid fee');
}

export function signWarthogTx(
  privateKeyHex: string,
  request: WarthogSignRequest,
  expectedAddress?: string,
): TransactionJson | LegacyTransactionJson {
  const account = Account.fromPrivateKeyHex(privateKeyHex);
  if (expectedAddress) {
    const want = expectedAddress.trim().replace(/^0x/i, '').toLowerCase();
    if (account.address.hex.toLowerCase() !== want) {
      throw new Error('The active account changed. Review the transaction again.');
    }
  }
  if (!ChainPin.validate(request.pinHash, request.pinHeight)) throw new Error('Invalid chain pin');
  const nonce = NonceId.fromNumber(request.nonceId);
  if (!nonce) throw new Error('Invalid nonce');
  const feeE8 = readUint(request.feeE8, 'fee');
  const fee = exactFee(feeE8);
  const pin = new ChainPin(request.pinHash, request.pinHeight);
  const legacy = new WarthogLegacyTransactionContext(pin, fee, nonce);
  const defi = new WarthogDeFiTransactionContext(pin, fee, nonce);
  const ctx = request.family === 'defi' ? defi : legacy;
  if (request.op !== 'wartTransfer' && request.family !== 'defi') {
    throw new Error('This transaction needs a DeFi node');
  }

  switch (request.op) {
    case 'wartTransfer': {
      const wart = Wart.fromE8(readUint(request.amountE8, 'WART amount'));
      const to = requireAddress(request.toAddr);
      if (!wart) throw new Error('Invalid WART amount');
      return ctx.transferWart(account, to, wart);
    }
    case 'tokenTransfer': {
      const to = requireAddress(request.toAddr);
      const amount = readUint(request.amountU64, 'token amount');
      if (request.isLiquidity) {
        const units = Liquidity.fromE8(amount);
        if (!units) throw new Error('Invalid liquidity amount');
        return defi.transferLiquidity(account, request.assetHash, to, units);
      }
      const funds = Funds.fromAmount(amount);
      if (!funds) throw new Error('Invalid token amount');
      return defi.transferAsset(account, request.assetHash, to, funds);
    }
    case 'limitSwap': {
      const limit = Price.fromHex(request.limitHex);
      if (!limit) throw new Error('Invalid limit price');
      const amount = readUint(request.amountU64, 'swap amount');
      if (request.isBuy) {
        const wart = Wart.fromE8(amount);
        if (!wart) throw new Error('Invalid WART amount');
        return defi.buy(account, request.assetHash, wart, limit);
      }
      const funds = Funds.fromAmount(amount);
      if (!funds) throw new Error('Invalid token amount');
      return defi.sell(account, request.assetHash, funds, limit);
    }
    case 'liquidityDeposit': {
      const tokens = Funds.fromAmount(readUint(request.amountU64, 'token amount'));
      const wart = Wart.fromE8(readUint(request.wartE8, 'WART amount'));
      if (!tokens) throw new Error('Invalid token amount');
      if (!wart) throw new Error('Invalid WART amount');
      return defi.depositLiquidity(account, request.assetHash, tokens, wart);
    }
    case 'liquidityWithdrawal': {
      const units = Liquidity.fromE8(readUint(request.amountE8, 'liquidity amount'));
      if (!units) throw new Error('Invalid liquidity amount');
      return defi.withdrawLiquidity(account, request.assetHash, units);
    }
    case 'cancelation': {
      const cancelNonce = NonceId.fromNumber(request.cancelNonceId);
      if (!cancelNonce) throw new Error('Invalid cancel nonce');
      return defi.cancelTransaction(account, request.cancelHeight, cancelNonce);
    }
    case 'assetCreation': {
      const supply = Funds.fromAmount(readUint(request.supplyU64, 'supply'));
      if (!supply) throw new Error('Invalid total supply');
      if (!Number.isInteger(request.decimals) || request.decimals < 0 || request.decimals > 18) {
        throw new Error('Decimals must be a whole number from 0 to 18');
      }
      return defi.createAssets(account, supply, new TokenDecimals(request.decimals), request.name);
    }
    default:
      throw new Error('Unknown Warthog transaction');
  }
}
