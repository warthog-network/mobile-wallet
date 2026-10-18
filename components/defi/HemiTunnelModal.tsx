import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking } from 'react-native';
import DefiModalShell from './DefiModalShell';
import SpendConfirm from '../SpendConfirm';
import { defiStyles } from './defiStyles';
import { explainChainError } from '../../utils/networks/http';
import { btcTxUrl, fetchBtcBalance, findBtcCredit, formatBtc, parseBtc } from '../../utils/networks/btc';
import { hemiTxUrl, readHemiMined } from '../../utils/networks/hemi';
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
}

const HemiTunnelModal: React.FC<Props> = ({ visible, btcAddress, hemiAddress, ledger, onClose }) => {
  const [direction, setDirection] = useState<'to-hemi' | 'to-bitcoin'>('to-hemi');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState(hemiAddress);
  const [vault, setVault] = useState<VaultLive | null>(null);
  const [btc, setBtc] = useState<string | null>(null);
  const [hemiBtc, setHemiBtc] = useState<string | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const [moves, setMoves] = useState<TunnelMove[]>([]);
  const [confs, setConfs] = useState<Record<string, number>>({});
  const [mined, setMined] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  const toHemi = direction === 'to-hemi';

  const reload = async () => {
    const [live, rows, token, coins] = await Promise.all([
      readVault(),
      readTunnelMoves(hemiAddress),
      fetchHemiBtcBalance(hemiAddress).then(formatBtc).catch(() => null),
      btcAddress ? fetchBtcBalance(btcAddress).then(formatBtc).catch(() => null) : Promise.resolve(null),
    ]);
    setVault(live);
    setHemiBtc(token);
    setBtc(coins);
    const nextMoves = rows.map((row) => ({ ...row }));
    const nextConfs: Record<string, number> = {};
    const nextMined: Record<string, boolean> = {};
    await Promise.all(nextMoves.map(async (row) => {
      if (row.status !== 'broadcast') return;
      if (row.direction === 'to-hemi') {
        nextConfs[row.id] = await readBtcConfirmations(row.txHash).catch(() => 0);
        const acked = await readDepositAcknowledged(live.stateAddress, row.txHash).catch(() => false);
        if (acked) {
          row.status = 'minted';
          await markTunnelMove(row.id, 'minted');
        }
        return;
      }
      const included = await readHemiMined(row.txHash).catch(() => false);
      nextMined[row.id] = included;
      if (!included) return;
      const paid = await findBtcCredit(row.btcAddress, row.createdAt, BigInt(row.netSats)).catch(() => false);
      if (paid) {
        row.status = 'paid';
        await markTunnelMove(row.id, 'paid');
      }
    }));
    setMoves(nextMoves);
    setConfs(nextConfs);
    setMined(nextMined);
  };

  useEffect(() => {
    if (!visible) return;
    setDirection('to-hemi');
    setAmount('');
    setDest(hemiAddress);
    setError(null);
    setTxUrl(null);
    setConfirmOpen(false);
    let cancel = false;
    void reload().catch((err: unknown) => {
      if (!cancel) setError(explainChainError(err));
    });
    return () => { cancel = true; };
  }, [visible, hemiAddress, btcAddress]);

  useEffect(() => {
    setDest(toHemi ? hemiAddress : (btcAddress || ''));
    setFee(null);
    setError(null);
  }, [toHemi, hemiAddress, btcAddress]);

  useEffect(() => {
    if (!visible || !vault) return;
    let cancel = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const sats = amount.trim() ? parseBtc(amount) : 0n;
          if (sats <= 0n) {
            if (!cancel) setFee(null);
            return;
          }
          const next = await quoteVaultFee(vault.stateAddress, toHemi ? 'deposit' : 'withdraw', sats);
          if (!cancel) setFee(formatBtc(next));
        } catch {
          if (!cancel) setFee(null);
        }
      })();
    }, 350);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [amount, toHemi, vault, visible]);

  const openConfirm = () => {
    setError(null);
    try {
      if (!dest.trim()) throw new Error(toHemi ? 'Enter the Hemi address.' : 'Enter the Bitcoin address.');
      if (toHemi && !btcAddress) throw new Error('A Bitcoin deposit needs the recovery phrase.');
      const min = toHemi ? vault?.minDepositSats : vault?.minWithdrawSats;
      const sats = parseBtc(amount);
      if (min != null && sats < min) throw new Error(`Minimum is ${formatBtc(min)} BTC.`);
      if (toHemi && vault && !vault.accepting) throw new Error('The vault is not accepting deposits.');
      setConfirmOpen(true);
    } catch (err: unknown) {
      setError(explainChainError(err));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (toHemi) {
        const tx = await depositToHemi(dest, amount);
        setTxUrl(btcTxUrl(tx.txid));
        toast.success('Deposit sent', 'hemiBTC mints after the vault sees enough confirmations.');
      } else {
        const tx = await withdrawToBitcoin(dest, amount, hemiAddress);
        setTxUrl(hemiTxUrl(tx.hash));
        toast.success('Withdrawal sent', 'Bitcoin pays out after the vault finalizes it.');
      }
      setConfirmOpen(false);
      setAmount('');
      await reload();
    } catch (err: unknown) {
      setConfirmOpen(false);
      setError(explainChainError(err));
    } finally {
      setBusy(false);
    }
  };

  const mint = async (move: TunnelMove) => {
    setBusy(true);
    setError(null);
    try {
      const tx = await mintHemiDeposit(move);
      if (tx.already) {
        toast.success('Already minted', 'The vault already minted hemiBTC for this deposit.');
      } else {
        setTxUrl(hemiTxUrl(tx.hash));
        toast.success('Mint sent', 'hemiBTC shows up after Hemi confirms it.');
      }
      await reload();
    } catch (err: unknown) {
      setError(explainChainError(err));
    } finally {
      setBusy(false);
    }
  };

  const minText = vault
    ? formatBtc(toHemi ? vault.minDepositSats : vault.minWithdrawSats)
    : '…';
  const openMoves = moves.filter((row) => row.status === 'broadcast');

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Hemi tunnel"
      subtitle="Native Bitcoin to hemiBTC. Same vault the Hemi app uses."
    >
      <Text style={defiStyles.ethHoldingsHint}>
        {btc == null ? 'Bitcoin …' : `${btc} BTC`}
        {' · '}
        {hemiBtc == null ? 'hemiBTC …' : `${hemiBtc} hemiBTC`}
        {vault ? ` · ${vault.confirmations} confirmations · ${vault.accepting ? 'vault open' : 'vault paused'}` : ''}
      </Text>
      <View style={[defiStyles.ethChoiceRow, { marginTop: 12 }]}>
        <TouchableOpacity
          style={[defiStyles.compactBtn, toHemi && defiStyles.compactBtnActive, { flex: 1 }]}
          onPress={() => setDirection('to-hemi')}
        >
          <Text style={[defiStyles.compactBtnText, toHemi && defiStyles.compactBtnTextActive]}>Deposit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[defiStyles.compactBtn, !toHemi && defiStyles.compactBtnActive, { flex: 1 }]}
          onPress={() => setDirection('to-bitcoin')}
        >
          <Text style={[defiStyles.compactBtnText, !toHemi && defiStyles.compactBtnTextActive]}>Withdraw</Text>
        </TouchableOpacity>
      </View>
      <Text style={defiStyles.label}>
        Amount · min {minText} BTC
        {toHemi ? (btc == null ? '' : ` · ${btc} BTC`) : (hemiBtc == null ? '' : ` · ${hemiBtc} hemiBTC`)}
      </Text>
      <TextInput
        style={defiStyles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.001"
        placeholderTextColor="#71717a"
      />
      <Text style={defiStyles.label}>{toHemi ? 'Hemi address that receives hemiBTC' : 'Bitcoin address that receives BTC'}</Text>
      <TextInput
        style={defiStyles.input}
        value={dest}
        onChangeText={setDest}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#71717a"
      />
      <Text style={defiStyles.ethHoldingsHint}>
        Vault fee {fee == null ? '…' : `${fee} BTC`}. You receive the amount minus that fee.
        {toHemi ? ' The deposit also pays a Bitcoin miner fee.' : ' Withdrawal gas is ETH on Hemi.'}
      </Text>
      {!btcAddress && toHemi ? (
        <Text style={defiStyles.ethHoldingsHint}>A Bitcoin deposit needs the recovery phrase.</Text>
      ) : null}
      {ledger ? (
        <Text style={defiStyles.ethHoldingsHint}>
          Withdrawal and mint sign on the Nano Ethereum app. Blind signing has to be on.
        </Text>
      ) : null}
      {error ? <Text style={defiStyles.ethError}>{error}</Text> : null}
      {txUrl ? (
        <TouchableOpacity onPress={() => { void Linking.openURL(txUrl); }}>
          <Text style={defiStyles.ethTxLink}>View transaction</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={[defiStyles.heroSendBtn, { marginTop: 12 }]}
        onPress={openConfirm}
        disabled={busy}
      >
        <Text style={defiStyles.heroSendBtnText}>{toHemi ? 'Review deposit' : 'Review withdrawal'}</Text>
      </TouchableOpacity>
      {openMoves.map((move) => {
        const seen = confs[move.id];
        const ready = move.direction === 'to-hemi'
          && vault != null
          && seen != null
          && seen >= vault.confirmations;
        return (
          <View key={move.id} style={{ marginTop: 12 }}>
            <Text style={defiStyles.ethHoldingsHint}>
              {move.direction === 'to-hemi' ? 'Deposit' : 'Withdrawal'} {formatBtc(BigInt(move.grossSats))} BTC
              {move.direction === 'to-hemi' && vault
                ? ` · ${seen ?? '…'} of ${vault.confirmations} confirmations`
                : mined[move.id]
                  ? ' · Hemi included it. Waiting for the Bitcoin payout.'
                  : ' · waiting for Hemi'}
            </Text>
            {ready ? (
              <TouchableOpacity
                style={[defiStyles.ethActionBtn, { flex: 0, marginTop: 6, paddingHorizontal: 14 }]}
                onPress={() => { void mint(move); }}
                disabled={busy}
              >
                <Text style={defiStyles.heroSendBtnText}>Mint hemiBTC</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
      <SpendConfirm
        open={confirmOpen}
        title={toHemi ? 'Deposit Bitcoin' : 'Withdraw to Bitcoin'}
        busy={busy}
        rows={[
          { label: 'Direction', value: toHemi ? 'Bitcoin → hemiBTC' : 'hemiBTC → Bitcoin' },
          { label: 'Amount', value: `${amount.trim()} BTC` },
          { label: 'Vault fee', value: fee == null ? '…' : `${fee} BTC` },
          { label: 'To', value: dest.trim() },
        ]}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={() => { void submit(); }}
      />
    </DefiModalShell>
  );
};

export default HemiTunnelModal;
