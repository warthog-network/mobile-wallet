import { useState, useEffect } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';
import { WalletData, WalletAction } from '../types';
import { SECURE_STORE_KEYS } from '../constants';
import { storage } from '../utils/storage';
import { 
  generateWallet, 
  deriveWallet, 
  importWallet, 
  encryptWallet, 
  decryptWallet,
  initCrypto 
} from '../utils/crypto';

export const useWallet = () => {
  const [wallet, setWallet] = useState<any>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [error, setError] = useState('');
  const [walletAction, setWalletAction] = useState<WalletAction>('login');
  const [walletData, setWalletData] = useState<WalletData>({
    mnemonic: '',
    privateKey: '',
    publicKey: '',
    address: '',
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saveWalletConsent, setSaveWalletConsent] = useState(false);

  useEffect(() => {
    initCrypto();
    loadWallet();
  }, []);

  const handleWalletAction = async () => {
    setError('');
    try {
      let newWallet: any;

      switch (walletAction) {
        case 'create':
          if (!password) return setError('Password is required');
          if (password !== confirmPassword) return setError('Passwords do not match');
          newWallet = generateWallet(12, 'hardened');
          break;

        case 'import':
          if (!walletData.mnemonic && !walletData.privateKey) return setError('Mnemonic or private key is required');
          if (!password) return setError('Password is required');
          if (password !== confirmPassword) return setError('Passwords do not match');

          newWallet = walletData.mnemonic
            ? deriveWallet(walletData.mnemonic, 12, 'hardened')
            : importWallet(walletData.privateKey);
          break;

        case 'login':
          if (!password) return setError('Password is required');
          const encryptedWallet = await storage.getItemAsync(SECURE_STORE_KEYS.wallet);
          if (!encryptedWallet) return setError('No wallet found. Please create or import a wallet.');

          newWallet = decryptWallet(encryptedWallet, password);
          break;

        default:
          return setError('Invalid action');
      }

      setWallet(newWallet);
      setIsLoggedIn(true);

      if ((walletAction === 'create' || walletAction === 'import') && saveWalletConsent) {
        await saveWallet(newWallet, password);
      }

      setWalletData({ mnemonic: '', privateKey: '', publicKey: '', address: '' });
      setPassword('');
      setConfirmPassword('');
      setSaveWalletConsent(false);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    }
  };

  const saveWallet = async (walletToSave: any, walletPassword: string) => {
    try {
      const encryptedWallet = encryptWallet(walletToSave, walletPassword);
      await storage.setItemAsync(SECURE_STORE_KEYS.wallet, encryptedWallet);
    } catch (err: any) {
      console.error('Error saving wallet:', err);
      Alert.alert('Error', 'Failed to save wallet securely');
    }
  };

  const downloadWallet = async () => {
    if (!wallet) return;
    try {
      const walletJson = JSON.stringify({
        mnemonic: wallet.mnemonic,
        privateKey: wallet.privateKey,
        address: wallet.address
      }, null, 2);
      const fileName = `warthog-wallet-${wallet.address.slice(0, 8)}.json`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, walletJson);
      Alert.alert('Success', `Wallet exported to ${fileName}`);
    } catch {
      Alert.alert('Error', 'Failed to export wallet');
    }
  };

  const loadWallet = async () => {
    try {
      const encryptedWallet = await storage.getItemAsync(SECURE_STORE_KEYS.wallet);
      if (encryptedWallet) setWalletAction('login');
    } catch (err) {
      console.error('Error loading wallet:', err);
    }
  };

  const handleLogout = () => {
    setWallet(null);
    setIsLoggedIn(false);
    setPassword('');
    setError('');
  };

  const handleClearWallet = async () => {
    Alert.alert(
      'Clear Wallet',
      'Are you sure you want to remove the saved wallet? Make sure you have a backup!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await storage.deleteItemAsync(SECURE_STORE_KEYS.wallet);
              handleLogout();
              setWalletAction('create');
            } catch {
              Alert.alert('Error', 'Failed to clear wallet');
            }
          }
        }
      ]
    );
  };

  const pickAndLoginFromFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: false
      });
      if (!result.canceled && result.assets?.[0]) {
        await loginFromFile(result.assets[0].uri);
      }
    } catch {
      Alert.alert('Error', 'Failed to pick file');
    }
  };

  const loginFromFile = async (fileUri: string) => {
    try {
      const fileContent = await FileSystem.readAsStringAsync(fileUri);
      const walletJson = JSON.parse(fileContent);

      if (!walletJson.mnemonic && !walletJson.privateKey) {
        Alert.alert('Error', 'Invalid wallet file format');
        return;
      }

      const importedWallet = walletJson.mnemonic
        ? deriveWallet(walletJson.mnemonic, 12, 'hardened')
        : importWallet(walletJson.privateKey);

      setWallet(importedWallet);
      setIsLoggedIn(true);
    } catch {
      Alert.alert('Error', 'Failed to import wallet from file');
    }
  };

  return {
    wallet, isLoggedIn, error, walletAction, walletData,
    password, confirmPassword, saveWalletConsent,
    setError, setWalletAction, setWalletData, setPassword,
    setConfirmPassword, setSaveWalletConsent,
    handleWalletAction, saveWallet, downloadWallet, loadWallet,
    handleLogout, handleClearWallet, pickAndLoginFromFile, loginFromFile
  };
};