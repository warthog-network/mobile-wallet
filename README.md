# Warthog Wallet

<info-msg>
It is currently 2026-02-16 17:14:00

Current tasks and notes:
- [x] Explain block counter computation details
- [x] Fix scrolling issue in TransactionHistory (nested ScrollView problem)
- [ ] Prepare for App Store submission (build, test, configure)

</info-msg>

A non-custodial cryptocurrency wallet for the Warthog blockchain, built with React Native and Expo. This app allows users to create, import, and manage Warthog wallets, view balances, send transactions, and track mining rewards—all while keeping private keys secure on-device.

## Features

- **Wallet Management**: Create new wallets, derive from seed phrases, or import private keys.
- **Secure Storage**: Private keys and mnemonics are encrypted and stored locally using Expo SecureStore.
- **Transaction Handling**: Send WART tokens with automatic nonce management and fee calculation.
- **Transaction History**: View paginated history with block rewards, timestamps, and copy-to-clipboard functionality.
- **Block Mining Stats**: Display mining rewards for 24h, week, and month periods.
- **Node Switching**: Switch between main and backup Warthog nodes for reliability.
- **Offline Signing**: All transactions are signed locally; no data is sent to external servers.
- **Cross-Platform**: Runs on iOS and Android via Expo.

## Technologies Used

- **React Native**: Framework for building native mobile apps.
- **Expo**: Platform for React Native development, building, and deployment.
- **ethers.js**: Ethereum-compatible library for wallet and transaction handling (adapted for Warthog).
- **axios**: HTTP client for API calls to blockchain nodes.
- **expo-secure-store**: Secure local storage for sensitive data.
- **expo-clipboard**: For copying addresses and transaction IDs.
- **@noble/secp256k1**: Elliptic curve cryptography for signing.

## Installation

1. **Prerequisites**:
   - Node.js (v14 or later)
   - npm or yarn
   - Expo CLI: `npm install -g @expo/cli`
   - For iOS: Xcode (macOS) and iOS Simulator
   - For Android: Android Studio and Emulator

2. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-username/warthog-wallet.git
   cd warthog-wallet
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   # or
   yarn install
   ```

4. **Configure Environment** (if needed):
   - Update `app.json` with your app details (name, version, icons).
   - Ensure Warthog node URLs are correct in `Wallet.tsx` (default: `https://warthognode.duckdns.org` and `http://217.182.64.43:3001`).

## Running the App

1. **Start the Development Server**:
   ```bash
   npx expo start -c
   ```
   - The `-c` flag clears the cache for a fresh start.
   - This opens the Expo DevTools in your browser.

2. **Run on Device/Emulator**:
   - **iOS**: Press `i` in the terminal or scan the QR code with the Expo Go app on your iPhone.
   - **Android**: Press `a` or scan the QR code with Expo Go on Android.
   - For physical devices, ensure they're on the same Wi-Fi network as your computer.

3. **Build for Production**:
   - For testing: `expo build:ios` or `expo build:android`.
   - For App Store submission: Use EAS Build (`eas build --platform ios`).

## Usage

- **Create Wallet**: Generate a new mnemonic and private key.
- **Import Wallet**: Enter an existing private key or seed phrase.
- **View Balance**: Displays WART balance and USD equivalent (fetched from CoinGecko).
- **Send Transactions**: Enter recipient address, amount, and fee; nonce is managed automatically.
- **Transaction History**: Toggle visibility, refresh, and load more transactions.
- **Node Selection**: Switch nodes for network reliability.

## Privacy and Security

This is a **non-custodial wallet**—you control your keys and funds. Seed phrases and private keys stay on the device. The same notice is in the app under Wallet Options → Privacy. Google Play still needs that text hosted at a public https URL before the listing can be submitted.

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature-name`.
3. Commit changes: `git commit -m 'Add feature'`.
4. Push and open a PR.

## License

This project is licensed under the MIT License. See `LICENSE` for details.

## Support

For issues or questions, open an issue on GitHub or contact support@warthogwallet.com.

---

**Note**: This app is for educational and personal use. Always verify transactions on the blockchain. For production deployment, ensure compliance with app store policies.
