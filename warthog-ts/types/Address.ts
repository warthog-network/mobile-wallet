import type { ec } from "elliptic";
import pkg from "elliptic";
import { ethers } from "ethers";

const { ec: EC } = pkg;
const ecInstance = new EC("secp256k1");

export class Address {
    private privateKeyHex: string;
    private publicKeyHex: string;
    private addressHex: string;

    private constructor(privateKeyHex: string, publicKeyHex: string, addressHex: string) {
        this.privateKeyHex = privateKeyHex;
        this.publicKeyHex = publicKeyHex;
        this.addressHex = addressHex;
    }

    public static fromRandom(): Address {
        const keyPair = ecInstance.genKeyPair();
        return Address.fromKeyPair(keyPair);
    }

    public static fromPrivateKeyHex(hex: string): Address {
        const keyPair = ecInstance.keyFromPrivate(hex, "hex");
        return Address.fromKeyPair(keyPair);
    }

    private static fromKeyPair(keyPair: ec.KeyPair): Address {
        let privateKeyHex = keyPair.getPrivate().toString("hex");
        while (privateKeyHex.length < 64) {
            privateKeyHex = "0" + privateKeyHex;
        }

        const publicKeyHex = keyPair.getPublic().encodeCompressed("hex");

        const publicKeyBuffer = Buffer.from(publicKeyHex, "hex");
        const sha256Hex = ethers.sha256(publicKeyBuffer);
        const sha256Hash = Buffer.from(sha256Hex.slice(2), "hex");
        const ripemd160Hex = ethers.ripemd160(sha256Hash);
        const ripemd160Hash = Buffer.from(ripemd160Hex.slice(2), "hex");
        const checksumHex = ethers.sha256(ripemd160Hash);
        const checksum = Buffer.from(checksumHex.slice(2), "hex").slice(0, 4);
        const addressBuffer = Buffer.concat([ripemd160Hash, checksum]);
        const addressHex = addressBuffer.toString("hex");

        return new Address(privateKeyHex, publicKeyHex, addressHex);
    }

    public getPrivateKeyHex(): string {
        return this.privateKeyHex;
    }

    public getPublicKeyHex(): string {
        return this.publicKeyHex;
    }

    public getAddress(): string {
        return this.addressHex;
    }

    public static validate(address: string): boolean {
        if (address.length !== 48) {
            return false;
        }

        const addressBuffer = Buffer.from(address, "hex");
        if (addressBuffer.length !== 24) {
            return false;
        }

        const payload = addressBuffer.slice(0, 20);
        const checksum = addressBuffer.slice(20, 24);

        const expectedChecksumHex = ethers.sha256(payload);
        const expectedChecksum = Buffer.from(expectedChecksumHex.slice(2), "hex").slice(0, 4);

        return checksum.equals(expectedChecksum);
    }
}
