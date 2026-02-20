import { useState } from 'react';
import { Alert } from 'react-native';
import { isValidAddress, signTransaction, wartToE8 } from '../utils/crypto';
import { fetchFeeE8, submitTransaction } from '../utils/api';
import { DEFAULT_FEE } from '../constants';

interface SentTransaction {
  txHash: string;
  timestamp: Date;
  toAddr: string;
  amount: string;
  fee: string;
}

export const useSendTransaction = (
  wallet: any,
  selectedNode: string,
  nextNonce: number,
  onTransactionSent?: (nonce: number) => Promise<void>
) => {
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState(DEFAULT_FEE.toString());
  const [manualNonce, setManualNonce] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTxLog, setSentTxLog] = useState<SentTransaction[]>([]);

  const validateAddress = (address: string): boolean => {
    return isValidAddress(address);
  };

  const handleSend = async () => {
    if (!wallet) {
      Alert.alert('Error', 'No wallet loaded');
      return;
    }

    // Validation
    if (!toAddr) {
      Alert.alert('Error', 'Recipient address is required');
      return;
    }

    if (!validateAddress(toAddr)) {
      Alert.alert('Error', 'Invalid recipient address');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Error', 'Amount must be greater than 0');
      return;
    }

    if (!fee || parseFloat(fee) < 0) {
      Alert.alert('Error', 'Fee must be 0 or greater');
      return;
    }

    setSending(true);

    try {
      // Convert amounts to E8 (satoshis)
      const amountE8 = wartToE8(amount);
      const feeE8 = await fetchFeeE8(selectedNode, fee);
      
      // Use manual nonce if provided, otherwise use calculated next nonce
      const nonceToUse = manualNonce ? parseInt(manualNonce, 10) : nextNonce;

      // Create and sign transaction
      const signature = signTransaction(
        wallet.privateKey,
        toAddr,
        amountE8,
        feeE8,
        nonceToUse
      );

      // Submit transaction
      const txHash = await submitTransaction(
        selectedNode,
        wallet.address,
        toAddr,
        amountE8,
        feeE8,
        nonceToUse,
        signature
      );

      // Log successful transaction
      const sentTx: SentTransaction = {
        txHash,
        timestamp: new Date(),
        toAddr,
        amount,
        fee
      };
      
      setSentTxLog(prev => [sentTx, ...prev]);

      // Update nonce tracking
      if (onTransactionSent) {
        await onTransactionSent(nonceToUse + 1);
      }

      // Reset form
      setToAddr('');
      setAmount('');
      setFee(DEFAULT_FEE.toString());
      setManualNonce('');

      Alert.alert(
        'Transaction Sent',
        `Transaction hash: ${txHash.slice(0, 16)}...`,
        [
          {
            text: 'OK',
            onPress: () => console.log('Transaction confirmed')
          }
        ]
      );

    } catch (error: any) {
      console.error('Send transaction error:', error);
      Alert.alert(
        'Transaction Failed',
        error.message || 'Failed to send transaction'
      );
    } finally {
      setSending(false);
    }
  };

  const clearSentTxLog = () => {
    setSentTxLog([]);
  };

  return {
    // State
    toAddr,
    amount,
    fee,
    manualNonce,
    sending,
    sentTxLog,
    
    // Setters
    setToAddr,
    setAmount,
    setFee,
    setManualNonce,
    
    // Actions
    handleSend,
    validateAddress,
    clearSentTxLog
  };
};
