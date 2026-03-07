import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WARTHOG_NODES, SECURE_STORE_KEYS } from '../constants';
import { AccountBalance } from '../types';
import { 
  fetchChainHead, 
  fetchAccountBalance, 
  fetchUsdPrice 
} from '../utils/api';
import { e8ToWart } from '../utils/crypto';

export const useBalance = (walletAddress?: string) => {
  const [balance, setBalance] = useState<AccountBalance>({
    balance: 0,
    nonceId: 0
  });
  const [usdBalance, setUsdBalance] = useState<number>(0);
  const [nextNonce, setNextNonce] = useState<number>(0);
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number>(0);
  const [selectedNode, setSelectedNode] = useState<string>(WARTHOG_NODES[0]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBalanceAndNonce = useCallback(async () => {
    if (!walletAddress) return;

    try {
      const [balanceData, chainHead, usdPrice] = await Promise.all([
        fetchAccountBalance(selectedNode, walletAddress),
        fetchChainHead(selectedNode),
        fetchUsdPrice()
      ]);

      setBalance(balanceData);
      setCurrentBlockHeight(chainHead.height);

      const persistentNonce = await getPersistentNonce(walletAddress);
      const calculatedNonce = Math.max(balanceData.nonceId + 1, persistentNonce);
      setNextNonce(calculatedNonce);

      if (usdPrice > 0) {
        const wartBalance = parseFloat(e8ToWart(balanceData.balance));
        setUsdBalance(wartBalance * usdPrice);
      }
    } catch (error) {
      console.error('Error fetching balance:', error);
    }
  }, [walletAddress, selectedNode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBalanceAndNonce();
    setRefreshing(false);
  }, [fetchBalanceAndNonce]);

  const getPersistentNonce = async (address: string): Promise<number> => {
    try {
      const key = SECURE_STORE_KEYS.nonce(address);
      const storedNonce = await AsyncStorage.getItem(key);
      return storedNonce ? parseInt(storedNonce, 10) : 0;
    } catch (error) {
      console.error('Error getting persistent nonce:', error);
      return 0;
    }
  };

  const savePersistentNonce = async (address: string, nonce: number) => {
    try {
      const key = SECURE_STORE_KEYS.nonce(address);
      await AsyncStorage.setItem(key, nonce.toString());
    } catch (error) {
      console.error('Error saving persistent nonce:', error);
    }
  };

  useEffect(() => {
    if (walletAddress) {
      fetchBalanceAndNonce();
    }
  }, [walletAddress, selectedNode, fetchBalanceAndNonce]);

  useEffect(() => {
    if (!walletAddress) return;
    const interval = setInterval(fetchBalanceAndNonce, 30000);
    return () => clearInterval(interval);
  }, [walletAddress, fetchBalanceAndNonce]);

  return {
    balance,
    usdBalance,
    nextNonce,
    currentBlockHeight,
    selectedNode,
    refreshing,
    setSelectedNode,
    setNextNonce,
    fetchBalanceAndNonce,
    onRefresh,
    getPersistentNonce,
    savePersistentNonce
  };
};