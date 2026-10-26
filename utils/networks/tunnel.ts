import AsyncStorage from '@react-native-async-storage/async-storage';
import { Contract, ethers } from 'ethers';
import {
  HEMIBTC,
  HEMI_CHAIN_ID,
  HEMI_RPC,
  MEMPOOL,
  VAULT_FACTORY,
  VAULT_INDEX,
} from './chains';
import {
  assertBtcAddress,
  formatBtc,
  parseBtc,
  sendBtcPayment,
  tunnelMemo,
} from './btc';
import { sendHemiCall } from './hemi';
import { networkFetch } from './http';

const STORE_KEY = 'warthogHemiTunnels';

const factoryAbi = [
  'function vaults(uint32) view returns (address)',
  'function initiateWithdrawal(uint32 vaultIndex, string btcAddress, uint256 amount) returns (uint256)',
  'function confirmDeposit(uint32 vaultIndex, bytes32 txid, uint256 outputIndex, bytes extraInfo) returns (bool)',
];

const vaultAbi = [
  'function bitcoinCustodyAddress() view returns (string)',
  'function MINIMUM_DEPOSIT_SATS() view returns (uint256)',
  'function MINIMUM_WITHDRAWAL_SATS() view returns (uint256)',
  'function MIN_BITCOIN_CONFIRMATIONS() view returns (uint32)',
  'function isAcceptingDeposits() view returns (bool)',
  'function vaultStateChild() view returns (address)',
];

const stateAbi = [
  'function calculateDepositFee(uint256) view returns (uint256)',
  'function calculateWithdrawalFee(uint256) view returns (uint256)',
  'function isDepositAcknowledged(bytes32) view returns (bool)',
];

const erc20Abi = ['function balanceOf(address) view returns (uint256)'];

export type VaultLive = {
  vaultAddress: string;
  stateAddress: string;
  custodyAddress: string;
  minDepositSats: bigint;
  minWithdrawSats: bigint;
  confirmations: number;
  accepting: boolean;
};

export type TunnelMove = {
  id: string;
  direction: 'to-hemi' | 'to-bitcoin';
  createdAt: number;
  grossSats: string;
  vaultFeeSats: string;
  netSats: string;
  btcAddress: string;
  hemiAddress: string;
  txHash: string;
  outputIndex?: number;
  status: 'broadcast' | 'minted' | 'paid';
};

export type BtcTunnelProbe = {
  confirmations: number | null | undefined;
  acknowledged: boolean | undefined;
  mined: boolean | null | undefined;
  need: number;
};

export type TunnelStep = {
  step: string;
  message: string;
  spinning: boolean;
  done: boolean;
};

/** Shared step name for the confirm sheet, the tunnel card, and Activity. */
export function btcTunnelStep(
  move: Pick<TunnelMove, 'direction' | 'status'>,
  probe: BtcTunnelProbe,
): TunnelStep {
  if (move.status === 'minted' || probe.acknowledged === true) {
    return {
      step: 'Done · hemiBTC minted',
      message: 'The vault minted hemiBTC for this deposit.',
      spinning: false,
      done: true,
    };
  }
  if (move.status === 'paid') {
    return {
      step: 'Done · Bitcoin paid out',
      message: 'Bitcoin paid this withdrawal.',
      spinning: false,
      done: true,
    };
  }
  if (move.direction === 'to-hemi') {
    const got = probe.confirmations;
    if (got == null) {
      return {
        step: 'Step 2 of 3 · Bitcoin confirmations',
        message: 'Asking mempool.space how many confirmations this deposit has.',
        spinning: true,
        done: false,
      };
    }
    if (got >= probe.need) {
      return {
        step: 'Step 3 of 3 · Mint hemiBTC',
        message: `${got} of ${probe.need} Bitcoin confirmations are in. Minting is one Hemi transaction.`,
        spinning: true,
        done: false,
      };
    }
    return {
      step: 'Step 2 of 3 · Bitcoin confirmations',
      message: got === 0
        ? `The deposit is waiting for its first Bitcoin block. The vault needs ${probe.need}.`
        : `${got} of ${probe.need} Bitcoin confirmations.`,
      spinning: true,
      done: false,
    };
  }
  if (probe.mined == null) {
    return {
      step: 'Step 1 of 2 · Hemi inclusion',
      message: 'Checking whether Hemi has included the withdrawal.',
      spinning: true,
      done: false,
    };
  }
  if (!probe.mined) {
    return {
      step: 'Step 1 of 2 · Hemi inclusion',
      message: 'The withdrawal is waiting to be included on Hemi.',
      spinning: true,
      done: false,
    };
  }
  return {
    step: 'Step 2 of 2 · Bitcoin payout',
    message: 'Hemi included it. The vault pays Bitcoin next.',
    spinning: true,
    done: false,
  };
}

const factoryInterface = new ethers.Interface(factoryAbi);

function hemiReadProvider(): ethers.JsonRpcProvider {
  const network = ethers.Network.from(HEMI_CHAIN_ID);
  return new ethers.JsonRpcProvider(HEMI_RPC, network, { staticNetwork: network });
}

export async function readVault(): Promise<VaultLive> {
  const provider = hemiReadProvider();
  const factory = new Contract(VAULT_FACTORY, factoryAbi, provider);
  const vaultAddress = (await factory.vaults(VAULT_INDEX)) as string;
  const vault = new Contract(vaultAddress, vaultAbi, provider);
  const [custodyAddress, minDepositSats, minWithdrawSats, confirmations, accepting, stateAddress] =
    await Promise.all([
      vault.bitcoinCustodyAddress() as Promise<string>,
      vault.MINIMUM_DEPOSIT_SATS() as Promise<bigint>,
      vault.MINIMUM_WITHDRAWAL_SATS() as Promise<bigint>,
      vault.MIN_BITCOIN_CONFIRMATIONS() as Promise<bigint>,
      vault.isAcceptingDeposits() as Promise<boolean>,
      vault.vaultStateChild() as Promise<string>,
    ]);
  return {
    vaultAddress,
    stateAddress,
    custodyAddress,
    minDepositSats,
    minWithdrawSats,
    confirmations: Number(confirmations),
    accepting,
  };
}

export async function quoteVaultFee(
  stateAddress: string,
  kind: 'deposit' | 'withdraw',
  amount: bigint,
): Promise<bigint> {
  const state = new Contract(stateAddress, stateAbi, hemiReadProvider());
  if (kind === 'deposit') return state.calculateDepositFee(amount) as Promise<bigint>;
  return state.calculateWithdrawalFee(amount) as Promise<bigint>;
}

export async function fetchHemiBtcBalance(address: string): Promise<bigint> {
  const token = new Contract(HEMIBTC, erc20Abi, hemiReadProvider());
  return token.balanceOf(address) as Promise<bigint>;
}

/** Bitcoin txid as the vault stores it: display order, with a 0x prefix. */
export function depositTxId(txid: string): string {
  const bare = txid.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(bare)) throw new Error('This deposit has no Bitcoin transaction id.');
  return `0x${bare.toLowerCase()}`;
}

export async function readDepositAcknowledged(stateAddress: string, txid: string): Promise<boolean> {
  const state = new Contract(stateAddress, stateAbi, hemiReadProvider());
  return state.isDepositAcknowledged(depositTxId(txid)) as Promise<boolean>;
}

export async function readBtcConfirmations(txid: string): Promise<number> {
  const [statusRes, tipRes] = await Promise.all([
    networkFetch(`${MEMPOOL}/api/tx/${txid}/status`),
    networkFetch(`${MEMPOOL}/api/blocks/tip/height`),
  ]);
  if (!statusRes.ok || !tipRes.ok) return 0;
  const status = (await statusRes.json()) as { confirmed: boolean; block_height?: number };
  if (!status.confirmed || status.block_height == null) return 0;
  const tip = Number(await tipRes.text());
  if (!Number.isFinite(tip)) return 0;
  return tip - status.block_height + 1;
}

async function readAll(): Promise<TunnelMove[]> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as TunnelMove[] : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: TunnelMove[]): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(rows.slice(0, 40)));
}

export async function readTunnelMoves(hemiAddress: string): Promise<TunnelMove[]> {
  const mine = hemiAddress.toLowerCase();
  const rows = await readAll();
  return rows.filter((row) => row.hemiAddress.toLowerCase() === mine);
}

export async function saveTunnelMove(move: TunnelMove): Promise<void> {
  const rows = await readAll();
  await writeAll([move, ...rows.filter((row) => row.id !== move.id)]);
}

export async function markTunnelMove(id: string, status: TunnelMove['status']): Promise<void> {
  const rows = await readAll();
  await writeAll(rows.map((row) => (row.id === id ? { ...row, status } : row)));
}

export async function depositToHemi(hemiAddress: string, amount: string): Promise<{ txid: string }> {
  const vault = await readVault();
  if (!vault.accepting) throw new Error('The Bitcoin vault is not accepting deposits.');
  const dest = ethers.getAddress(hemiAddress.trim());
  const sats = parseBtc(amount);
  if (sats < vault.minDepositSats) {
    throw new Error(`Minimum deposit is ${formatBtc(vault.minDepositSats)} BTC.`);
  }
  const fee = await quoteVaultFee(vault.stateAddress, 'deposit', sats);
  const sent = await sendBtcPayment({
    to: vault.custodyAddress,
    sats,
    memo: tunnelMemo(dest),
  });
  const net = sats > fee ? sats - fee : 0n;
  await saveTunnelMove({
    id: sent.txid,
    direction: 'to-hemi',
    createdAt: Date.now(),
    grossSats: sats.toString(),
    vaultFeeSats: fee.toString(),
    netSats: net.toString(),
    btcAddress: sent.address,
    hemiAddress: dest,
    txHash: sent.txid,
    outputIndex: 0,
    status: 'broadcast',
  });
  return { txid: sent.txid };
}

export async function withdrawToBitcoin(btcAddress: string, amount: string, hemiAddress: string): Promise<{ hash: string }> {
  const vault = await readVault();
  const dest = assertBtcAddress(btcAddress);
  const sats = parseBtc(amount);
  if (sats < vault.minWithdrawSats) {
    throw new Error(`Minimum withdrawal is ${formatBtc(vault.minWithdrawSats)} BTC.`);
  }
  const fee = await quoteVaultFee(vault.stateAddress, 'withdraw', sats);
  const data = factoryInterface.encodeFunctionData('initiateWithdrawal', [VAULT_INDEX, dest, sats]);
  const hash = await sendHemiCall({ to: VAULT_FACTORY, data });
  const net = sats > fee ? sats - fee : 0n;
  await saveTunnelMove({
    id: hash,
    direction: 'to-bitcoin',
    createdAt: Date.now(),
    grossSats: sats.toString(),
    vaultFeeSats: fee.toString(),
    netSats: net.toString(),
    btcAddress: dest,
    hemiAddress: ethers.getAddress(hemiAddress),
    txHash: hash,
    status: 'broadcast',
  });
  return { hash };
}

export async function mintHemiDeposit(move: TunnelMove): Promise<{ hash: string; already: boolean }> {
  if (move.outputIndex == null) throw new Error('This deposit has no output index.');
  const vault = await readVault();
  const acked = await readDepositAcknowledged(vault.stateAddress, move.txHash).catch(() => false);
  if (acked) {
    await markTunnelMove(move.id, 'minted');
    return { hash: move.txHash, already: true };
  }
  const confs = await readBtcConfirmations(move.txHash);
  if (confs < vault.confirmations) {
    throw new Error(`${confs} of ${vault.confirmations} Bitcoin confirmations so far.`);
  }
  const data = factoryInterface.encodeFunctionData('confirmDeposit', [
    VAULT_INDEX,
    depositTxId(move.txHash),
    BigInt(move.outputIndex),
    '0x',
  ]);
  try {
    const hash = await sendHemiCall({ to: VAULT_FACTORY, data });
    await markTunnelMove(move.id, 'minted');
    return { hash, already: false };
  } catch (err) {
    const nowAcked = await readDepositAcknowledged(vault.stateAddress, move.txHash).catch(() => false);
    if (!nowAcked) throw err;
    await markTunnelMove(move.id, 'minted');
    return { hash: move.txHash, already: true };
  }
}
