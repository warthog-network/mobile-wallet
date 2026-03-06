import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { Button } from './Button';
import { Input } from './Input';
import { Card } from './Card';
import { theme } from '../theme';
import { WalletAction } from '../types';

interface WalletLoginProps {
  walletAction: WalletAction;
  setWalletAction: (action: WalletAction) => void;
  walletData: {
    mnemonic: string;
    privateKey: string;
    password: string;
  };
  setWalletData: (data: any) => void;
  password: string;
  setPassword: (password: string) => void;
  confirmPassword: string;
  setConfirmPassword: (password: string) => void;
  saveWalletConsent: boolean;
  setSaveWalletConsent: (consent: boolean) => void;
  error: string;
  onSubmit: () => void;
  onPickFile: () => void;
  loading?: boolean;
}

export const WalletLogin: React.FC<WalletLoginProps> = ({
  walletAction,
  setWalletAction,
  walletData,
  setWalletData,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  saveWalletConsent,
  setSaveWalletConsent,
  error,
  onSubmit,
  onPickFile,
  loading = false
}) => {
  const renderActionButtons = () => (
    <View style={styles.actionButtons}>
      <Button
        title="Login"
        variant={walletAction === 'login' ? 'primary' : 'ghost'}
        onPress={() => setWalletAction('login')}
        size="small"
      />
      <Button
        title="Create"
        variant={walletAction === 'create' ? 'primary' : 'ghost'}
        onPress={() => setWalletAction('create')}
        size="small"
      />
      <Button
        title="Import"
        variant={walletAction === 'import' ? 'primary' : 'ghost'}
        onPress={() => setWalletAction('import')}
        size="small"
      />
    </View>
  );

  const renderLoginForm = () => (
    <>
      <Input
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholder="Enter your wallet password"
      />
      <View style={styles.fileButtonContainer}>
        <Button
          title="Login from File"
          variant="outline"
          onPress={onPickFile}
          fullWidth
        />
      </View>
    </>
  );

  const renderCreateForm = () => (
    <>
      <Input
        label="Password"
        value={walletData.password}
        onChangeText={(text) => setWalletData({ ...walletData, password: text })}
        secureTextEntry
        autoCapitalize="none"
        placeholder="Choose a strong password"
      />
      <Input
        label="Confirm Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholder="Confirm your password"
      />
      <View style={styles.consentContainer}>
        <Switch
          value={saveWalletConsent}
          onValueChange={setSaveWalletConsent}
          trackColor={{ false: theme.colors.surface, true: theme.colors.primary }}
          thumbColor={saveWalletConsent ? theme.colors.background : theme.colors.textSecondary}
        />
        <Text style={styles.consentText}>
          Save wallet securely on this device
        </Text>
      </View>
    </>
  );

  const renderImportForm = () => (
    <>
      <Input
        label="Mnemonic Phrase (optional)"
        value={walletData.mnemonic}
        onChangeText={(text) => setWalletData({ ...walletData, mnemonic: text })}
        multiline
        numberOfLines={3}
        autoCapitalize="none"
        placeholder="Enter your 12-word mnemonic phrase"
      />
      <Input
        label="Private Key (optional)"
        value={walletData.privateKey}
        onChangeText={(text) => setWalletData({ ...walletData, privateKey: text })}
        autoCapitalize="none"
        placeholder="Enter your private key"
      />
      <Input
        label="Password"
        value={walletData.password}
        onChangeText={(text) => setWalletData({ ...walletData, password: text })}
        secureTextEntry
        autoCapitalize="none"
        placeholder="Choose a strong password"
      />
      <Input
        label="Confirm Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholder="Confirm your password"
      />
      <View style={styles.consentContainer}>
        <Switch
          value={saveWalletConsent}
          onValueChange={setSaveWalletConsent}
          trackColor={{ false: theme.colors.surface, true: theme.colors.primary }}
          thumbColor={saveWalletConsent ? theme.colors.background : theme.colors.textSecondary}
        />
        <Text style={styles.consentText}>
          Save wallet securely on this device
        </Text>
      </View>
    </>
  );

  const getSubmitButtonText = () => {
    switch (walletAction) {
      case 'login': return 'Login';
      case 'create': return 'Create Wallet';
      case 'import': return 'Import Wallet';
      default: return 'Submit';
    }
  };

  return (
    <Card variant="glass" style={styles.container}>
      <Text style={styles.title}>Warthog Wallet</Text>
      
      {renderActionButtons()}
      
      <View style={styles.formContainer}>
        {walletAction === 'login' && renderLoginForm()}
        {walletAction === 'create' && renderCreateForm()}
        {walletAction === 'import' && renderImportForm()}
        
        {error ? <Text style={styles.error}>{error}</Text> : null}
        
        <Button
          title={getSubmitButtonText()}
          onPress={onSubmit}
          loading={loading}
          fullWidth
          style={styles.submitButton}
        />
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.lg,
    margin: theme.spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.primary,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
    textShadowColor: theme.colors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  formContainer: {
    gap: theme.spacing.md,
  },
  fileButtonContainer: {
    marginTop: theme.spacing.sm,
  },
  consentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  consentText: {
    flex: 1,
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  error: {
    color: theme.colors.error,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
  },
  submitButton: {
    marginTop: theme.spacing.md,
  },
});
