import { ethers } from 'ethers';
import { formatRawAmount } from './ethHoldings';
import { signEthereumOnLedger } from './ledger/ethereum';
import { LedgerError } from './ledger/protocol';
import { chainPublic, getLedgerSession, getSessionAccountIndex, signEthereum } from './sessionVault';
import { ETH_CHAIN_ID, ETH_RPC, ETH_USDT, ETH_WETH, SUSHI_ROUTER } from './ethTokens';

export type EthSendAsset = 'ETH' | 'USDT';
export type SwapDirection = 'ETH_TO_USDT' | 'USDT_TO_ETH';

export interface SubmittedEthTx {
  hash: string;
  blockNumber: number;
}

export interface SwapQuote {
  direction: SwapDirection;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
  slippageBps: number;
}

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function transfer(address,uint256)',
  'function approve(address,uint256)',
];

const ROUTER_ABI = [
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function swapExactETHForTokens(uint256,address[],address,uint256) payable',
  'function swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
  'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
];

const network = ethers.Network.from(ETH_CHAIN_ID);

function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(ETH_RPC, network, { staticNetwork: network });
}

async function assertMainnet(client: ethers.JsonRpcProvider): Promise<void> {
  const hex = await client.send('eth_chainId', []);
  if (BigInt(hex) !== BigInt(ETH_CHAIN_ID)) {
    throw new Error('Ethereum RPC is not mainnet.');
  }
}

type Spender = {
  client: ethers.JsonRpcProvider;
  address: string;
  estimate: (tx: ethers.TransactionRequest) => Promise<bigint>;
  send: (tx: ethers.TransactionRequest) => Promise<ethers.TransactionResponse>;
};

async function sendWithLedger(
  client: ethers.JsonRpcProvider,
  address: string,
  tx: ethers.TransactionRequest,
): Promise<ethers.TransactionResponse> {
  if (tx.to == null) throw new Error('This transaction has no recipient.');
  const to = await ethers.resolveAddress(tx.to);
  const fees = tx.maxFeePerGas != null && tx.maxPriorityFeePerGas != null
    ? {
      maxFeePerGas: BigInt(tx.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
    }
    : await feeCap(client);
  const value = tx.value == null ? 0n : BigInt(tx.value);
  const data = tx.data == null ? '0x' : ethers.hexlify(tx.data);
  const gasLimit = tx.gasLimit == null
    ? await client.estimateGas({ from: address, to, value, data })
    : BigInt(tx.gasLimit);
  const nonce = tx.nonce == null
    ? await client.getTransactionCount(address, 'pending')
    : Number(tx.nonce);
  const unsigned = ethers.Transaction.from({
    type: 2,
    chainId: ETH_CHAIN_ID,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    gasLimit,
    to,
    value,
    data,
  });
  const signature = await signEthereumOnLedger(unsigned.unsignedSerialized);
  unsigned.signature = signature;
  if ((unsigned.from ?? '').toLowerCase() !== address.toLowerCase()) {
    throw new LedgerError('This Nano Ethereum account does not match the saved address.');
  }
  return client.broadcastTransaction(unsigned.serialized);
}

async function sendWithPhrase(
  client: ethers.JsonRpcProvider,
  address: string,
  index: number,
  tx: ethers.TransactionRequest,
): Promise<ethers.TransactionResponse> {
  if (tx.to == null) throw new Error('This transaction has no recipient.');
  const to = await ethers.resolveAddress(tx.to);
  const fees = tx.maxFeePerGas != null && tx.maxPriorityFeePerGas != null
    ? {
      maxFeePerGas: BigInt(tx.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
    }
    : await feeCap(client);
  const value = tx.value == null ? 0n : BigInt(tx.value);
  const data = tx.data == null ? '0x' : ethers.hexlify(tx.data);
  const gasLimit = tx.gasLimit == null
    ? await client.estimateGas({ from: address, to, value, data })
    : BigInt(tx.gasLimit);
  const nonce = tx.nonce == null
    ? await client.getTransactionCount(address, 'pending')
    : Number(tx.nonce);
  const unsigned = ethers.Transaction.from({
    type: 2,
    chainId: ETH_CHAIN_ID,
    nonce,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    gasLimit,
    to,
    value,
    data,
  });
  unsigned.signature = signEthereum(index, unsigned.unsignedSerialized);
  if ((unsigned.from ?? '').toLowerCase() !== address.toLowerCase()) {
    throw new Error('The signing key does not match this Ethereum address.');
  }
  return client.broadcastTransaction(unsigned.serialized);
}

async function openSpender(): Promise<Spender> {
  const ledger = getLedgerSession();
  if (ledger) {
    if (!ledger.ethAddress) {
      throw new Error('Add the Ethereum account from the home screen. The Ethereum app on the Nano has to approve it.');
    }
    const client = provider();
    const address = ethers.getAddress(ledger.ethAddress);
    return {
      client,
      address,
      estimate: (tx) => client.estimateGas({ ...tx, from: address }),
      send: (tx) => sendWithLedger(client, address, tx),
    };
  }
  const index = getSessionAccountIndex();
  const pubs = chainPublic(index);
  if (!pubs) {
    throw new Error('This wallet has no recovery phrase, so it cannot sign Ethereum transactions.');
  }
  const client = provider();
  const address = ethers.getAddress(pubs.ethAddress);
  return {
    client,
    address,
    estimate: (tx) => client.estimateGas({ ...tx, from: address }),
    send: (tx) => sendWithPhrase(client, address, index, tx),
  };
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  const text = amount.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Enter a positive amount.');
  const [whole, frac = ''] = text.split('.');
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const raw = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(frac.padEnd(decimals, '0'));
  if (raw <= 0n) throw new Error('Enter an amount greater than zero.');
  return raw;
}

export function minOut(amountOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps >= 10_000) {
    throw new Error('Slippage must be between 0.01% and 99.99%.');
  }
  const min = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
  if (min <= 0n) throw new Error('That slippage leaves nothing to receive.');
  return min;
}

export function explainEthError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const nested = error && typeof error === 'object'
    ? String((error as { shortMessage?: string }).shortMessage || raw)
    : raw;
  const text = nested.replace(/^execution reverted:?\s*/i, '');
  if (/insufficient funds/i.test(text)) return 'Not enough ETH for this amount and the gas.';
  if (/transfer amount exceeds balance|exceeds balance/i.test(text)) return 'The balance is too small for that amount.';
  if (/INSUFFICIENT_OUTPUT_AMOUNT|too little received/i.test(text)) {
    return 'The price moved past your slippage. Quote it again.';
  }
  if (/blacklist/i.test(text)) return 'USDT rejected this address.';
  return text || 'Ethereum transaction failed.';
}

async function feeCap(client: ethers.Provider): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const fees = await client.getFeeData();
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (maxFeePerGas == null || maxFeePerGas <= 0n) throw new Error('Could not read the Ethereum gas price.');
  const tip = fees.maxPriorityFeePerGas ?? 1_000_000_000n;
  return {
    maxFeePerGas,
    maxPriorityFeePerGas: tip > maxFeePerGas ? maxFeePerGas : tip,
  };
}

function pathFor(direction: SwapDirection): string[] {
  return direction === 'ETH_TO_USDT' ? [ETH_WETH, ETH_USDT] : [ETH_USDT, ETH_WETH];
}

export async function readRawHoldings(address: string): Promise<{ eth: bigint; usdt: bigint }> {
  const client = provider();
  try {
    await assertMainnet(client);
    const usdt = new ethers.Contract(ETH_USDT, ERC20_ABI, client);
    const [eth, rawUsdt] = await Promise.all([
      client.getBalance(address),
      usdt.balanceOf(address) as Promise<bigint>,
    ]);
    return { eth, usdt: rawUsdt };
  } finally {
    client.destroy();
  }
}

/** Largest ETH transfer that still leaves gas behind. */
export async function maxSendableEth(address: string): Promise<bigint> {
  const client = provider();
  try {
    const [balance, fees] = await Promise.all([client.getBalance(address), feeCap(client)]);
    const reserve = 21_000n * fees.maxFeePerGas;
    return balance > reserve ? balance - reserve : 0n;
  } finally {
    client.destroy();
  }
}

/** Largest ETH amount that can be swapped, leaving gas for the SushiSwap transaction. */
export async function maxSwapEth(address: string): Promise<bigint> {
  const client = provider();
  try {
    const [balance, fees] = await Promise.all([client.getBalance(address), feeCap(client)]);
    const reserve = 250_000n * fees.maxFeePerGas;
    return balance > reserve ? balance - reserve : 0n;
  } finally {
    client.destroy();
  }
}

async function confirmedBlock(
  tx: ethers.TransactionResponse,
  onStatus?: (text: string) => void,
): Promise<number> {
  onStatus?.('Waiting for Ethereum to confirm…');
  const receipt = await tx.wait();
  if (receipt == null || receipt.status !== 1) {
    throw new Error('Ethereum rejected the transaction.');
  }
  const blockNumber = Number(receipt.blockNumber);
  if (!Number.isFinite(blockNumber)) {
    throw new Error('Ethereum confirmed the transaction without a block number.');
  }
  return blockNumber;
}

async function assertGas(client: ethers.Provider, address: string, gasLimit: bigint): Promise<void> {
  const [balance, fees] = await Promise.all([client.getBalance(address), feeCap(client)]);
  const cost = gasLimit * fees.maxFeePerGas;
  if (balance < cost) {
    throw new Error(`This needs about ${formatRawAmount(cost, 18, 6)} ETH for gas.`);
  }
}

/** Contract call on Ethereum mainnet. A Nano needs Blind signing when `data` is present. */
export async function sendEthCall(request: {
  to: string;
  data: string;
  value?: bigint;
}): Promise<ethers.TransactionReceipt> {
  const spender = await openSpender();
  try {
    await assertMainnet(spender.client);
    const to = ethers.getAddress(request.to);
    const value = request.value ?? 0n;
    const data = request.data;
    const fees = await feeCap(spender.client);
    const gasLimit = (await spender.estimate({ to, data, value })) * 12n / 10n;
    const balance = await spender.client.getBalance(spender.address);
    if (value + gasLimit * fees.maxFeePerGas > balance) {
      throw new Error('Leave some ETH for the Ethereum network fee. The bridged amount is on top of gas.');
    }
    const tx = await spender.send({ to, data, value, gasLimit, ...fees });
    const receipt = await tx.wait();
    if (receipt == null || receipt.status !== 1) throw new Error('Ethereum rejected the transaction.');
    return receipt;
  } finally {
    spender.client.destroy();
  }
}

export async function sendEthAsset(asset: EthSendAsset, to: string, amount: string): Promise<SubmittedEthTx> {
  let recipient: string;
  try {
    recipient = ethers.getAddress(to.trim());
  } catch {
    throw new Error('Enter a valid Ethereum address.');
  }
  const spender = await openSpender();
  try {
    await assertMainnet(spender.client);
    if (recipient.toLowerCase() === spender.address.toLowerCase()) {
      throw new Error('That address is this wallet.');
    }
    const fees = await feeCap(spender.client);
    if (asset === 'ETH') {
      const value = parseTokenAmount(amount, 18);
      const balance = await spender.client.getBalance(spender.address);
      let gasLimit = 21_000n;
      try {
        const estimated = await spender.estimate({ to: recipient, value });
        if (estimated > gasLimit) gasLimit = estimated * 12n / 10n;
      } catch {
        // A plain transfer uses 21,000. An amount the balance cannot cover fails the check below.
      }
      const cost = gasLimit * fees.maxFeePerGas;
      if (value + cost > balance) {
        const max = balance > cost ? balance - cost : 0n;
        throw new Error(`Not enough ETH. The most you can send is ${formatRawAmount(max, 18, 6)} after gas.`);
      }
      const tx = await spender.send({ to: recipient, value, gasLimit, ...fees });
      return { hash: tx.hash, blockNumber: await confirmedBlock(tx) };
    }
    const value = parseTokenAmount(amount, 6);
    const token = new ethers.Contract(ETH_USDT, ERC20_ABI, spender.client);
    const balance = await token.balanceOf(spender.address) as bigint;
    if (value > balance) {
      throw new Error(`Only ${formatRawAmount(balance, 6, 6)} USDT is in this wallet.`);
    }
    const data = token.interface.encodeFunctionData('transfer', [recipient, value]);
    const gasLimit = (await spender.estimate({ to: ETH_USDT, data })) * 12n / 10n;
    await assertGas(spender.client, spender.address, gasLimit);
    const tx = await spender.send({ to: ETH_USDT, data, gasLimit, ...fees });
    return { hash: tx.hash, blockNumber: await confirmedBlock(tx) };
  } finally {
    spender.client.destroy();
  }
}

async function quoteFromRaw(
  direction: SwapDirection,
  amountIn: bigint,
  slippageBps: number,
): Promise<SwapQuote> {
  const client = provider();
  try {
    await assertMainnet(client);
    const router = new ethers.Contract(SUSHI_ROUTER, ROUTER_ABI, client);
    const amounts = await router.getAmountsOut(amountIn, pathFor(direction)) as bigint[];
    const amountOut = amounts[amounts.length - 1] ?? 0n;
    if (amountOut <= 0n) throw new Error('SushiSwap has no price for that amount.');
    return {
      direction,
      amountIn,
      amountOut,
      amountOutMin: minOut(amountOut, slippageBps),
      slippageBps,
    };
  } finally {
    client.destroy();
  }
}

export async function quoteSushiSwap(
  direction: SwapDirection,
  amount: string,
  slippageBps: number,
): Promise<SwapQuote> {
  const decimals = direction === 'ETH_TO_USDT' ? 18 : 6;
  return quoteFromRaw(direction, parseTokenAmount(amount, decimals), slippageBps);
}

export async function usdtAllowance(owner: string): Promise<bigint> {
  const client = provider();
  try {
    const token = new ethers.Contract(ETH_USDT, ERC20_ABI, client);
    return await token.allowance(owner, SUSHI_ROUTER) as bigint;
  } finally {
    client.destroy();
  }
}

/**
 * Swap ETH and USDT through the SushiSwap V2 router.
 * USDT spends an approval first when the router is not already allowed to take the amount.
 * Returns after the swap is confirmed, plus the approval hash when one was sent.
 */
export async function executeSushiSwap(
  quote: SwapQuote,
  onStatus?: (text: string) => void,
): Promise<SubmittedEthTx & { approvalHash?: string }> {
  const spender = await openSpender();
  const ledger = Boolean(getLedgerSession());
  const approveText = ledger
    ? 'Approve on the Ledger. The Ethereum app must stay open.'
    : 'Sending the swap…';
  try {
    await assertMainnet(spender.client);
    const fresh = await quoteFromRaw(quote.direction, quote.amountIn, quote.slippageBps);
    if (fresh.amountOut < quote.amountOutMin) {
      throw new Error('The price moved past the minimum you confirmed. Quote it again.');
    }
    const fees = await feeCap(spender.client);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    const router = new ethers.Contract(SUSHI_ROUTER, ROUTER_ABI, spender.client);
    const path = pathFor(quote.direction);

    if (quote.direction === 'ETH_TO_USDT') {
      onStatus?.(approveText);
      const data = router.interface.encodeFunctionData('swapExactETHForTokens', [
        quote.amountOutMin,
        path,
        spender.address,
        deadline,
      ]);
      const gasLimit = (await spender.estimate({ to: SUSHI_ROUTER, data, value: quote.amountIn })) * 12n / 10n;
      const balance = await spender.client.getBalance(spender.address);
      if (quote.amountIn + gasLimit * fees.maxFeePerGas > balance) {
        throw new Error('Not enough ETH to cover the swap and the gas.');
      }
      const tx = await spender.send({ to: SUSHI_ROUTER, data, value: quote.amountIn, gasLimit, ...fees });
      return { hash: tx.hash, blockNumber: await confirmedBlock(tx, onStatus) };
    }

    const token = new ethers.Contract(ETH_USDT, ERC20_ABI, spender.client);
    const balance = await token.balanceOf(spender.address) as bigint;
    if (quote.amountIn > balance) {
      throw new Error(`Only ${formatRawAmount(balance, 6, 6)} USDT is in this wallet.`);
    }
    let allowance = await token.allowance(spender.address, SUSHI_ROUTER) as bigint;
    let approvalHash: string | undefined;
    if (allowance < quote.amountIn) {
      if (allowance > 0n) {
        onStatus?.(ledger ? 'Approve clearing the old USDT allowance on the Ledger.' : 'Clearing the old USDT approval…');
        const resetData = token.interface.encodeFunctionData('approve', [SUSHI_ROUTER, 0n]);
        const resetTx = await spender.send({ to: ETH_USDT, data: resetData, ...fees });
        await resetTx.wait();
      }
      onStatus?.(ledger ? 'Approve the USDT allowance on the Ledger.' : 'Approving USDT for SushiSwap…');
      const approveData = token.interface.encodeFunctionData('approve', [SUSHI_ROUTER, quote.amountIn]);
      const approveTx = await spender.send({ to: ETH_USDT, data: approveData, ...fees });
      approvalHash = approveTx.hash;
      await approveTx.wait();
    }
    onStatus?.(approveText);
    const data = router.interface.encodeFunctionData('swapExactTokensForETH', [
      quote.amountIn,
      quote.amountOutMin,
      path,
      spender.address,
      deadline,
    ]);
    const gasLimit = (await spender.estimate({ to: SUSHI_ROUTER, data })) * 12n / 10n;
    await assertGas(spender.client, spender.address, gasLimit);
    const tx = await spender.send({ to: SUSHI_ROUTER, data, gasLimit, ...fees });
    return { hash: tx.hash, approvalHash, blockNumber: await confirmedBlock(tx, onStatus) };
  } finally {
    spender.client.destroy();
  }
}

export type SushiLeg = {
  symbol: string;
  /** WETH when this leg is native ETH. The router path uses that address. */
  address: string;
  decimals: number;
  native: boolean;
};

export type SushiPairQuote = {
  pay: SushiLeg;
  receive: SushiLeg;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
  slippageBps: number;
};

export const SUSHI_ETH: SushiLeg = { symbol: 'ETH', address: ETH_WETH, decimals: 18, native: true };
export const SUSHI_USDT: SushiLeg = { symbol: 'USDT', address: ETH_USDT, decimals: 6, native: false };

function pathForLegs(pay: SushiLeg, receive: SushiLeg): string[] {
  if (pay.native && receive.native) throw new Error('Choose two different assets.');
  if (!pay.native && !receive.native && pay.address.toLowerCase() === receive.address.toLowerCase()) {
    throw new Error('Choose two different assets.');
  }
  if (pay.native) return [ETH_WETH, ethers.getAddress(receive.address)];
  if (receive.native) return [ethers.getAddress(pay.address), ETH_WETH];
  return [ethers.getAddress(pay.address), ETH_WETH, ethers.getAddress(receive.address)];
}

async function quoteLegs(pay: SushiLeg, receive: SushiLeg, amountIn: bigint, slippageBps: number): Promise<SushiPairQuote> {
  const client = provider();
  try {
    await assertMainnet(client);
    const router = new ethers.Contract(SUSHI_ROUTER, ROUTER_ABI, client);
    let amounts: bigint[];
    try {
      amounts = await router.getAmountsOut(amountIn, pathForLegs(pay, receive)) as bigint[];
    } catch {
      throw new Error('SushiSwap has no route for that pair.');
    }
    const amountOut = amounts[amounts.length - 1] ?? 0n;
    if (amountOut <= 0n) throw new Error('SushiSwap has no route for that pair.');
    return { pay, receive, amountIn, amountOut, amountOutMin: minOut(amountOut, slippageBps), slippageBps };
  } finally {
    client.destroy();
  }
}

/** SushiSwap V2 through WETH. A pair with no pool throws instead of inventing a price. */
export async function quoteSushiPair(
  pay: SushiLeg,
  receive: SushiLeg,
  amountIn: bigint,
  slippageBps: number,
): Promise<SushiPairQuote> {
  return quoteLegs(pay, receive, amountIn, slippageBps);
}

export async function routerAllowance(token: string, owner: string): Promise<bigint> {
  const client = provider();
  try {
    const contract = new ethers.Contract(token, ERC20_ABI, client);
    return await contract.allowance(owner, SUSHI_ROUTER) as bigint;
  } finally {
    client.destroy();
  }
}

/**
 * Swap two Ethereum assets on SushiSwap V2.
 * The router is the only destination. USDT still clears a leftover allowance first.
 */
export async function executeSushiPair(
  quote: SushiPairQuote,
  onStatus?: (text: string) => void,
): Promise<SubmittedEthTx & { approvalHash?: string }> {
  const spender = await openSpender();
  const ledger = Boolean(getLedgerSession());
  const approveText = ledger
    ? 'Approve on the Ledger. The Ethereum app must stay open.'
    : 'Sending the swap…';
  try {
    await assertMainnet(spender.client);
    const fresh = await quoteLegs(quote.pay, quote.receive, quote.amountIn, quote.slippageBps);
    if (fresh.amountOut < quote.amountOutMin) {
      throw new Error('The price moved past the minimum you confirmed. Quote it again.');
    }
    const fees = await feeCap(spender.client);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    const router = new ethers.Contract(SUSHI_ROUTER, ROUTER_ABI, spender.client);
    const path = pathForLegs(quote.pay, quote.receive);

    let approvalHash: string | undefined;
    if (!quote.pay.native) {
      const token = new ethers.Contract(quote.pay.address, ERC20_ABI, spender.client);
      const balance = await token.balanceOf(spender.address) as bigint;
      if (quote.amountIn > balance) {
        throw new Error(`Only ${formatRawAmount(balance, quote.pay.decimals, 6)} ${quote.pay.symbol} is in this wallet.`);
      }
      let allowance = await token.allowance(spender.address, SUSHI_ROUTER) as bigint;
      const usdt = quote.pay.address.toLowerCase() === ETH_USDT.toLowerCase();
      if (allowance < quote.amountIn) {
        if (usdt && allowance > 0n) {
          onStatus?.(ledger ? 'Approve clearing the old USDT allowance on the Ledger.' : 'Clearing the old USDT approval…');
          const resetData = token.interface.encodeFunctionData('approve', [SUSHI_ROUTER, 0n]);
          const resetTx = await spender.send({ to: quote.pay.address, data: resetData, ...fees });
          await resetTx.wait();
        }
        onStatus?.(ledger ? `Approve the ${quote.pay.symbol} allowance on the Ledger.` : `Approving ${quote.pay.symbol} for SushiSwap…`);
        const approveData = token.interface.encodeFunctionData('approve', [SUSHI_ROUTER, quote.amountIn]);
        const approveTx = await spender.send({ to: quote.pay.address, data: approveData, ...fees });
        approvalHash = approveTx.hash;
        await approveTx.wait();
        allowance = quote.amountIn;
      }
    }

    onStatus?.(approveText);
    const method = quote.pay.native
      ? 'swapExactETHForTokens'
      : quote.receive.native
        ? 'swapExactTokensForETH'
        : 'swapExactTokensForTokens';
    const args = quote.pay.native
      ? [quote.amountOutMin, path, spender.address, deadline]
      : [quote.amountIn, quote.amountOutMin, path, spender.address, deadline];
    const data = router.interface.encodeFunctionData(method, args);
    const value = quote.pay.native ? quote.amountIn : 0n;
    const gasLimit = (await spender.estimate({ to: SUSHI_ROUTER, data, value })) * 12n / 10n;
    if (quote.pay.native) {
      const balance = await spender.client.getBalance(spender.address);
      if (quote.amountIn + gasLimit * fees.maxFeePerGas > balance) {
        throw new Error('Not enough ETH to cover the swap and the gas.');
      }
    } else {
      await assertGas(spender.client, spender.address, gasLimit);
    }
    const tx = await spender.send({ to: SUSHI_ROUTER, data, value, gasLimit, ...fees });
    return { hash: tx.hash, approvalHash, blockNumber: await confirmedBlock(tx, onStatus) };
  } finally {
    spender.client.destroy();
  }
}
