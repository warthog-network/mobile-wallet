import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DefiModalShell from './DefiModalShell';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import { EthMoveList, EthTunnelForm } from './EthTunnelForm';
import { defiStyles } from './defiStyles';
import { AvailRow, QuoteLine, SpinCoin, formatRemain, formatWhen, shortAddr, styles } from './tunnelUi';
import { explainChainError } from '../../utils/networks/http';
import {
  btcTxUrl,
  estimateSpend,
  fetchBtcBalance,
  fetchFeeRate,
  fetchUtxos,
  findBtcCredit,
  formatBtc,
  parseBtc,
} from '../../utils/networks/btc';
import { fetchHemiBalance, hemiTxUrl, readHemiMined } from '../../utils/networks/hemi';
import {
  depositToHemi,
  fetchHemiBtcBalance,
  markTunnelMove,
  mintHemiDeposit,
  quoteVaultFee,
  readBtcConfirmations,
  readDepositAcknowledged,
  readTunnelMoves,
  readVault,
  withdrawToBitcoin,
  type TunnelMove,
  type VaultLive,
} from '../../utils/networks/tunnel';
import { toast } from '../../utils/toast';

interface Props {
  visible: boolean;
  btcAddress?: string;
  hemiAddress: string;
  ledger?: boolean;
  onClose: () => void;
  /** Draw the form inside another card. The holdings button keeps the full page. */
  bare?: boolean;
  /** Hide the Bitcoin | ETH toggle and stay on one asset. */
  lockAsset?: 'btc' | 'eth';
}

const BTC_BLOCK_MS = 10 * 60 * 1000;

type MoveView = {
  spinning: boolean;
  canMint: boolean;
  step: string;
  message: string;
  eta: string;
};

function readSats(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole) * 100_000_000n + BigInt((frac.padEnd(8, '0') || '0'));
}

function moveView(
  row: TunnelMove,
  now: number,
  confirmations: number | null | undefined,
  acknowledged: boolean | undefined,
  need: number,
  mined: boolean | null | undefined,
): MoveView {
  const deposit = row.direction === 'to-hemi';
  if (deposit) {
    const got = confirmations;
    if (got == null) {
      return {
        spinning: true,
        canMint: false,
        step: 'Step 2 of 3 · Bitcoin confirmations',
        message: 'Asking mempool.space how many confirmations this deposit has.',
        eta: 'Checking…',
      };
    }
    if (got >= need && acknowledged === false) {
      return {
        spinning: true,
        canMint: true,
        step: 'Step 3 of 3 · Mint hemiBTC',
        message: `${got} of ${need} Bitcoin confirmations are in. Minting is one Hemi transaction.`,
        eta: 'Waiting on you',
      };
    }
    if (got >= need) {
      return {
        spinning: true,
        canMint: false,
        step: 'Step 3 of 3 · Mint hemiBTC',
        message: 'Checking whether the vault already minted this deposit.',
        eta: 'Checking…',
      };
    }
    return {
      spinning: true,
      canMint: false,
      step: 'Step 2 of 3 · Bitcoin confirmations',
      message: got === 0
        ? `The deposit is waiting for its first Bitcoin block. The vault needs ${need}.`
        : `${got} of ${need} Bitcoin confirmations.`,
      eta: formatRemain(now + (need - got) * BTC_BLOCK_MS, now),
    };
  }
  if (mined == null) {
    return {
      spinning: true,
      canMint: false,
      step: 'Step 1 of 2 · Hemi inclusion',
      message: 'Checking whether Hemi has included the withdrawal.',
      eta: 'Checking…',
    };
  }
  if (!mined) {
    return {
      spinning: true,
      canMint: false,
      step: 'Step 1 of 2 · Hemi inclusion',
      message: 'The withdrawal is waiting to be included on Hemi.',
      eta: 'A Hemi block is usually about 12 seconds',
    };
  }
  return {
    spinning: true,
    canMint: false,
    step: 'Step 2 of 2 · Bitcoin payout',
    message: `Hemi included it. The vault pays Bitcoin to ${shortAddr(row.btcAddress, 8, 6)}.`,
    eta: 'No published clock for the payout. This closes when that Bitcoin arrives.',
  };
}

/** Ask the vault before confirmations so a finished mint never flashes the Mint button. */
async function trackMoves(rows: TunnelMove[], stateAddress: string | undefined): Promise<{
  moves: TunnelMove[];
  confs: Record<string, number | null>;
  acked: Record<string, boolean | undefined>;
  mined: Record<string, boolean | null>;
}> {
  const next = rows.map((row) => ({ ...row }));
  const confs: Record<string, number | null> = {};
  const acked: Record<string, boolean | undefined> = {};
  const mined: Record<string, boolean | null> = {};
  await Promise.all(next.map(async (row) => {
    if (row.status !== 'broadcast') return;
    if (row.direction === 'to-hemi') {
      if (stateAddress) {
        try {
          const known = await readDepositAcknowledged(stateAddress, row.txHash);
          if (known) {
            row.status = 'minted';
            acked[row.id] = true;
            confs[row.id] = null;
            await markTunnelMove(row.id, 'minted');
            return;
          }
        } catch {
          try {
            confs[row.id] = await readBtcConfirmations(row.txHash);
          } catch {
            confs[row.id] = null;
          }
          acked[row.id] = false;
          return;
        }
      }
      try {
        confs[row.id] = await readBtcConfirmations(row.txHash);
        acked[row.id] = stateAddress ? false : undefined;
      } catch {
        confs[row.id] = null;
        acked[row.id] = stateAddress ? false : undefined;
      }
      return;
    }
    try {
      const included = await readHemiMined(row.txHash);
      mined[row.id] = included;
      if (!included) return;
      const paid = await findBtcCredit(row.btcAddress, row.createdAt, BigInt(row.netSats));
      if (paid) {
        row.status = 'paid';
        await markTunnelMove(row.id, 'paid');
      }
    } catch {
      mined[row.id] = null;
    }
  }));
  return { moves: next, confs, acked, mined };
}

const HemiTunnelModal: React.FC<Props> = ({
  visible,
  btcAddress,
  hemiAddress,
  ledger,
  onClose,
  bare = false,
  lockAsset,
}) => {
  const [direction, setDirection] = useState<'to-hemi' | 'to-bitcoin'>('to-hemi');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState(hemiAddress);
  const [vault, setVault] = useState<VaultLive | null>(null);
  const [btc, setBtc] = useState<bigint | null>(null);
  const [hemiBtc, setHemiBtc] = useState<bigint | null>(null);
  const [gas, setGas] = useState<bigint | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [networkFee, setNetworkFee] = useState<bigint | null>(null);
  const [moves, setMoves] = useState<TunnelMove[]>([]);
  const [confs, setConfs] = useState<Record<string, number | null>>({});
  const [acked, setAcked] = useState<Record<string, boolean | undefined>>({});
  const [mined, setMined] = useState<Record<string, boolean | null>>({});
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const flow = useSpendFlow();
  const busy = flow.busy;
  const [minting, setMinting] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const [asset, setAsset] = useState<'btc' | 'eth'>('btc');
  const [ethTick, setEthTick] = useState(0);
  const loadGen = useRef(0);
  const refreshRef = useRef<(id: number) => Promise<void>>(async () => undefined);

  const toHemi = direction === 'to-hemi';
  const sats = readSats(amount);
  const min = toHemi ? vault?.minDepositSats : vault?.minWithdrawSats;
  const balance = toHemi ? btc : hemiBtc;
  const net = sats != null && fee != null && sats > fee ? sats - fee : null;
  const tooSmall = sats != null && min != null && sats < min;
  const invalid = amount.trim() !== '' && sats == null;
  const noGas = !toHemi && gas === 0n;
  const overBalance = sats != null && balance != null && sats > balance;
  const shortFee = toHemi && sats != null && networkFee != null && btc != null && sats + networkFee > btc;
  const vaultClosed = toHemi && vault != null && !vault.accepting;
  const needsPhrase = toHemi && !btcAddress;
  const blocked = sats == null || sats <= 0n || tooSmall || invalid || noGas || overBalance || shortFee || vaultClosed || needsPhrase;
  const openMoves = moves.filter((row) => row.status === 'broadcast');
  const tracking = openMoves.length > 0;

  const refresh = async (id: number) => {
    let live = vault;
    try {
      live = await readVault();
    } catch {
      live = vault;
    }
    if (id !== loadGen.current) return;
    if (live) setVault(live);
    const [token, coins, eth, rows] = await Promise.all([
      fetchHemiBtcBalance(hemiAddress).catch(() => null),
      btcAddress ? fetchBtcBalance(btcAddress).catch(() => null) : Promise.resolve(null),
      fetchHemiBalance(hemiAddress).catch(() => null),
      readTunnelMoves(hemiAddress),
    ]);
    if (id !== loadGen.current) return;
    setHemiBtc(token);
    setBtc(coins);
    setGas(eth);
    const tracked = await trackMoves(rows, live?.stateAddress);
    if (id !== loadGen.current) return;
    setMoves(tracked.moves);
    setConfs(tracked.confs);
    setAcked(tracked.acked);
    setMined(tracked.mined);
  };

  useEffect(() => {
    if (!visible) return;
    setDirection('to-hemi');
    setAsset(lockAsset ?? 'btc');
    setAmount('');
    setDest(hemiAddress);
    setError(null);
    setTxUrl(null);
    setConfirmOpen(false);
    setFee(null);
    setNetworkFee(null);
  }, [visible, hemiAddress, lockAsset]);

  useEffect(() => {
    setConfirmOpen(false);
  }, [asset]);

  refreshRef.current = refresh;

  useEffect(() => {
    if (!visible) return;
    const id = ++loadGen.current;
    void refreshRef.current(id).catch((err: unknown) => {
      if (id === loadGen.current) setError(explainChainError(err));
    });
    const poll = setInterval(() => {
      const next = ++loadGen.current;
      void refreshRef.current(next).catch(() => undefined);
    }, 20_000);
    return () => {
      loadGen.current += 1;
      clearInterval(poll);
    };
  }, [visible, hemiAddress, btcAddress]);

  useEffect(() => {
    if (!visible || !tracking) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [visible, tracking]);

  useEffect(() => {
    setDest(toHemi ? hemiAddress : (btcAddress || ''));
    setFee(null);
    setNetworkFee(null);
    setError(null);
    setTxUrl(null);
  }, [toHemi, hemiAddress, btcAddress]);

  useEffect(() => {
    if (!visible || !vault) return;
    let cancel = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (sats == null || sats <= 0n) {
          if (!cancel) {
            setFee(null);
            setNetworkFee(null);
          }
          return;
        }
        try {
          const next = await quoteVaultFee(vault.stateAddress, toHemi ? 'deposit' : 'withdraw', sats);
          if (!cancel) setFee(next);
        } catch {
          if (!cancel) setFee(null);
        }
        if (!toHemi || !btcAddress) {
          if (!cancel) setNetworkFee(null);
          return;
        }
        try {
          const [utxos, rate] = await Promise.all([fetchUtxos(btcAddress), fetchFeeRate()]);
          if (!cancel) setNetworkFee(estimateSpend(utxos, sats, rate, true));
        } catch {
          if (!cancel) setNetworkFee(null);
        }
      })();
    }, 350);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [sats, toHemi, vault, visible, btcAddress]);

  const openConfirm = () => {
    setError(null);
    if (blocked) return;
    try {
      if (!dest.trim()) throw new Error(toHemi ? 'Enter the Hemi address.' : 'Enter the Bitcoin address.');
      parseBtc(amount);
      setConfirmOpen(true);
    } catch (err: unknown) {
      setError(explainChainError(err));
    }
  };

  const submit = async () => {
    flow.begin(toHemi ? 'Broadcasting the Bitcoin deposit…' : 'Sending the withdrawal on Hemi…');
    setError(null);
    let settled = false;
    try {
      if (toHemi) {
        const tx = await depositToHemi(dest, amount);
        setTxUrl(btcTxUrl(tx.txid));
        flow.finish(true, 'Deposit sent', 'hemiBTC mints after the vault sees enough confirmations.');
        settled = true;
      } else {
        const tx = await withdrawToBitcoin(dest, amount, hemiAddress);
        setTxUrl(hemiTxUrl(tx.hash));
        flow.finish(true, 'Withdrawal sent', 'Bitcoin pays out after the vault finalizes it.');
        settled = true;
      }
      const id = ++loadGen.current;
      await refresh(id);
    } catch (err: unknown) {
      const message = explainChainError(err);
      setError(message);
      if (!settled) flow.finish(false, 'Tunnel failed', message);
    }
  };

  const mint = async (move: TunnelMove) => {
    setMinting(move.id);
    setError(null);
    const toastId = toast.loading('Minting', 'Asking the vault to mint hemiBTC…');
    try {
      const tx = await mintHemiDeposit(move);
      if (tx.already) {
        toast.update(toastId, 'success', 'Already minted', 'The vault already minted hemiBTC for this deposit.', 7000);
      } else {
        setTxUrl(hemiTxUrl(tx.hash));
        toast.update(toastId, 'success', 'Mint sent', 'hemiBTC shows up after Hemi confirms it.', 7000);
      }
      const id = ++loadGen.current;
      await refresh(id);
    } catch (err: unknown) {
      const message = explainChainError(err);
      setError(message);
      toast.update(toastId, 'error', 'Mint failed', message, 8000);
    } finally {
      setMinting(null);
    }
  };

  const sendLabel = sats == null ? '—' : `${formatBtc(sats)} ${toHemi ? 'BTC' : 'hemiBTC'}`;
  const receiveLabel = net == null ? '—' : `${formatBtc(net)} ${toHemi ? 'hemiBTC' : 'BTC'}`;

  if (bare && !visible) return null;

  const form = (
    <>
      {openMoves.length > 0 ? (
        <View style={styles.moves}>
          <Text style={styles.kicker}>Bitcoin tunnel</Text>
          {openMoves.map((move) => {
            const view = moveView(move, now, confs[move.id], acked[move.id], vault?.confirmations ?? 6, mined[move.id]);
            const deposit = move.direction === 'to-hemi';
            return (
              <View key={move.id} style={styles.card}>
                <Text style={styles.cardTitle}>{deposit ? 'Bitcoin → hemiBTC' : 'hemiBTC → Bitcoin'}</Text>
                <Text style={styles.fine}>
                  {formatWhen(move.createdAt)} · {formatBtc(BigInt(move.netSats))} after the vault fee
                </Text>
                <View style={styles.stepRow}>
                  <SpinCoin spinning={view.spinning || minting === move.id} />
                  <View style={styles.stepCopy}>
                    <Text style={styles.stepTitle}>{minting === move.id ? 'Submitting the mint' : view.step}</Text>
                    <Text style={styles.fine}>{view.message}</Text>
                    <Text style={styles.eta}>{view.eta}</Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => { void Linking.openURL(deposit ? btcTxUrl(move.txHash) : hemiTxUrl(move.txHash)); }}>
                    <Text style={styles.actionLink}>Transaction</Text>
                  </TouchableOpacity>
                  {view.canMint ? (
                    <TouchableOpacity
                      style={[styles.primary, minting === move.id && styles.disabled]}
                      onPress={() => { void mint(move); }}
                      disabled={minting != null || busy}
                    >
                      <Text style={styles.primaryText}>{minting === move.id ? 'Minting…' : 'Mint hemiBTC'}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {lockAsset === 'btc' ? null : (
        <EthMoveList visible={visible} address={hemiAddress} tick={ethTick} />
      )}

      {lockAsset ? null : (
      <View style={styles.choice}>
        <TouchableOpacity
          style={[styles.choiceBtn, asset === 'btc' && styles.choiceOn]}
          onPress={() => setAsset('btc')}
        >
          <Text style={[styles.choiceText, asset === 'btc' && styles.choiceTextOn]}>Bitcoin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.choiceBtn, asset === 'eth' && styles.choiceOn]}
          onPress={() => setAsset('eth')}
        >
          <Text style={[styles.choiceText, asset === 'eth' && styles.choiceTextOn]}>ETH</Text>
        </TouchableOpacity>
      </View>
      )}

      {asset === 'eth' ? (
        <EthTunnelForm
          address={hemiAddress}
          ledger={ledger}
          onSent={() => setEthTick((n) => n + 1)}
        />
      ) : (
      <>
      <View style={styles.hero}>
        <View style={styles.accent} />
        <View style={styles.kickerRow}>
          <Text style={styles.kicker}>Native tunnel</Text>
          <Text style={styles.kicker}>{vault ? 'Vault live' : '…'}</Text>
        </View>
        <Text style={styles.direction}>{toHemi ? 'Bitcoin → Hemi' : 'Hemi → Bitcoin'}</Text>
        <Text style={styles.meta}>
          {vault
            ? `Min ${formatBtc(toHemi ? vault.minDepositSats : vault.minWithdrawSats)} · ${vault.confirmations} Bitcoin confirmations · vault ${vault.accepting ? 'open' : 'paused'}`
            : 'Reading the Hemi vault…'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.kicker}>Available</Text>
        <AvailRow
          icon="BTC"
          ticker="BTC"
          detail="Native Bitcoin"
          amount={btc == null ? '—' : formatBtc(btc)}
        />
        <AvailRow
          icon="HEMIBTC"
          ticker="hemiBTC"
          detail="On Hemi"
          amount={hemiBtc == null ? '—' : formatBtc(hemiBtc)}
          bordered
        />
      </View>

      <View style={styles.choice}>
        <TouchableOpacity
          style={[styles.choiceBtn, toHemi && styles.choiceOn]}
          onPress={() => setDirection('to-hemi')}
        >
          <Text style={[styles.choiceText, toHemi && styles.choiceTextOn]}>Deposit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.choiceBtn, !toHemi && styles.choiceOn]}
          onPress={() => setDirection('to-bitcoin')}
        >
          <Text style={[styles.choiceText, !toHemi && styles.choiceTextOn]}>Withdraw</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.fieldLabel}>
        Amount · {balance == null ? '…' : `${formatBtc(balance)} available`}
      </Text>
      <TextInput
        style={defiStyles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.0001"
        placeholderTextColor="#71717a"
      />
      <Text style={styles.fieldLabel}>
        {toHemi ? 'Hemi address that receives hemiBTC' : 'Bitcoin address that receives BTC'}
      </Text>
      <TextInput
        style={defiStyles.input}
        value={dest}
        onChangeText={setDest}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#71717a"
      />

      <View style={styles.card}>
        <QuoteLine label="You send" value={sendLabel} />
        <QuoteLine label="Vault fee" value={fee == null ? '—' : formatBtc(fee)} />
        {toHemi ? <QuoteLine label="Bitcoin network fee" value={networkFee == null ? '—' : formatBtc(networkFee)} /> : null}
        <QuoteLine label="You receive" value={receiveLabel} />
        {toHemi && vault ? <QuoteLine label="Vault" value={shortAddr(vault.custodyAddress, 8, 6)} /> : null}
      </View>

      {invalid ? <Text style={styles.fine}>Enter a Bitcoin amount with at most 8 decimals.</Text> : null}
      {tooSmall && min != null ? <Text style={styles.fine}>Minimum is {formatBtc(min)}.</Text> : null}
      {overBalance && !shortFee ? <Text style={styles.fine}>That is more than the available balance.</Text> : null}
      {shortFee ? <Text style={styles.fine}>Leave Bitcoin for the network fee. The deposit is on top of the miner fee.</Text> : null}
      {noGas ? <Text style={styles.fine}>Withdrawals need ETH on Hemi for gas.</Text> : null}
      {vaultClosed ? <Text style={styles.fine}>The vault is not accepting deposits right now.</Text> : null}
      {needsPhrase ? (
        <Text style={styles.fine}>
          {ledger
            ? 'Add the Bitcoin account from the home screen. Open the Bitcoin app on the Ledger.'
            : 'A Bitcoin deposit needs the recovery phrase.'}
        </Text>
      ) : null}
      {ledger && toHemi && btcAddress ? (
        <Text style={styles.fine}>The Bitcoin app signs this deposit. Keep that app open.</Text>
      ) : null}
      {ledger && !toHemi ? (
        <Text style={styles.fine}>Withdrawal and mint sign on the Nano Ethereum app. Blind signing has to be on.</Text>
      ) : null}
      {busy ? (
        <View style={[styles.card, styles.stepCard]}>
          <View style={styles.stepRow}>
            <SpinCoin spinning />
            <View style={styles.stepCopy}>
              <Text style={styles.stepTitle}>Submitting</Text>
              <Text style={styles.fine}>
                {toHemi ? 'Broadcasting the Bitcoin deposit.' : 'Sending the withdrawal on Hemi.'}
              </Text>
              <Text style={styles.eta}>A few seconds, then the tracker keeps this move.</Text>
            </View>
          </View>
        </View>
      ) : null}
      {error ? <Text style={defiStyles.ethError}>{error}</Text> : null}
      {txUrl ? (
        <TouchableOpacity onPress={() => { void Linking.openURL(txUrl); }}>
          <Text style={styles.link}>Open the transaction</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.primary, styles.wide, (blocked || busy) && styles.disabled]}
        onPress={openConfirm}
        disabled={blocked || busy}
      >
        <Text style={styles.primaryText}>
          {busy ? 'Submitting…' : toHemi ? 'Deposit Bitcoin' : 'Withdraw to Bitcoin'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.foot}>
        A deposit pays the live vault and writes your Hemi address into an OP_RETURN, which is how the Hemi portal tags a native tunnel. hemiBTC is minted to that address after the confirmation count above. Withdrawals call the vault factory on Hemi and pay Bitcoin back to the address you entered. Both moves are mainnet. An open move stays at the top of this page until it finishes.
      </Text>

      <SpendConfirm
        open={confirmOpen}
        title={toHemi ? 'Deposit Bitcoin' : 'Withdraw to Bitcoin'}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        confirmLabel={toHemi ? 'Deposit Bitcoin' : 'Withdraw to Bitcoin'}
        rows={[
          { label: 'Direction', value: toHemi ? 'Bitcoin → hemiBTC' : 'hemiBTC → Bitcoin' },
          { label: 'You send', value: sendLabel },
          { label: 'Vault fee', value: fee == null ? '…' : formatBtc(fee) },
          ...(toHemi ? [{ label: 'Bitcoin network fee', value: networkFee == null ? '…' : formatBtc(networkFee) }] : []),
          { label: 'You receive', value: receiveLabel },
          { label: 'To', value: dest.trim() },
        ]}
        onCancel={() => {
          flow.close(() => setAmount(''));
          setConfirmOpen(false);
        }}
        onConfirm={() => { void submit(); }}
      />
      </>
      )}
    </>
  );

  if (bare) return form;

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Hemi tunnel"
      subtitle="Bitcoin and ETH. Same bridges the Hemi app uses."
    >
      {form}
    </DefiModalShell>
  );
};

export default HemiTunnelModal;
