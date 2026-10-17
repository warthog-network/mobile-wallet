import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { toast } from '../../utils/toast';
import * as Clipboard from 'expo-clipboard';
import { defiStyles } from './defiStyles';
import DefiModalShell from './DefiModalShell';
import { isValidAssetHash, parseDisplayAmount } from '../../utils/warthogFormat';
import { lookupAssetInfo, searchAssets, type AssetInfo } from '../../utils/defiApi';
import { submitAssetCreation } from '../../utils/defiSubmit';
import { DEFAULT_FEE } from '../../constants';
import type { WalletData } from '../../types';
import { theme } from '../../theme';
import AssetMark, { AssetTitle } from './AssetMark';
import AssetChartPanel from './AssetChartPanel';
import { isLedgerSession } from '../../utils/sessionVault';
import { LEDGER_DEFI_HOLD } from '../../utils/ledger/protocol';

interface Props {
  visible: boolean;
  onClose: () => void;
  wallet: WalletData;
  selectedNode: string;
  nextNonce: number;
  onSuccess: (nonce: number) => Promise<void>;
  onTrackAsset: (hash: string, name?: string) => Promise<void>;
}

type SearchMode = 'name' | 'hashMatch' | 'lookup';

const AssetsModal: React.FC<Props> = ({
  visible,
  onClose,
  wallet,
  selectedNode,
  nextNonce,
  onSuccess,
  onTrackAsset,
}) => {
  const [tab, setTab] = useState<'create' | 'search'>('search');
  const [name, setName] = useState('');
  const [supply, setSupply] = useState('');
  const [decimals, setDecimals] = useState('8');
  const [fee, setFee] = useState(DEFAULT_FEE);
  const [searchMode, setSearchMode] = useState<SearchMode>('name');
  const [searchName, setSearchName] = useState('');
  const [searchHash, setSearchHash] = useState('');
  const [lookupHash, setLookupHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AssetInfo[]>([]);
  const [searchMeta, setSearchMeta] = useState<{ namePrefix?: string; hashPrefix?: string } | null>(null);
  const [lookupResult, setLookupResult] = useState<AssetInfo | null>(null);
  const [searched, setSearched] = useState(false);
  const [openAssetCharts, setOpenAssetCharts] = useState<Set<string>>(new Set());

  const chartKey = (hash: string) => String(hash || '').replace(/^0x/i, '').toLowerCase();
  const toggleAssetChart = (hash: string) => {
    const key = chartKey(hash);
    if (!key) return;
    setOpenAssetCharts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const chartOpen = (hash: string) => openAssetCharts.has(chartKey(hash));
  const toggleAllSearchCharts = (hashes: string[]) => {
    const keys = hashes.map(chartKey).filter(Boolean);
    if (!keys.length) return;
    setOpenAssetCharts((prev) => {
      const anyOpen = keys.some((k) => prev.has(k));
      return anyOpen ? new Set() : new Set(keys);
    });
  };

  const copyHash = (hash: string, label = 'Asset hash') => {
    if (!hash) return;
    Clipboard.setStringAsync(hash);
    toast.success('Copied', `${label} copied to clipboard`);
  };

  const handleCreate = async () => {
    const assetName = name.trim().toUpperCase();
    if (!assetName || assetName.length > 5) {
      toast.error('Invalid name', 'Asset name must be 1-5 characters');
      return;
    }
    if (!supply || parseFloat(supply) <= 0) {
      toast.error('Invalid supply', 'Enter a valid total supply');
      return;
    }
    const decimalsNum = parseInt(decimals.trim(), 10);
    if (!Number.isFinite(decimalsNum) || decimalsNum < 0 || decimalsNum > 18) {
      toast.error('Invalid decimals', 'Enter a whole number from 0 to 18');
      return;
    }
    setLoading(true);
    try {
      const result = await submitAssetCreation({
        node: selectedNode,
        wallet,
        nonceId: nextNonce,
        fee,
        name: assetName,
        supply,
        decimals: decimalsNum,
      });
      await onSuccess(result.nonce + 1);
      toast.success('Submitted', `Asset creation tx: ${result.txHash.slice(0, 20)}…`);
      copyHash(result.txHash, 'Transaction hash');
      setName('');
      setSupply('');
    } catch (e: any) {
      toast.error('Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    const namePrefix = searchName.trim().toUpperCase();
    const hashPrefix = searchHash.trim().replace(/^0x/i, '');

    if (searchMode === 'hashMatch' && !hashPrefix) {
      toast.error('Enter hash prefix', 'Provide a hash prefix to search');
      return;
    }

    setLoading(true);
    setResults([]);
    setSearchMeta(null);
    setSearched(false);
    try {
      const data = await searchAssets(
        selectedNode,
        searchMode === 'hashMatch' ? namePrefix : namePrefix,
        hashPrefix || undefined
      );
      setResults(data.matches);
      setSearchMeta({ namePrefix: data.namePrefix, hashPrefix: data.hashPrefix });
      setSearched(true);
    } catch (e: any) {
      toast.error('Search failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = async () => {
    const clean = lookupHash.trim().replace(/^0x/i, '').toLowerCase();
    if (!isValidAssetHash(clean)) {
      toast.error('Invalid hash', 'Enter a 64-character hex hash');
      return;
    }
    setLoading(true);
    setLookupResult(null);
    try {
      const data = await lookupAssetInfo(selectedNode, clean);
      setLookupResult(data as AssetInfo);
    } catch (e: any) {
      toast.error('Lookup failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const getAssetHash = (asset: AssetInfo) => asset.hash || asset.assetHash || '';

  const renderAssetCard = (asset: AssetInfo, key: string | number) => {
    const hash = getAssetHash(asset);
    const assetName = asset.name || 'Asset';
    return (
      <View key={key} style={[defiStyles.card, { flexDirection: 'column', alignItems: 'stretch' }]}>
        <View style={defiStyles.row}>
          {hash ? <AssetMark hash={hash} name={assetName} /> : null}
          <View style={{ flex: 1, marginLeft: hash ? theme.spacing.sm : 0 }}>
            {hash ? (
              <AssetTitle hash={hash} name={assetName} style={defiStyles.cardTitle} />
            ) : (
              <Text style={defiStyles.cardTitle}>{assetName}</Text>
            )}
            <Text style={defiStyles.cardSub}>ID {asset.id} • {asset.decimals} decimals</Text>
          </View>
          {hash ? (
            <TouchableOpacity
              style={defiStyles.compactBtn}
              onPress={() => copyHash(hash)}
            >
              <Text style={[defiStyles.compactBtnText, { fontFamily: theme.typography.fontFamily.mono }]}>
                {hash.slice(0, 8)}…{hash.slice(-6)}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={defiStyles.cardSub}>Supply: {parseDisplayAmount(asset.totalSupply)}</Text>
        {asset.height != null ? (
          <Text style={defiStyles.cardSub}>Block height: {asset.height}</Text>
        ) : null}
        <View style={[defiStyles.row, { marginTop: theme.spacing.sm, flexWrap: 'wrap' }]}>
          {hash ? (
            <>
              <TouchableOpacity
                style={[defiStyles.compactBtn, { flex: 1, minWidth: 120 }]}
                onPress={async () => {
                  try {
                    await onTrackAsset(hash, assetName);
                    toast.success('Tracked', `${assetName} added to wallet`);
                  } catch (e: any) {
                    toast.error('Failed', e.message);
                  }
                }}
              >
                <Text style={defiStyles.compactBtnText}>+ Track in Wallet</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[defiStyles.compactBtn, { flex: 1, minWidth: 120 }]}
                onPress={() => copyHash(hash, 'Full asset hash')}
              >
                <Text style={defiStyles.compactBtnTextAccent}>Copy Full Hash</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  defiStyles.compactBtn,
                  { flex: 1, minWidth: 90 },
                  chartOpen(hash) && defiStyles.compactBtnActive,
                ]}
                onPress={() => toggleAssetChart(hash)}
              >
                <Text
                  style={[
                    defiStyles.compactBtnText,
                    chartOpen(hash) && defiStyles.compactBtnTextActive,
                  ]}
                >
                  Chart
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
        {hash && chartOpen(hash) ? (
          <View style={{ width: '100%', marginTop: 8 }}>
            <AssetChartPanel
              nodeUrl={selectedNode}
              hash={hash}
              assetName={assetName}
            />
          </View>
        ) : null}
      </View>
    );
  };

  const searchSummary = () => {
    if (!searched) return null;
    if (results.length === 0) {
      return (
        <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing.sm }}>
          No assets found matching your search.
        </Text>
      );
    }
    const label = searchMeta?.namePrefix
      ? ` for "${searchMeta.namePrefix}"`
      : searchMeta?.hashPrefix
        ? ` with hash prefix "${searchMeta.hashPrefix}"`
        : ' (all assets)';
    const hashes = results.map((a) => getAssetHash(a)).filter(Boolean);
    const anyOpen = hashes.some((h) => chartOpen(h));
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: theme.spacing.sm,
        }}
      >
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.caption, flex: 1 }}>
          Found {results.length} match{results.length !== 1 ? 'es' : ''}{label}
        </Text>
        <TouchableOpacity
          style={[defiStyles.compactBtn, anyOpen && defiStyles.compactBtnActive]}
          onPress={() => toggleAllSearchCharts(hashes)}
        >
          <Text style={[defiStyles.compactBtnText, anyOpen && defiStyles.compactBtnTextActive]}>
            Charts
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Asset Tools"
      subtitle="Search, look up, and create assets on the DeFi testnet"
    >
          <View style={defiStyles.tabRow}>
            {(['search', 'create'] as const).map((t) => (
              <TouchableOpacity key={t} style={[defiStyles.tab, tab === t && defiStyles.tabActive]} onPress={() => setTab(t)}>
                <Text style={[defiStyles.tabText, tab === t && defiStyles.tabTextActive]}>
                  {t === 'create' ? 'Create Asset' : 'Search & Lookup'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'create' ? (
            <View>
              {isLedgerSession() ? <Text style={defiStyles.hintText}>{LEDGER_DEFI_HOLD}</Text> : null}
              <Text style={defiStyles.label}>Name (1-5 chars, e.g. HOG)</Text>
              <TextInput style={defiStyles.input} value={name} onChangeText={setName} autoCapitalize="characters" placeholderTextColor={theme.colors.textMuted} />
              <Text style={defiStyles.label}>Total Supply</Text>
              <TextInput style={defiStyles.input} value={supply} onChangeText={setSupply} keyboardType="decimal-pad" placeholderTextColor={theme.colors.textMuted} />
              <Text style={defiStyles.label}>Decimals (0-18)</Text>
              <Text style={[defiStyles.cardSub, { marginBottom: theme.spacing.xs }]}>
                Plain integer — unlike limit prices, this does not need encoding
              </Text>
              <TextInput style={defiStyles.input} value={decimals} onChangeText={setDecimals} keyboardType="number-pad" placeholderTextColor={theme.colors.textMuted} />
              <Text style={defiStyles.label}>Fee (WART)</Text>
              <TextInput style={defiStyles.input} value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholderTextColor={theme.colors.textMuted} />
              <TouchableOpacity style={defiStyles.btn} onPress={handleCreate} disabled={loading || isLedgerSession()}>
                <Text style={defiStyles.btnText}>{loading ? 'Submitting…' : 'Create Asset'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <View style={defiStyles.tabRow}>
                {([
                  { id: 'name' as const, label: 'Search by name' },
                  { id: 'hashMatch' as const, label: 'Hash prefix' },
                  { id: 'lookup' as const, label: 'Lookup by hash' },
                ]).map((mode) => (
                  <TouchableOpacity
                    key={mode.id}
                    style={[defiStyles.tab, searchMode === mode.id && defiStyles.tabActive]}
                    onPress={() => {
                      setSearchMode(mode.id);
                      setResults([]);
                      setLookupResult(null);
                      setSearched(false);
                    }}
                  >
                    <Text style={[defiStyles.tabText, searchMode === mode.id && defiStyles.tabTextActive]}>
                      {mode.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {searchMode === 'name' && (
                <View>
                  <Text style={defiStyles.label}>Name prefix (leave empty to list all)</Text>
                  <TextInput
                    style={defiStyles.input}
                    value={searchName}
                    onChangeText={setSearchName}
                    autoCapitalize="characters"
                    placeholder="e.g. BUN — or blank for all"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  <Text style={defiStyles.label}>Hash prefix (optional)</Text>
                  <TextInput
                    style={defiStyles.input}
                    value={searchHash}
                    onChangeText={setSearchHash}
                    autoCapitalize="none"
                    placeholder="First hex chars of asset hash"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  <TouchableOpacity style={defiStyles.btn} onPress={handleSearch} disabled={loading}>
                    <Text style={defiStyles.btnText}>{loading ? 'Querying…' : 'Query'}</Text>
                  </TouchableOpacity>
                  {searchSummary()}
                  {results.map((asset, i) => renderAssetCard(asset, i))}
                </View>
              )}

              {searchMode === 'hashMatch' && (
                <View>
                  <Text style={defiStyles.label}>Hash prefix</Text>
                  <TextInput
                    style={defiStyles.input}
                    value={searchHash}
                    onChangeText={setSearchHash}
                    autoCapitalize="none"
                    placeholder="e.g. 67be5795"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  <Text style={defiStyles.label}>Name prefix (optional filter)</Text>
                  <TextInput
                    style={defiStyles.input}
                    value={searchName}
                    onChangeText={setSearchName}
                    autoCapitalize="characters"
                    placeholder="Narrow by asset name"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  <TouchableOpacity style={defiStyles.btn} onPress={handleSearch} disabled={loading}>
                    <Text style={defiStyles.btnText}>{loading ? 'Querying…' : 'Query'}</Text>
                  </TouchableOpacity>
                  {searchSummary()}
                  {results.map((asset, i) => renderAssetCard(asset, i))}
                </View>
              )}

              {searchMode === 'lookup' && (
                <View>
                  <Text style={defiStyles.label}>Asset hash (64 hex chars)</Text>
                  <TextInput
                    style={defiStyles.input}
                    value={lookupHash}
                    onChangeText={setLookupHash}
                    autoCapitalize="none"
                    placeholder="64 hex characters (no 0x)"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  <TouchableOpacity style={defiStyles.btn} onPress={handleLookup} disabled={loading}>
                    <Text style={defiStyles.btnText}>{loading ? 'Querying…' : 'Query'}</Text>
                  </TouchableOpacity>
                  {lookupResult && renderAssetCard(lookupResult, 'lookup')}
                </View>
              )}
            </View>
          )}

          {loading && <ActivityIndicator color={theme.colors.primary} style={{ marginTop: theme.spacing.md }} />}
    </DefiModalShell>
  );
};

export default AssetsModal;