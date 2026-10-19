import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { defiStyles } from './defiStyles';
import { theme } from '../../theme';
import { readHoldingAmounts } from '../../utils/tokenBalances';
import EthSendModal from './EthSendModal';
import TokenIcon from '../TokenIcon';
import FormattedNumber from '../FormattedNumber';
import TokenPickModal from './TokenPickModal';
import { useWalletTokens } from './useWalletTokens';
import { showOnHoldings } from '../../utils/walletTokens';

interface Props {
  address: string;
  refreshing?: boolean;
  /** Bumped after a swap from the Swap tab so this card reloads without remounting. */
  generation?: number;
  generationBlock?: number;
  onActivity?: () => void;
}

/** ETH, USDC, USDT, WBTC, and any token added on Ethereum. */
const EthHoldings: React.FC<Props> = ({
  address,
  refreshing,
  generation = 0,
  generationBlock,
  onActivity,
}) => {
  const { tokens } = useWalletTokens('ethereum');
  const [amounts, setAmounts] = useState<Record<string, string | null> | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const request = useRef(0);
  const seenGeneration = useRef(0);

  const load = useCallback(async (blockNumber?: number) => {
    const id = ++request.current;
    setLoading(true);
    const tag = blockNumber != null && blockNumber >= 0 ? `0x${Math.floor(blockNumber).toString(16)}` : 'latest';
    try {
      const next = await readHoldingAmounts(address, tokens, tag);
      if (id !== request.current) return;
      setAmounts(next);
      setFailed(Object.values(next).every((amount) => amount == null));
    } catch {
      if (id !== request.current) return;
      setFailed(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [address, tokens]);

  useEffect(() => {
    setAmounts(null);
    setFailed(false);
    setLoading(true);
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!refreshing) return;
    void load();
  }, [refreshing, load]);

  useEffect(() => {
    if (!generation || seenGeneration.current === generation) return;
    seenGeneration.current = generation;
    void load(generationBlock);
  }, [generation, generationBlock, load]);

  const known = amounts != null && !failed;
  const visible = known
    ? tokens.filter((token) => showOnHoldings(token, amounts[token.id]))
    : tokens.filter((token) => token.native);

  return (
    <View style={defiStyles.ethBlock}>
      <View style={defiStyles.ethHoldingsLabelRow}>
        <Text style={defiStyles.ethHoldingsLabel}>Ethereum</Text>
        {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
      </View>
      {failed ? (
        <Text style={defiStyles.ethHoldingsHint}>Ethereum balances unavailable</Text>
      ) : null}
      {visible.map((token) => {
        const amount = known ? amounts[token.id] : null;
        return (
          <View key={token.id} style={defiStyles.ethHoldingRow}>
            <View style={defiStyles.ethSymbolGroup}>
              <TokenIcon symbol={token.symbol} size={28} />
              <View>
                <Text style={defiStyles.ethHoldingSymbol}>{token.symbol}</Text>
                {token.custom ? <Text style={defiStyles.ethHoldingsHint}>{token.name}</Text> : null}
              </View>
            </View>
            {amount == null ? (
              <Text style={defiStyles.ethHoldingAmount}>{known || failed ? '—' : '…'}</Text>
            ) : (
              <FormattedNumber value={amount} variant="balance" style={defiStyles.ethHoldingAmount} />
            )}
          </View>
        );
      })}
      {address ? (
        <View style={defiStyles.ethActions}>
          <TouchableOpacity style={defiStyles.heroSendBtn} onPress={() => setSendOpen(true)}>
            <Text style={defiStyles.heroSendBtnText}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity style={defiStyles.heroSendBtn} onPress={() => onActivity?.()}>
            <Text style={defiStyles.heroSendBtnText}>Activity</Text>
          </TouchableOpacity>
          <TouchableOpacity style={defiStyles.heroSendBtn} onPress={() => setAddOpen(true)}>
            <Text style={defiStyles.heroSendBtnText}>Add token</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <EthSendModal
        visible={sendOpen}
        address={address}
        onClose={() => setSendOpen(false)}
        onSent={(blockNumber) => { void load(blockNumber); }}
      />
      <TokenPickModal
        visible={addOpen}
        network="ethereum"
        tokens={tokens}
        title="Ethereum tokens"
        onClose={() => setAddOpen(false)}
      />
    </View>
  );
};

export default EthHoldings;
