// TransactionHistory.tsx — FULLY UPDATED (Feb 2026)
// FIXED: Correct /transaction/lookup endpoint + block fallback
// Dates now always show for confirmed transactions
// Newest transactions first + robust timestamp handling
// ENHANCED: Contact names instead of raw addresses
// FIXED: Infinite refresh loop (onRefresh in fetch deps + callback)

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { toast } from './utils/toast';
import { useAddressBook } from './components/AddressBook/AddressBookModal';
import {
  fetchAccountHistory,
  fetchAccountHistoryPreferIndexer,
  type NormalizedHistoryTx,
} from './utils/historyParser';
import {
  DEFI_HISTORY_FILTERS,
  MAINNET_HISTORY_FILTERS,
  filterEmptyMessage,
  matchesHistoryFilter,
  type HistoryFilterId,
} from './utils/historyFilters';
import { isDefiNode } from './utils/nodes';
import { defiColors } from './components/defi/defiStyles';
import SelectDropdown from './components/SelectDropdown';
import { theme } from './theme';

interface Props {
  address: string;
  node: string;
  onRefresh?: () => void | Promise<void>;
  onAddContact?: (address: string) => void;
}

/** Like wartbunker: client-scan older pages until enough filter matches (node has no type filter). */
const FILTER_HUNT_MAX_PAGES = 40;
const FILTER_PAGE_SIZE = 7;

type HistoryCacheEntry = {
  items: NormalizedHistoryTx[];
  source: 'indexer' | 'node';
  hasMore: boolean;
  fromId: number | string | null;
  indexerPage: number;
  pagesLoaded: number;
};

const historyPageCache = new Map<string, HistoryCacheEntry>();
const lastFilterByAccount = new Map<string, HistoryFilterId>();

function accountCacheKey(node: string, address: string) {
  return `${node}::${address.toLowerCase()}`;
}

function historyCacheKey(node: string, address: string, filter: string) {
  return `${accountCacheKey(node, address)}::${filter}`;
}

function mergeHistory(
  prev: NormalizedHistoryTx[],
  next: NormalizedHistoryTx[],
): NormalizedHistoryTx[] {
  const seen = new Set(prev.map((t) => t.txid));
  const merged = [...prev];
  for (const tx of next) {
    if (!tx.txid || seen.has(tx.txid)) continue;
    seen.add(tx.txid);
    merged.push(tx);
  }
  merged.sort((a, b) => (b.height || 0) - (a.height || 0));
  return merged;
}

function updateRewardCounts(items: NormalizedHistoryTx[]) {
  const now = Date.now() / 1000;
  const rewards = items.filter((tx) => tx.isReward);
  return {
    '24h': rewards.filter((tx) => (tx.timestamp || 0) >= now - 86400).length,
    week: rewards.filter((tx) => (tx.timestamp || 0) >= now - 604800).length,
    month: rewards.filter((tx) => (tx.timestamp || 0) >= now - 2592000).length,
    rewards24h: rewards
      .filter((tx) => (tx.timestamp || 0) >= now - 86400)
      .map((tx) => tx.txid),
    rewardsWeek: rewards
      .filter((tx) => (tx.timestamp || 0) >= now - 604800)
      .map((tx) => tx.txid),
    rewardsMonth: rewards
      .filter((tx) => (tx.timestamp || 0) >= now - 2592000)
      .map((tx) => tx.txid),
  };
}

const TransactionHistory: React.FC<Props> = ({
  address,
  node,
  onRefresh,
  onAddContact,
}) => {
  const [history, setHistory] = useState<NormalizedHistoryTx[]>([]);
  const [loading, setLoading] = useState(false);
  /** Client-side filter hunt: paging older node history until matches (wartbunker parity). */
  const [hunting, setHunting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(FILTER_PAGE_SIZE);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterId>('all');
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [fromId, setFromId] = useState<number | string | null>(null);
  const [pagesLoaded, setPagesLoaded] = useState(0);
  /** indexer = server type filters; node = RPC + client hunt */
  const [historySource, setHistorySource] = useState<'indexer' | 'node' | null>(null);
  const [indexerPage, setIndexerPage] = useState(1);
  const requestId = useRef(0);
  const huntGen = useRef(0);
  /** Live snapshots for async pagination (avoid stale closures mid-hunt). */
  const historyRef = useRef<NormalizedHistoryTx[]>([]);
  const fromIdRef = useRef<number | string | null>(null);
  const hasMoreRef = useRef(false);
  const pagesLoadedRef = useRef(0);
  const historySourceRef = useRef<'indexer' | 'node' | null>(null);
  const indexerPageRef = useRef(1);
  /** Skip re-fetch on first historyFilter effect (address load owns it). */
  const skipFilterReloadRef = useRef(true);
  const isDefi = isDefiNode(node);
  const filters = isDefi ? DEFI_HISTORY_FILTERS : MAINNET_HISTORY_FILTERS;

  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    fromIdRef.current = fromId;
  }, [fromId]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    pagesLoadedRef.current = pagesLoaded;
  }, [pagesLoaded]);
  useEffect(() => {
    historySourceRef.current = historySource;
  }, [historySource]);
  useEffect(() => {
    indexerPageRef.current = indexerPage;
  }, [indexerPage]);

  const { addContact, getContactByAddress } = useAddressBook();

  const [blockCounts, setBlockCounts] = useState({
    '24h': 0,
    week: 0,
    month: 0,
    rewards24h: [] as string[],
    rewardsWeek: [] as string[],
    rewardsMonth: [] as string[],
  });

  const abbreviate = (str: string) =>
    str ? `${str.slice(0, 6)}...${str.slice(-4)}` : 'N/A';

  const getAddressDisplay = (
    addr: string | null | undefined,
    isFromAddress = false
  ): { display: string; isContact: boolean; fullAddress: string } => {
    if (!addr) {
      return {
        display: isFromAddress ? 'Block Reward' : 'N/A',
        isContact: false,
        fullAddress: '',
      };
    }

    const contact = getContactByAddress(addr);
    if (contact) {
      return { display: contact.name, isContact: true, fullAddress: addr };
    }

    return { display: abbreviate(addr), isContact: false, fullAddress: addr };
  };

  const handleSaveAsContact = async (addr: string) => {
    if (onAddContact) {
      onAddContact(addr);
      return;
    }

    Alert.alert(
      'Save Contact',
      `Would you like to save "${addr.slice(0, 10)}..." as a contact?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            try {
              const defaultName = `Contact ${Date.now().toString().slice(-4)}`;
              await addContact({
                name: defaultName,
                address: addr,
                notes: 'Added from transaction history',
                isFavorite: false,
              });
              toast.success('Contact saved', `"${defaultName}" added`);
            } catch {
              toast.error('Could not save', 'Failed to save contact. It may already exist.');
            }
          },
        },
      ]
    );
  };

  /**
   * Indexer already applied group=/direction= — trust results.
   * Node path: client-filter (and hunt older pages).
   */
  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all' || historySource === 'indexer') return history;
    return history.filter((tx) => matchesHistoryFilter(tx, historyFilter, address));
  }, [history, historyFilter, address, historySource]);

  const applyFullList = useCallback((items: NormalizedHistoryTx[]) => {
    setHistory(items);
    setError(null);
    setBlockCounts(updateRewardCounts(items));
  }, []);

  const writeHistoryCache = useCallback(
    (filter: HistoryFilterId, entry: HistoryCacheEntry) => {
      const cacheFilter = entry.source === 'node' ? 'all' : filter;
      historyPageCache.set(historyCacheKey(node, address, cacheFilter), entry);
    },
    [address, node],
  );

  const applyCachedEntry = useCallback(
    (entry: HistoryCacheEntry) => {
      requestId.current += 1;
      huntGen.current += 1;
      applyFullList(entry.items);
      historyRef.current = entry.items;
      historySourceRef.current = entry.source;
      fromIdRef.current = entry.fromId;
      hasMoreRef.current = entry.hasMore;
      pagesLoadedRef.current = entry.pagesLoaded;
      indexerPageRef.current = entry.indexerPage;
      setHistorySource(entry.source);
      setFromId(entry.fromId);
      setHasMore(entry.hasMore);
      setPagesLoaded(entry.pagesLoaded);
      setIndexerPage(entry.indexerPage);
      setLoading(false);
      setHunting(false);
      setError(null);
    },
    [applyFullList],
  );

  const resolveHistoryCache = useCallback(
    (filter: HistoryFilterId): HistoryCacheEntry | null => {
      const exact = historyPageCache.get(historyCacheKey(node, address, filter));
      if (exact) return exact;
      const all = historyPageCache.get(historyCacheKey(node, address, 'all'));
      if (all?.source === 'node') return all;
      return null;
    },
    [address, node],
  );

  /**
   * Load history for current filter.
   * Prefer explorer indexer (WartBunker-style server type filters).
   */
  const fetchHistory = useCallback(
    async (options?: { syncWallet?: boolean; filter?: HistoryFilterId }) => {
      if (!address) return;

      const filter = options?.filter ?? historyFilter;
      const id = ++requestId.current;
      huntGen.current += 1;
      setLoading(true);
      setHunting(false);
      setError(null);
      setVisibleCount(FILTER_PAGE_SIZE);

      try {
        const result = await fetchAccountHistoryPreferIndexer(node, address, {
          filter,
          page: 1,
        });
        if (id !== requestId.current) return;

        applyFullList(result.items);
        historyRef.current = result.items;
        historySourceRef.current = result.source;
        setHistorySource(result.source);

        if (result.source === 'indexer') {
          fromIdRef.current = null;
          hasMoreRef.current = result.hasMore;
          pagesLoadedRef.current = 1;
          indexerPageRef.current = result.nextPage ?? 2;
          setFromId(null);
          setHasMore(result.hasMore);
          setPagesLoaded(1);
          setIndexerPage(result.nextPage ?? 2);
        } else {
          fromIdRef.current = result.fromId;
          hasMoreRef.current = result.hasMore;
          pagesLoadedRef.current = 1;
          indexerPageRef.current = 1;
          setFromId(result.fromId);
          setHasMore(result.hasMore);
          setPagesLoaded(1);
          setIndexerPage(1);
        }

        writeHistoryCache(filter, {
          items: result.items,
          source: result.source,
          hasMore: result.hasMore,
          fromId: result.source === 'indexer' ? null : result.fromId,
          indexerPage: result.source === 'indexer' ? result.nextPage ?? 2 : 1,
          pagesLoaded: 1,
        });

        if (options?.syncWallet && onRefresh) {
          await onRefresh();
        }
      } catch (err: any) {
        if (id !== requestId.current) return;
        const message = err.message || 'Node returned error – try backup node';
        setError(message);
        console.error('History fetch error:', err);
        applyFullList([]);
        historyRef.current = [];
        fromIdRef.current = null;
        hasMoreRef.current = false;
        pagesLoadedRef.current = 0;
        historySourceRef.current = null;
        setFromId(null);
        setHasMore(false);
        setPagesLoaded(0);
        setHistorySource(null);
      } finally {
        if (id === requestId.current) {
          setLoading(false);
        }
      }
    },
    [address, node, historyFilter, applyFullList, onRefresh, writeHistoryCache],
  );

  const loadForFilter = useCallback(
    (filter: HistoryFilterId, opts?: { force?: boolean; syncWallet?: boolean }) => {
      if (!address) return;
      lastFilterByAccount.set(accountCacheKey(node, address), filter);

      if (!opts?.force) {
        const source = historySourceRef.current;
        if (source === 'node' && historyRef.current.length > 0 && !opts?.syncWallet) {
          setVisibleCount(FILTER_PAGE_SIZE);
          return;
        }
        const cached = resolveHistoryCache(filter);
        if (cached) {
          applyCachedEntry(cached);
          setVisibleCount(FILTER_PAGE_SIZE);
          return;
        }
      }

      void fetchHistory({ filter, syncWallet: opts?.syncWallet });
    },
    [address, node, fetchHistory, resolveHistoryCache, applyCachedEntry],
  );

  /**
   * Append older pages — indexer page++ or node cursor.
   * Node path: used for Show More and filter hunt when matches sit under rewards.
   */
  const loadOlderPages = useCallback(
    async (opts: {
      maxPages: number;
      untilMatchCount?: number;
      filter?: HistoryFilterId;
    }): Promise<{
      items: NormalizedHistoryTx[];
      hasMore: boolean;
      fromId: number | string | null;
      pagesFetched: number;
      nextIndexerPage?: number;
    }> => {
      let more = hasMoreRef.current;
      let pages = 0;
      let acc = historyRef.current;
      let nextFrom: number | string | null = fromIdRef.current;
      let nextIdxPage = indexerPageRef.current;
      const source = historySourceRef.current;
      const filter = opts.filter || 'all';

      // Indexer: server already filtered — just page forward
      if (source === 'indexer') {
        while (pages < opts.maxPages && more) {
          const result = await fetchAccountHistoryPreferIndexer(node, address, {
            filter,
            page: nextIdxPage,
          });
          if (result.source !== 'indexer') {
            // Indexer died mid-session — stop; user can refresh
            more = false;
            break;
          }
          pages += 1;
          const beforeLen = acc.length;
          acc = mergeHistory(acc, result.items);
          more = result.hasMore;
          nextIdxPage = result.nextPage ?? nextIdxPage + 1;
          if (result.items.length === 0 || acc.length === beforeLen) {
            more = false;
            break;
          }
          if (
            opts.untilMatchCount != null &&
            acc.length >= opts.untilMatchCount
          ) {
            break;
          }
        }
        return {
          items: acc,
          hasMore: more,
          fromId: null,
          pagesFetched: pages,
          nextIndexerPage: nextIdxPage,
        };
      }

      // Node: no type filter — page and client-filter
      if (acc.length > 0 && (!more || nextFrom == null)) {
        return { items: acc, hasMore: false, fromId: nextFrom, pagesFetched: 0 };
      }

      while (pages < opts.maxPages) {
        const before: number | string =
          acc.length === 0 || nextFrom == null ? 4294967295 : nextFrom;

        if (acc.length > 0 && nextFrom == null) {
          more = false;
          break;
        }

        const result = await fetchAccountHistory(node, address, before);
        pages += 1;
        const beforeLen = acc.length;
        acc = mergeHistory(acc, result.items);
        nextFrom = result.fromId;
        more = Boolean(result.hasMore && result.fromId);

        if (opts.untilMatchCount != null && filter !== 'all') {
          const matches = acc.filter((tx) =>
            matchesHistoryFilter(tx, filter, address),
          ).length;
          if (matches >= opts.untilMatchCount) break;
        }

        if (!result.hasMore || result.fromId == null) {
          more = false;
          break;
        }
        if (result.items.length === 0 || acc.length === beforeLen) {
          more = false;
          break;
        }
      }

      return { items: acc, hasMore: more, fromId: nextFrom, pagesFetched: pages };
    },
    [address, node],
  );

  // Address/node change — restore last filter + cache when revisiting.
  useEffect(() => {
    if (!address) return;
    skipFilterReloadRef.current = true;
    const remembered = lastFilterByAccount.get(accountCacheKey(node, address)) || 'all';
    setHistoryFilter(remembered);
    loadForFilter(remembered);
  }, [address, node]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Filter change: reuse cached pages (and node client-filter) instead of refetching.
   * Indexer still fetches the first time a type is opened.
   */
  useEffect(() => {
    setVisibleCount(FILTER_PAGE_SIZE);
    if (!address) return;
    if (skipFilterReloadRef.current) {
      skipFilterReloadRef.current = false;
      return;
    }
    loadForFilter(historyFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFilter]);

  /**
   * Node-only filter hunt: keep loading older pages until matches found.
   * Skipped when source is indexer (server already filtered).
   */
  useEffect(() => {
    if (!address || loading) return;
    if (historySource === 'indexer') return;
    if (historyFilter === 'all') return;
    if (hunting) return;

    const need = visibleCount;
    if (filteredHistory.length >= need) return;
    if (!hasMore && pagesLoaded > 0) return;
    if (pagesLoaded >= FILTER_HUNT_MAX_PAGES) return;
    if (pagesLoaded === 0 && history.length === 0) return;

    const gen = ++huntGen.current;
    let cancelled = false;

    (async () => {
      setHunting(true);
      try {
        const remaining = Math.max(1, FILTER_HUNT_MAX_PAGES - pagesLoadedRef.current);
        const result = await loadOlderPages({
          maxPages: remaining,
          untilMatchCount: need,
          filter: historyFilter,
        });
        if (cancelled || gen !== huntGen.current) return;

        applyFullList(result.items);
        historyRef.current = result.items;
        fromIdRef.current = result.fromId;
        hasMoreRef.current = result.hasMore;
        setFromId(result.fromId);
        setHasMore(result.hasMore);
        const nextPages = pagesLoadedRef.current + result.pagesFetched;
        pagesLoadedRef.current = nextPages;
        setPagesLoaded(nextPages);
        if (historySourceRef.current) {
          writeHistoryCache(historyFilter, {
            items: result.items,
            source: historySourceRef.current,
            hasMore: result.hasMore,
            fromId: result.fromId,
            indexerPage: indexerPageRef.current,
            pagesLoaded: nextPages,
          });
        }
      } catch (err: any) {
        if (cancelled || gen !== huntGen.current) return;
        console.warn('Filter hunt failed:', err);
      } finally {
        if (!cancelled && gen === huntGen.current) {
          setHunting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address,
    historyFilter,
    historySource,
    filteredHistory.length,
    visibleCount,
    hasMore,
    pagesLoaded,
    loading,
    history.length,
  ]);

  const handleShowMore = useCallback(async () => {
    const nextVisible = visibleCount + FILTER_PAGE_SIZE;
    if (filteredHistory.length > visibleCount) {
      setVisibleCount(nextVisible);
      return;
    }
    if (!hasMore || loading || hunting) {
      setVisibleCount(nextVisible);
      return;
    }
    setHunting(true);
    try {
      const result = await loadOlderPages({
        maxPages: historySource === 'indexer' ? 1 : 5,
        untilMatchCount:
          historySource === 'indexer' || historyFilter === 'all'
            ? nextVisible
            : nextVisible,
        filter: historyFilter,
      });
      applyFullList(result.items);
      historyRef.current = result.items;
      fromIdRef.current = result.fromId;
      hasMoreRef.current = result.hasMore;
      setFromId(result.fromId);
      setHasMore(result.hasMore);
      if (result.nextIndexerPage != null) {
        indexerPageRef.current = result.nextIndexerPage;
        setIndexerPage(result.nextIndexerPage);
      }
      const nextPages = pagesLoadedRef.current + result.pagesFetched;
      pagesLoadedRef.current = nextPages;
      setPagesLoaded(nextPages);
      setVisibleCount(nextVisible);
      if (historySourceRef.current) {
        writeHistoryCache(historyFilter, {
          items: result.items,
          source: historySourceRef.current,
          hasMore: result.hasMore,
          fromId: result.fromId,
          indexerPage: indexerPageRef.current,
          pagesLoaded: nextPages,
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load more history');
    } finally {
      setHunting(false);
    }
  }, [
    visibleCount,
    filteredHistory.length,
    hasMore,
    loading,
    hunting,
    loadOlderPages,
    historyFilter,
    historySource,
    applyFullList,
    writeHistoryCache,
  ]);

  const copy = (text: string, label: string) => {
    Clipboard.setStringAsync(text);
    toast.success('Copied', `${label} copied`);
  };

  const showInitialLoader = loading && history.length === 0;
  const filterBusy = hunting && historyFilter !== 'all';
  const filterExhausted =
    historyFilter !== 'all' &&
    !hunting &&
    !loading &&
    filteredHistory.length === 0 &&
    history.length > 0 &&
    (!hasMore || pagesLoaded >= FILTER_HUNT_MAX_PAGES);

  return (
    <View style={styles.section}>
      <Text style={styles.smallTitle}>Blocks Mined</Text>
      <View style={styles.rewardRow}>
        <TouchableOpacity style={styles.rewardPill}>
          <Text style={styles.rewardText}>24h: {blockCounts['24h']}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rewardPill}>
          <Text style={styles.rewardText}>Week: {blockCounts.week}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rewardPill}>
          <Text style={styles.rewardText}>Month: {blockCounts.month}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Transaction History</Text>
      {isDefi && (
        <Text style={styles.networkNote}>
          DeFi — type filters use explorer indexer when available (like WartBunker)
          {historySource === 'indexer'
            ? ' · indexer'
            : historySource === 'node'
              ? ' · node (scan older pages)'
              : ''}
        </Text>
      )}
      {!isDefi && (
        <Text style={styles.networkNote}>
          Mainnet — filter rewards, transfers, or in/out
          {historySource === 'indexer'
            ? ' · indexer'
            : historySource === 'node'
              ? ' · node history'
              : ''}
        </Text>
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          onPress={() => loadForFilter(historyFilter, { force: true, syncWallet: true })}
          style={styles.actionBtn}
          disabled={loading}
        >
          <Text style={styles.actionBtnText}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
        </TouchableOpacity>
        <SelectDropdown
          value={historyFilter}
          options={filters}
          onChange={setHistoryFilter}
          placeholder="Tx type"
          accessibilityLabel="Transaction type filter"
          style={styles.filterDropdown}
        />
      </View>
      {historyFilter !== 'all' && (history.length > 0 || filterBusy) ? (
        <Text style={styles.filterMeta}>
          {filterBusy
            ? `Scanning older history for ${
                filters.find((f) => f.id === historyFilter)?.label || historyFilter
              }…`
            : `${filteredHistory.length} match${filteredHistory.length === 1 ? '' : 'es'}${
                history.length !== filteredHistory.length
                  ? ` · of ${history.length} loaded`
                  : ''
              }${hasMore ? ' · more available' : ''}`}
        </Text>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {(loading && history.length > 0) || filterBusy ? (
            <View style={styles.refreshingRow}>
              <ActivityIndicator size="small" color={defiColors.goldHover} />
              <Text style={styles.refreshingText}>
                {filterBusy
                  ? historySource === 'indexer'
                    ? 'Loading filtered history…'
                    : 'Scanning older node history for matches…'
                  : 'Updating history…'}
              </Text>
            </View>
          ) : null}

          {showInitialLoader ? (
            <ActivityIndicator size="large" color={defiColors.goldHover} style={{ margin: 30 }} />
          ) : history.length === 0 && !loading ? (
            <Text style={styles.noTx}>{error ? 'Could not load transactions' : 'No transactions yet'}</Text>
          ) : filteredHistory.length === 0 && filterBusy ? (
            <Text style={styles.noTx}>Looking past recent rewards for matches…</Text>
          ) : filteredHistory.length === 0 && filterExhausted ? (
            <Text style={styles.noTx}>{filterEmptyMessage(historyFilter)}</Text>
          ) : filteredHistory.length === 0 && historyFilter !== 'all' ? (
            <Text style={styles.noTx}>Looking past recent rewards for matches…</Text>
          ) : filteredHistory.length === 0 ? (
            <Text style={styles.noTx}>{filterEmptyMessage(historyFilter)}</Text>
          ) : (
            filteredHistory.slice(0, visibleCount).map((item, index) => (
              <View key={`${item.txid}-${item.height}-${index}`} style={styles.txCard}>
                <View style={styles.row}>
                  <Text style={styles.label}>TxID</Text>
                  <TouchableOpacity onPress={() => copy(item.txid, 'TxID')}>
                    <Text style={styles.value}>{abbreviate(item.txid)}</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>From</Text>
                  <TouchableOpacity
                    onPress={() => copy(item.fromAddress ?? '', 'From Address')}
                    onLongPress={() => {
                      const full = item.fromAddress ?? '';
                      if (full && !getContactByAddress(full)) {
                        handleSaveAsContact(full);
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.value,
                        getAddressDisplay(item.fromAddress, true).isContact && styles.contactValue,
                      ]}
                    >
                      {getAddressDisplay(item.fromAddress, true).display}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>To</Text>
                  <TouchableOpacity
                    onPress={() => copy(item.toAddress ?? '', 'To Address')}
                    onLongPress={() => {
                      const full = item.toAddress ?? '';
                      if (full && !getContactByAddress(full)) {
                        handleSaveAsContact(full);
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.value,
                        getAddressDisplay(item.toAddress).isContact && styles.contactValue,
                      ]}
                    >
                      {getAddressDisplay(item.toAddress).display}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Type</Text>
                  <Text style={styles.value}>
                    {(item.type || 'tx').replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>

                {item.description ? (
                  <View style={styles.row}>
                    <Text style={styles.label}>Details</Text>
                    <Text style={[styles.value, styles.descriptionValue]}>{item.description}</Text>
                  </View>
                ) : null}

                <View style={styles.row}>
                  <Text style={styles.label}>Direction</Text>
                  <Text
                    style={[
                      styles.value,
                      {
                        color: item.isIncoming
                          ? defiColors.buy
                          : item.fromAddress === address
                            ? defiColors.sell
                            : defiColors.textSecondary,
                      },
                    ]}
                  >
                    {item.isReward
                      ? 'Reward'
                      : item.isIncoming
                        ? 'Received'
                        : item.fromAddress === address
                          ? 'Sent'
                          : 'Activity'}
                  </Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Amount</Text>
                  <Text
                    style={[
                      styles.value,
                      {
                        color: item.isIncoming
                          ? defiColors.buy
                          : item.fromAddress === address
                            ? defiColors.sell
                            : theme.colors.textPrimary,
                      },
                    ]}
                  >
                    {item.amount} {item.asset || 'WART'}
                  </Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Height</Text>
                  <Text style={styles.value}>{item.height}</Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Confirmations</Text>
                  <Text style={styles.value}>{item.confirmations}</Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Date</Text>
                  <Text style={styles.value}>
                    {item.confirmations === 0
                      ? 'Pending'
                      : item.timestamp
                        ? new Date(item.timestamp * 1000).toLocaleString()
                        : 'N/A'}
                  </Text>
                </View>
              </View>
            ))
          )}

          {!showInitialLoader &&
          (filteredHistory.length > visibleCount ||
            (hasMore && !filterBusy && filteredHistory.length > 0)) ? (
            <TouchableOpacity
              onPress={() => void handleShowMore()}
              style={styles.showMoreBtn}
              disabled={hunting || loading}
            >
              <Text style={styles.showMoreText}>
                {hunting ? 'Loading…' : hasMore && filteredHistory.length <= visibleCount ? 'Load older…' : 'Show More'}
              </Text>
            </TouchableOpacity>
          ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: theme.spacing.md },
  smallTitle: {
    fontSize: theme.typography.caption,
    color: defiColors.blue,
    fontWeight: theme.typography.semiBold,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    fontSize: theme.typography.body,
    color: defiColors.gold,
    fontWeight: theme.typography.semiBold,
    marginBottom: theme.spacing.xs,
  },
  networkNote: { color: defiColors.textMuted, fontSize: 11, marginBottom: theme.spacing.sm },
  descriptionValue: { flex: 1, marginLeft: 12, textAlign: 'right' },
  rewardRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md, flexWrap: 'wrap' },
  buttonRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm, flexWrap: 'wrap', alignItems: 'center' },
  filterDropdown: { flex: 1, minWidth: 140 },
  filterMeta: {
    color: defiColors.textMuted,
    fontSize: 11,
    marginBottom: theme.spacing.sm,
  },
  rewardPill: {
    backgroundColor: defiColors.bgInset,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: defiColors.borderMuted,
  },
  rewardText: { color: defiColors.textSecondary, fontWeight: theme.typography.semiBold, fontSize: theme.typography.tiny },
  actionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: 'rgba(39, 39, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.5)',
  },
  actionBtnActive: {
    backgroundColor: defiColors.goldHover,
    borderColor: defiColors.goldHover,
  },
  actionBtnText: { color: defiColors.textSecondary, fontWeight: theme.typography.semiBold, fontSize: theme.typography.tiny },
  actionBtnTextActive: { color: '#ffffff' },
  refreshingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  refreshingText: { color: defiColors.textMuted, fontSize: theme.typography.tiny },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  txCard: {
    backgroundColor: defiColors.bgCardMuted,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: defiColors.borderMuted,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.sm },
  label: { color: defiColors.textMuted, fontSize: theme.typography.caption },
  value: {
    color: theme.colors.textPrimary,
    fontSize: theme.typography.caption,
    textAlign: 'right',
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily.mono,
  },
  contactValue: { color: defiColors.goldHover, fontWeight: theme.typography.semiBold },
  noTx: { color: defiColors.textMuted, textAlign: 'center', marginTop: theme.spacing.xl, fontSize: theme.typography.bodySm },
  showMoreBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: defiColors.goldHover,
    borderWidth: 1,
    borderColor: defiColors.goldHover,
    alignSelf: 'center',
    marginTop: theme.spacing.sm,
  },
  showMoreText: { color: '#ffffff', fontWeight: theme.typography.semiBold, fontSize: theme.typography.tiny },
});

export default TransactionHistory;