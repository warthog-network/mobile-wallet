// types/index.ts - TypeScript type definitions

export interface WalletData {
  mnemonic?: string;
  privateKey: string;
  publicKey: string;
  address: string;
  wordCount?: number;
  pathType?: 'hardened' | 'normal';
}

export type WalletAction = 'create' | 'derive' | 'import' | 'login';

export interface Transaction {
  txid: string;
  txHash?: string;
  fromAddress?: string;
  toAddress?: string;
  amount: string | number;
  height: number;
  confirmations: number;
  timestamp?: number;
  feeE8?: number;
}

export interface BlockData {
  height: number;
  pinHeight: number;
  pinHash: string;
  timestamp?: number;
  utc?: string;
}

export interface AccountBalance {
  balance: number;
  nonceId: number;
}

export interface TransactionPostData {
  pinHeight: number;
  nonceId: number;
  toAddr: string;
  amountE8: number;
  feeE8: number;
  signature65: string;
}

export interface BlockRewardStats {
  '24h': number;
  week: number;
  month: number;
  rewards24h: string[];
  rewardsWeek: string[];
  rewardsMonth: string[];
}

export interface HistoryResponse {
  data?: {
    perBlock?: Array<{
      height: number;
      confirmations: number;
      transactions?: {
        transfers?: Transaction[];
        rewards?: Transaction[];
      };
    }>;
  };
  perBlock?: Array<{
    height: number;
    confirmations: number;
    transactions?: {
      transfers?: Transaction[];
      rewards?: Transaction[];
    };
  }>;
}
