import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { defiStyles } from './defiStyles';
import { theme } from '../../theme';
import TokenIcon, { tokenMark, type TokenSymbol } from '../TokenIcon';
import FormattedNumber from '../FormattedNumber';
import HemiTunnelModal from './HemiTunnelModal';
import NetworkSendModal, { type NetworkKind } from './NetworkSendModal';
import { fetchBtcBalance, formatBtc } from '../../utils/networks/btc';
import { readHoldingAmounts } from '../../utils/tokenBalances';
import TokenPickModal from './TokenPickModal';
import { useWalletTokens } from './useWalletTokens';
import { showOnHoldings } from '../../utils/walletTokens';

interface Props {
  chain: NetworkKind;
  btcAddress?: string;
  hemiAddress?: string;
  solAddress?: string;
  accountKind?: 'software' | 'ledger';
  onAddAccount?: () => void;
  addingAccount?: boolean;
  refreshing?: boolean;
  /** Bumped after a Solana swap so USDC and USDT reload. */
  solGeneration?: number;
  /** Bumped after a Hemi swap or Stargate move so the Hemi balance reloads. */
  hemiGeneration?: number;
  onCopyAddress: (address: string) => void;
  onActivity?: () => void;
  /** Bumped by the collapsed Send square. A remount does not open the modal. */
  openSendTick?: number;
}

const LABELS: Record<NetworkKind, { icon: TokenSymbol; title: string; unit?: string }> = {
  btc: { icon: 'BTC', title: 'BTC' },
  hemi: { icon: 'HEMI', title: 'Hemi', unit: 'ETH' },
  sol: { icon: 'SOL', title: 'SOL' },
};

function shortAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

const NetworkHoldings: React.FC<Props> = ({
  chain,
  btcAddress,
  hemiAddress,
  solAddress,
  accountKind = 'software',
  onAddAccount,
  addingAccount = false,
  refreshing,
  solGeneration = 0,
  hemiGeneration = 0,
  onCopyAddress,
  onActivity,
  openSendTick = 0,
}) => {
  const tokenNetwork = chain === 'hemi' ? 'hemi' : 'solana';
  const { tokens } = useWalletTokens(tokenNetwork);
  const [amount, setAmount] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [held, setHeld] = useState<Record<string, string | null> | null>(null);
  const [heldFailed, setHeldFailed] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [tunnelOpen, setTunnelOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const request = useRef(0);
  const seenSol = useRef(0);
  const seenHemi = useRef(0);
  const seenSend = useRef(openSendTick);

  useEffect(() => {
    if (openSendTick === seenSend.current) return;
    seenSend.current = openSendTick;
    if (openSendTick > 0) setSendOpen(true);
  }, [openSendTick]);

  const address = chain === 'btc' ? btcAddress : chain === 'hemi' ? hemiAddress : solAddress;
  const meta = LABELS[chain];

  const load = useCallback(async () => {
    const id = ++request.current;
    if (!address) {
      setAmount(null);
      setFailed(false);
      setHeld(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (chain === 'btc') {
        setAmount(formatBtc(await fetchBtcBalance(address)));
        setHeld(null);
        setHeldFailed(false);
      } else {
        const next = await readHoldingAmounts(address, tokens);
        if (id !== request.current) return;
        setHeld(next);
        setHeldFailed(Object.values(next).every((value) => value == null));
        const native = tokens.find((token) => token.native);
        setAmount(native ? next[native.id] ?? null : null);
      }
      if (id !== request.current) return;
      setFailed(false);
    } catch {
      if (id !== request.current) return;
      setFailed(true);
      setAmount(null);
      setHeld(null);
      setHeldFailed(true);
    }
    if (id === request.current) setLoading(false);
  }, [address, chain, tokens]);

  useEffect(() => {
    setAmount(null);
    setFailed(false);
    setHeld(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!refreshing) return;
    void load();
  }, [refreshing, load]);

  useEffect(() => {
    if (!solGeneration || chain !== 'sol' || seenSol.current === solGeneration) return;
    seenSol.current = solGeneration;
    void load();
  }, [solGeneration, chain, load]);

  useEffect(() => {
    if (!hemiGeneration || chain !== 'hemi' || seenHemi.current === hemiGeneration) return;
    seenHemi.current = hemiGeneration;
    void load();
  }, [hemiGeneration, chain, load]);

  const listed = chain === 'btc' || !address
    ? []
    : held != null && !heldFailed
      ? tokens.filter((token) => showOnHoldings(token, held[token.id]))
      : tokens.filter((token) => token.native);

  const note = !address
    ? chain === 'hemi'
      ? accountKind === 'ledger'
        ? 'Open Ethereum and add the Nano account. Hemi uses that address.'
        : 'Hemi needs the recovery phrase.'
      : chain === 'btc'
        ? accountKind === 'ledger'
          ? 'Open the Bitcoin app on the Nano and approve the address it shows. That address stays with this Ledger account.'
          : 'Bitcoin needs the recovery phrase.'
        : accountKind === 'ledger'
          ? 'Open the Solana app on the Nano and approve the address it shows. That address stays with this Ledger account.'
          : 'Solana needs the recovery phrase.'
    : chain === 'hemi'
      ? 'Same address as Ethereum. Gas is ETH on Hemi.'
      : chain === 'sol'
        ? 'SOL on this address. Other tokens show here once they have a balance.'
        : null;

  const tokenRow = (
    icon: string,
    title: string,
    value: string | null,
    missing: boolean,
    unit?: string,
  ) => (
    <View style={defiStyles.ethHoldingRow}>
      <View style={defiStyles.ethSymbolGroup}>
        <TokenIcon symbol={icon} size={28} />
        <View>
          <Text style={defiStyles.ethHoldingSymbol}>{title}</Text>
          {unit ? <Text style={defiStyles.ethHoldingsHint}>{unit}</Text> : null}
        </View>
      </View>
      {missing || value == null ? (
        <Text style={defiStyles.ethHoldingAmount}>{missing ? '—' : '…'}</Text>
      ) : (
        <FormattedNumber value={value} variant="balance" style={defiStyles.ethHoldingAmount} />
      )}
    </View>
  );

  return (
    <View style={defiStyles.ethBlock}>
      <View style={defiStyles.ethHoldingsLabelRow}>
        <Text style={defiStyles.ethHoldingsLabel}>
          {chain === 'btc' ? 'Bitcoin' : chain === 'hemi' ? 'Hemi' : 'Solana'}
        </Text>
        {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
      </View>
      {chain === 'btc' ? tokenRow(meta.icon, meta.title, amount, !address || failed, meta.unit) : null}
      {listed.map((token) => (
        <View key={token.id}>
          {tokenRow(
            tokenMark(token.symbol, chain === 'hemi' ? 'hemi' : undefined, token.native) as TokenSymbol,
            token.symbol,
            held?.[token.id] ?? null,
            heldFailed,
            token.name === token.symbol ? undefined : token.name,
          )}
        </View>
      ))}
      {address ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => onCopyAddress(address)}>
            <Text style={[defiStyles.ethAddress, { marginTop: 0 }]} numberOfLines={1}>
              {shortAddress(address)}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={defiStyles.heroSendBtn} onPress={() => setSendOpen(true)}>
            <Text style={defiStyles.heroSendBtnText}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity style={defiStyles.heroSendBtn} onPress={() => onActivity?.()}>
            <Text style={defiStyles.heroSendBtnText}>Activity</Text>
          </TouchableOpacity>
          {chain === 'hemi' ? (
            <TouchableOpacity style={defiStyles.heroSendBtn} onPress={() => setTunnelOpen(true)}>
              <Text style={defiStyles.heroSendBtnText}>Tunnel</Text>
            </TouchableOpacity>
          ) : null}
          {chain !== 'btc' ? (
            <TouchableOpacity style={defiStyles.heroSendBtn} onPress={() => setAddOpen(true)}>
              <Text style={defiStyles.heroSendBtnText}>Add token</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <>
          <Text style={defiStyles.ethHoldingsHint}>{note}</Text>
          {accountKind === 'ledger' && onAddAccount && chain !== 'hemi' ? (
            <TouchableOpacity
              style={[defiStyles.heroSendBtn, { marginTop: 8, alignSelf: 'flex-start' }]}
              onPress={onAddAccount}
              disabled={addingAccount}
            >
              <Text style={defiStyles.heroSendBtnText}>
                {addingAccount
                  ? 'Approve on Ledger…'
                  : chain === 'btc'
                    ? 'Add Bitcoin account'
                    : 'Add Solana account'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
      {address && note ? (
        <Text style={[defiStyles.ethHoldingsHint, { marginTop: 8 }]}>{note}</Text>
      ) : null}
      <NetworkSendModal
        visible={sendOpen}
        kind={chain}
        address={address || ''}
        onClose={() => setSendOpen(false)}
        onSent={() => { void load(); }}
      />
      {chain === 'hemi' && hemiAddress ? (
        <HemiTunnelModal
          visible={tunnelOpen}
          btcAddress={btcAddress}
          hemiAddress={hemiAddress}
          ledger={accountKind === 'ledger'}
          onClose={() => setTunnelOpen(false)}
        />
      ) : null}
      {chain !== 'btc' ? (
        <TokenPickModal
          visible={addOpen}
          network={tokenNetwork}
          tokens={tokens}
          title={chain === 'hemi' ? 'Hemi tokens' : 'Solana tokens'}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </View>
  );
};

export default NetworkHoldings;
