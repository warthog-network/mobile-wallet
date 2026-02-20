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
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ethers } from 'ethers';
import axios from 'axios';
import TransactionHistory from './TransactionHistory';

// Extracted imports
import { WalletData } from './types';
import { WARTHOG_NODES, SECURE_STORE_KEYS, DERIVATION_PATHS, ADDRESS_LENGTH, PRIVATE_KEY_LENGTH, DEFAULT_FEE } from './constants';
import { initCrypto, generateWallet as generateWalletUtil, deriveWallet as deriveWalletUtil, importWallet as importWalletUtil, wartToE8, signTransaction } from './utils/crypto';
import { fetchChainHead, fetchAccountBalance, fetchUsdPrice, fetchFeeE8, submitTransaction } from './utils/api';

// Initialize crypto
initCrypto();



const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070707', padding: 20 },
  sectionTitle: { fontSize: 26, color: '#FFC107', fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  loginSection: { marginTop: 20 },
  label: { color: '#FFECB3', fontSize: 16, marginBottom: 8 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  nodeColumn: { gap: 8, marginBottom: 20 },
  nodeButton: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#474747', borderRadius: 8, alignSelf: 'stretch' },
  nodeButtonText: { color: '#FFFFFF', fontWeight: '600', textAlign: 'center', fontSize: 13 },
  bottomRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10, marginBottom: 40 },
  bottomButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  bottomButtonText: { color: '#FFFFFF', fontWeight: '600', textAlign: 'center', fontSize: 11 },
  actionButton: { paddingVertical: 10, paddingHorizontal: 18, backgroundColor: '#474747', borderRadius: 8, minWidth: 70 },
  actionButtonText: { color: '#FFFFFF', fontWeight: '600', textAlign: 'center', fontSize: 13 },
  activeButton: { backgroundColor: '#FFC107' },

  toggleRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },

  sendToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#474747',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#FFC107',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sendToggleText: { color: '#FFECB3', fontSize: 16, fontWeight: '600' },
  sendToggleArrow: { color: '#FFC107', fontSize: 18, fontWeight: 'bold' },

  activityToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#474747',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#FFC107',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  activityToggleText: { color: '#FFECB3', fontSize: 16, fontWeight: '600' },
  activityToggleArrow: { color: '#FFC107', fontSize: 18, fontWeight: 'bold' },

  balanceBox: { backgroundColor: '#474747', padding: 20, borderRadius: 12, borderWidth: 3, borderColor: '#FFC107', marginBottom: 20 },
  balanceLabel: { color: '#FFECB3', fontSize: 16 },
  balance: { fontSize: 34, color: '#FFFFFF', fontWeight: '700' },
  usd: { color: '#FFECB3', fontSize: 20, marginTop: 4 },
  address: { color: '#FFECB3', fontSize: 14, marginTop: 12, textAlign: 'center' },
  refreshButton: { backgroundColor: '#FFC107', padding: 16, borderRadius: 8, alignItems: 'center', marginBottom: 20 },
  refreshText: { color: '#1C2526', fontWeight: '700', fontSize: 17 },
  sendSection: { marginTop: 10 },
  nonceDisplay: { color: '#FFECB3', fontSize: 14, marginBottom: 8, textAlign: 'center' },
  logSection: { marginTop: 20 },
  logList: { maxHeight: 200 },
  logItem: { backgroundColor: '#1C2526', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#FFC107', marginBottom: 8 },
  logText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'monospace' },
  input: { backgroundColor: '#1C2526', color: '#FFFFFF', padding: 16, borderRadius: 8, borderWidth: 2, borderColor: '#FFC107', marginBottom: 12, fontSize: 16 },
  bigButton: { backgroundColor: '#FFC107', padding: 16, borderRadius: 8, alignItems: 'center', marginVertical: 8 },
  bigButtonText: { color: '#1C2526', fontWeight: '700', fontSize: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#474747', padding: 25, borderRadius: 16, width: '92%', borderWidth: 3, borderColor: '#FFC107' },
  modalTitle: { fontSize: 24, color: '#FFC107', textAlign: 'center', marginBottom: 15 },
  seed: { backgroundColor: '#1C2526', padding: 15, color: '#FFECB3', fontSize: 15, marginBottom: 15, borderRadius: 8 },
  key: { backgroundColor: '#1C2526', padding: 15, color: '#FFFFFF', fontSize: 14, marginBottom: 15, borderRadius: 8 },
  close: { color: '#FFECB3', textAlign: 'center', marginTop: 20, fontSize: 18 },
  error: { color: '#FF4444', textAlign: 'center', marginTop: 15, fontSize: 16 },
  blockCounter: { 
    backgroundColor: '#1C2526', 
    padding: 14, 
    borderRadius: 8, 
    borderWidth: 2, 
    borderColor: '#FFC107', 
    marginBottom: 12 
  },
  blockText: { color: '#FFECB3', fontSize: 15, fontWeight: '600' },
});

const StyledTextInput = (props: React.ComponentProps<typeof TextInput>) => (
  <TextInput
    {...props}
    placeholderTextColor="#ffffff88"
    style={[styles.input, props.style]}
  />
);

const Wallet: React.FC = () => {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [balance, setBalance] = useState<string>('0.00000000');
  const [usdBalance, setUsdBalance] = useState<string>('$0.00');
  const [nextNonce, setNextNonce] = useState<number>(0);
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number>(0);
  const [selectedNode, setSelectedNode] = useState(WARTHOG_NODES[0]);
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

  const [showSendSection, setShowSendSection] = useState(false);
  const [showHistorySection, setShowHistorySection] = useState(false);

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
  const [sentTxLog, setSentTxLog] = useState<string[]>([]);

  useEffect(() => {
    SecureStore.getItemAsync(SECURE_STORE_KEYS.wallet).then(enc => enc && setIsLoggedIn(true));
  }, []);

  const handleLogout = () => {
    setWallet(null);
    setIsLoggedIn(false);
    setSentTxLog([]);
    Alert.alert('Logged Out', 'Your wallet is still saved securely on this device.');
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
              await SecureStore.deleteItemAsync(SECURE_STORE_KEYS.wallet);
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
      const stored = await SecureStore.getItemAsync(SECURE_STORE_KEYS.nonce(address));
      return stored ? Number(stored) : 0;
    } catch {
      return 0;
    }
  };

  const savePersistentNonce = async (address: string, nonce: number): Promise<void> => {
    if (!address) return;
    try {
      await SecureStore.setItemAsync(SECURE_STORE_KEYS.nonce(address), nonce.toString());
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
    }
  };

  const saveWallet = async () => {
    setModalError(null);
    if (!password) return setModalError('Enter a password');
    if (password !== confirmPassword) return setModalError('Passwords do not match');
    if (!saveWalletConsent) return setModalError('Check the consent box to save');
    if (!walletData) return setModalError('No wallet data available');
    try {
      const enc = CryptoJS.AES.encrypt(JSON.stringify(walletData), password).toString();
      await SecureStore.setItemAsync(SECURE_STORE_KEYS.wallet, enc);
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

  const downloadWallet = async () => {
    setModalError(null);
    if (!password) return setModalError('Enter a password');
    if (password !== confirmPassword) return setModalError('Passwords do not match');
    if (!walletData) return setModalError('No wallet data available');
    try {
      const enc = CryptoJS.AES.encrypt(JSON.stringify(walletData), password).toString();
      const file = new File(Paths.cache, 'warthog_wallet.txt');
      await file.write(enc);
      await Sharing.shareAsync(file.uri);
      setShowModal(false);
      setPassword('');
      setConfirmPassword('');
      Alert.alert('✅ Downloaded!');
    } catch (e: any) {
      setModalError('Failed to download: ' + e.message);
    }
  };

  const loadWallet = async () => {
    const enc = await SecureStore.getItemAsync(SECURE_STORE_KEYS.wallet);
    if (!enc || !password) return setError('No wallet or wrong password');
    try {
      const dec = CryptoJS.AES.decrypt(enc, password).toString(CryptoJS.enc.Utf8);
      const data = JSON.parse(dec);
      setWallet(data);
      setIsLoggedIn(true);
      fetchBalanceAndNonce(data.address);
      setPassword('');
    } catch {
      setError('Wrong password');
    }
  };

  const pickAndLoginFromFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'text/plain', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = new File(result.assets[0].uri);
      const content = await file.text();
      setUploadedFileContent(content);
      Alert.alert('File Loaded', 'Enter password below to decrypt');
    } catch (e: any) {
      setError('Failed to read file: ' + e.message);
    }
  };

  const loginFromFile = async () => {
    if (!uploadedFileContent || !password) return setError('No file or password');
    try {
      const bytes = CryptoJS.AES.decrypt(uploadedFileContent, password);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      const data = JSON.parse(decrypted);
      setWallet(data);
      setIsLoggedIn(true);
      fetchBalanceAndNonce(data.address);
      setUploadedFileContent(null);
      setPassword('');
      Alert.alert('✅ Logged in from file!');
    } catch {
      setError('Wrong password or invalid file');
    }
  };

  const handleSend = async () => {
    if (!wallet || !toAddr || !amount) return setError('Fill all fields');
    if (toAddr.length !== 48 || !/^[0-9a-fA-F]{48}$/.test(toAddr)) {
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

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#FFC107']} />}
    >
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
              <TouchableOpacity style={[styles.bigButton, { backgroundColor: '#FF9800' }]} onPress={pickAndLoginFromFile}>
                <Text style={styles.bigButtonText}>Login from File</Text>
              </TouchableOpacity>
              {uploadedFileContent && (
                <>
                  <StyledTextInput
                    placeholder="Enter password to decrypt file"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity style={styles.bigButton} onPress={loginFromFile}>
                    <Text style={styles.bigButtonText}>Decrypt & Login</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
          {(walletAction === 'create' || walletAction === 'derive' || walletAction === 'import') && (
            <TouchableOpacity style={styles.bigButton} onPress={handleWalletAction}>
              <Text style={styles.bigButtonText}>
                {walletAction === 'create' ? 'Create New Wallet' : walletAction === 'derive' ? 'Derive from Seed Phrase' : 'Import Private Key'}
              </Text>
            </TouchableOpacity>
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
          <View style={styles.balanceBox}>
            <Text style={styles.balanceLabel}>Balance</Text>
            <Text style={styles.balance}>{balance} WART</Text>
            <Text style={styles.usd}>{usdBalance}</Text>
            <TouchableOpacity onPress={() => copyToClipboard(wallet.address, 'Address')}>
              <Text style={styles.address}>{wallet.address}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
            <Text style={styles.refreshText}>Refresh Balance</Text>
          </TouchableOpacity>

          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={styles.sendToggleButton}
              onPress={() => setShowSendSection(!showSendSection)}
            >
              <Text style={styles.sendToggleText}>Send WART</Text>
              <Text style={styles.sendToggleArrow}>
                {showSendSection ? '▼' : '▶'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.activityToggleButton}
              onPress={() => setShowHistorySection(!showHistorySection)}
            >
              <Text style={styles.activityToggleText}>Activity</Text>
              <Text style={styles.activityToggleArrow}>
                {showHistorySection ? '▼' : '▶'}
              </Text>
            </TouchableOpacity>
          </View>

          {showSendSection && (
            <View style={styles.sendSection}>
              <Text style={styles.label}>To Address (48 chars)</Text>
              <StyledTextInput placeholder="Enter recipient address" value={toAddr} onChangeText={setToAddr} />
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
            </View>
          )}

          {showHistorySection && (
            <>
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

              <TransactionHistory address={wallet.address} node={selectedNode} onRefresh={onRefresh} />
            </>
          )}

          <Text style={styles.label}>Wallet Options</Text>
          <View style={styles.bottomRow}>
            <TouchableOpacity
              style={[styles.bottomButton, { backgroundColor: '#474747' }]}
              onPress={handleLogout}
            >
              <Text style={styles.bottomButtonText}>Logout (keep saved)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bottomButton, { backgroundColor: '#FF4444' }]}
              onPress={handleClearWallet}
            >
              <Text style={styles.bottomButtonText}>Clear & Delete Saved</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <ActivityIndicator size="large" color="#FFC107" />
      )}

      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Wallet Ready!</Text>
            {walletData?.mnemonic && <Text style={styles.seed}>{walletData.mnemonic}</Text>}
            <Text style={styles.label}>Private Key</Text>
            <TouchableOpacity onPress={() => copyToClipboard(walletData!.privateKey, 'Private Key')}>
              <Text style={styles.key}>{walletData?.privateKey}</Text>
            </TouchableOpacity>
            <StyledTextInput placeholder="Password" secureTextEntry={!showPassword} value={password} onChangeText={setPassword} />
            <StyledTextInput placeholder="Confirm Password" secureTextEntry={!showConfirmPassword} value={confirmPassword} onChangeText={setConfirmPassword} />
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10 }}
              onPress={() => setSaveWalletConsent(!saveWalletConsent)}
            >
              <View style={{ width: 20, height: 20, borderWidth: 2, borderColor: '#FFC107', marginRight: 10, backgroundColor: saveWalletConsent ? '#FFC107' : 'transparent' }} />
              <Text style={{ color: '#FFECB3', fontSize: 14 }}>I consent to save this wallet securely on this device</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bigButton} onPress={saveWallet}>
              <Text style={styles.bigButtonText}>Save Securely (Device)</Text>
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
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
};

export default Wallet;
