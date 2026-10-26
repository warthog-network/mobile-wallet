import AsyncStorage from '@react-native-async-storage/async-storage';
import { ethers } from 'ethers';
import { sendEthCall } from '../ethChain';
import { ETH_CHAIN_ID, ETH_RPC } from '../ethTokens';
import {
  BRIDGE_MIN_GAS,
  HEMI_CHAIN_ID,
  HEMI_RPC,
  L1_STANDARD_BRIDGE,
  L2_MESSAGE_PASSER,
  L2_OUTPUT_ORACLE,
  L2_STANDARD_BRIDGE,
  OPTIMISM_PORTAL,
} from './chains';
import { sendHemiCall } from './hemi';

const STORE_KEY = 'warthogHemiEthMoves';

/** Usual time for Hemi to derive an Ethereum deposit after that Ethereum block. */
export const ETH_DERIVE_SECONDS = 180;

/** Measured from Hemi blocks 120 apart. Used only for the output countdown. */
const HEMI_BLOCK_SECONDS = 12;

const coder = ethers.AbiCoder.defaultAbiCoder();

const bridgeAbi = [
  'function bridgeETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable',
  'function paused() view returns (bool)',
];

const oracleAbi = [
  'function latestOutputIndex() view returns (uint256)',
  'function getL2Output(uint256) view returns (tuple(bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber))',
  'function FINALIZATION_PERIOD_SECONDS() view returns (uint256)',
  'function SUBMISSION_INTERVAL() view returns (uint256)',
];

const portalAbi = [
  'function paused() view returns (bool)',
  'function proveWithdrawalTransaction((uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data) _tx, uint256 _l2OutputIndex, (bytes32 version, bytes32 stateRoot, bytes32 messagePasserStorageRoot, bytes32 latestBlockhash) _outputRootProof, bytes[] _withdrawalProof)',
  'function finalizeWithdrawalTransaction((uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data) _tx)',
  'function provenWithdrawals(bytes32) view returns (bytes32 outputRoot, uint128 timestamp, uint128 l2OutputIndex)',
  'function finalizedWithdrawals(bytes32) view returns (bool)',
];

const messagePassed = new ethers.Interface([
  'event MessagePassed(uint256 indexed nonce, address indexed sender, address indexed target, uint256 value, uint256 gasLimit, bytes data, bytes32 withdrawalHash)',
]);

const bridgeInterface = new ethers.Interface(bridgeAbi);
const portalInterface = new ethers.Interface(portalAbi);

export type WithdrawalFields = {
  nonce: bigint;
  sender: string;
  target: string;
  value: bigint;
  gasLimit: bigint;
  data: string;
};

export type OutputRootProof = {
  version: string;
  stateRoot: string;
  messagePasserStorageRoot: string;
  latestBlockhash: string;
};

export type OutputRef = {
  index: bigint;
  outputRoot: string;
  timestamp: number;
  l2BlockNumber: bigint;
};

export type EthBridgeInfo = {
  l1Paused: boolean;
  l2Paused: boolean;
  portalPaused: boolean;
  finalizationSeconds: number;
};

export type WithdrawalStage =
  | { kind: 'waiting-output'; aboutSeconds: number | null }
  | { kind: 'ready-to-prove'; output: OutputRef }
  | { kind: 'waiting-finality'; readyAt: number }
  | { kind: 'ready-to-finalize' }
  | { kind: 'finalized' };

export type EthInclusion = 'pending' | 'failed' | { confirmed: true; timestamp: number };

export type StoredWithdrawal = {
  nonce: string;
  sender: string;
  target: string;
  value: string;
  gasLimit: string;
  data: string;
  hash: string;
};

export type EthMove = {
  id: string;
  direction: 'to-hemi' | 'to-ethereum';
  createdAt: number;
  amountWei: string;
  from: string;
  to: string;
  txHash: string;
  l2Block?: number;
  withdrawal?: StoredWithdrawal;
  hemiWeiBefore?: string;
  status: 'submitted' | 'proven' | 'finalized' | 'credited';
};

function ethProvider(): ethers.JsonRpcProvider {
  const network = ethers.Network.from(ETH_CHAIN_ID);
  return new ethers.JsonRpcProvider(ETH_RPC, network, { staticNetwork: network });
}

function hemiProvider(): ethers.JsonRpcProvider {
  const network = ethers.Network.from(HEMI_CHAIN_ID);
  return new ethers.JsonRpcProvider(HEMI_RPC, network, { staticNetwork: network });
}

export function requireEthAddress(value: string): string {
  const text = value.trim();
  if (!ethers.isAddress(text)) throw new Error('Enter an Ethereum address (0x…).');
  return ethers.getAddress(text);
}

export function ethTxUrl(hash: string): string {
  return `https://etherscan.io/tx/${hash}`;
}

export function hashWithdrawal(tx: WithdrawalFields): string {
  return ethers.keccak256(coder.encode(
    ['uint256', 'address', 'address', 'uint256', 'uint256', 'bytes'],
    [tx.nonce, tx.sender, tx.target, tx.value, tx.gasLimit, tx.data],
  ));
}

/** Storage slot of sentMessages[withdrawalHash]. The portal reads mapping slot 0. */
function withdrawalStorageKey(withdrawalHash: string): string {
  return ethers.keccak256(coder.encode(['bytes32', 'uint256'], [withdrawalHash, 0n]));
}

function hashOutputRootProof(proof: OutputRootProof): string {
  return ethers.keccak256(coder.encode(
    ['bytes32', 'bytes32', 'bytes32', 'bytes32'],
    [proof.version, proof.stateRoot, proof.messagePasserStorageRoot, proof.latestBlockhash],
  ));
}

export async function readL1Eth(address: string): Promise<bigint> {
  const provider = ethProvider();
  try {
    return await provider.getBalance(address);
  } finally {
    provider.destroy();
  }
}

export async function readEthBridge(): Promise<EthBridgeInfo> {
  const l1 = ethProvider();
  const l2 = hemiProvider();
  try {
    const bridgeL1 = new ethers.Contract(L1_STANDARD_BRIDGE, bridgeAbi, l1);
    const portal = new ethers.Contract(OPTIMISM_PORTAL, portalAbi, l1);
    const oracle = new ethers.Contract(L2_OUTPUT_ORACLE, oracleAbi, l1);
    const bridgeL2 = new ethers.Contract(L2_STANDARD_BRIDGE, bridgeAbi, l2);
    const [l1Paused, l2Paused, portalPaused, period] = await Promise.all([
      bridgeL1.paused() as Promise<boolean>,
      bridgeL2.paused() as Promise<boolean>,
      portal.paused() as Promise<boolean>,
      oracle.FINALIZATION_PERIOD_SECONDS() as Promise<bigint>,
    ]);
    return {
      l1Paused,
      l2Paused,
      portalPaused,
      finalizationSeconds: Number(period),
    };
  } finally {
    l1.destroy();
    l2.destroy();
  }
}

async function feePrice(provider: ethers.JsonRpcProvider): Promise<bigint> {
  const fee = await provider.getFeeData();
  const price = fee.maxFeePerGas ?? fee.gasPrice;
  if (price == null || price <= 0n) throw new Error('Gas price is unavailable.');
  return price;
}

/** Worst-case network fee for bridging `amount`. The bridged amount itself is separate. */
export async function estimateBridgeFee(
  kind: 'deposit' | 'withdraw',
  from: string,
  to: string,
  amount: bigint,
): Promise<bigint> {
  const provider = kind === 'deposit' ? ethProvider() : hemiProvider();
  try {
    const bridge = new ethers.Contract(
      kind === 'deposit' ? L1_STANDARD_BRIDGE : L2_STANDARD_BRIDGE,
      bridgeAbi,
      provider,
    );
    const [price, gas] = await Promise.all([
      feePrice(provider),
      bridge.bridgeETHTo.estimateGas(requireEthAddress(to), BRIDGE_MIN_GAS, '0x', {
        from,
        value: amount,
      }) as Promise<bigint>,
    ]);
    return gas * price;
  } finally {
    provider.destroy();
  }
}

/** Largest value that still leaves a buffered network fee in `balance`. */
export async function maxBridgeAmount(
  kind: 'deposit' | 'withdraw',
  from: string,
  to: string,
  balance: bigint,
): Promise<bigint> {
  if (balance <= 0n) return 0n;
  const provider = kind === 'deposit' ? ethProvider() : hemiProvider();
  try {
    const bridge = new ethers.Contract(
      kind === 'deposit' ? L1_STANDARD_BRIDGE : L2_STANDARD_BRIDGE,
      bridgeAbi,
      provider,
    );
    const price = await feePrice(provider);
    let gas = kind === 'deposit' ? 900_000n : 200_000n;
    try {
      gas = await bridge.bridgeETHTo.estimateGas(requireEthAddress(to), BRIDGE_MIN_GAS, '0x', {
        from,
        value: 0n,
      }) as bigint;
    } catch {
      // A zero-value quote can revert. The fallback gas cap still keeps the max under the balance.
    }
    const reserve = (gas * price * 3n) / 2n;
    return balance > reserve ? balance - reserve : 0n;
  } finally {
    provider.destroy();
  }
}

export async function destinationIsContract(kind: 'deposit' | 'withdraw', address: string): Promise<boolean> {
  const provider = kind === 'deposit' ? hemiProvider() : ethProvider();
  try {
    const code = await provider.getCode(requireEthAddress(address));
    return code !== '0x';
  } finally {
    provider.destroy();
  }
}

function portalTuple(tx: WithdrawalFields): [bigint, string, string, bigint, bigint, string] {
  return [tx.nonce, tx.sender, tx.target, tx.value, tx.gasLimit, tx.data];
}

export function withdrawalFromReceipt(receipt: ethers.TransactionReceipt): {
  withdrawal: WithdrawalFields;
  hash: string;
  l2Block: number;
} {
  const rows = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== L2_MESSAGE_PASSER.toLowerCase()) return [];
    try {
      const parsed = messagePassed.parseLog(log);
      return parsed ? [parsed] : [];
    } catch {
      return [];
    }
  });
  if (rows.length !== 1) throw new Error('The withdrawal receipt did not contain one Hemi exit message.');
  const args = rows[0].args;
  const withdrawal: WithdrawalFields = {
    nonce: args.nonce as bigint,
    sender: args.sender as string,
    target: args.target as string,
    value: args.value as bigint,
    gasLimit: args.gasLimit as bigint,
    data: ethers.hexlify(args.data as string),
  };
  const hash = hashWithdrawal(withdrawal);
  const logged = (args.withdrawalHash as string).toLowerCase();
  if (hash.toLowerCase() !== logged) throw new Error('Withdrawal hash does not match the receipt.');
  if (receipt.blockNumber == null) throw new Error('The Hemi receipt has no block number.');
  return { withdrawal, hash, l2Block: receipt.blockNumber };
}

async function assertBridgeOpen(kind: 'deposit' | 'withdraw'): Promise<void> {
  const info = await readEthBridge();
  if (info.portalPaused) throw new Error('The Ethereum portal is paused.');
  if (kind === 'deposit' && info.l1Paused) throw new Error('The Ethereum side of the bridge is paused.');
  if (kind === 'withdraw' && info.l2Paused) throw new Error('The Hemi side of the bridge is paused.');
}

export async function depositEth(from: string, to: string, amount: bigint): Promise<string> {
  await assertBridgeOpen('deposit');
  if (amount <= 0n) throw new Error('Enter an amount of ETH.');
  const dest = requireEthAddress(to);
  const balance = await readL1Eth(from);
  if (amount >= balance) throw new Error('Leave some ETH in this wallet for the network fee.');
  const data = bridgeInterface.encodeFunctionData('bridgeETHTo', [dest, BRIDGE_MIN_GAS, '0x']);
  const receipt = await sendEthCall({ to: L1_STANDARD_BRIDGE, data, value: amount });
  return receipt.hash;
}

export async function withdrawEth(
  from: string,
  to: string,
  amount: bigint,
): Promise<{ hash: string; withdrawal: WithdrawalFields; withdrawalHash: string; l2Block: number }> {
  await assertBridgeOpen('withdraw');
  if (amount <= 0n) throw new Error('Enter an amount of ETH.');
  const dest = requireEthAddress(to);
  const l2 = hemiProvider();
  try {
    const balance = await l2.getBalance(from);
    if (amount >= balance) throw new Error('Leave some ETH on Hemi for the network fee.');
  } finally {
    l2.destroy();
  }
  const data = bridgeInterface.encodeFunctionData('bridgeETHTo', [dest, BRIDGE_MIN_GAS, '0x']);
  const hash = await sendHemiCall({ to: L2_STANDARD_BRIDGE, data, value: amount });
  const reader = hemiProvider();
  try {
    const receipt = await reader.getTransactionReceipt(hash);
    if (!receipt) throw new Error('The Hemi withdrawal was not mined.');
    const parsed = withdrawalFromReceipt(receipt);
    return { hash, withdrawal: parsed.withdrawal, withdrawalHash: parsed.hash, l2Block: parsed.l2Block };
  } finally {
    reader.destroy();
  }
}

export async function readEthInclusion(hash: string): Promise<EthInclusion> {
  const provider = ethProvider();
  try {
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt) return 'pending';
    if (receipt.status === 0) return 'failed';
    const block = await provider.getBlock(receipt.blockNumber);
    return { confirmed: true, timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000) };
  } finally {
    provider.destroy();
  }
}

function outputFrom(index: bigint, row: { outputRoot: string; timestamp: bigint; l2BlockNumber: bigint }): OutputRef {
  return {
    index,
    outputRoot: row.outputRoot,
    timestamp: Number(row.timestamp),
    l2BlockNumber: row.l2BlockNumber,
  };
}

async function outputWaitSeconds(l2Block: number): Promise<number | null> {
  const l1 = ethProvider();
  const l2 = hemiProvider();
  try {
    const oracle = new ethers.Contract(L2_OUTPUT_ORACLE, oracleAbi, l1);
    const [latest, interval, tip] = await Promise.all([
      oracle.latestOutputIndex() as Promise<bigint>,
      oracle.SUBMISSION_INTERVAL() as Promise<bigint>,
      l2.getBlock('latest'),
    ]);
    const row = await oracle.getL2Output(latest);
    const step = Number(interval);
    if (!tip || step <= 0) return null;
    let next = Number(row.l2BlockNumber) + step;
    while (next < l2Block) next += step;
    return Math.max(0, next - tip.number) * HEMI_BLOCK_SECONDS;
  } finally {
    l1.destroy();
    l2.destroy();
  }
}

export async function findCoveringOutput(l2Block: number): Promise<OutputRef | null> {
  const provider = ethProvider();
  try {
    const oracle = new ethers.Contract(L2_OUTPUT_ORACLE, oracleAbi, provider);
    const latest = (await oracle.latestOutputIndex()) as bigint;
    const tip = await oracle.getL2Output(latest);
    if ((tip.l2BlockNumber as bigint) < BigInt(l2Block)) return null;
    let lo = 0n;
    let hi = latest;
    let best: OutputRef | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) / 2n;
      let row: { outputRoot: string; timestamp: bigint; l2BlockNumber: bigint };
      try {
        row = await oracle.getL2Output(mid);
      } catch {
        lo = mid + 1n;
        continue;
      }
      if (row.l2BlockNumber >= BigInt(l2Block)) {
        best = outputFrom(mid, row);
        if (mid === 0n) break;
        hi = mid - 1n;
      } else {
        lo = mid + 1n;
      }
    }
    return best;
  } finally {
    provider.destroy();
  }
}

export async function readWithdrawalStage(tx: WithdrawalFields, l2Block: number): Promise<WithdrawalStage> {
  const hash = hashWithdrawal(tx);
  const provider = ethProvider();
  try {
    const portal = new ethers.Contract(OPTIMISM_PORTAL, portalAbi, provider);
    const oracle = new ethers.Contract(L2_OUTPUT_ORACLE, oracleAbi, provider);
    const [proven, finalized, period] = await Promise.all([
      portal.provenWithdrawals(hash) as Promise<{ outputRoot: string; timestamp: bigint; l2OutputIndex: bigint }>,
      portal.finalizedWithdrawals(hash) as Promise<boolean>,
      oracle.FINALIZATION_PERIOD_SECONDS() as Promise<bigint>,
    ]);
    if (finalized) return { kind: 'finalized' };
    const wait = Number(period);
    if (proven.timestamp !== 0n) {
      const proposal = await oracle.getL2Output(proven.l2OutputIndex);
      if ((proposal.outputRoot as string).toLowerCase() !== proven.outputRoot.toLowerCase()) {
        const output = await findCoveringOutput(l2Block);
        if (output) return { kind: 'ready-to-prove', output };
        const aboutSeconds = await outputWaitSeconds(l2Block).catch(() => null);
        return { kind: 'waiting-output', aboutSeconds };
      }
      const proveReadyAt = Number(proven.timestamp) + wait + 1;
      const outputReadyAt = Number(proposal.timestamp) + wait + 1;
      const readyAt = Math.max(proveReadyAt, outputReadyAt);
      if (Math.floor(Date.now() / 1000) >= readyAt) return { kind: 'ready-to-finalize' };
      return { kind: 'waiting-finality', readyAt };
    }
    const output = await findCoveringOutput(l2Block);
    if (output) return { kind: 'ready-to-prove', output };
    const aboutSeconds = await outputWaitSeconds(l2Block).catch(() => null);
    return { kind: 'waiting-output', aboutSeconds };
  } finally {
    provider.destroy();
  }
}

function asBlockNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Hemi block number is out of range.');
  return Number(value);
}

async function prepareWithdrawalProof(tx: WithdrawalFields, output: OutputRef): Promise<{
  index: bigint;
  outputRootProof: OutputRootProof;
  withdrawalProof: string[];
}> {
  const blockNumber = asBlockNumber(output.l2BlockNumber);
  const provider = hemiProvider();
  try {
    const block = await provider.getBlock(blockNumber);
    if (!block?.hash || !block.stateRoot) throw new Error('That Hemi block has no state root yet.');
    const hash = hashWithdrawal(tx);
    const slot = withdrawalStorageKey(hash);
    const proof = await provider.send('eth_getProof', [
      L2_MESSAGE_PASSER,
      [slot],
      `0x${blockNumber.toString(16)}`,
    ]) as { storageHash: string; storageProof: { value: string; proof: string[] }[] };
    const stored = proof.storageProof?.[0];
    if (!stored) throw new Error('Hemi did not return a withdrawal proof.');
    if (BigInt(stored.value) === 0n) throw new Error('This withdrawal is not in the Hemi message passer at that output.');
    const outputRootProof: OutputRootProof = {
      version: ethers.ZeroHash,
      stateRoot: block.stateRoot,
      messagePasserStorageRoot: proof.storageHash,
      latestBlockhash: block.hash,
    };
    const computed = hashOutputRootProof(outputRootProof);
    if (computed.toLowerCase() !== output.outputRoot.toLowerCase()) {
      throw new Error('The output root proof does not match the oracle.');
    }
    return { index: output.index, outputRootProof, withdrawalProof: stored.proof };
  } finally {
    provider.destroy();
  }
}

export async function proveWithdrawal(tx: WithdrawalFields, output: OutputRef): Promise<string> {
  const info = await readEthBridge();
  if (info.portalPaused) throw new Error('The Ethereum portal is paused.');
  const args = await prepareWithdrawalProof(tx, output);
  const data = portalInterface.encodeFunctionData('proveWithdrawalTransaction', [
    portalTuple(tx),
    args.index,
    [args.outputRootProof.version, args.outputRootProof.stateRoot, args.outputRootProof.messagePasserStorageRoot, args.outputRootProof.latestBlockhash],
    args.withdrawalProof,
  ]);
  const receipt = await sendEthCall({ to: OPTIMISM_PORTAL, data });
  return receipt.hash;
}

export async function finalizeWithdrawal(tx: WithdrawalFields): Promise<string> {
  const info = await readEthBridge();
  if (info.portalPaused) throw new Error('The Ethereum portal is paused.');
  const data = portalInterface.encodeFunctionData('finalizeWithdrawalTransaction', [portalTuple(tx)]);
  const receipt = await sendEthCall({ to: OPTIMISM_PORTAL, data });
  return receipt.hash;
}

export function stageError(stage: WithdrawalStage): string {
  if (stage.kind === 'waiting-output') return 'No published Hemi output includes this withdrawal yet.';
  if (stage.kind === 'waiting-finality') {
    return `Finalize after ${new Date(stage.readyAt * 1000).toLocaleString()}.`;
  }
  if (stage.kind === 'finalized') return 'This withdrawal is already finalized.';
  if (stage.kind === 'ready-to-prove') return 'This withdrawal still needs a proof on Ethereum.';
  return 'This withdrawal is not ready.';
}

export type EthTunnelStep = {
  step: string;
  message: string;
  spinning: boolean;
  done: boolean;
  failed: boolean;
};

/** Shared step name for the confirm sheet, the ETH tunnel card, and Activity. */
export function ethTunnelStep(
  move: Pick<EthMove, 'direction' | 'status' | 'l2Block'>,
  inclusion: EthInclusion | 'error' | undefined,
  stage: WithdrawalStage | 'error' | undefined,
): EthTunnelStep {
  if (move.direction === 'to-hemi') {
    if (move.status === 'credited') {
      return {
        step: 'Done · ETH is on Hemi',
        message: 'The Hemi balance increased by this deposit.',
        spinning: false,
        done: true,
        failed: false,
      };
    }
    if (inclusion === 'failed') {
      return {
        step: 'Deposit failed',
        message: 'Ethereum included the transaction and it reverted. Nothing was bridged.',
        spinning: false,
        done: false,
        failed: true,
      };
    }
    if (inclusion == null || inclusion === 'error' || inclusion === 'pending') {
      return {
        step: 'Step 1 of 2 · Waiting for Ethereum',
        message: inclusion === 'error'
          ? 'Could not read the Ethereum receipt. Still tracking this deposit.'
          : 'The deposit is in the Ethereum mempool.',
        spinning: true,
        done: false,
        failed: false,
      };
    }
    return {
      step: 'Step 2 of 2 · Hemi derivation',
      message: 'Ethereum included the deposit. Hemi credits the same amount after it derives that block.',
      spinning: true,
      done: false,
      failed: false,
    };
  }
  if (move.status === 'finalized' || (stage && stage !== 'error' && stage.kind === 'finalized')) {
    return {
      step: 'Done · ETH is on Ethereum',
      message: 'Finalize succeeded. The portal paid the withdrawal.',
      spinning: false,
      done: true,
      failed: false,
    };
  }
  if (stage == null) {
    return {
      step: 'Checking the portal',
      message: 'Reading where this withdrawal is on Ethereum.',
      spinning: true,
      done: false,
      failed: false,
    };
  }
  if (stage === 'error') {
    return {
      step: 'Portal status unavailable',
      message: 'The tracker will try again. The withdrawal is still saved on this device.',
      spinning: true,
      done: false,
      failed: false,
    };
  }
  if (stage.kind === 'waiting-output') {
    return {
      step: 'Step 1 of 4 · Waiting for a Hemi output',
      message: move.l2Block == null
        ? 'A published Hemi output has to include this withdrawal.'
        : `A published Hemi output has to include block ${move.l2Block.toLocaleString()}. Outputs are every 120 Hemi blocks, about 24 minutes.`,
      spinning: true,
      done: false,
      failed: false,
    };
  }
  if (stage.kind === 'ready-to-prove') {
    return {
      step: 'Step 2 of 4 · Prove on Ethereum',
      message: 'An output includes this withdrawal. Proving is your Ethereum transaction.',
      spinning: true,
      done: false,
      failed: false,
    };
  }
  if (stage.kind === 'waiting-finality') {
    return {
      step: 'Step 3 of 4 · Finality wait',
      message: 'Proven. Finalize stays locked until the proof and the output finish the 24 hour period.',
      spinning: true,
      done: false,
      failed: false,
    };
  }
  return {
    step: 'Step 4 of 4 · Finalize on Ethereum',
    message: 'The wait is over. Finalizing pays the ETH out of the portal.',
    spinning: true,
    done: false,
    failed: false,
  };
}

export function withdrawalFields(move: EthMove): WithdrawalFields | null {
  const row = move.withdrawal;
  if (!row) return null;
  try {
    return {
      nonce: BigInt(row.nonce),
      sender: row.sender,
      target: row.target,
      value: BigInt(row.value),
      gasLimit: BigInt(row.gasLimit),
      data: row.data,
    };
  } catch {
    return null;
  }
}

function isEthMove(value: unknown): value is EthMove {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<EthMove>;
  return typeof row.id === 'string'
    && (row.direction === 'to-hemi' || row.direction === 'to-ethereum')
    && typeof row.amountWei === 'string'
    && typeof row.txHash === 'string'
    && (row.status === 'submitted' || row.status === 'proven' || row.status === 'finalized' || row.status === 'credited');
}

async function readAll(): Promise<EthMove[]> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEthMove) : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: EthMove[]): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(rows.slice(0, 40)));
}

export async function readEthMoves(address: string): Promise<EthMove[]> {
  const mine = address.toLowerCase();
  const rows = await readAll();
  return rows.filter((row) => row.from.toLowerCase() === mine);
}

export async function saveEthMove(move: EthMove): Promise<void> {
  const rows = await readAll();
  await writeAll([move, ...rows.filter((row) => row.id !== move.id)]);
}

export async function markEthMove(id: string, status: EthMove['status']): Promise<void> {
  const rows = await readAll();
  await writeAll(rows.map((row) => (row.id === id ? { ...row, status } : row)));
}

export function storedWithdrawal(tx: WithdrawalFields, hash: string): StoredWithdrawal {
  return {
    nonce: tx.nonce.toString(),
    sender: tx.sender,
    target: tx.target,
    value: tx.value.toString(),
    gasLimit: tx.gasLimit.toString(),
    data: tx.data,
    hash,
  };
}
