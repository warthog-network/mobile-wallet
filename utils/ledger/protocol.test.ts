import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import { NETWORK, Transaction, p2wpkh } from '@scure/btc-signer';
import { ethers } from 'ethers';
import {
  BTC_ADDRESS_PATH,
  MerkleTree,
  bitcoinAddressCommand,
  bitcoinExtendedKeyCommand,
  bitcoinFingerprintCommand,
  bitcoinSignCommand,
  elementHash,
  nativeSegwitPolicy,
  parsePsbtMaps,
  parseYieldedSignature,
} from './bitcoinProtocol';
import {
  apdu,
  encodePath,
  ethAccountPath,
  ethPublicKeyCommand,
  ethSignCommands,
  ethYParity,
  ledgerPath,
  ledgerWartSubmitJson,
  parseEthPublicKey,
  solAccountPath,
  solPublicKeyCommand,
  solSignCommands,
  statusMessage,
  wartAddressFromUncompressed,
  wartTransferBytes,
} from './protocol';

const pin = '11'.repeat(32);
const to = 'ab'.repeat(24);

const transfer = wartTransferBytes({
  pinHash: pin,
  pinHeight: 0x01020304,
  nonceId: 7,
  feeE8: 1000n,
  toAddress: to,
  amountE8: 50n,
});
assert.equal(transfer.length, 79);
assert.equal(ethers.hexlify(transfer.subarray(0, 32)).slice(2), pin);
assert.equal(transfer[32], 0x01);
assert.equal(transfer[35], 0x04);
assert.equal(transfer[39], 7);
assert.equal(transfer[40], 0);
assert.equal(transfer[41], 0);
assert.equal(transfer[42], 0);
assert.equal(transfer[51], 0xab);
assert.equal(transfer[78], 50);

// BIP44 components above 2^31 are signed in JS. setUint32 writes the Nano's uint32 bits.
assert.equal(Buffer.from(encodePath(ledgerPath('hardened', 0))).toString('hex'), '058000002c80000816800000000000000000000000');
assert.equal(Buffer.from(encodePath(ledgerPath('normal', 3))).toString('hex'), '058000002c80000816000000000000000000000003');

const command = apdu(0x05, 0x01, 0x00, new Uint8Array([9]));
assert.deepEqual(Array.from(command), [0xe0, 0x05, 0x01, 0x00, 1, 9]);

const key = new Uint8Array(65);
key[0] = 0x04;
key.fill(2, 1, 33);
key[64] = 1;
const address = wartAddressFromUncompressed(key);
assert.equal(address.length, 48);
const raw = ethers.getBytes('0x' + address);
const checksum = ethers.getBytes(ethers.sha256(raw.subarray(0, 20))).subarray(0, 4);
assert.deepEqual(Array.from(raw.subarray(20)), Array.from(checksum));
assert.throws(() => wartAddressFromUncompressed(new Uint8Array(64)));

const signed = {
  type: 'wartTransfer',
  pinHeight: 4,
  nonceId: 1,
  feeE8: 10n,
  toAddr: to,
  wartE8: 20n,
  amountE8: 20n,
  signature65: 'aa'.repeat(65),
};
const mainnet = ledgerWartSubmitJson(signed, 'https://warthognode.duckdns.org');
assert.equal(mainnet.amountE8, 20);
assert.equal('wartE8' in mainnet, false);
assert.equal('type' in mainnet, false);
const defi = ledgerWartSubmitJson(signed, 'https://warthog-defitestnet.duckdns.org');
assert.equal(defi.type, 'wartTransfer');
assert.equal(defi.wartE8, 20);
assert.equal('amountE8' in defi, false);

assert.equal(
  Buffer.from(encodePath(ethAccountPath())).toString('hex'),
  '058000002c8000003c800000000000000000000000',
);
const ethCommand = ethPublicKeyCommand();
assert.equal(ethCommand[1], 0x02);
assert.equal(ethCommand[2], 0x01);
assert.equal(Buffer.from(ethCommand.subarray(5)).toString('hex'), '058000002c8000003c800000000000000000000000');

const ethWallet = new ethers.Wallet(`0x${'11'.repeat(32)}`);
const pub = ethers.getBytes(ethWallet.signingKey.publicKey);
const ascii = new TextEncoder().encode(ethWallet.address.slice(2).toLowerCase());
const payload = new Uint8Array(67 + ascii.length);
payload[0] = 65;
payload.set(pub, 1);
payload[66] = ascii.length;
payload.set(ascii, 67);
assert.equal(parseEthPublicKey(payload), ethWallet.address);
payload[67] = payload[67] === 0x30 ? 0x31 : 0x30;
assert.throws(() => parseEthPublicKey(payload));

assert.equal(ethYParity(0), 0);
assert.equal(ethYParity(28), 1);
assert.equal(ethYParity(37), 0);
const shortTx = new Uint8Array(40);
shortTx[0] = 0x02;
const one = ethSignCommands(shortTx);
assert.equal(one.length, 1);
assert.equal(one[0][1], 0x04);
assert.equal(one[0][2], 0x00);
assert.equal(Buffer.from(one[0].subarray(5, 26)).toString('hex'), '058000002c8000003c800000000000000000000000');
const longTx = new Uint8Array(130);
longTx[0] = 0x02;
const two = ethSignCommands(longTx);
assert.equal(two.length, 2);
assert.equal(two[1][2], 0x80);
assert.equal(two[0].length, 5 + 150);
assert.equal(two[1].length, 5 + 1);
const sample = ethers.Transaction.from({
  type: 2,
  chainId: 1,
  nonce: 3,
  maxPriorityFeePerGas: 1_000_000_000n,
  maxFeePerGas: 20_000_000_000n,
  gasLimit: 21_000n,
  to: ethWallet.address,
  value: 1n,
  data: '0x',
});
assert.equal(sample.unsignedSerialized.startsWith('0x02'), true);
const wrapped = ethSignCommands(ethers.getBytes(sample.unsignedSerialized));
assert.equal(wrapped.length, 1);
assert.equal(wrapped[0][2], 0x00);

assert.equal(
  Buffer.from(encodePath(solAccountPath())).toString('hex'),
  '048000002c800001f58000000080000000',
);
const solGet = solPublicKeyCommand();
assert.equal(solGet[0], 0xe0);
assert.equal(solGet[1], 0x05);
assert.equal(solGet[2], 0x01);
assert.equal(Buffer.from(solGet.subarray(5)).toString('hex'), '048000002c800001f58000000080000000');

const solSmall = solSignCommands(new Uint8Array(10));
assert.equal(solSmall.length, 1);
assert.equal(solSmall[0][1], 0x06);
assert.equal(solSmall[0][2], 0x01);
assert.equal(solSmall[0][3], 0x00);
assert.equal(solSmall[0][5], 1);

const solEdge = solSignCommands(new Uint8Array(237));
assert.equal(solEdge.length, 1);
assert.equal(solEdge[0][3], 0x00);
assert.equal(solEdge[0][4], 255);

const solOver = solSignCommands(new Uint8Array(238));
assert.equal(solOver.length, 2);
assert.equal(solOver[0][3], 0x02);
assert.equal(solOver[0][4], 255);
assert.equal(solOver[1][3], 0x01);
assert.equal(solOver[1][4], 1);

const solThree = solSignCommands(new Uint8Array(493));
assert.equal(solThree.length, 3);
assert.equal(solThree[0][3], 0x02);
assert.equal(solThree[1][3], 0x03);
assert.equal(solThree[2][3], 0x01);
assert.throws(() => solSignCommands(new Uint8Array(0)));
assert.throws(() => solSignCommands(new Uint8Array(1233)));
assert.match(statusMessage(0x6808, 'solana'), /Blind signing/);
assert.match(statusMessage(0x6e00, 'bitcoin'), /Bitcoin app/);
assert.match(statusMessage(0x6a80, 'bitcoin'), /refused/);

assert.equal(Buffer.from(new MerkleTree([]).root).toString('hex'), '00'.repeat(32));
assert.equal(
  Buffer.from(elementHash(new TextEncoder().encode('wpkh(@0/**)'))).toString('hex'),
  '4a3cecc70f9e950a6aa0972d01fda84996d39bc50825e0ab7cab9d2d33889b7d',
);
const left = elementHash(Uint8Array.of(1));
const right = elementHash(Uint8Array.of(2));
const pair = new Uint8Array(65);
pair[0] = 0x01;
pair.set(left, 1);
pair.set(right, 33);
assert.equal(
  Buffer.from(new MerkleTree([left, right]).root).toString('hex'),
  ethers.sha256(pair).slice(2),
);

assert.equal(
  Buffer.from(bitcoinExtendedKeyCommand("m/84'/0'/0'")).toString('hex'),
  'e10000010e0003800000548000000080000000',
);
assert.equal(Buffer.from(bitcoinFingerprintCommand()).toString('hex'), 'e105000100');

const policy = nativeSegwitPolicy('aabbccdd', 'xpub6Example');
assert.equal(
  Buffer.from(policy.serialized).toString('hex'),
  '02000bc8974a0d8bdd29024b2ddb7a7fe8df1d9801b270f4e6c1e7e1011ae39e7c9b00016e30bfe307cd16cba47985ccc2a51a625a4a5d79612ce06bce1a45793d4e70d8',
);
assert.equal(
  Buffer.from(policy.id).toString('hex'),
  'e8593d2d488f865000bfd22a420675f052260891e384343465489901c2466102',
);
const addressCommand = bitcoinAddressCommand(policy, true);
assert.equal(addressCommand[0], 0xe1);
assert.equal(addressCommand[1], 0x03);
assert.equal(addressCommand[3], 0x01);
assert.equal(addressCommand[4], 70);
assert.equal(
  Buffer.from(addressCommand.subarray(5)).toString('hex'),
  `01${Buffer.from(policy.id).toString('hex')}${'00'.repeat(32)}0000000000`,
);

const secret = new Uint8Array(32);
secret[31] = 1;
const compressed = secp256k1.getPublicKey(secret, true);
const payment = p2wpkh(compressed, NETWORK);
const tx = new Transaction();
tx.addInput({
  txid: hex.decode('11'.repeat(32)),
  index: 0,
  witnessUtxo: { script: payment.script, amount: 50_000n },
  bip32Derivation: [[compressed, { fingerprint: 0xaabbccdd, path: BTC_ADDRESS_PATH }]],
});
if (!payment.address) throw new Error('missing address');
tx.addOutputAddress(payment.address, 40_000n, NETWORK);
const maps = parsePsbtMaps(tx.toPSBT(2));
assert.equal(maps.inputMaps.length, 1);
assert.equal(maps.outputMaps.length, 1);
const derivation = [...maps.inputMaps[0].entries()].find(([key]) => key.startsWith('06'));
if (!derivation) throw new Error('missing derivation');
assert.equal(derivation[0].slice(2), Buffer.from(compressed).toString('hex'));
assert.equal(
  Buffer.from(derivation[1].value).toString('hex'),
  'aabbccdd5400008000000080000000800000000000000000',
);
const signedCommand = bitcoinSignCommand(maps.globalMap, maps.inputMaps, maps.outputMaps, policy);
assert.equal(signedCommand[0], 0xe1);
assert.equal(signedCommand[1], 0x04);
assert.equal(signedCommand[3], 0x01);
assert.ok(signedCommand[4] <= 255);
assert.ok(Buffer.from(signedCommand).toString('hex').includes(Buffer.from(policy.id).toString('hex')));

const sized = tx.clone();
const dummy = new Uint8Array(73);
dummy[0] = 0x30;
sized.updateInput(0, { partialSig: [[compressed, dummy]] }, true);
sized.finalize();
assert.ok(sized.vsize > 100);

const yieldedPub = new Uint8Array(33);
yieldedPub[0] = 0x02;
const yielded = parseYieldedSignature(Uint8Array.of(0, 33, ...yieldedPub, 0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x01));
assert.equal(yielded.inputIndex, 0);
assert.equal(yielded.publicKey.length, 33);
assert.equal(yielded.signature[yielded.signature.length - 1], 0x01);
assert.throws(() => parseYieldedSignature(Uint8Array.of(0xfe, 0x00, 0x00, 0x00, 0x80, 33)));
assert.throws(() => parseYieldedSignature(Uint8Array.of(0, 32, ...new Uint8Array(32))));

console.log('ledger protocol ok');
