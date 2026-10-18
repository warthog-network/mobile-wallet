import { ethers } from 'ethers';
import { deriveEthWallet } from '../evmAddress';
import { signEthereumOnLedger } from '../ledger/ethereum';
import { LedgerError } from '../ledger/protocol';
import { getLedgerSession, getSessionMnemonic } from '../sessionVault';
import { HEMI_CHAIN_ID, HEMI_DECIMALS, HEMI_EXPLORER, HEMI_RPC } from './chains';
import { networkFetch } from './http';
import { formatUnits, parseUnits } from './units';

const network = ethers.Network.from(HEMI_CHAIN_ID);

function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(HEMI_RPC, network, { staticNetwork: network });
}

async function feeCap(client: ethers.JsonRpcProvider): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const fees = await client.getFeeData();
  const priority = fees.maxPriorityFeePerGas ?? 1_000_000n;
  const max = fees.maxFeePerGas ?? (fees.gasPrice ?? 1_000_000_000n);
  return {
    maxPriorityFeePerGas: priority,
    maxFeePerGas: max > priority ? max : priority * 2n,
  };
}

export function parseHemi(amount: string): bigint {
  return parseUnits(amount, HEMI_DECIMALS, 'ETH');
}

export function formatHemi(wei: bigint): string {
  return formatUnits(wei, HEMI_DECIMALS);
}

export async function fetchHemiBalance(address: string): Promise<bigint> {
  const res = await networkFetch(HEMI_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });
  if (!res.ok) throw new Error('Could not load the Hemi balance.');
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || 'Could not load the Hemi balance.');
  if (typeof body.result !== 'string') throw new Error('Could not load the Hemi balance.');
  return BigInt(body.result);
}

/** Leave room for the Hemi gas price and the L1 data fee on a plain transfer. */
export async function maxSendableHemi(address: string): Promise<bigint> {
  const client = provider();
  const [balance, fees] = await Promise.all([client.getBalance(address), feeCap(client)]);
  const reserve = 100_000n * fees.maxFeePerGas;
  return balance > reserve ? balance - reserve : 0n;
}

export async function quoteHemiFee(): Promise<bigint> {
  const fees = await feeCap(provider());
  return 21_000n * fees.maxFeePerGas;
}

async function sendWithLedger(
  client: ethers.JsonRpcProvider,
  address: string,
  to: string,
  value: bigint,
): Promise<string> {
  const fees = await feeCap(client);
  const gasLimit = await client.estimateGas({ from: address, to, value });
  const nonce = await client.getTransactionCount(address, 'pending');
  const unsigned = ethers.Transaction.from({
    type: 2,
    chainId: HEMI_CHAIN_ID,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    gasLimit,
    to,
    value,
    data: '0x',
  });
  const signature = await signEthereumOnLedger(unsigned.unsignedSerialized);
  unsigned.signature = signature;
  if ((unsigned.from ?? '').toLowerCase() !== address.toLowerCase()) {
    throw new LedgerError('This Nano Ethereum account does not match the saved address.');
  }
  const tx = await client.broadcastTransaction(unsigned.serialized);
  await tx.wait();
  return tx.hash;
}

export async function sendHemi(to: string, amount: string): Promise<{ hash: string }> {
  const destination = to.trim();
  if (!ethers.isAddress(destination)) {
    throw new Error('Enter a Hemi address. It is the same shape as an Ethereum address.');
  }
  const value = parseHemi(amount);
  const client = provider();
  const ledger = getLedgerSession();
  if (ledger) {
    if (!ledger.ethAddress) {
      throw new Error('Add the Ethereum account from the home screen. Hemi uses that address.');
    }
    const from = ethers.getAddress(ledger.ethAddress);
    if (from.toLowerCase() === destination.toLowerCase()) {
      throw new Error('That is this wallet’s Hemi address.');
    }
    const hash = await sendWithLedger(client, from, destination, value);
    return { hash };
  }
  const mnemonic = getSessionMnemonic();
  if (!mnemonic) {
    throw new Error('This wallet has no recovery phrase, so it cannot sign Hemi transactions.');
  }
  const wallet = deriveEthWallet(mnemonic).connect(client);
  if (wallet.address.toLowerCase() === destination.toLowerCase()) {
    throw new Error('That is this wallet’s Hemi address.');
  }
  const tx = await wallet.sendTransaction({ to: destination, value });
  await tx.wait();
  return { hash: tx.hash };
}

export function hemiTxUrl(hash: string): string {
  return `${HEMI_EXPLORER}/tx/${hash}`;
}
