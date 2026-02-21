import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import { TransactionItem } from './AddressBook/TransactionItem';
import { Transaction } from '../types';
import { colors, spacing, typography } from '../theme';

interface TransactionHistoryScreenProps {
  address: string;
  node: string;
}

export const TransactionHistoryScreen: React.FC<TransactionHistoryScreenProps> = ({
  address,
  node,
}) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${node}/account/${address}/history/4294967295`);
      const raw = res.data.data || res.data;
      let allTxs: Transaction[] = [];

      if (raw.perBlock) {
        raw.perBlock.forEach((block: any) => {
          const txs = [
            ...(block.transactions?.transfers || []),
            ...(block.transactions?.rewards || []),
          ];
          txs.forEach((tx: any) => {
            allTxs.push({
              txid: tx.txHash || tx.txid,
              txHash: tx.txHash || tx.txid,
              fromAddress: tx.fromAddress,
              toAddress: tx.toAddress,
              amount: tx.amount || 0,
              height: block.height,
              confirmations: block.confirmations,
              timestamp: tx.timestamp,
              feeE8: tx.feeE8,
            });
          });
        });
      }

      // Robust timestamp lookup if missing
      await Promise.all(
        allTxs.map(async (tx: Transaction) => {
          if (tx.timestamp) return;

          try {
            const txRes = await axios.get(`${node}/transaction/lookup/${tx.txid}`);
            const txData = txRes.data.data?.transaction || txRes.data.data || txRes.data;
            if (txData.timestamp) {
              tx.timestamp = txData.timestamp;
              return;
            }
            if (txData.utc) tx.timestamp = new Date(txData.utc).getTime() / 1000;
          } catch {}

          if (tx.height) {
            try {
              const blockRes = await axios.get(`${node}/chain/block/${tx.height}`);
              const blockData = blockRes.data.data || blockRes.data;
              const ts =
                blockData.timestamp ||
                blockData.header?.timestamp ||
                (blockData.utc ? new Date(blockData.utc).getTime() / 1000 : null);
              if (ts) tx.timestamp = ts;
            } catch {}
          }
        })
      );

      // Newest first
      allTxs.sort((a, b) => (b.height || 0) - (a.height || 0));

      setTransactions(allTxs);
    } catch (err: any) {
      console.error('Failed to fetch transactions:', err);
      // For demo, set fake data
      setTransactions([
        {
          txid: '1',
          txHash: '1',
          fromAddress: '0x1234567890abcdef1234567890abcdef12345678',
          toAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
          amount: '0.5',
          height: 1000,
          confirmations: 10,
          timestamp: Date.now() / 1000,
        },
        {
          txid: '2',
          txHash: '2',
          fromAddress: '0x1111111111111111111111111111111111111111',
          toAddress: '0x2222222222222222222222222222222222222222',
          amount: '1.2',
          height: 999,
          confirmations: 11,
          timestamp: Date.now() / 1000 - 100000,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [address, node]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTransactions();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: Transaction }) => (
    <TransactionItem tx={item} />
  );

  if (loading && transactions.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading transaction history...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}> History</Text>

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.txid}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: typography.h2,
    fontWeight: typography.bold,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
});
