// TransactionHistory.tsx — FULLY UPDATED (Feb 2026)
// FIXED: Correct /transaction/lookup endpoint + block fallback
// Dates now always show for confirmed transactions
// Newest transactions first + robust timestamp handling
// ENHANCED: Contact names instead of raw addresses
// FIXED: Syntax error (extra brace) + missing getContactByAddress

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import * as Clipboard from 'expo-clipboard';
import { useAddressBook } from './components/AddressBook/AddressBookModal';
import { Contact } from './types';

interface Props {
  address: string;
  node: string;
  onRefresh: () => void;
  onAddContact?: (address: string) => void;
}

const TransactionHistory: React.FC<Props> = ({
  address,
  node,
  onRefresh,
  onAddContact,
}) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(7);
  const [showTransactions, setShowTransactions] = useState(false);

  // Address Book Integration
  const { contacts, addContact, getContactByAddress } = useAddressBook();

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

  // Helper function to get contact name or formatted address
  const getAddressDisplay = (
    addr: string | undefined,
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

  // Handle saving unknown address as contact
  const handleSaveAsContact = async (address: string) => {
    if (onAddContact) {
      onAddContact(address); // Let parent open the nice modal
      return;
    }

    // Fallback alert
    Alert.alert(
      'Save Contact',
      `Would you like to save "${address.slice(0, 10)}..." as a contact?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            try {
              const defaultName = `Contact ${Date.now()
                .toString()
                .slice(-4)}`;
              await addContact({
                name: defaultName,
                address,
                notes: 'Added from transaction history',
                isFavorite: false,
              });
              Alert.alert('Success', `Contact "${defaultName}" saved!`);
            } catch (error) {
              Alert.alert(
                'Error',
                'Failed to save contact. It may already exist.'
              );
            }
          },
        },
      ]
    );
  };

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${node}/account/${address}/history/4294967295`);
      const raw = res.data.data || res.data;
      let allTxs: any[] = [];

      if (raw.perBlock) {
        raw.perBlock.forEach((block: any) => {
          const txs = [
            ...(block.transactions?.transfers || []),
            ...(block.transactions?.rewards || []),
          ];
          txs.forEach((tx) => {
            allTxs.push({
              ...tx,
              height: block.height,
              confirmations: block.confirmations,
              txid: tx.txHash,
            });
          });
        });
      }

      // Robust timestamp lookup
      await Promise.all(
        allTxs.map(async (tx: any) => {
          if (tx.timestamp) return;

          // Primary: transaction lookup
          try {
            const txRes = await axios.get(`${node}/transaction/lookup/${tx.txid}`);
            const txData = txRes.data.data?.transaction || txRes.data.data || txRes.data;
            if (txData.timestamp) {
              tx.timestamp = txData.timestamp;
              return;
            }
            if (txData.utc) tx.timestamp = new Date(txData.utc).getTime() / 1000;
          } catch {}

          // Fallback: block timestamp
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

      setHistory(allTxs);
      setVisibleCount(7);

      // Reward stats
      const now = Date.now() / 1000;
      const rewards = allTxs.filter((tx: any) => !tx.fromAddress);

      setBlockCounts({
        '24h': rewards.filter((tx: any) => (tx.timestamp || 0) >= now - 86400).length,
        week: rewards.filter((tx: any) => (tx.timestamp || 0) >= now - 604800).length,
        month: rewards.filter((tx: any) => (tx.timestamp || 0) >= now - 2592000).length,
        rewards24h: rewards
          .filter((tx: any) => (tx.timestamp || 0) >= now - 86400)
          .map((tx: any) => tx.txid),
        rewardsWeek: rewards
          .filter((tx: any) => (tx.timestamp || 0) >= now - 604800)
          .map((tx: any) => tx.txid),
        rewardsMonth: rewards
          .filter((tx: any) => (tx.timestamp || 0) >= now - 2592000)
          .map((tx: any) => tx.txid),
      });
    } catch (err: any) {
      Alert.alert('History Error', err.message || 'Node returned error – try backup node');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [address, node]);

  useEffect(() => {
    if (address) fetchHistory();
  }, [address, node, fetchHistory]);

  const copy = (text: string, label: string) => {
    Clipboard.setStringAsync(text);
    Alert.alert('Copied!', `${label} copied`);
  };

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

      <View style={styles.buttonRow}>
        <TouchableOpacity onPress={fetchHistory} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowTransactions(!showTransactions)}
          style={styles.toggleBtn}
        >
          <Text style={styles.toggleText}>
            {showTransactions ? 'Hide Transactions' : 'Show Transactions'}
          </Text>
        </TouchableOpacity>
      </View>

      {showTransactions && (
        <>
          {loading ? (
            <ActivityIndicator size="large" color="#FFC107" style={{ margin: 30 }} />
          ) : history.length === 0 ? (
            <Text style={styles.noTx}>No transactions yet</Text>
          ) : (
            history.slice(0, visibleCount).map((item, index) => (
              <View key={index} style={styles.txCard}>
                <View style={styles.row}>
                  <Text style={styles.label}>TxID</Text>
                  <TouchableOpacity onPress={() => copy(item.txid, 'TxID')}>
                    <Text style={styles.value}>{abbreviate(item.txid)}</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>From</Text>
                  <TouchableOpacity
                    onPress={() => copy(item.fromAddress || '', 'From Address')}
                    onLongPress={() => {
                      const full = item.fromAddress || '';
                      if (full && !getContactByAddress(full)) {
                        handleSaveAsContact(full);
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.value,
                        getAddressDisplay(item.fromAddress, true).isContact &&
                          styles.contactValue,
                      ]}
                    >
                      {getAddressDisplay(item.fromAddress, true).display}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>To</Text>
                  <TouchableOpacity
                    onPress={() => copy(item.toAddress || '', 'To Address')}
                    onLongPress={() => {
                      const full = item.toAddress || '';
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
                  <Text style={[styles.value, {color: item.fromAddress === address ? '#FF0000' : '#00FF00'}]}>
                    {item.fromAddress === address ? 'Sent' : 'Received'}
                  </Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Amount</Text>
                  <Text style={[styles.value, {color: item.fromAddress === address ? '#FF0000' : '#00FF00'}]}>
                    {parseFloat(item.amount || 0).toFixed(8)} WART
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

          {history.length > visibleCount && (
            <TouchableOpacity
              onPress={() => setVisibleCount(visibleCount + 7)}
              style={styles.showMoreBtn}
            >
              <Text style={styles.showMoreText}>Show More</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: 30 },
  smallTitle: { fontSize: 18, color: '#FFC107', fontWeight: '600', marginBottom: 10 },
  title: { fontSize: 22, color: '#FFC107', fontWeight: '700' },
  rewardRow: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  buttonRow: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  rewardPill: {
    backgroundColor: '#1C2526',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFC107',
  },
  rewardText: { color: '#FFECB3', fontWeight: '600' },
  refreshBtn: { backgroundColor: '#474747', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  refreshText: { color: '#FFECB3', fontWeight: '600' },
  toggleBtn: { backgroundColor: '#474747', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  toggleText: { color: '#FFECB3', fontWeight: '600' },
  txCard: {
    backgroundColor: '#1C2526',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#FFC107',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: '#FFECB3', fontSize: 14 },
  value: { color: '#FFFFFF', fontSize: 14, textAlign: 'right', flexShrink: 1 },
  contactValue: { color: '#FFC107', fontWeight: '600' },
  noTx: { color: '#FFECB3', textAlign: 'center', marginTop: 30, fontSize: 16 },
  showMoreBtn: {
    backgroundColor: '#FFC107',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'center',
    marginTop: 10,
  },
  showMoreText: { color: '#1C2526', fontWeight: '600' },
});

export default TransactionHistory;
