// utils/crypto.ts - Crypto utilities extracted from Wallet.tsx

import { Buffer } from 'buffer';
import * as ExpoCrypto from 'expo-crypto';
import CryptoJS from 'crypto-js';
import { ethers } from 'ethers';
import { Account } from "warthog-ts"

import { WalletData } from '../types';
import { DERIVATION_PATHS, SATOSHI_MULTIPLIER } from '../constants';

// Initialize global crypto polyfills
export const initCrypto = () => {
  global.Buffer = Buffer;

  // Set CryptoJS random generator first
  CryptoJS.lib.WordArray.random = (nBytes: number) => {
    const bytes = ExpoCrypto.getRandomBytes(nBytes);
    return CryptoJS.lib.WordArray.create(bytes);
  };

  // Only set global.crypto if not already set
  if (typeof global.crypto === 'undefined') {
    (global as any).crypto = {};
    (global as any).crypto.getRandomValues = ExpoCrypto.getRandomValues;
  }
};

// Convert WART to E8 (satoshis)
export const wartToE8 = (wart: string): number | null => {
  try {
    const num = parseFloat(wart);
    if (isNaN(num) || num <= 0) return null;
    return Math.round(num * SATOSHI_MULTIPLIER);
  } catch {
    return null;
  }
};

// Convert E8 to WART
export const e8ToWart = (e8: number): string => {
  return (e8 / SATOSHI_MULTIPLIER).toFixed(8);
};

// Generate new wallet with mnemonic
export const generateWallet = async (
  wordCount: number,
  pathType: 'hardened' | 'normal'
): Promise<WalletData> => {
  const strength = wordCount === 12 ? 16 : 32;
  
  try {
    const { getRandomBytesAsync } = ExpoCrypto;
    const entropy = await getRandomBytesAsync(strength);
    const mnemonicObj = ethers.Mnemonic.fromEntropy(ethers.hexlify(entropy));
    const path = DERIVATION_PATHS[pathType];
    const hd = ethers.HDNodeWallet.fromPhrase(mnemonicObj.phrase, '', path);
    
    const account = Account.fromPrivateKeyHex(hd.privateKey.slice(2));
    
    return {
      mnemonic: mnemonicObj.phrase,
      privateKey: account.getPrivateKeyHex(),
      publicKey: account.getPublicKeyHex(),
      address: account.getAddress(),
      wordCount,
      pathType,
    };
  } catch (e: any) {
    throw new Error('Failed to generate secure random entropy: ' + e.message);
  }
};

// Derive wallet from mnemonic
export const deriveWallet = (
  mnemonic: string,
  wordCount: number,
  pathType: 'hardened' | 'normal'
): WalletData => {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== wordCount) {
    throw new Error(`Must have exactly ${wordCount} words`);
  }
  
  const path = DERIVATION_PATHS[pathType];
  const hd = ethers.HDNodeWallet.fromPhrase(mnemonic, '', path);
  
  const account = Account.fromPrivateKeyHex(hd.privateKey.slice(2));
  
  return {
    mnemonic,
    privateKey: account.getPrivateKeyHex(),
    publicKey: account.getPublicKeyHex(),
    address: account.getAddress(),
    wordCount,
    pathType,
  };
};

// Import wallet from private key
export const importWallet = (privateKey: string): WalletData => {
  if (privateKey.length !== 64) {
    throw new Error('Private key must be exactly 64 hex characters');
  }
  
  const account = Account.fromPrivateKeyHex(privateKey);
  
  return {
    privateKey: account.getPrivateKeyHex(),
    publicKey: account.getPublicKeyHex(),
    address: account.getAddress(),
  };
};

// Encrypt wallet data
export const encryptWallet = (walletData: WalletData, password: string): string => {
  return CryptoJS.AES.encrypt(JSON.stringify(walletData), password).toString();
};

// Decrypt wallet data
export const decryptWallet = (encrypted: string, password: string): WalletData => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, password);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return JSON.parse(decrypted);
  } catch {
    throw new Error('Wrong password or invalid encrypted data');
  }
};

// Sign transaction
export const signTransaction = (
  txHash: string,
  privateKey: string
): { r: string; s: string; v: number; signature65: string } => {
  const txHashBytes = ethers.getBytes(txHash);
  const signer = new ethers.Wallet(`0x${privateKey}`);
  const sig = signer.signingKey.sign(txHashBytes);
  
  const rHex = sig.r.slice(2);
  const sHex = sig.s.slice(2);
  const recid = sig.v - 27;
  const recidHex = recid.toString(16).padStart(2, '0');
  const signature65 = rHex + sHex + recidHex;
  
  return {
    r: rHex,
    s: sHex,
    v: recid,
    signature65,
  };
};

// Validate Warthog address
export const isValidAddress = (address: string): boolean => {
  return Account.validateAddress(address);
};

// Abbreviate address/hash
export const abbreviate = (str: string, prefixLen = 6, suffixLen = 4): string => {
  if (!str || str.length <= prefixLen + suffixLen) return str || 'N/A';
  return `${str.slice(0, prefixLen)}...${str.slice(-suffixLen)}`;
};
