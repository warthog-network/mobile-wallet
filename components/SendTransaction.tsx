import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { Input } from './Input';
import { AddressBookModal } from './AddressBook/AddressBookModal';
import { theme } from '../theme';
import { e8ToWart } from '../utils/crypto';
import { Contact } from '../types';

interface SentTransaction {
  txHash: string;
  timestamp: Date;
  toAddr: string;
  amount: string;
  fee: string;
}

interface SendTransactionProps {
  toAddr: string;
  setToAddr: (addr: string) => void;
  amount: string;
  setAmount: (amount: string) => void;
  fee: string;
  setFee: (fee: string) => void;
  manualNonce: string;
  setManualNonce: (nonce: string) => void;
  nextNonce: number;
  balance: {
    balance: string;
    nonce: number;
  };
  sending: boolean;
  sentTxLog: SentTransaction[];
  onSend: () => void;
  validateAddress: (address: string) => boolean;
  onClearTxLog: () => void;
}

export const SendTransaction: React.FC<SendTransactionProps> = ({
  toAddr,
  setToAddr,
  amount,
  setAmount,
  fee,
  setFee,
  manualNonce,
  setManualNonce,
  nextNonce,
  balance,
  sending,
  sentTxLog,
  onSend,
  validateAddress,
  onClearTxLog
}) => {
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const availableBalance = e8ToWart(parseInt(balance.balance) || 0);
  const isValidToAddr = toAddr ? validateAddress(toAddr) : true;
  const hasAmount = amount && parseFloat(amount) > 0;
  const hasSufficientBalance = hasAmount && parseFloat(amount) <= parseFloat(availableBalance);

  const handleContactSelect = (contact: Contact) => {
    setToAddr(contact.address);
    setSelectedContact(contact);
    setShowAddressBook(false);
  };

  const handleSaveAsContact = () => {
    if (toAddr && validateAddress(toAddr)) {
      // This would open the address book in "add" mode with pre-filled address
      setShowAddressBook(true);
    }
  };

  const renderSentTxLog = () => {
    if (sentTxLog.length === 0) return null;

    return (
      <Card variant="solid" style={styles.logCard}>
        <View style={styles.logHeader}>
          <Text style={styles.logTitle}>Recent Transactions</Text>
          <Button
            title="Clear"
            variant="ghost"
            size="small"
            onPress={onClearTxLog}
          />
        </View>
        
        <ScrollView style={styles.logScroll} showsVerticalScrollIndicator={false}>
          {sentTxLog.map((tx, index) => (
            <View key={index} style={styles.logItem}>
              <Text style={styles.logTxHash}>
                {tx.txHash.slice(0, 16)}...
              </Text>
              <Text style={styles.logDetails}>
                To: {tx.toAddr.slice(0, 8)}...{tx.toAddr.slice(-8)}
              </Text>
              <Text style={styles.logDetails}>
                Amount: {tx.amount} WART • Fee: {tx.fee} WART
              </Text>
              <Text style={styles.logTimestamp}>
                {tx.timestamp.toLocaleTimeString()}
              </Text>
            </View>
          ))}
        </ScrollView>
      </Card>
    );
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Card variant="glass" style={styles.sendCard}>
        <Text style={styles.title}>Send WART</Text>
        
        <View style={styles.balanceInfo}>
          <Text style={styles.balanceText}>
            Available: {parseFloat(availableBalance).toLocaleString()} WART
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.addressContainer}>
            <View style={styles.addressInput}>
              <Input
                label="Recipient Address"
                value={toAddr}
                onChangeText={(value) => {
                  setToAddr(value);
                  if (selectedContact && value !== selectedContact.address) {
                    setSelectedContact(null); // Clear selected contact if address changed manually
                  }
                }}
                placeholder="Enter 48-character address"
                autoCapitalize="none"
                error={toAddr && !isValidToAddr ? 'Invalid address format' : undefined}
              />
            </View>

            <View style={styles.addressButtons}>
              <Button
                title="Contacts"
                variant="outline"
                size="medium"
                onPress={() => setShowAddressBook(true)}
                style={styles.addressButton}
              />
              {toAddr && isValidToAddr && !selectedContact && (
                <Button
                  title="Save"
                  variant="ghost"
                  size="small"
                  onPress={handleSaveAsContact}
                  style={styles.addressButton}
                />
              )}
            </View>
          </View>

          {selectedContact && (
            <View style={styles.selectedContact}>
              <Text style={styles.selectedContactText}>
                Selected: {selectedContact.name}
              </Text>
            </View>
          )}

          <Input
            label="Amount (WART)"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.0"
            keyboardType="numeric"
            error={
              hasAmount && !hasSufficientBalance 
                ? 'Insufficient balance' 
                : undefined
            }
          />

          <Input
            label="Fee (WART)"
            value={fee}
            onChangeText={setFee}
            placeholder="0.001"
            keyboardType="numeric"
          />

          <Input
            label={`Manual Nonce (optional, auto: ${nextNonce})`}
            value={manualNonce}
            onChangeText={setManualNonce}
            placeholder={nextNonce.toString()}
            keyboardType="numeric"
          />

          {hasAmount && (
            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Amount:</Text>
                <Text style={styles.summaryValue}>{amount} WART</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Fee:</Text>
                <Text style={styles.summaryValue}>{fee} WART</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryTotal]}>
                <Text style={styles.summaryLabel}>Total:</Text>
                <Text style={styles.summaryValue}>
                  {(parseFloat(amount) + parseFloat(fee || '0')).toFixed(8)} WART
                </Text>
              </View>
            </View>
          )}

          <Button
            title={sending ? 'Sending...' : 'Send Transaction'}
            onPress={onSend}
            loading={sending}
            disabled={!toAddr || !isValidToAddr || !hasAmount || !hasSufficientBalance}
            fullWidth
            style={styles.sendButton}
          />
        </View>
      </Card>

      {renderSentTxLog()}

      <AddressBookModal
        visible={showAddressBook}
        mode="select"
        onClose={() => setShowAddressBook(false)}
        onSelectContact={handleContactSelect}
        preselectedAddress={toAddr}
        title="Select Recipient"
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.md,
  },
  sendCard: {
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.primary,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  balanceInfo: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  balanceText: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    textAlign: 'center',
  },
  form: {
    gap: theme.spacing.md,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
  },
  addressInput: {
    flex: 1,
  },
  addressButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'stretch',
  },
  addressButton: {
    minWidth: 50,
  },
  selectedContact: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing.xs,
  },
  selectedContactText: {
    color: theme.colors.surface,
    fontSize: theme.typography.caption,
    fontWeight: theme.typography.semiBold,
    textAlign: 'center',
  },
  summary: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryTotal: {
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  summaryLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  summaryValue: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  sendButton: {
    marginTop: theme.spacing.sm,
  },
  logCard: {
    padding: theme.spacing.md,
    maxHeight: 300,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  logTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '500',
  },
  logScroll: {
    maxHeight: 200,
  },
  logItem: {
    padding: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: 2,
  },
  logTxHash: {
    color: theme.colors.primary,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  logDetails: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  logTimestamp: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    textAlign: 'right',
  },
});
