import { useState } from 'react';
import { toast } from '../utils/toast';
import {
  Address,
  Wart,
  NonceId,
  RoundedFee,
} from 'warthog-ts';
import { isValidAddress } from '../utils/crypto';
import {
  createTxContext,
  fetchFeeE8,
  submitWarthogTransaction,
} from '../utils/api';
import { DEFAULT_FEE } from '../constants';
import { signPreparedWarthog } from '../utils/sessionVault';

interface SentTransaction {
  txHash: string;
  timestamp: Date;
  toAddr: string;
  amount: string;
  fee: string;
}

function parseRecipientAddress(raw: string): Address | null {
  const trimmed = raw.trim().replace(/^0x/i, '');
  return Address.fromHex(trimmed) ?? Address.fromRaw(trimmed);
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
      toast.error('Error', 'No wallet loaded');
      return;
    }
    if (!toAddr || !validateAddress(toAddr)) {
      toast.error('Error', !toAddr ? 'Recipient address is required' : 'Invalid recipient address');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Error', 'Amount must be greater than 0');
      return;
    }
    if (!fee || parseFloat(fee) < 0) {
      toast.error('Error', 'Fee must be 0 or greater');
      return;
    }

    setSending(true);

    try {
      const recipient = parseRecipientAddress(toAddr);
      if (!recipient) {
        throw new Error('Invalid recipient address');
      }

      const wartAmount = Wart.parse(amount.trim());
      if (!wartAmount) {
        throw new Error('Invalid amount');
      }

      const feeE8 = await fetchFeeE8(selectedNode, fee);
      // feeE8 already node-rounded; do not ceil-re-round
      const roundedFee = RoundedFee.fromE8(BigInt(feeE8), false);
      if (!roundedFee) {
        throw new Error('Invalid fee');
      }

      const nonceToUse = manualNonce ? parseInt(manualNonce, 10) : nextNonce;
      const nonce = NonceId.fromNumber(nonceToUse);
      if (!nonce) {
        throw new Error('Invalid nonce');
      }

      const ctx = await createTxContext(selectedNode, roundedFee, nonce);
      const tx = await signPreparedWarthog(ctx, {
        op: 'wartTransfer',
        toAddr: recipient.hex,
        amountE8: wartAmount.E8.toString(),
      }, wallet.address);
      const result = await submitWarthogTransaction(selectedNode, tx);
      const txHashStr = result.txHash;

      const sentTx: SentTransaction = {
        txHash: txHashStr,
        timestamp: new Date(),
        toAddr,
        amount,
        fee,
      };
      setSentTxLog(prev => [sentTx, ...prev]);

      if (onTransactionSent) {
        await onTransactionSent(nonceToUse + 1);
      }

      setToAddr('');
      setAmount('');
      setFee(DEFAULT_FEE.toString());
      setManualNonce('');

      toast.success('Sent', `Tx ${txHashStr.slice(0, 16)}…`);
    } catch (error: any) {
      console.error('Send transaction error:', error);
      toast.error('Send failed', error.message || 'Failed to send transaction');
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