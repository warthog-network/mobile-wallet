import { useState } from 'react';
import { Alert } from 'react-native';
import { isValidAddress, signTransaction, wartToE8 } from '../utils/crypto';
import { fetchFeeE8, submitTransaction, fetchChainHead } from '../utils/api';
import { DEFAULT_FEE } from '../constants';
import { TransactionPostData } from '../types';
import { keccak256, toUtf8Bytes } from 'ethers';

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
    if (!toAddr || !validateAddress(toAddr)) {
      Alert.alert('Error', !toAddr ? 'Recipient address is required' : 'Invalid recipient address');
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
      const amountE8 = wartToE8(amount)!;
      const feeE8 = await fetchFeeE8(selectedNode, fee);
      const chainHead = await fetchChainHead(selectedNode);
      const pinHeight = chainHead.pinHeight;
      const nonceToUse = manualNonce ? parseInt(manualNonce, 10) : nextNonce;

      const txDataBase = { pinHeight, nonceId: nonceToUse, toAddr, amountE8, feeE8 };

      const txStr = `${pinHeight}${nonceToUse}${toAddr}${amountE8}${feeE8}`;
      const txHash = keccak256(toUtf8Bytes(txStr));
      const sigObj = signTransaction(txHash, wallet.privateKey);

      const txData: TransactionPostData = {
        ...txDataBase,
        signature65: sigObj.signature65,
      };

      const result = await submitTransaction(selectedNode, txData);
      const txHashStr = result.txHash;

      const sentTx: SentTransaction = {
        txHash: txHashStr,
        timestamp: new Date(),
        toAddr,
        amount,
        fee
      };
      setSentTxLog(prev => [sentTx, ...prev]);

      if (onTransactionSent) {
        await onTransactionSent(nonceToUse + 1);
      }

      setToAddr('');
      setAmount('');
      setFee(DEFAULT_FEE.toString());
      setManualNonce('');

      Alert.alert('Transaction Sent', `Transaction hash: ${txHashStr.slice(0, 16)}...`);
    } catch (error: any) {
      console.error('Send transaction error:', error);
      Alert.alert('Transaction Failed', error.message || 'Failed to send transaction');
    } finally {
      setSending(false);
    }
  };

  const clearSentTxLog = () => setSentTxLog([]);

  return {
    toAddr, amount, fee, manualNonce, sending, sentTxLog,
    setToAddr, setAmount, setFee, setManualNonce,
    handleSend, validateAddress, clearSentTxLog
  };
};