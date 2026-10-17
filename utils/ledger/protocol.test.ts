import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  apdu,
  encodePath,
  ledgerPath,
  ledgerWartSubmitJson,
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

console.log('ledger protocol ok');
