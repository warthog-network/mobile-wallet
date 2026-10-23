import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking } from 'react-native';
import { ethers } from 'ethers';
import DefiModalShell from './DefiModalShell';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import AssetMenu from './AssetMenu';
import { useWalletTokens } from './useWalletTokens';
import { defiStyles } from './defiStyles';
import { tokenMark } from '../TokenIcon';
import { formatRawAmountFloor } from '../../utils/ethHoldings';
import { explainChainError } from '../../utils/networks/http';
import { readHoldingAmounts, readOneBalance } from '../../utils/tokenBalances';
import { formatUnits, parseUnits } from '../../utils/networks/units';
import { isLedgerSession } from '../../utils/sessionVault';
import {
  btcTxUrl,
  fetchBtcBalance,
  formatBtc,
  maxSendableBtc,
  parseBtc,
  quoteBtcFee,
  sendBtc,
} from '../../utils/networks/btc';
import {
  formatHemi,
  hemiTxUrl,
  maxSendableHemi,
  parseHemi,
  quoteHemiFee,
  sendHemi,
  sendHemiCall,
} from '../../utils/networks/hemi';
import {
  SOL_FEE_LAMPORTS,
} from '../../utils/networks/chains';
import {
  assertSolAddress,
  fetchSolBalance,
  formatSol,
  maxSendableSol,
  parseSol,
  sendSol,
  solTxUrl,
} from '../../utils/networks/solana';
import { sendSpl } from '../../utils/networks/solswap';

const ERC20 = new ethers.Interface(['function transfer(address to, uint256 amount)']);

export type NetworkKind = 'btc' | 'hemi' | 'sol';

const COPY: Record<NetworkKind, { title: string; unit: string; subtitle: string; placeholder: string }> = {
  btc: {
    title: 'Send Bitcoin',
    unit: 'BTC',
    subtitle: 'Bitcoin mainnet. Native segwit from this account.',
    placeholder: 'bc1…',
  },
  hemi: {
    title: 'Send on Hemi',
    unit: 'ETH',
    subtitle: 'Hemi network. Gas is ETH on Hemi. The address matches Ethereum.',
    placeholder: '0x…',
  },
  sol: {
    title: 'Send SOL',
    unit: 'SOL',
    subtitle: 'Solana mainnet. Same account path Backpack and Phantom use.',
    placeholder: 'Solana address',
  },
};

interface Props {
  visible: boolean;
  kind: NetworkKind | null;
  address: string;
  onClose: () => void;
  onSent: () => void;
}

const NetworkSendModal: React.FC<Props> = ({ visible, kind, address, onClose, onSent }) => {
  const tokenNetwork = kind === 'hemi' ? 'hemi' : 'solana';
  const { tokens } = useWalletTokens(tokenNetwork);
  const [tokenId, setTokenId] = useState('');
  const [menuBalances, setMenuBalances] = useState<Record<string, string>>({});
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [held, setHeld] = useState<string | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flow = useSpendFlow();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const token = kind === 'btc' ? null : (tokens.find((item) => item.id === tokenId) ?? tokens[0]);

  const meta = kind ? COPY[kind] : COPY.btc;
  const unit = token?.symbol ?? meta.unit;
  const shownHeld = kind === 'btc' ? held : (token ? menuBalances[token.id] ?? null : null);

  useEffect(() => {
    if (!visible || !kind) return;
    setRecipient('');
    setAmount('');
    setHeld(null);
    setFee(null);
    setError(null);
    setTxUrl(null);
    setConfirmOpen(false);
    setTokenId('');
    setMenuBalances({});
    let cancel = false;
    if (kind === 'btc') {
      void fetchBtcBalance(address)
        .then(formatBtc)
        .then((next) => { if (!cancel) setHeld(next); })
        .catch((err: unknown) => { if (!cancel) setError(explainChainError(err)); });
    }
    return () => { cancel = true; };
  }, [visible, kind, address]);

  useEffect(() => {
    if (!visible || kind === 'btc' || !kind) return;
    let cancel = false;
    void readHoldingAmounts(address, tokens)
      .then((rows) => {
        if (cancel) return;
        const next: Record<string, string> = {};
        Object.entries(rows).forEach(([id, text]) => { if (text != null) next[id] = text; });
        setMenuBalances(next);
      })
      .catch((err: unknown) => { if (!cancel) setError(explainChainError(err)); });
    return () => { cancel = true; };
  }, [visible, kind, address, tokens]);

  const fillMax = async () => {
    if (!kind) return;
    setError(null);
    try {
      if (token && !token.native) {
        const raw = await readOneBalance(token.network, address, token);
        if (raw <= 0n) throw new Error(`This wallet has no ${token.symbol}.`);
        setAmount(token.network === 'solana'
          ? formatUnits(raw, token.decimals)
          : formatRawAmountFloor(raw, token.decimals, Math.min(token.decimals, 8)));
        return;
      }
      if (kind === 'btc') {
        const max = await maxSendableBtc(address);
        if (max <= 0n) throw new Error('Not enough Bitcoin to pay the miner fee.');
        setAmount(formatBtc(max));
        return;
      }
      if (kind === 'hemi') {
        const max = await maxSendableHemi(address);
        if (max <= 0n) throw new Error('Not enough ETH on Hemi to pay for gas.');
        setAmount(formatRawAmountFloor(max, 18, 6));
        return;
      }
      const balance = await fetchSolBalance(address);
      const max = maxSendableSol(balance);
      if (max <= 0n) throw new Error('Not enough SOL to pay the network fee.');
      setAmount(formatSol(max));
    } catch (err: unknown) {
      setError(explainChainError(err));
    }
  };

  const openConfirm = async () => {
    if (!kind) return;
    setError(null);
    setFee(null);
    try {
      if (!recipient.trim()) throw new Error('Enter the recipient address.');
      if (kind === 'btc') parseBtc(amount);
      else if (kind === 'sol') assertSolAddress(recipient);
      else if (!ethers.isAddress(recipient.trim())) throw new Error('Enter an address. Hemi uses the same shape as Ethereum.');
      if (token && !token.native) parseUnits(amount, token.decimals, token.symbol);
      else if (kind === 'hemi') parseHemi(amount);
      else if (kind === 'sol') parseSol(amount);
      const hemiFee = kind === 'hemi' ? await quoteHemiFee() : 0n;
      const nextFee = kind === 'btc'
        ? `${formatBtc(await quoteBtcFee(recipient, amount))} BTC`
        : kind === 'hemi'
          ? `up to ${formatHemi(token && !token.native ? hemiFee * 4n : hemiFee)} ETH`
          : token && !token.native
            ? `${formatSol(SOL_FEE_LAMPORTS)} SOL, more if they need a ${token.symbol} account`
            : `${formatSol(SOL_FEE_LAMPORTS)} SOL`;
      setFee(nextFee);
      setConfirmOpen(true);
    } catch (err: unknown) {
      setConfirmOpen(false);
      setError(explainChainError(err));
    }
  };

  const send = async () => {
    if (!kind) return;
    const network = kind === 'btc' ? 'Bitcoin' : kind === 'hemi' ? 'Hemi' : 'Solana';
    flow.begin(`Sending ${amount.trim()} ${unit} on ${network}…`);
    setError(null);
    try {
      if (kind === 'btc') {
        const tx = await sendBtc(recipient, amount);
        setTxUrl(btcTxUrl(tx.txid));
        flow.finish(true, 'Sent', `Bitcoin accepted ${amount.trim()} BTC.`);
      } else if (kind === 'hemi' && token && !token.native) {
        const raw = parseUnits(amount, token.decimals, token.symbol);
        const owned = await readOneBalance('hemi', address, token);
        if (raw > owned) throw new Error(`Only ${formatUnits(owned, token.decimals)} ${token.symbol} is in this wallet.`);
        const to = ethers.getAddress(recipient.trim());
        if (to.toLowerCase() === address.toLowerCase()) throw new Error('That address is this wallet.');
        const data = ERC20.encodeFunctionData('transfer', [to, raw]);
        const hash = await sendHemiCall({ to: token.address, data });
        setTxUrl(hemiTxUrl(hash));
        flow.finish(true, 'Sent', `Hemi confirmed ${amount.trim()} ${token.symbol}.`);
      } else if (kind === 'hemi') {
        const tx = await sendHemi(recipient, amount);
        setTxUrl(hemiTxUrl(tx.hash));
        flow.finish(true, 'Sent', `Hemi confirmed ${amount.trim()} ETH.`);
      } else if (token && !token.native) {
        const tx = await sendSpl({
          mint: token.address,
          decimals: token.decimals,
          toOwner: recipient,
          amount,
          symbol: token.symbol,
          program: token.program,
        });
        setTxUrl(solTxUrl(tx.signature));
        flow.finish(true, 'Sent', `Solana accepted ${amount.trim()} ${token.symbol}.`);
      } else {
        const tx = await sendSol(recipient, amount);
        setTxUrl(solTxUrl(tx.signature));
        flow.finish(true, 'Sent', `Solana accepted ${amount.trim()} SOL.`);
      }
      onSent();
    } catch (err: unknown) {
      const message = explainChainError(err);
      setError(message);
      flow.finish(false, 'Send failed', message);
    }
  };

  const title = token && !token.native ? `Send ${token.symbol}` : meta.title;
  const subtitle = token && !token.native
    ? kind === 'sol'
      ? 'Solana mainnet. The network fee is a little SOL.'
      : 'Hemi network. Gas is ETH on Hemi.'
    : meta.subtitle;

  return (
    <DefiModalShell visible={visible && kind != null} onClose={onClose} title={title} subtitle={subtitle}>
      {token ? (
        <AssetMenu
          label={token.symbol}
          tokens={tokens}
          selectedId={token.id}
          balances={menuBalances}
          network={token.network}
          icon={tokenMark(token.symbol, token.network, token.native)}
          onSelect={(next) => { setTokenId(next.id); setAmount(''); setError(null); }}
        />
      ) : null}
      <Text style={defiStyles.label}>To</Text>
      <TextInput
        style={defiStyles.input}
        value={recipient}
        onChangeText={setRecipient}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={meta.placeholder}
        placeholderTextColor="#71717a"
      />
      <Text style={defiStyles.label}>Amount · {shownHeld ?? '…'} {unit}</Text>
      <View style={defiStyles.ethAmountRow}>
        <TextInput
          style={[defiStyles.input, { flex: 1, marginBottom: 0 }]}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#71717a"
        />
        <TouchableOpacity style={defiStyles.ethMaxBtn} onPress={() => { void fillMax(); }}>
          <Text style={defiStyles.heroSendBtnText}>Max</Text>
        </TouchableOpacity>
      </View>
      {isLedgerSession() && token && !token.native ? (
        <Text style={defiStyles.ethHoldingsHint}>
          {kind === 'sol'
            ? 'The Solana app signs this. Turn on Blind signing in that app, and leave it open.'
            : 'The Ethereum app signs this. Turn on Blind signing in that app, and leave it open.'}
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
        onPress={() => { void openConfirm(); }}
        disabled={flow.busy}
      >
        <Text style={defiStyles.heroSendBtnText}>Review</Text>
      </TouchableOpacity>
      <SpendConfirm
        open={confirmOpen}
        title={title}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        confirmLabel={`Send ${unit}`}
        rows={[
          { label: 'Network', value: subtitle.split('.')[0] },
          { label: 'To', value: recipient.trim() },
          { label: 'Amount', value: `${amount.trim()} ${unit}` },
          { label: 'Fee', value: fee ?? 'Calculating…' },
        ]}
        onCancel={() => {
          flow.close(() => setAmount(''));
          setConfirmOpen(false);
        }}
        onConfirm={() => { void send(); }}
      />
    </DefiModalShell>
  );
};

export default NetworkSendModal;
