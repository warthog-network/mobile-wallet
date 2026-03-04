// Wallet.tsx — ULTIMATE FINAL PRODUCTION VERSION (black screen fixed)
// • Dual toggle buttons: Send WART (left) + Activity (right)
// • Both start collapsed on first load
// • Full login + modal sections restored (no placeholders)

// ────────────────────────────────────────────────────────────────
// Imports
// ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ethers } from 'ethers';
import axios from 'axios';
import TransactionHistory from './TransactionHistory';
import AddressBookModal from './components/AddressBook/AddressBookModal';
import { Contact } from './types';
import { storage } from './utils/storage';

// Extracted imports
import { WalletData } from './types';
import { WARTHOG_NODES, type NodeUrl, SECURE_STORE_KEYS, DERIVATION_PATHS, ADDRESS_LENGTH, PRIVATE_KEY_LENGTH, DEFAULT_FEE } from './constants';
import { initCrypto, generateWallet as generateWalletUtil, deriveWallet as deriveWalletUtil, importWallet as importWalletUtil, wartToE8, signTransaction, decryptWallet, encryptWallet, isValidAddress } from './utils/crypto';
import { fetchChainHead, fetchAccountBalance, fetchUsdPrice, fetchFeeE8, submitTransaction } from './utils/api';
import { theme } from './theme';

// Initialize crypto
initCrypto();



const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 17, paddingHorizontal: 7, paddingBottom: 7 },
  sectionTitle: { fontSize: theme.typography.h1, color: theme.colors.primary, fontWeight: theme.typography.bold, textAlign: 'center', marginBottom: theme.spacing.lg },
  loginSection: { marginTop: theme.spacing.lg },
  label: { color: theme.colors.textSecondary, fontSize: theme.typography.body, marginBottom: theme.spacing.sm },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  nodeColumn: { gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  nodeButton: { paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.md, backgroundColor: theme.colors.surfaceLight, borderRadius: theme.borderRadius.md, alignSelf: 'stretch' },
  nodeButtonText: { color: theme.colors.textPrimary, fontWeight: theme.typography.semiBold, textAlign: 'center', fontSize: theme.typography.caption },
  bottomRow: { flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.sm, marginBottom: theme.spacing.xxxl },
  bottomButton: { paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md, borderRadius: theme.borderRadius.md },
  bottomButtonText: { color: theme.colors.textPrimary, fontWeight: theme.typography.semiBold, textAlign: 'center', fontSize: theme.typography.tiny },
  actionButton: { paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg, backgroundColor: theme.colors.surfaceLight, borderRadius: theme.borderRadius.md, minWidth: 70 },
  actionButtonText: { color: theme.colors.textPrimary, fontWeight: theme.typography.semiBold, textAlign: 'center', fontSize: theme.typography.caption },
  activeButton: { backgroundColor: theme.colors.primary },

  toggleRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm, flexWrap: 'wrap' },

  sendToggleButton: {
    flex: 1,
    minWidth: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  sendToggleText: { color: theme.colors.textSecondary, fontSize: theme.typography.caption, fontWeight: theme.typography.semiBold },
  sendToggleArrow: { color: theme.colors.primary, fontSize: theme.typography.caption, fontWeight: theme.typography.bold },

  activityToggleButton: {
    flex: 1,
    minWidth: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  activityToggleText: { color: theme.colors.textSecondary, fontSize: theme.typography.caption, fontWeight: theme.typography.semiBold },
  activityToggleArrow: { color: theme.colors.primary, fontSize: theme.typography.caption, fontWeight: theme.typography.bold },

  contactsToggleButton: {
    flex: 1,
    minWidth: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  contactsToggleText: { color: theme.colors.textSecondary, fontSize: theme.typography.caption, fontWeight: theme.typography.semiBold },
  contactsToggleArrow: { color: theme.colors.primary, fontSize: theme.typography.caption, fontWeight: theme.typography.bold },

  balanceBox: { backgroundColor: theme.colors.surfaceLight, padding: theme.spacing.lg, borderRadius: theme.borderRadius.lg, borderWidth: 3, borderColor: theme.colors.primary, marginBottom: theme.spacing.lg },
  balanceLabel: { color: theme.colors.textSecondary, fontSize: theme.typography.body },
  balance: { fontSize: theme.typography.h1, color: theme.colors.textPrimary, fontWeight: theme.typography.bold },
  usd: { color: theme.colors.textSecondary, fontSize: theme.typography.body, marginTop: theme.spacing.sm },
  address: { color: theme.colors.textSecondary, fontSize: theme.typography.caption, marginTop: theme.spacing.md, textAlign: 'center' },
  refreshButton: { backgroundColor: theme.colors.primary, padding: theme.spacing.lg, borderRadius: theme.borderRadius.md, alignItems: 'center', marginBottom: theme.spacing.lg },
  refreshText: { color: theme.colors.surface, fontWeight: theme.typography.bold, fontSize: theme.typography.body },
  sendSection: { marginTop: theme.spacing.sm },
  nonceDisplay: { color: theme.colors.textSecondary, fontSize: theme.typography.caption, marginBottom: theme.spacing.sm, textAlign: 'center' },
  logSection: { marginTop: theme.spacing.lg },
  logList: { maxHeight: 200 },
  logItem: { backgroundColor: theme.colors.surface, padding: theme.spacing.md, borderRadius: theme.borderRadius.md, borderWidth: 1, borderColor: theme.colors.primary, marginBottom: theme.spacing.sm },
  logText: { color: theme.colors.textPrimary, fontSize: theme.typography.caption, fontFamily: theme.typography.fontFamily.mono },
  input: { backgroundColor: theme.colors.surface, color: theme.colors.textPrimary, padding: theme.spacing.lg, borderRadius: theme.borderRadius.md, borderWidth: 2, borderColor: theme.colors.primary, marginBottom: theme.spacing.md, fontSize: theme.typography.body },
  inputNoMargin: { backgroundColor: theme.colors.surface, color: theme.colors.textPrimary, padding: theme.spacing.lg, borderRadius: theme.borderRadius.md, borderWidth: 2, borderColor: theme.colors.primary, fontSize: theme.typography.body, marginBottom: 0 },
  bigButton: { backgroundColor: theme.colors.primary, padding: theme.spacing.lg, borderRadius: theme.borderRadius.md, alignItems: 'center', marginVertical: theme.spacing.sm },
  bigButtonText: { color: theme.colors.surface, fontWeight: theme.typography.bold, fontSize: theme.typography.body },
  modalOverlay: { flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: theme.colors.surfaceLight, padding: theme.spacing.xl, borderRadius: theme.borderRadius.xl, width: '92%', borderWidth: 3, borderColor: theme.colors.primary },
  modalTitle: { fontSize: theme.typography.h2, color: theme.colors.primary, textAlign: 'center', marginBottom: theme.spacing.md },
  seed: { backgroundColor: theme.colors.surface, padding: theme.spacing.md, color: theme.colors.textSecondary, fontSize: theme.typography.caption, marginBottom: theme.spacing.md, borderRadius: theme.borderRadius.md },
  key: { backgroundColor: theme.colors.surface, padding: theme.spacing.md, color: theme.colors.textPrimary, fontSize: theme.typography.caption, marginBottom: theme.spacing.md, borderRadius: theme.borderRadius.md },
  close: { color: theme.colors.textSecondary, textAlign: 'center', marginTop: theme.spacing.lg, fontSize: theme.typography.body },
  error: { color: theme.colors.error, textAlign: 'center', marginTop: theme.spacing.md, fontSize: theme.typography.body },
  blockCounter: { 
    backgroundColor: theme.colors.surface, 
    padding: theme.spacing.md, 
    borderRadius: theme.borderRadius.md, 
    borderWidth: 2, 
    borderColor: theme.colors.primary, 
    marginBottom: theme.spacing.md 
  },
  blockText: { color: theme.colors.textSecondary, fontSize: theme.typography.caption, fontWeight: theme.typography.semiBold },

  // Address Book styles
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
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
    width: 50,
    borderRadius: theme.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactButtonText: {
    color: theme.colors.surface,
    fontSize: 20,
  },
  saveButtonText: {
    color: theme.colors.surface,
    fontSize: 16,
  },
  selectedContact: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  selectedContactText: {
    color: theme.colors.surface,
    fontSize: theme.typography.caption,
    fontWeight: theme.typography.semiBold,
    textAlign: 'center',
  },

  contactsSection: {
    marginTop: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
  },
});

const StyledTextInput = (props: React.ComponentProps<typeof TextInput>) => (
  <TextInput
    {...props}
    placeholderTextColor={theme.colors.textMuted}
    style={[styles.input, props.style]}
  />
);

const getPasswordStrength = (password: string) => {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z\d]/.test(password)) score++;
  if (score <= 2) return { level: 1, label: 'Weak' };
  if (score <= 3) return { level: 2, label: 'Fair' };
  if (score <= 4) return { level: 3, label: 'Good' };
  return { level: 4, label: 'Strong' };
};

const Wallet: React.FC = () => {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [balance, setBalance] = useState<string>('0.00000000');
  const [usdBalance, setUsdBalance] = useState<string>('$0.00');
  const [nextNonce, setNextNonce] = useState<number>(0);
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number>(0);
  const [selectedNode, setSelectedNode] = useState<NodeUrl>(WARTHOG_NODES[0]);
  const [walletAction, setWalletAction] = useState<'create' | 'derive' | 'import' | 'login'>('create');
  const [mnemonic, setMnemonic] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [wordCount, setWordCount] = useState('12');
  const [pathType, setPathType] = useState<'hardened' | 'normal'>('hardened');
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0.01');
  const [manualNonce, setManualNonce] = useState('');
  const [sending, setSending] = useState(false);

  const [showSendModal, setShowSendModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [showWalletOptionsModal, setShowWalletOptionsModal] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [saveWalletConsent, setSaveWalletConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadedFileContent, setUploadedFileContent] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [sentTxLog, setSentTxLog] = useState<string[]>([]);
  const [showRecentTxLog, setShowRecentTxLog] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);

  // Address Book state
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [addressBookMode, setAddressBookMode] = useState<'select' | 'manage'>('select');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [prefilledAddress, setPrefilledAddress] = useState<string>('');

  // Save current wallet state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savePassword, setSavePassword] = useState('');
  const [saveConfirmPassword, setSaveConfirmPassword] = useState('');
  const [logoutAfterSave, setLogoutAfterSave] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadPassword, setDownloadPassword] = useState('');

  useEffect(() => {
    storage.getItemAsync(SECURE_STORE_KEYS.wallet).then((enc: string | null) => {
      if (enc) {
        setWalletAction('login');
      }
    });
  }, []);

  const handleLogout = async () => {
    const enc = await storage.getItemAsync(SECURE_STORE_KEYS.wallet);
    if (!enc) {
      // Not saved, prompt to save first
      setLogoutAfterSave(true);
      setShowSaveModal(true);
      return;
    }
    // Already saved, logout
    performLogout();
  };

  const performLogout = () => {
    setWallet(null);
    setIsLoggedIn(false);
    setSentTxLog([]);
    Alert.alert('Logged Out', 'Your wallet is saved securely on this device.');
  };

  const handleClearWallet = () => {
    Alert.alert(
      'Delete Saved Wallet?',
      'This will permanently remove the encrypted wallet from your device.\n\nYou will need to import or create a new wallet next time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'DELETE FOREVER',
          style: 'destructive',
          onPress: async () => {
            try {
              await storage.deleteItemAsync(SECURE_STORE_KEYS.wallet);
              setWallet(null);
              setIsLoggedIn(false);
              setSentTxLog([]);
              setNextNonce(0);
              Alert.alert('Wallet Cleared', 'All saved data has been deleted.');
            } catch (e) {
              Alert.alert('Error', 'Failed to delete wallet data');
            }
          },
        },
      ]
    );
  };



  const getPersistentNonce = async (address: string): Promise<number> => {
    if (!address) return 0;
    try {
      const stored = await storage.getItemAsync(SECURE_STORE_KEYS.nonce(address));
      return stored ? Number(stored) : 0;
    } catch {
      return 0;
    }
  };

  const savePersistentNonce = async (address: string, nonce: number): Promise<void> => {
    if (!address) return;
    try {
      await storage.setItemAsync(SECURE_STORE_KEYS.nonce(address), nonce.toString());
    } catch (e) {
      console.error('Failed to persist nonce:', e);
    }
  };

  const fetchBalanceAndNonce = async (address: string) => {
    try {
      const [headData, balData] = await Promise.all([
        fetchChainHead(selectedNode),
        fetchAccountBalance(selectedNode, address),
      ]);

      setCurrentBlockHeight(headData.pinHeight);

      const balanceInWart = (balData.balance / 1).toFixed(8);
      setBalance(balanceInWart);

      const usdPrice = await fetchUsdPrice();
      const usd = (parseFloat(balanceInWart) * usdPrice).toFixed(2);
      setUsdBalance(`$${usd}`);

      const fetchedNonce = balData.nonceId;
      const persistentNonce = await getPersistentNonce(address);
      const newNextNonce = Math.max(persistentNonce, fetchedNonce, nextNonce);
      setNextNonce(newNextNonce);
      await savePersistentNonce(address, newNextNonce);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (wallet?.address) await fetchBalanceAndNonce(wallet.address);
    setRefreshing(false);
  }, [wallet]);

  const handleWalletAction = async () => {
    setError(null);
    setCreatingWallet(true);
    console.log('Wallet creation started - spinner should show');

    // Small delay to ensure spinner renders before heavy crypto operations
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      let data: WalletData;
      if (walletAction === 'create') {
        data = await generateWalletUtil(Number(wordCount), pathType);
      } else if (walletAction === 'derive') {
        data = deriveWalletUtil(mnemonic, Number(wordCount), pathType);
        setMnemonic('');
      } else if (walletAction === 'import' && privateKeyInput.length === PRIVATE_KEY_LENGTH) {
        data = importWalletUtil(privateKeyInput);
        setPrivateKeyInput('');
      } else {
        throw new Error('Fill all fields');
      }
      setWalletData(data);
      setSaveWalletConsent(false);
      setShowModal(true);
    } catch (e: any) {
      Alert.alert('Wallet Creation Failed', e.message);
    } finally {
      setCreatingWallet(false);
    }
  };

  const saveWallet = async () => {
    setModalError(null);
    if (!password) return setModalError('Enter a password');
    if (getPasswordStrength(password).level < 3) return setModalError('Password is too weak. Must be at least Good strength.');
    if (password !== confirmPassword) return setModalError('Passwords do not match');
    if (!saveWalletConsent) return setModalError('Check the consent box to save');
    if (!walletData) return setModalError('No wallet data available');
    try {
      const enc = encryptWallet(walletData, password);
      await storage.setItemAsync(SECURE_STORE_KEYS.wallet, enc);
      setWallet(walletData);
      setIsLoggedIn(true);
      setShowModal(false);
      fetchBalanceAndNonce(walletData.address);
      setPassword('');
      setConfirmPassword('');
      Alert.alert('✅ Wallet Saved Securely!');
    } catch (e: any) {
      setModalError('Failed to save wallet: ' + e.message);
    }
  };

  const saveCurrentWallet = async () => {
    setModalError(null);
    if (!savePassword) return setModalError('Enter a password');
    if (getPasswordStrength(savePassword).level < 3) return setModalError('Password is too weak. Must be at least Good strength.');
    if (savePassword !== saveConfirmPassword) return setModalError('Passwords do not match');
    if (!wallet) return setModalError('No wallet available');
    try {
      const enc = encryptWallet(wallet, savePassword);
      await storage.setItemAsync(SECURE_STORE_KEYS.wallet, enc);
      setShowSaveModal(false);
      setSavePassword('');
      setSaveConfirmPassword('');
      Alert.alert('✅ Wallet Saved Securely!');
      if (logoutAfterSave) {
        setLogoutAfterSave(false);
        performLogout();
      }
    } catch (e: any) {
      setModalError('Failed to save wallet: ' + e.message);
    }
  };

  const downloadCurrentWallet = async () => {
    setModalError(null);
    if (!downloadPassword) return setModalError('Enter a password');
    if (getPasswordStrength(downloadPassword).level < 3) return setModalError('Password is too weak. Must be at least Good strength.');
    if (!wallet) return setModalError('No wallet available');
    try {
      const enc = encryptWallet(wallet, downloadPassword);
      const file = new File(Paths.cache, 'warthog_wallet.txt');
      await file.write(enc);
      await Sharing.shareAsync(file.uri);
      setShowDownloadModal(false);
      setDownloadPassword('');
      Alert.alert('✅ Downloaded!');
    } catch (e: any) {
      setModalError('Failed to download: ' + e.message);
    }
  };

  const downloadWallet = async () => {
    setModalError(null);
    if (!password) return setModalError('Enter a password');
    if (getPasswordStrength(password).level < 3) return setModalError('Password is too weak. Must be at least Good strength.');
    if (password !== confirmPassword) return setModalError('Passwords do not match');
    if (!walletData) return setModalError('No wallet data available');
    try {
      const enc = encryptWallet(walletData, password);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([enc], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'warthog_wallet.txt';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, 'warthog_wallet.txt');
        await file.write(enc);
        await Sharing.shareAsync(file.uri);
      }
      
      setShowModal(false);
      setPassword('');
      setConfirmPassword('');
      Alert.alert('✅ Downloaded!');
    } catch (e: any) {
      setModalError('Failed to download: ' + e.message);
    }
  };

  const loadWallet = async () => {
    const enc = await storage.getItemAsync(SECURE_STORE_KEYS.wallet);
    if (!enc || !password) return setError('No wallet or wrong password');
    try {
      const data = decryptWallet(enc, password);
      setWallet(data);
      setIsLoggedIn(true);
      fetchBalanceAndNonce(data.address);
      setPassword('');
    } catch (e: any) {
      setError('Wrong password: ' + e.message);
    }
  };

  const pickAndLoginFromFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'text/plain', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = new File(result.assets[0].uri);
      const content = await file.text();
      setUploadedFileContent(content);
      setUploadedFileName(result.assets[0].name || 'Selected file');
      Alert.alert('File Loaded', 'Enter password below to decrypt');
    } catch (e: any) {
      setError('Failed to read file: ' + e.message);
    }
  };

  const loginFromFile = async () => {
    if (!uploadedFileContent || !password) return setError('No file or password');
    try {
      const data = decryptWallet(uploadedFileContent, password);
      setWallet(data);
      setIsLoggedIn(true);
      fetchBalanceAndNonce(data.address);
      setUploadedFileContent(null);
      setPassword('');
      Alert.alert('✅ Logged in from file!');
    } catch (e: any) {
      setError('Wrong password or invalid file: ' + e.message);
    }
  };

  const handleSend = async () => {
    if (!wallet || !toAddr || !amount) return setError('Fill all fields');
    if (!isValidAddress(toAddr)) {
      return setError('Invalid toAddr: must be exactly 48 hex characters');
    }
    setSending(true);
    setError(null);
    try {
      const headData = await fetchChainHead(selectedNode);
      setCurrentBlockHeight(headData.pinHeight);
      const nonceId = manualNonce ? parseInt(manualNonce) : nextNonce;
      const feeWart = fee || DEFAULT_FEE;
      const feeE8 = await fetchFeeE8(selectedNode, feeWart);
      const amountE8 = wartToE8(amount);
      if (!amountE8) throw new Error('Invalid amount');
      const buf1 = Buffer.from(headData.pinHash, "hex");
      const buf2 = Buffer.alloc(19);
      buf2.writeUInt32BE(headData.pinHeight, 0);
      buf2.writeUInt32BE(nonceId, 4);
      buf2.writeUInt8(0, 8); buf2.writeUInt8(0, 9); buf2.writeUInt8(0, 10);
      buf2.writeBigUInt64BE(BigInt(feeE8), 11);
      const buf3 = Buffer.from(toAddr.slice(0, 40), "hex");
      const buf4 = Buffer.alloc(8);
      buf4.writeBigUInt64BE(BigInt(amountE8), 0);
      const toSign = Buffer.concat([buf1, buf2, buf3, buf4]);
      const txHash = ethers.sha256(toSign);
      const sigData = signTransaction(txHash, wallet.privateKey);
      const postData = {
        pinHeight: headData.pinHeight,
        nonceId,
        toAddr,
        amountE8,
        feeE8,
        signature65: sigData.signature65,
      };
      const res = await submitTransaction(selectedNode, postData);
      const sentTxHash = res.txHash;
      Alert.alert('Sent!', `Tx Hash: ${sentTxHash}`);
      setSentTxLog((prev) => [sentTxHash, ...prev]);
      setShowRecentTxLog(true);
      setTimeout(() => setShowRecentTxLog(false), 35000); // Hide after 35 seconds
      const updatedNextNonce = Math.max(nextNonce || 0, nonceId + 1);
      setNextNonce(updatedNextNonce);
      await savePersistentNonce(wallet.address, updatedNextNonce);
      setManualNonce('');
      onRefresh();
    } catch (e: any) {
      console.error(e);
      const msg = e.response?.data?.error || e.message || 'Send failed';
      setError(msg);
      Alert.alert('Send Failed', msg);
    } finally {
      setSending(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    Clipboard.setStringAsync(text);
    Alert.alert('Copied!', `${label} copied`);
  };

  // Address Book handlers
  const handleContactSelect = (contact: Contact) => {
    setToAddr(contact.address);
    setSelectedContact(contact);
    setShowAddressBook(false);
  };

  const handleSaveAsContact = () => {
    if (toAddr && isValidAddress(toAddr)) {
      setShowAddressBook(true);
    }
  };

  return (
    <View style={styles.container}>
      {!isLoggedIn ? (
        <View style={styles.loginSection}>
          <Text style={styles.label}>Choose Action</Text>
          <View style={styles.buttonRow}>
            {(['create', 'derive', 'import', 'login'] as const).map(act => (
              <TouchableOpacity
                key={act}
                style={[styles.actionButton, walletAction === act && styles.activeButton]}
                onPress={() => setWalletAction(act)}
              >
                <Text style={styles.actionButtonText}>{act.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {walletAction === 'login' && (
            <>
              <TouchableOpacity style={styles.bigButton} onPress={loadWallet}>
                <Text style={styles.bigButtonText}>Login from Device (Saved)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.bigButton, { backgroundColor: theme.colors.warning }]} onPress={pickAndLoginFromFile}>
                <Text style={styles.bigButtonText}>Login from File</Text>
              </TouchableOpacity>
              <StyledTextInput
                placeholder="Enter password to decrypt"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              {uploadedFileName && (
                <Text style={styles.label}>Selected file: {uploadedFileName}</Text>
              )}
              {uploadedFileContent ? (
                <TouchableOpacity style={styles.bigButton} onPress={loginFromFile}>
                  <Text style={styles.bigButtonText}>Decrypt & Login from File</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.bigButton} onPress={loadWallet}>
                  <Text style={styles.bigButtonText}>Decrypt & Login from Device</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {(walletAction === 'create' || walletAction === 'derive' || walletAction === 'import') && (
            <>
              {creatingWallet ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                  <Text style={styles.loadingText}>Creating wallet...</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.bigButton} onPress={handleWalletAction}>
                  <Text style={styles.bigButtonText}>
                    {walletAction === 'create' ? 'Create New Wallet' : walletAction === 'derive' ? 'Derive from Seed Phrase' : 'Import Private Key'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {walletAction === 'derive' && (
            <StyledTextInput
              placeholder="Enter 12 or 24 word seed phrase"
              value={mnemonic}
              onChangeText={setMnemonic}
              multiline
              numberOfLines={4}
            />
          )}
          {walletAction === 'import' && (
            <StyledTextInput
              placeholder="Enter 64-char private key"
              value={privateKeyInput}
              onChangeText={setPrivateKeyInput}
            />
          )}
        </View>
      ) : wallet ? (
        <>
          <View style={styles.balanceBox}>
            <Text style={styles.balanceLabel}>Balance</Text>
            <Text style={styles.balance}>{balance} WART</Text>
            <Text style={styles.usd}>{usdBalance}</Text>
            <TouchableOpacity onPress={() => copyToClipboard(wallet.address, 'Address')}>
              <Text style={styles.address}>{wallet.address.slice(0, 6)}...{wallet.address.slice(-6)}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
            <Text style={styles.refreshText}>Refresh Balance</Text>
          </TouchableOpacity>

          {showRecentTxLog && sentTxLog.length > 0 && (
            <View style={styles.logSection}>
              <Text style={styles.sectionTitle}>Recent Transaction</Text>
              <TouchableOpacity onPress={() => copyToClipboard(sentTxLog[0], 'Tx Hash')} style={styles.logItem}>
                <Text style={styles.logText}>{sentTxLog[0]}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={styles.sendToggleButton}
              onPress={() => setShowSendModal(true)}
            >
              <Text style={styles.sendToggleText}>Send</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.activityToggleButton}
              onPress={() => setShowHistoryModal(true)}
            >
              <Text style={styles.activityToggleText}>History</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contactsToggleButton}
              onPress={() => setShowContactsModal(true)}
            >
              <Text style={styles.contactsToggleText}>Contacts</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={styles.contactsToggleButton}  // Reuse style
              onPress={() => setShowWalletOptionsModal(true)}
            >
              <Text style={styles.contactsToggleText}>Wallet Options</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <ActivityIndicator size="large" color={theme.colors.primary} />
      )}

      {/* ==================== MODALS ==================== */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Wallet Ready!</Text>
            {walletData?.mnemonic && (
              <>
                <Text style={styles.label}>Mnemonic Phrase</Text>
                <Text style={styles.seed}>{walletData.mnemonic}</Text>
              </>
            )}
            <Text style={styles.label}>Private Key</Text>
            <TouchableOpacity onPress={() => copyToClipboard(walletData!.privateKey, 'Private Key')}>
              <Text style={styles.key}>{walletData?.privateKey}</Text>
            </TouchableOpacity>
            <Text style={styles.label}>Password must be at least 8 characters with uppercase, lowercase, number, and special character.</Text>
            <StyledTextInput placeholder="Password" secureTextEntry={!showPassword} value={password} onChangeText={setPassword} />
            <Text style={styles.label}>Strength: <Text style={{ color: getPasswordStrength(password).level === 1 ? 'red' : getPasswordStrength(password).level === 2 ? 'orange' : getPasswordStrength(password).level === 3 ? 'blue' : 'green' }}>{getPasswordStrength(password).label}</Text></Text>
            <StyledTextInput placeholder="Confirm Password" secureTextEntry={!showConfirmPassword} value={confirmPassword} onChangeText={setConfirmPassword} />
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10 }}
              onPress={() => setSaveWalletConsent(!saveWalletConsent)}
            >
              <View style={{ width: 20, height: 20, borderWidth: 2, borderColor: theme.colors.primary, marginRight: 10, backgroundColor: saveWalletConsent ? theme.colors.primary : 'transparent' }} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>I consent to save this wallet securely on this device</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bigButton} onPress={saveWallet}>
              <Text style={styles.bigButtonText}>{Platform.OS === 'web' ? 'Save (not secure in this web demo)' : 'Save Securely (Device)'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bigButton} onPress={downloadWallet}>
              <Text style={styles.bigButtonText}>Download Encrypted File</Text>
            </TouchableOpacity>
            {modalError && <Text style={styles.error}>{modalError}</Text>}
            <TouchableOpacity onPress={() => { setShowModal(false); setModalError(null); }}>
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showSaveModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Save Current Wallet</Text>
            <Text style={styles.label}>Password must be at least 8 characters with uppercase, lowercase, number, and special character.</Text>
            <StyledTextInput placeholder="Password" secureTextEntry value={savePassword} onChangeText={setSavePassword} />
            <Text style={styles.label}>Strength: <Text style={{ color: getPasswordStrength(savePassword).level === 1 ? 'red' : getPasswordStrength(savePassword).level === 2 ? 'orange' : getPasswordStrength(savePassword).level === 3 ? 'blue' : 'green' }}>{getPasswordStrength(savePassword).label}</Text></Text>
            <StyledTextInput placeholder="Confirm Password" secureTextEntry value={saveConfirmPassword} onChangeText={setSaveConfirmPassword} />
            <TouchableOpacity style={styles.bigButton} onPress={saveCurrentWallet}>
              <Text style={styles.bigButtonText}>{Platform.OS === 'web' ? 'Save (not secure in this web demo)' : 'Save Securely (Device)'}</Text>
            </TouchableOpacity>
            {modalError && <Text style={styles.error}>{modalError}</Text>}
            <TouchableOpacity onPress={() => { setShowSaveModal(false); setModalError(null); setSavePassword(''); setSaveConfirmPassword(''); setLogoutAfterSave(false); }}>
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showDownloadModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Download Wallet File</Text>
            <Text style={styles.label}>Password must be at least 8 characters with uppercase, lowercase, number, and special character.</Text>
            <StyledTextInput placeholder="Password" secureTextEntry value={downloadPassword} onChangeText={setDownloadPassword} />
            <Text style={styles.label}>Strength: <Text style={{ color: getPasswordStrength(downloadPassword).level === 1 ? 'red' : getPasswordStrength(downloadPassword).level === 2 ? 'orange' : getPasswordStrength(downloadPassword).level === 3 ? 'blue' : 'green' }}>{getPasswordStrength(downloadPassword).label}</Text></Text>
            <TouchableOpacity style={styles.bigButton} onPress={downloadCurrentWallet}>
              <Text style={styles.bigButtonText}>Download Encrypted File</Text>
            </TouchableOpacity>
            {modalError && <Text style={styles.error}>{modalError}</Text>}
            <TouchableOpacity onPress={() => { setShowDownloadModal(false); setModalError(null); setDownloadPassword(''); }}>
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showSendModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent}>
            {wallet ? (
              <>
                <Text style={styles.modalTitle}>Send WART</Text>
                <Text style={styles.label}>To Address (48 chars)</Text>
                <View style={styles.addressContainer}>
                  <View style={styles.addressInput}>
                    <StyledTextInput
                      placeholder="Enter recipient address"
                      value={toAddr}
                      style={styles.inputNoMargin}
                      onChangeText={(value) => {
                        setToAddr(value);
                        if (selectedContact && value !== selectedContact.address) {
                          setSelectedContact(null); // Clear selected contact if address changed manually
                        }
                      }}
                    />
                  </View>
                  <View style={styles.addressButtons}>
                    <TouchableOpacity
                      style={[styles.addressButton, { backgroundColor: theme.colors.primary }]}
                      onPress={() => setShowAddressBook(true)}
                    >
                      <Text style={styles.contactButtonText}>📇</Text>
                    </TouchableOpacity>
                    {toAddr && isValidAddress(toAddr) && !selectedContact && (
                      <TouchableOpacity
                        style={[styles.addressButton, { backgroundColor: theme.colors.info }]}
                        onPress={handleSaveAsContact}
                      >
                        <Text style={styles.saveButtonText}>💾</Text>
                      </TouchableOpacity>
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
                <Text style={styles.label}>Amount (WART)</Text>
                <StyledTextInput placeholder="Enter amount to send" value={amount} onChangeText={setAmount} keyboardType="numeric" />
                <Text style={styles.label}>Fee (WART)</Text>
                <StyledTextInput placeholder="Transaction fee (default 0.01)" value={fee} onChangeText={setFee} keyboardType="numeric" />
                <Text style={styles.nonceDisplay}>Auto Nonce: {nextNonce}</Text>
                <Text style={styles.label}>Manual Nonce (leave blank for auto)</Text>
                <StyledTextInput placeholder="Optional manual nonce" value={manualNonce} onChangeText={setManualNonce} keyboardType="numeric" />
                <TouchableOpacity style={styles.bigButton} onPress={handleSend} disabled={sending}>
                  <Text style={styles.bigButtonText}>{sending ? 'Sending...' : 'SEND TRANSACTION'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowSendModal(false)}>
                  <Text style={styles.close}>Close</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showHistoryModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent}>
            {wallet ? (
              <>
                <Text style={styles.modalTitle}>Transaction History</Text>
                <View style={styles.blockCounter}>
                  <Text style={styles.blockText}>Current Block Height: {currentBlockHeight}</Text>
                </View>
                {sentTxLog.length > 0 && (
                  <View style={styles.logSection}>
                    <Text style={styles.sectionTitle}>Sent Transaction Log</Text>
                    <ScrollView style={styles.logList} contentContainerStyle={{ paddingBottom: 20 }}>
                      {sentTxLog.map((hash, index) => (
                        <TouchableOpacity key={index} onPress={() => copyToClipboard(hash, 'Tx Hash')} style={styles.logItem}>
                          <Text style={styles.logText}>{hash}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
                <TransactionHistory
                  address={wallet.address}
                  node={selectedNode}
                  onRefresh={onRefresh}
                  onAddContact={(address) => {
                    setPrefilledAddress(address);
                    setAddressBookMode('select');
                    setShowAddressBook(true);
                  }}
                />
                <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
                  <Text style={styles.close}>Close</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showContactsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Contacts</Text>
            <TouchableOpacity
              style={styles.bigButton}
              onPress={() => {
                setAddressBookMode('manage');
                setShowAddressBook(true);
              }}
            >
              <Text style={styles.bigButtonText}>📇 Manage Contacts</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bigButton, { backgroundColor: theme.colors.textSecondary }]}
              onPress={() => {
                setAddressBookMode('select');
                setShowAddressBook(true);
              }}
            >
              <Text style={styles.bigButtonText}>👆 Select Contact for Sending</Text>
            </TouchableOpacity>
            <Text style={[styles.label, { textAlign: 'center', marginTop: theme.spacing.md }]}>
              💡 Tip: You can also add contacts directly from transactions using the 💾 button when entering addresses!
            </Text>
            <TouchableOpacity onPress={() => setShowContactsModal(false)}>
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showWalletOptionsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent}>
            <View style={{ paddingTop: 20, gap: 24 }}>
              <Text style={styles.modalTitle}>Wallet Options</Text>
              <Text style={styles.label}>Select Node</Text>
              <View style={styles.nodeColumn}>
                {WARTHOG_NODES.map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.nodeButton, selectedNode === n && styles.activeButton]}
                    onPress={() => setSelectedNode(n)}
                  >
                    <Text style={styles.nodeButtonText} numberOfLines={1}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.bottomButton, { backgroundColor: '#757575' }]}
                onPress={() => {
                  setShowWalletOptionsModal(false);
                  handleLogout();
                }}
              >
                <Text style={styles.bottomButtonText}>Logout (keep saved)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bottomButton, { backgroundColor: theme.colors.info }]}
                onPress={() => {
                  setShowWalletOptionsModal(false);
                  setShowSaveModal(true);
                }}
              >
                <Text style={styles.bottomButtonText}>Save to Device</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bottomButton, { backgroundColor: theme.colors.error }]}
                onPress={() => {
                  setShowWalletOptionsModal(false);
                  handleClearWallet();
                }}
              >
                <Text style={styles.bottomButtonText}>Clear & Delete Saved</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bottomButton, { backgroundColor: theme.colors.warning }]}
                onPress={() => {
                  setShowWalletOptionsModal(false);
                  setShowDownloadModal(true);
                }}
              >
                <Text style={styles.bottomButtonText}>Download Wallet File</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowWalletOptionsModal(false)}>
                <Text style={styles.close}>Close</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <AddressBookModal
        visible={showAddressBook}
        mode={addressBookMode}
        onClose={() => setShowAddressBook(false)}
        onSelectContact={handleContactSelect}
        preselectedAddress={toAddr}
        title={addressBookMode === 'manage' ? 'Manage Contacts' : 'Select Recipient'}
      />

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

export default Wallet;
