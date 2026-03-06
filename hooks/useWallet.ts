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
    password: ''
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
      let newWallet;
      
      switch (walletAction) {
        case 'create':
          if (!walletData.password) {
            setError('Password is required');
            return;
          }
          if (walletData.password !== confirmPassword) {
            setError('Passwords do not match');
            return;
          }
          newWallet = generateWallet();
          break;
          
        case 'import':
          if (!walletData.mnemonic && !walletData.privateKey) {
            setError('Mnemonic or private key is required');
            return;
          }
          if (!walletData.password) {
            setError('Password is required');
            return;
          }
          if (walletData.password !== confirmPassword) {
            setError('Passwords do not match');
            return;
          }
          
          if (walletData.mnemonic) {
            newWallet = deriveWallet(walletData.mnemonic);
          } else {
            newWallet = importWallet(walletData.privateKey);
          }
          break;
          
        case 'login':
          if (!password) {
            setError('Password is required');
            return;
          }
          
          const encryptedWallet = await storage.getItemAsync(SECURE_STORE_KEYS.ENCRYPTED_WALLET);
          if (!encryptedWallet) {
            setError('No wallet found. Please create or import a wallet.');
            return;
          }
          
          try {
            newWallet = decryptWallet(encryptedWallet, password);
          } catch (decryptError) {
            setError('Invalid password');
            return;
          }
          break;
          
        default:
          setError('Invalid action');
          return;
      }

      setWallet(newWallet);
      setIsLoggedIn(true);
      
      // Save wallet if creating or importing
      if ((walletAction === 'create' || walletAction === 'import') && saveWalletConsent) {
        await saveWallet(newWallet, walletData.password);
      }
      
      // Reset form
      setWalletData({ mnemonic: '', privateKey: '', password: '' });
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
      await storage.setItemAsync(SECURE_STORE_KEYS.ENCRYPTED_WALLET, encryptedWallet);
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
    } catch (err: any) {
      Alert.alert('Error', 'Failed to export wallet');
    }
  };

  const loadWallet = async () => {
    try {
      const encryptedWallet = await storage.getItemAsync(SECURE_STORE_KEYS.ENCRYPTED_WALLET);
      if (encryptedWallet) {
        // Wallet exists, user needs to login
        setWalletAction('login');
      }
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
              await storage.deleteItemAsync(SECURE_STORE_KEYS.ENCRYPTED_WALLET);
              handleLogout();
              setWalletAction('create');
            } catch (err) {
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

      if (!result.canceled && result.assets[0]) {
        await loginFromFile(result.assets[0].uri);
      }
    } catch (err: any) {
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
      
      let importedWallet;
      if (walletJson.mnemonic) {
        importedWallet = deriveWallet(walletJson.mnemonic);
      } else {
        importedWallet = importWallet(walletJson.privateKey);
      }
      
      setWallet(importedWallet);
      setIsLoggedIn(true);
      
    } catch (err: any) {
      Alert.alert('Error', 'Failed to import wallet from file');
    }
  };

  return {
    // State
    wallet,
    isLoggedIn,
    error,
    walletAction,
    walletData,
    password,
    confirmPassword,
    saveWalletConsent,
    
    // Setters
    setError,
    setWalletAction,
    setWalletData,
    setPassword,
    setConfirmPassword,
    setSaveWalletConsent,
    
    // Actions
    handleWalletAction,
    saveWallet,
    downloadWallet,
    loadWallet,
    handleLogout,
    handleClearWallet,
    pickAndLoginFromFile,
    loginFromFile
  };
};
