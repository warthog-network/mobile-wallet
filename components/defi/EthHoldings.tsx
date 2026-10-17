import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { defiStyles } from './defiStyles';
import { theme } from '../../theme';
import { readEthereumHoldings, readEthereumHoldingsConfirmed, type EthAssetBalance } from '../../utils/ethHoldings';
import EthSendModal from './EthSendModal';
import TokenIcon from '../TokenIcon';
import FormattedNumber from '../FormattedNumber';

interface Props {
  address: string;
  refreshing?: boolean;
  /** Bumped after a swap from the Swap tab so this card reloads without remounting. */
  generation?: number;
  generationBlock?: number;
  onSwap?: () => void;
  onActivity?: () => void;
}

/** ETH and USDT held by the phrase-derived Ethereum account. */
const EthHoldings: React.FC<Props> = ({
  address,
  refreshing,
  generation = 0,
  generationBlock,
  onSwap,
  onActivity,
}) => {
  const [rows, setRows] = useState<EthAssetBalance[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const request = useRef(0);
  const seenGeneration = useRef(0);
  const rowsRef = useRef<EthAssetBalance[] | null>(null);

  const load = useCallback(async (blockNumber?: number) => {
    const id = ++request.current;
    setLoading(true);
    try {
      let next = await readEthereumHoldingsConfirmed(address, blockNumber);
      const previous = rowsRef.current;
      const unchanged = blockNumber != null && previous != null && next.every(
        (row, index) => row.amount != null && row.amount === previous[index]?.amount,
      );
      if (unchanged && previous) {
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
          if (id !== request.current) return;
          next = await readEthereumHoldings(address);
          if (next.some((row, index) => row.amount !== previous[index]?.amount)) break;
        }
      }
      if (id !== request.current) return;
      rowsRef.current = next;
      setRows(next);
      setFailed(next.every((row) => row.amount == null));
    } catch {
      if (id !== request.current) return;
      setFailed(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setRows(null);
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

  const showRows = rows != null && !failed;

  return (
    <View style={defiStyles.ethBlock}>
      <View style={defiStyles.ethHoldingsLabelRow}>
        <Text style={defiStyles.ethHoldingsLabel}>Ethereum</Text>
        {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
      </View>
      {failed ? (
        <Text style={defiStyles.ethHoldingsHint}>Ethereum balances unavailable</Text>
      ) : null}
      {showRows
        ? rows.map((row) => (
            <View key={row.symbol} style={defiStyles.ethHoldingRow}>
              <View style={defiStyles.ethSymbolGroup}>
                <TokenIcon symbol={row.symbol} size={28} />
                <Text style={defiStyles.ethHoldingSymbol}>{row.symbol}</Text>
              </View>
              {row.amount == null ? (
                <Text style={defiStyles.ethHoldingAmount}>—</Text>
              ) : (
                <FormattedNumber value={row.amount} variant="balance" style={defiStyles.ethHoldingAmount} />
              )}
            </View>
          ))
        : null}
      {showRows ? (
        <View style={defiStyles.ethActions}>
          <TouchableOpacity style={defiStyles.ethActionBtn} onPress={() => setSendOpen(true)}>
            <Text style={defiStyles.heroSendBtnText}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity style={defiStyles.ethActionBtn} onPress={() => onSwap?.()}>
            <Text style={defiStyles.heroSendBtnText}>Swap</Text>
          </TouchableOpacity>
          <TouchableOpacity style={defiStyles.ethActionBtn} onPress={() => onActivity?.()}>
            <Text style={defiStyles.heroSendBtnText}>Activity</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <EthSendModal
        visible={sendOpen}
        address={address}
        onClose={() => setSendOpen(false)}
        onSent={(blockNumber) => { void load(blockNumber); }}
      />
    </View>
  );
};

export default EthHoldings;
