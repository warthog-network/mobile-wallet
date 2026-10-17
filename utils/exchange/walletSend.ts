import {
  Account,
  Address,
  NonceId,
  RoundedFee,
  Wart,
} from 'warthog-ts';
import { DEFAULT_FEE } from '../../constants';
import { createTxContext, fetchAccountBalance, fetchFeeE8, submitWarthogTransaction } from '../api';
import { isValidAddress } from '../crypto';
import { isDefiNode } from '../nodes';
import { getSessionPrivateKey } from '../sessionVault';
import { amountExceedsAvailable, insufficientFreeBalanceMessage } from '../warthogFormat';

/** Send WART from the open wallet to a SafeTrade deposit address. */
export async function sendWartFromWallet(opts: {
  node: string;
  nonceId: number;
  fromAddress: string;
  toAddress: string;
  amount: string;
}): Promise<{ txHash: string; nextNonce: number }> {
  if (isDefiNode(opts.node)) {
    throw new Error('Switch this wallet to Warthog mainnet before sending WART to SafeTrade.');
  }
  const to = opts.toAddress.trim().replace(/^0x/i, '');
  if (!isValidAddress(to)) {
    throw new Error('SafeTrade returned a WART deposit address this wallet will not use.');
  }
  if (to.toLowerCase() === opts.fromAddress.trim().toLowerCase()) {
    throw new Error('That deposit address is this wallet.');
  }
  const live = await fetchAccountBalance(opts.node, opts.fromAddress);
  if (amountExceedsAvailable(opts.amount, live.availableStr)) {
    throw new Error(insufficientFreeBalanceMessage({
      available: live.availableStr,
      locked: live.lockedStr,
      unit: 'WART',
    }));
  }
  const amountNum = Number(opts.amount);
  const freeNum = Number(live.availableStr);
  const feeNum = Number(DEFAULT_FEE);
  if (Number.isFinite(amountNum) && Number.isFinite(freeNum) && amountNum + feeNum > freeNum + 1e-8) {
    throw new Error(`Only ${live.availableStr} WART is free. This send also needs a ${DEFAULT_FEE} WART fee.`);
  }
  const recipient = Address.fromHex(to);
  const wartAmount = Wart.parse(opts.amount.trim());
  if (!recipient || !wartAmount) {
    throw new Error('SafeTrade returned a WART deposit address this wallet will not use.');
  }
  const feeE8 = await fetchFeeE8(opts.node, DEFAULT_FEE);
  const roundedFee = RoundedFee.fromE8(BigInt(feeE8), false);
  if (!roundedFee) throw new Error('Invalid fee');
  const nonce = NonceId.fromNumber(opts.nonceId);
  if (!nonce) throw new Error('Invalid nonce');
  const account = Account.fromPrivateKeyHex(getSessionPrivateKey());
  const ctx = await createTxContext(opts.node, roundedFee, nonce);
  const tx = ctx.transferWart(account, recipient, wartAmount);
  const result = await submitWarthogTransaction(opts.node, tx);
  return { txHash: result.txHash, nextNonce: opts.nonceId + 1 };
}
