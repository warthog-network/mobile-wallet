// utils/api.ts - API utilities for blockchain interactions

import axios from 'axios';
import { API_ENDPOINTS } from '../constants';
import { AccountBalance, BlockData, Transaction, TransactionPostData } from '../types';

// Fetch chain head (current block height)
export const fetchChainHead = async (node: string): Promise<BlockData> => {
  const res = await axios.get(API_ENDPOINTS.chainHead(node));
  const data = res.data.data || res.data;
  return {
    height: Number(data.height || 0),
    pinHeight: Number(data.pinHeight || 0),
    pinHash: data.pinHash || '',
    timestamp: data.timestamp,
    utc: data.utc,
  };
};

// Fetch account balance
export const fetchAccountBalance = async (
  node: string,
  address: string
): Promise<AccountBalance> => {
  const res = await axios.get(API_ENDPOINTS.accountBalance(node, address));
  const data = res.data.data || res.data;
  return {
    balance: Number(data.balance || 0),
    nonceId: Number(data.nonceId || 0),
  };
};

// Fetch USD price from CoinGecko
export const fetchUsdPrice = async (): Promise<number> => {
  try {
    const res = await fetch(API_ENDPOINTS.coingeckoPrice);
    const data = await res.json();
    return data.warthog?.usd || 0;
  } catch {
    return 0;
  }
};

// Fetch fee encoding
export const fetchFeeE8 = async (node: string, feeWart: string): Promise<number> => {
  try {
    const res = await axios.get(API_ENDPOINTS.encode16bit(node, feeWart));
    return res.data.data?.roundedE8 || 1000000;
  } catch {
    return 1000000; // Default 0.01 WART
  }
};

// Submit transaction
export const submitTransaction = async (
  node: string,
  txData: TransactionPostData
): Promise<{ txHash: string }> => {
  const res = await axios.post(API_ENDPOINTS.transactionAdd(node), txData);
  
  if (res.data?.error) {
    throw new Error(res.data.error);
  }
  
  return {
    txHash: res.data?.data?.txHash || 'pending',
  };
};

// Fetch transaction by hash
export const fetchTransaction = async (
  node: string,
  txid: string
): Promise<Transaction | null> => {
  try {
    const res = await axios.get(API_ENDPOINTS.transactionLookup(node, txid));
    const data = res.data.data?.transaction || res.data.data || res.data;
    return data;
  } catch {
    return null;
  }
};

// Fetch block by height
export const fetchBlock = async (
  node: string,
  height: number
): Promise<BlockData | null> => {
  try {
    const res = await axios.get(API_ENDPOINTS.chainBlock(node, height));
    const data = res.data.data || res.data;
    return {
      height: Number(data.height || height),
      pinHeight: Number(data.pinHeight || height),
      pinHash: data.pinHash || '',
      timestamp: data.timestamp || data.header?.timestamp,
      utc: data.utc,
    };
  } catch {
    return null;
  }
};
