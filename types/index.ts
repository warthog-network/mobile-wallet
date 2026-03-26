// types/index.ts - TypeScript type definitions

export interface WalletData {
  mnemonic?: string;
  privateKey: string;
  publicKey: string;
  address: string;
  wordCount?: number;
  pathType?: 'hardened' | 'normal';
}

export interface SavedWallet {
  name: string;
  encryptedData: string; // The encrypted wallet data
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


// Address Book Types
export interface Contact {
  id: string;                    // UUID v4 for unique identification
  name: string;                  // User-friendly display name (1-50 chars)
  address: string;               // Warthog wallet address (42 chars, 0x prefixed)
  notes?: string;                // Optional notes (max 200 chars)
  createdAt: Date;               // ISO timestamp of creation
  lastUsed?: Date;               // ISO timestamp of last transaction use
  isFavorite?: boolean;          // Star/pin status for quick access
  usageCount: number;            // Incrementing counter for frequency sorting
  tags?: string[];               // Optional categorization tags
}

export interface ContactFormData {
  name: string;
  address: string;
  notes?: string;
  isFavorite?: boolean;
}

export interface AddressBookState {
  contacts: Contact[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  sortBy: "name" | "recent" | "frequency" | "favorites";
  filterTags: string[];
}
