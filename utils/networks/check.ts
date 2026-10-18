/**
 * Derivation vectors. Run with: npx tsx utils/networks/check.ts
 * Not imported by the app.
 */
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { hex } from '@scure/base';
import { Transaction } from '@scure/btc-signer';
import { ethers } from 'ethers';
import { deriveEthAddress } from '../evmAddress';
import { buildSignedTx, tunnelMemo } from './btc';
import { chainAddresses, deriveChainKeys } from './derive';
import { slip10Derive } from './slip10';
import { associatedTokenAddress } from './solswap';
import { USDC_MINT, USDT_MINT } from './chains';

function assertEq(name: string, got: string, want: string): void {
  if (got.toLowerCase() !== want.toLowerCase()) {
    throw new Error(`${name}\n got ${got}\n want ${want}`);
  }
  console.log('ok', name);
}

const seed = ethers.getBytes('0x000102030405060708090a0b0c0d0e0f');
const digest = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
assertEq(
  'slip10 master',
  bytesToHex(digest.slice(0, 32)),
  '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7',
);
assertEq(
  "slip10 m/0'",
  bytesToHex(slip10Derive(seed, "m/0'")),
  '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
);
assertEq(
  'slip10 deep',
  bytesToHex(slip10Derive(seed, "m/0'/1'/2'/2'/1000000000'")),
  '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
);

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
assertEq('eth', deriveEthAddress(phrase), '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
const pub = chainAddresses(phrase);
assertEq('btc', pub.btcAddress, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
assertEq('sol', pub.solAddress, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
const memo = new TextDecoder().decode(tunnelMemo('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'));
assertEq('tunnel memo', memo, '9858EFFD232B4033E47D90003D41EC34ECAEDA94');
assertEq(
  'usdc ata',
  associatedTokenAddress(pub.solAddress, USDC_MINT),
  '5N3f1tj9v1vc5TUZ8S7mCAnVmjVKrfnzXWhxLaxyZAgt',
);
assertEq(
  'usdt ata',
  associatedTokenAddress(pub.solAddress, USDT_MINT),
  '6pXYguUixhfdydHDMgsvSy3sAWjStL2eEYh4KeYJAUDk',
);

const keys = deriveChainKeys(phrase);
const built = buildSignedTx({
  publicKey: keys.btcPublicKey,
  privateKey: keys.btcPrivateKey,
  utxos: [{ txid: '11'.repeat(32), vout: 0, value: 100_000 }],
  payTo: { address: '1QDhzsteETKuw1M5kWHEjzaAmHSGhpH8zr', amount: 50_000n },
  memo: tunnelMemo('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'),
  changeAddress: keys.btcAddress,
  feeRate: 2,
});
keys.btcPrivateKey.fill(0);
keys.solPrivateKey.fill(0);
const parsed = Transaction.fromRaw(hex.decode(built.hex), { allowUnknownOutputs: true }) as unknown as {
  outputs: { script?: Uint8Array; amount?: bigint }[];
};
const opReturn = parsed.outputs[1]?.script;
if (built.outputIndex !== 0 || !opReturn || opReturn[0] !== 0x6a || opReturn[1] !== 40) {
  throw new Error(`tunnel output ${built.outputIndex} script ${opReturn ? hex.encode(opReturn) : 'missing'}`);
}
assertEq('op_return', new TextDecoder().decode(opReturn.subarray(2)), '9858EFFD232B4033E47D90003D41EC34ECAEDA94');
if (parsed.outputs[0]?.amount !== 50_000n) throw new Error('payment is not output 0');
console.log('ok tunnel payment');
