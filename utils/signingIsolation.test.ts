/**
 * Signing isolation. Run with: npx tsx --test utils/signingIsolation.test.ts
 * The phrase is a public BIP39 test vector. Do not use it for funds.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { base58, hex } from '@scure/base';
import { Transaction } from '@scure/btc-signer';
import { ed25519 } from '@noble/curves/ed25519';
import { ethers } from 'ethers';
import {
  Account,
  Address,
  ChainPin,
  Funds,
  Liquidity,
  NonceId,
  Price,
  RoundedFee,
  TokenDecimals,
  Wart,
  WarthogDeFiTransactionContext,
  WarthogLegacyTransactionContext,
} from 'warthog-ts';
import { deriveEthAddress } from './evmAddress';
import { planBtcPsbt, tunnelMemo } from './networks/btc';
import { deriveChainKeys } from './networks/derive';
import { publicChains, signBitcoinPhrase, signEthereumPhrase, signSolanaPhrase } from './phraseSign';
import {
  chainPublic,
  clearSessionKeys,
  exportWallet,
  getSessionAccountIndex,
  getSessionMnemonic,
  getSessionPrivateKey,
  setChainSession,
  setSessionKeys,
  signPreparedWarthog,
} from './sessionVault';
import { signWarthogTx, type WarthogSignRequest } from './warthogSign';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function must<T>(value: T | null, label: string): T {
  if (value == null) throw new Error(label);
  return value;
}

function canon(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

function wartKey(index: number): { privateKey: string; address: string } {
  const hd = ethers.HDNodeWallet.fromPhrase(phrase, '', `m/44'/2070'/0'/0/${index}`);
  const privateKey = hd.privateKey.slice(2);
  return { privateKey, address: Account.fromPrivateKeyHex(privateKey).address.hex };
}

describe('chain signatures from a phrase', () => {
  test('public addresses follow the account index', () => {
    const pubs = publicChains(phrase, 2);
    const keys = deriveChainKeys(phrase, 2);
    try {
      assert.equal(pubs.ethAddress, deriveEthAddress(phrase, 2));
      assert.equal(pubs.btcAddress, keys.btcAddress);
      assert.equal(pubs.solAddress, keys.solAddress);
      assert.equal(pubs.btcPublicKey, ethers.hexlify(keys.btcPublicKey));
      assert.deepEqual(Object.keys(pubs).sort(), ['btcAddress', 'btcPublicKey', 'ethAddress', 'solAddress']);
    } finally {
      keys.btcPrivateKey.fill(0);
      keys.solPrivateKey.fill(0);
    }
  });

  test('account zero keeps the original Ethereum address', () => {
    assert.equal(publicChains(phrase, 0).ethAddress, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  });

  test('an ethereum signature recovers the requested account', () => {
    const unsigned = ethers.Transaction.from({
      type: 2,
      chainId: 1,
      nonce: 3,
      maxFeePerGas: 20n,
      maxPriorityFeePerGas: 1n,
      gasLimit: 21_000n,
      to: '0x0000000000000000000000000000000000000001',
      value: 5n,
    });
    unsigned.signature = signEthereumPhrase(phrase, 1, unsigned.unsignedSerialized);
    assert.equal(unsigned.from, deriveEthAddress(phrase, 1));
  });

  test('a solana signature verifies for that account', () => {
    const message = new TextEncoder().encode('warthog');
    const signature = signSolanaPhrase(phrase, 4, message);
    const owner = base58.decode(publicChains(phrase, 4).solAddress);
    assert.equal(ed25519.verify(signature, message, owner), true);
  });

  test('a bitcoin spend signs without putting the private key in the transaction', () => {
    const keys = deriveChainKeys(phrase, 0);
    const other = deriveChainKeys(phrase, 1);
    try {
      const secret = ethers.hexlify(keys.btcPrivateKey).slice(2).toLowerCase();
      const planned = planBtcPsbt({
        publicKey: keys.btcPublicKey,
        utxos: [{ txid: '11'.repeat(32), vout: 1, value: 100_000 }],
        payTo: { address: other.btcAddress, amount: 20_000n },
        changeAddress: keys.btcAddress,
        feeRate: 2,
        memo: tunnelMemo('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'),
      });
      const signed = signBitcoinPhrase(phrase, 0, planned.psbt);
      assert.match(signed.txid, /^[0-9a-f]{64}$/);
      assert.equal(signed.hex.toLowerCase().includes(secret), false);
      const tx = Transaction.fromRaw(hex.decode(signed.hex), { allowUnknownOutputs: true });
      assert.equal(tx.inputsLength, 1);
      assert.equal(tx.outputsLength > 1, true);
      assert.equal(tx.id, signed.txid);
    } finally {
      keys.btcPrivateKey.fill(0);
      keys.solPrivateKey.fill(0);
      other.btcPrivateKey.fill(0);
      other.solPrivateKey.fill(0);
    }
  });
});

describe('warthog signatures stay off the page', () => {
  const material = wartKey(0);
  const other = wartKey(1);
  const account = Account.fromPrivateKeyHex(material.privateKey);
  const to = must(Address.fromHex(other.address), 'recipient');
  const pin = new ChainPin('11'.repeat(32), 32);
  const fee = must(RoundedFee.fromE8(1_000_000n, false), 'fee');
  const nonce = must(NonceId.fromNumber(7), 'nonce');
  const legacy = new WarthogLegacyTransactionContext(pin, fee, nonce);
  const defi = new WarthogDeFiTransactionContext(pin, fee, nonce);
  const asset = 'ab'.repeat(32);
  const base = {
    pinHash: pin.pinHash,
    pinHeight: pin.pinHeight,
    nonceId: nonce.value,
    feeE8: fee.E8.toString(),
  };

  function expectSame(request: WarthogSignRequest, library: object) {
    const signed = signWarthogTx(material.privateKey, request, material.address);
    const encoded = canon(signed);
    assert.equal(encoded, canon(library));
    assert.equal(encoded.toLowerCase().includes(material.privateKey.toLowerCase()), false);
  }

  test('a legacy WART transfer matches the library', () => {
    const wart = must(Wart.parse('1.5'), 'wart');
    expectSame(
      { ...base, family: 'legacy', op: 'wartTransfer', toAddr: to.hex, amountE8: wart.E8.toString() },
      legacy.transferWart(account, to, wart),
    );
  });

  test('a DeFi WART transfer matches the library', () => {
    const wart = must(Wart.parse('2'), 'wart');
    expectSame(
      { ...base, family: 'defi', op: 'wartTransfer', toAddr: to.hex, amountE8: wart.E8.toString() },
      defi.transferWart(account, to, wart),
    );
  });

  test('a token transfer matches the library', () => {
    const funds = must(Funds.parse('3.5', new TokenDecimals(8)), 'funds');
    expectSame(
      {
        ...base,
        family: 'defi',
        op: 'tokenTransfer',
        assetHash: asset,
        isLiquidity: false,
        toAddr: to.hex,
        amountU64: funds.amount.toString(),
      },
      defi.transferAsset(account, asset, to, funds),
    );
  });

  test('a ceil-rounded fee is signed at that exact amount', () => {
    const ceilFee = must(Wart.parse('0.015'), 'fee wart').roundedFee(true);
    const amount = must(Wart.parse('1'), 'wart');
    const ctx = new WarthogLegacyTransactionContext(pin, ceilFee, nonce);
    expectSame(
      {
        ...base,
        family: 'legacy',
        feeE8: ceilFee.E8.toString(),
        op: 'wartTransfer',
        toAddr: to.hex,
        amountE8: amount.E8.toString(),
      },
      ctx.transferWart(account, to, amount),
    );
  });

  test('the wrong account is refused', () => {
    const wart = must(Wart.parse('1'), 'wart');
    assert.throws(
      () => signWarthogTx(
        material.privateKey,
        { ...base, family: 'legacy', op: 'wartTransfer', toAddr: to.hex, amountE8: wart.E8.toString() },
        other.address,
      ),
      /The active account changed\. Review the transaction again\./,
    );
  });

  test('a token transfer on a legacy node is refused', () => {
    assert.throws(
      () => signWarthogTx(material.privateKey, {
        ...base,
        family: 'legacy',
        op: 'tokenTransfer',
        assetHash: asset,
        isLiquidity: false,
        toAddr: to.hex,
        amountU64: '1',
      }),
      /This transaction needs a DeFi node/,
    );
  });

  test('the session stores the key and returns only a signature', async () => {
    clearSessionKeys();
    setSessionKeys({
      privateKey: material.privateKey,
      publicKey: account.publicKeyHex,
      address: material.address,
      mnemonic: phrase,
    });
    try {
      assert.equal(getSessionMnemonic(), '');
      assert.equal(getSessionPrivateKey(), '');
      const exported = exportWallet();
      assert.equal(exported.mnemonic, phrase);
      assert.equal(exported.privateKey, material.privateKey);
      assert.equal(chainPublic(0)?.ethAddress, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
      const wart = must(Wart.parse('1'), 'wart');
      const signed = await signPreparedWarthog(legacy, {
        op: 'wartTransfer',
        toAddr: to.hex,
        amountE8: wart.E8.toString(),
      }, material.address);
      assert.equal(canon(signed).toLowerCase().includes(material.privateKey.toLowerCase()), false);
      assert.equal('signature65' in signed, true);
    } finally {
      clearSessionKeys();
    }
  });

  test('the session keeps an account index and not the phrase', () => {
    setChainSession(phrase, 3);
    assert.equal(getSessionMnemonic(), '');
    assert.equal(getSessionAccountIndex(), 3);
    setChainSession(null);
    assert.equal(getSessionMnemonic(), '');
    assert.equal(getSessionAccountIndex(), 0);
  });

  test('a locked session cannot sign', () => {
    clearSessionKeys();
    assert.throws(() => exportWallet(), /Wallet is locked — unlock to sign/);
    assert.equal(chainPublic(), null);
  });
});
