import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { Input } from './Input';
import { theme } from '../theme';
import { e8ToWart } from '../utils/crypto';

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
  const availableBalance = e8ToWart(balance.balance);
  const isValidToAddr = toAddr ? validateAddress(toAddr) : true;
  const hasAmount = amount && parseFloat(amount) > 0;
  const hasSufficientBalance = hasAmount && parseFloat(amount) <= parseFloat(availableBalance);

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
          <Input
            label="Recipient Address"
            value={toAddr}
            onChangeText={setToAddr}
            placeholder="Enter 48-character address"
            autoCapitalize="none"
            error={toAddr && !isValidToAddr ? 'Invalid address format' : undefined}
          />

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
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.medium,
  },
  sendCard: {
    padding: theme.spacing.large,
    marginBottom: theme.spacing.medium,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.primary,
    textAlign: 'center',
    marginBottom: theme.spacing.medium,
  },
  balanceInfo: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.medium,
    borderRadius: theme.borderRadius.medium,
    marginBottom: theme.spacing.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  balanceText: {
    color: theme.colors.text,
    fontSize: 16,
    textAlign: 'center',
  },
  form: {
    gap: theme.spacing.medium,
  },
  summary: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.medium,
    borderRadius: theme.borderRadius.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.small,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryTotal: {
    paddingTop: theme.spacing.small,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  summaryLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  summaryValue: {
    color: theme.colors.text,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  sendButton: {
    marginTop: theme.spacing.small,
  },
  logCard: {
    padding: theme.spacing.medium,
    maxHeight: 300,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.medium,
  },
  logTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '500',
  },
  logScroll: {
    maxHeight: 200,
  },
  logItem: {
    padding: theme.spacing.small,
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
