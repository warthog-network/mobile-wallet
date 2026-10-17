package expo.modules.ledgerusb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

private const val VENDOR_ID = 0x2c97
private const val USAGE_PAGE = 0xffa0
private const val ACTION_USB_PERMISSION = "org.warthog.wallet.LEDGER_USB"

class LedgerUsbException(message: String) : CodedException(message)

/**
 * Raw USB frames for a Nano S+. Each frame is 64 bytes. Report id 0 is not
 * written: WebHID omits it, and this path talks to the endpoint directly.
 */
class LedgerUsbModule : Module() {
  private val gate = Mutex()
  private var connection: UsbDeviceConnection? = null
  private var claimed: UsbInterface? = null
  private var endpointIn: UsbEndpoint? = null
  private var endpointOut: UsbEndpoint? = null

  private val appContextAndroid: Context
    get() = appContext.reactContext ?: throw LedgerUsbException("The wallet is not ready to use USB.")

  override fun definition() = ModuleDefinition {
    Name("LedgerUsb")

    AsyncFunction("write") Coroutine { hex: String ->
      withContext(Dispatchers.IO) {
        gate.withLock {
          ensureOpen()
          val packet = hexToBytes(hex)
          if (packet.size != 64) {
            throw LedgerUsbException("Ledger packet must be 64 bytes")
          }
          transferOut(packet)
        }
      }
    }

    AsyncFunction("read") Coroutine { timeoutMs: Int ->
      withContext(Dispatchers.IO) {
        gate.withLock {
          ensureOpen()
          bytesToHex(transferIn(timeoutMs.coerceIn(1, 180_000)))
        }
      }
    }

    AsyncFunction("close") Coroutine { ->
      withContext(Dispatchers.IO) {
        gate.withLock { closeLocked() }
      }
    }
  }

  private suspend fun ensureOpen() {
    if (connection != null && endpointIn != null && endpointOut != null) return
    closeLocked()
    val usb = appContextAndroid.getSystemService(Context.USB_SERVICE) as UsbManager
    val device = usb.deviceList.values.firstOrNull { it.vendorId == VENDOR_ID }
      ?: throw LedgerUsbException("Plug in the Nano S+ with a USB cable, then try again.")
    if (!usb.hasPermission(device)) {
      val granted = requestPermission(usb, device)
      if (!granted) {
        throw LedgerUsbException("USB access was denied. Allow the Nano when Android asks.")
      }
    }
    val conn = usb.openDevice(device)
      ?: throw LedgerUsbException("Android could not open the Ledger. Unplug it and try again.")
    val choice = pickInterface(conn, device)
    if (choice == null) {
      conn.close()
      throw LedgerUsbException("Open the Warthog app on the Ledger, then try again.")
    }
    if (!conn.claimInterface(choice.intf, true)) {
      conn.close()
      throw LedgerUsbException("Could not connect to the Ledger. Unplug it and try again.")
    }
    connection = conn
    claimed = choice.intf
    endpointIn = choice.inn
    endpointOut = choice.out
  }

  private suspend fun requestPermission(usb: UsbManager, device: UsbDevice): Boolean {
    val context = appContextAndroid
    return suspendCancellableCoroutine { cont ->
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
          if (intent.action != ACTION_USB_PERMISSION) return
          try {
            context.unregisterReceiver(this)
          } catch (_: Exception) {
          }
          val ok = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
          if (cont.isActive) cont.resume(ok)
        }
      }
      if (Build.VERSION.SDK_INT >= 33) {
        context.registerReceiver(receiver, IntentFilter(ACTION_USB_PERMISSION), Context.RECEIVER_NOT_EXPORTED)
      } else {
        context.registerReceiver(receiver, IntentFilter(ACTION_USB_PERMISSION))
      }
      cont.invokeOnCancellation {
        try {
          context.unregisterReceiver(receiver)
        } catch (_: Exception) {
        }
      }
      // The system writes the grant result into this intent. IMMUTABLE drops that extra.
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
      val pending = PendingIntent.getBroadcast(
        context,
        0,
        Intent(ACTION_USB_PERMISSION).setPackage(context.packageName),
        flags,
      )
      usb.requestPermission(device, pending)
    }
  }

  private data class Choice(
    val intf: UsbInterface,
    val inn: UsbEndpoint,
    val out: UsbEndpoint,
    val score: Int,
  )

  private fun pickInterface(conn: UsbDeviceConnection, device: UsbDevice): Choice? {
    var best: Choice? = null
    for (i in 0 until device.interfaceCount) {
      val intf = device.getInterface(i)
      var inn: UsbEndpoint? = null
      var out: UsbEndpoint? = null
      for (e in 0 until intf.endpointCount) {
        val ep = intf.getEndpoint(e)
        if (ep.direction == UsbConstants.USB_DIR_IN && inn == null) inn = ep
        if (ep.direction == UsbConstants.USB_DIR_OUT && out == null) out = ep
      }
      val input = inn ?: continue
      val output = out ?: continue
      var score = 0
      if (intf.interfaceClass == UsbConstants.USB_CLASS_HID) score += 10
      if (intf.interfaceClass == 255) score += 8
      if (input.type == UsbConstants.USB_ENDPOINT_XFER_INT) score += 5
      if (hasUsagePage(conn, intf, USAGE_PAGE)) score += 100
      val current = best
      if (current == null || score > current.score) {
        best = Choice(intf, input, output, score)
      }
    }
    return best
  }

  private fun hasUsagePage(conn: UsbDeviceConnection, intf: UsbInterface, page: Int): Boolean {
    return try {
      val buf = ByteArray(512)
      val len = conn.controlTransfer(0x81, 0x06, 0x2200, intf.id, buf, buf.size, 400)
      len > 0 && descriptorHasUsagePage(buf, len, page)
    } catch (_: Exception) {
      false
    }
  }

  private fun descriptorHasUsagePage(buf: ByteArray, length: Int, page: Int): Boolean {
    var i = 0
    while (i < length) {
      val prefix = buf[i].toInt() and 0xff
      val sizeCode = prefix and 0x03
      val size = if (sizeCode == 3) 4 else sizeCode
      if (i + size >= length) return false
      val tag = prefix and 0xfc
      if (tag == 0x06 && size == 2) {
        val value = (buf[i + 1].toInt() and 0xff) or ((buf[i + 2].toInt() and 0xff) shl 8)
        if (value == page) return true
      }
      i += 1 + size
    }
    return false
  }

  // Android's UsbDeviceConnection has no interruptTransfer. bulkTransfer
  // also moves interrupt packets, which is what the Nano's HID endpoints are.
  private fun transfer(conn: UsbDeviceConnection, ep: UsbEndpoint, buffer: ByteArray, length: Int, timeout: Int): Int {
    return conn.bulkTransfer(ep, buffer, length, timeout)
  }

  private fun transferOut(packet: ByteArray) {
    val conn = connection ?: throw LedgerUsbException("The Ledger is not open.")
    val ep = endpointOut ?: throw LedgerUsbException("The Ledger is not open.")
    val sent = transfer(conn, ep, packet, packet.size, 10_000)
    if (sent != packet.size) {
      closeLocked()
      throw LedgerUsbException("The Ledger disconnected. Unlock the Nano and approve the prompt.")
    }
  }

  private fun transferIn(timeoutMs: Int): ByteArray {
    val conn = connection ?: throw LedgerUsbException("The Ledger is not open.")
    val ep = endpointIn ?: throw LedgerUsbException("The Ledger is not open.")
    val size = maxOf(64, ep.maxPacketSize)
    val buffer = ByteArray(size)
    val got = transfer(conn, ep, buffer, buffer.size, timeoutMs)
    if (got <= 0) {
      throw LedgerUsbException("Ledger timed out. Unlock the Nano and approve the prompt.")
    }
    return normalizeFrame(buffer, got)
  }

  /** Drop a leading report id when the endpoint includes one. */
  private fun normalizeFrame(raw: ByteArray, length: Int): ByteArray {
    val slice = raw.copyOf(length)
    if (
      slice.size >= 4 &&
      slice[0] == 0.toByte() &&
      slice[1] == 0x01.toByte() &&
      slice[2] == 0x01.toByte()
    ) {
      return slice.copyOfRange(1, slice.size)
    }
    return slice
  }

  private fun closeLocked() {
    val conn = connection
    val intf = claimed
    try {
      if (conn != null && intf != null) conn.releaseInterface(intf)
    } catch (_: Exception) {
    }
    try {
      conn?.close()
    } catch (_: Exception) {
    }
    connection = null
    claimed = null
    endpointIn = null
    endpointOut = null
  }

  private fun hexToBytes(hex: String): ByteArray {
    val clean = hex.trim()
    if (clean.length % 2 != 0) throw LedgerUsbException("Bad Ledger packet")
    val out = ByteArray(clean.length / 2)
    try {
      for (i in out.indices) {
        out[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
      }
    } catch (_: NumberFormatException) {
      throw LedgerUsbException("Bad Ledger packet")
    }
    return out
  }

  private fun bytesToHex(bytes: ByteArray): String {
    val chars = CharArray(bytes.size * 2)
    val alphabet = "0123456789abcdef"
    for (i in bytes.indices) {
      val v = bytes[i].toInt() and 0xff
      chars[i * 2] = alphabet[v ushr 4]
      chars[i * 2 + 1] = alphabet[v and 0x0f]
    }
    return String(chars)
  }
}
