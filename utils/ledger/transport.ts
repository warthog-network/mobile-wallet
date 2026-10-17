/**
 * Ledger link. Chrome uses WebHID, the same packet layout as the browser
 * wallet. Android claims the Nano over USB and moves those same 64-byte
 * frames. Report id 0 is not on the wire.
 */
import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { bytesToHex, hexToBytes, LedgerError, type LedgerIo } from './protocol';

const VENDOR_ID = 0x2c97;

interface HidCollection {
  usagePage?: number;
}

interface HidInputReportEvent extends Event {
  readonly data: DataView;
}

interface HidDevice {
  opened: boolean;
  vendorId: number;
  collections?: HidCollection[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: HidInputReportEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: HidInputReportEvent) => void): void;
}

interface Hid {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: { filters: Array<{ vendorId?: number }> }): Promise<HidDevice[]>;
}

function webHid(): Hid | undefined {
  if (Platform.OS !== 'web') return undefined;
  const nav = globalThis.navigator as Navigator & { hid?: Hid };
  return nav?.hid;
}

function isWarthogInterface(device: HidDevice): boolean {
  return device.collections?.some((collection) => collection.usagePage === 0xffa0) ?? false;
}

function pickDevice(devices: HidDevice[]): HidDevice | undefined {
  return devices.find(isWarthogInterface) ?? devices.find((device) => device.vendorId === VENDOR_ID);
}

async function requestWebDevice(): Promise<HidDevice> {
  const hid = webHid();
  if (!hid) {
    throw new LedgerError('Chrome is required to talk to a Ledger');
  }
  const already = pickDevice(await hid.getDevices());
  if (already) return already;
  const devices = await hid.requestDevice({ filters: [{ vendorId: VENDOR_ID }] });
  const device = pickDevice(devices) ?? devices[0];
  if (!device) {
    throw new LedgerError(
      'Choose the Nano S+ in the browser device list, then click Connect. If that list is hidden, look behind this window.',
    );
  }
  return device;
}

function webIo(device: HidDevice): LedgerIo {
  return {
    async write(packet: Uint8Array) {
      if (!device.opened) await device.open();
      await device.sendReport(0, packet);
    },
    read(timeoutMs: number) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          device.removeEventListener('inputreport', onReport);
          reject(new LedgerError('Ledger timed out. Unlock the Nano and approve the prompt.'));
        }, timeoutMs);
        const onReport = (event: HidInputReportEvent) => {
          clearTimeout(timer);
          device.removeEventListener('inputreport', onReport);
          resolve(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
        };
        device.addEventListener('inputreport', onReport);
      });
    },
    async close() {
      try {
        await device.close();
      } catch {
        /* the browser may already have dropped the handle */
      }
    },
  };
}

type LedgerUsbNative = {
  write(hex: string): Promise<void>;
  read(timeoutMs: number): Promise<string>;
  close(): Promise<void>;
};

function androidUsb(): LedgerUsbNative {
  try {
    return requireNativeModule<LedgerUsbNative>('LedgerUsb');
  } catch {
    throw new LedgerError('This install does not include Ledger USB. Rebuild the Android app.');
  }
}

function androidIo(): LedgerIo {
  const usb = androidUsb();
  return {
    async write(packet: Uint8Array) {
      await usb.write(bytesToHex(packet));
    },
    async read(timeoutMs: number) {
      const hex = await usb.read(timeoutMs);
      return hexToBytes(hex);
    },
    async close() {
      try {
        await usb.close();
      } catch {
        /* already closed */
      }
    },
  };
}

export function ledgerTransportAvailable(): boolean {
  if (Platform.OS === 'android') return true;
  if (Platform.OS === 'web') return Boolean(webHid());
  return false;
}

export function ledgerConnectHint(): string {
  if (Platform.OS === 'android') {
    return 'Unlock the Nano and open the Warthog app. Plug in the Nano S+ with a USB cable. Allow USB access when Android asks, then approve the address on the device.';
  }
  if (Platform.OS === 'web' && webHid()) {
    return 'Unlock the Nano and open the Warthog app. Chrome lists the Nano S+. Choose it and click Connect. Approve the address on the device.';
  }
  if (Platform.OS === 'web') {
    return 'Chrome is required to talk to a Ledger. Unlock the Nano and open the Warthog app.';
  }
  return 'Ledger USB is available on Android, or in Chrome on a computer.';
}

export async function openLedgerIo(): Promise<LedgerIo> {
  if (Platform.OS === 'android') return androidIo();
  if (Platform.OS === 'web') return webIo(await requestWebDevice());
  throw new LedgerError('Ledger USB is available on Android, or in Chrome on a computer.');
}
