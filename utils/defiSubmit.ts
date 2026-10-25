import {
  Account,
  Address,
  Funds,
  Liquidity,
  NonceId,
  Price,
  RoundedFee,
  TokenDecimals,
  WarthogDeFiTransactionContext,
  Wart,
  type TransactionJson,
} from 'warthog-ts';
import { encodeLimitPrice } from './encodeLimitPrice';
import {
  createTxContext,
  fetchFeeE8,
  nodeRequest,
  submitWarthogTransaction,
} from './api';
import { isValidAddress } from './crypto';
import { normalizeAssetHash, isValidAssetHash } from './warthogFormat';
import type { WalletData } from '../types';
import { getSessionPrivateKey, isLedgerSession } from './sessionVault';
import { LEDGER_DEFI_HOLD } from './ledger/protocol';

function parseRecipientAddress(raw: string): Address | null {
  const trimmed = raw.trim().replace(/^0x/i, '');
  return Address.fromHex(trimmed) ?? Address.fromRaw(trimmed);
}

export async function signAndSubmitDefiTx(
  node: string,
  wallet: WalletData,
  nonceId: number,
  feeWart: string,
  buildTx: (ctx: WarthogDeFiTransactionContext, account: Account) => TransactionJson
): Promise<{ txHash: string; nonce: number }> {
  if (isLedgerSession()) throw new Error(LEDGER_DEFI_HOLD);

  const feeE8 = await fetchFeeE8(node, feeWart);
  // feeE8 already node-rounded; do not ceil-re-round
  const roundedFee = RoundedFee.fromE8(BigInt(feeE8), false);
  if (!roundedFee) throw new Error('Invalid fee');

  const nonce = NonceId.fromNumber(nonceId);
  if (!nonce) throw new Error('Invalid nonce');

  const account = Account.fromPrivateKeyHex(getSessionPrivateKey());
  const ctx = await createTxContext(node, roundedFee, nonce);
  if (!(ctx instanceof WarthogDeFiTransactionContext)) {
    throw new Error('Switch this wallet to the DeFi testnet before this transaction.');
  }
  const tx = buildTx(ctx, account);
  const result = await submitWarthogTransaction(node, tx);
  return { txHash: result.txHash, nonce: nonceId };
}

export async function submitAssetTransfer(params: {
  node: string;
  wallet: WalletData;
  nonceId: number;
  fee: string;
  assetHash: string;
  toAddress: string;
  amount: string;
  decimals: number;
  isLiquidity?: boolean;
}) {
  const hash = normalizeAssetHash(params.assetHash);
  if (!isValidAssetHash(hash)) throw new Error('Asset hash must be exactly 64 hex characters');

  const recipient = parseRecipientAddress(params.toAddress);
  if (!recipient || !isValidAddress(recipient.hex)) throw new Error('Invalid recipient address');

  const amountStr = params.amount.trim().replace(',', '.');

  return signAndSubmitDefiTx(params.node, params.wallet, params.nonceId, params.fee, (ctx, account) => {
    if (params.isLiquidity) {
      const units = Liquidity.parse(amountStr);
      if (!units) throw new Error('Invalid liquidity amount');
      return ctx.transferLiquidity(account, hash, recipient, units);
    }
    const precision = new TokenDecimals(Math.min(Math.max(params.decimals, 0), 18));
    const tokenAmount = Funds.parse(amountStr, precision);
    if (!tokenAmount) throw new Error('Invalid token amount');
    return ctx.transferAsset(account, hash, recipient, tokenAmount);
  });
}

export async function submitAssetCreation(params: {
  node: string;
  wallet: WalletData;
  nonceId: number;
  fee: string;
  name: string;
  supply: string;
  decimals: number;
}) {
  const assetName = params.name.trim().toUpperCase();
  if (!assetName || assetName.length > 5) throw new Error('Asset name must be 1-5 characters');

  if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 18) {
    throw new Error('Decimals must be a whole number from 0 to 18');
  }

  const precision = new TokenDecimals(params.decimals);
  const totalSupply = Funds.parse(params.supply.trim().replace(',', '.'), precision);
  if (!totalSupply) throw new Error('Invalid total supply');

  return signAndSubmitDefiTx(params.node, params.wallet, params.nonceId, params.fee, (ctx, account) =>
    ctx.createAssets(account, totalSupply, precision, assetName)
  );
}

export async function submitLimitSwap(params: {
  node: string;
  wallet: WalletData;
  nonceId: number;
  fee: string;
  assetHash: string;
  isBuy: boolean;
  amount: string;
  assetDecimals: number;
  limitHex?: string;
  limitPrice?: string;
  /** Prefer ceil when buying (willing to pay more). */
  encodeCeil?: boolean;
}) {
  const hash = normalizeAssetHash(params.assetHash);
  if (!isValidAssetHash(hash)) throw new Error('Asset hash must be exactly 64 hex characters');

  const limitHex = (() => {
    const raw = params.limitHex?.trim().toLowerCase();
    if (raw) {
      if (!/^[0-9a-f]{6}$/.test(raw)) {
        throw new Error('Encoded limit must be exactly 6 hex characters');
      }
      return raw;
    }
    if (!params.limitPrice?.trim()) {
      throw new Error('Encoded limit price is required — enter price + decimals and tap Encode');
    }
    const ceil = params.encodeCeil ?? params.isBuy;
    try {
      return encodeLimitPrice(params.limitPrice, params.assetDecimals, { ceil });
    } catch {
      return encodeLimitPrice(params.limitPrice, params.assetDecimals, { ceil: true });
    }
  })();

  const limit = Price.fromHex(limitHex);
  if (!limit) throw new Error('Invalid limit price encoding');

  const amountStr = params.amount.trim().replace(',', '.');

  return signAndSubmitDefiTx(params.node, params.wallet, params.nonceId, params.fee, (ctx, account) => {
    if (params.isBuy) {
      const wartAmount = Wart.parse(amountStr);
      if (!wartAmount) throw new Error('Invalid WART amount');
      return ctx.buy(account, hash, wartAmount, limit);
    }
    const precision = new TokenDecimals(Math.min(Math.max(params.assetDecimals, 0), 18));
    const tokenAmount = Funds.parse(amountStr, precision);
    if (!tokenAmount) throw new Error('Invalid token amount');
    return ctx.sell(account, hash, tokenAmount, limit);
  });
}

export async function submitLiquidityDeposit(params: {
  node: string;
  wallet: WalletData;
  nonceId: number;
  fee: string;
  assetHash: string;
  assetAmount: string;
  decimals: number;
  wartAmount: string;
}) {
  const hash = normalizeAssetHash(params.assetHash);
  if (!isValidAssetHash(hash)) throw new Error('Asset hash must be exactly 64 hex characters');

  const precision = new TokenDecimals(Math.min(Math.max(params.decimals, 0), 18));
  const tokenAmount = Funds.parse(params.assetAmount.trim().replace(',', '.'), precision);
  if (!tokenAmount) throw new Error('Invalid asset amount');

  const wart = Wart.parse(params.wartAmount.trim().replace(',', '.'));
  if (!wart) throw new Error('Invalid WART amount');

  return signAndSubmitDefiTx(params.node, params.wallet, params.nonceId, params.fee, (ctx, account) =>
    ctx.depositLiquidity(account, hash, tokenAmount, wart)
  );
}

export async function submitLiquidityWithdraw(params: {
  node: string;
  wallet: WalletData;
  nonceId: number;
  fee: string;
  assetHash: string;
  shares: string;
}) {
  const hash = normalizeAssetHash(params.assetHash);
  if (!isValidAssetHash(hash)) throw new Error('Asset hash must be exactly 64 hex characters');

  const units = Liquidity.parse(params.shares.trim().replace(',', '.'));
  if (!units) throw new Error('Invalid LP shares amount');

  return signAndSubmitDefiTx(params.node, params.wallet, params.nonceId, params.fee, (ctx, account) =>
    ctx.withdrawLiquidity(account, hash, units)
  );
}

async function resolveOrderCancelTarget(
  node: string,
  txHash: string,
  accountAddress: string
): Promise<{ cancelHeight: number; cancelNonceId: number }> {
  const normalized = txHash.trim().toLowerCase();

  const lookup = await nodeRequest<{ transaction?: { signedCommon?: { pinHeight?: number; nonceId?: number } } }>(
    node,
    `/transaction/lookup/${normalized}`,
  );
  if (lookup.success) {
    const signedCommon = lookup.data?.transaction?.signedCommon;
    if (signedCommon?.pinHeight != null && signedCommon?.nonceId != null) {
      return {
        cancelHeight: Number(signedCommon.pinHeight),
        cancelNonceId: Number(signedCommon.nonceId),
      };
    }
  }

  const mempool = await nodeRequest<unknown>(node, `/account/${accountAddress}/mempool`);
  if (mempool.success && Array.isArray(mempool.data)) {
    for (const entry of mempool.data as Array<{ transaction?: { hash?: string; signedCommon?: { pinHeight?: number; nonceId?: number } } }>) {
      const hash = entry?.transaction?.hash;
      if (hash?.toLowerCase() !== normalized) continue;
      const signedCommon = entry.transaction?.signedCommon;
      if (signedCommon?.pinHeight != null && signedCommon?.nonceId != null) {
        return {
          cancelHeight: Number(signedCommon.pinHeight),
          cancelNonceId: Number(signedCommon.nonceId),
        };
      }
    }
  }

  const lookupErr = !lookup.success ? (lookup as { error?: string }).error : undefined;
  throw new Error(lookupErr || 'Could not resolve order details for cancel');
}

export async function submitCancelLimitOrder(params: {
  node: string;
  wallet: WalletData;
  nonceId: number;
  fee: string;
  orderTxHash: string;
}) {
  const target = await resolveOrderCancelTarget(params.node, params.orderTxHash, params.wallet.address);

  const cancelNonce = NonceId.fromNumber(target.cancelNonceId);
  if (!cancelNonce) {
    throw new Error('Invalid cancel order nonce');
  }

  return signAndSubmitDefiTx(params.node, params.wallet, params.nonceId, params.fee, (ctx, account) =>
    ctx.cancelTransaction(account, target.cancelHeight, cancelNonce)
  );
}