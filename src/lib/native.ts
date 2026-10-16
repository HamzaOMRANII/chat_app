import { isNativeApp } from "./platform";

/** Copies text; the APK uses the Clipboard plugin, the browser the Clipboard API. */
export async function copyText(text: string) {
  if (isNativeApp) {
    const { Clipboard } = await import("@capacitor/clipboard");
    await Clipboard.write({ string: text });
  } else {
    await navigator.clipboard.writeText(text);
  }
}

export const canShare = isNativeApp || typeof navigator.share === "function";

/** Opens the system share sheet. Returns false when the person closed it. */
export async function shareText(title: string, text: string) {
  try {
    if (isNativeApp) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, text, dialogTitle: title });
    } else {
      await navigator.share({ title, text });
    }
    return true;
  } catch {
    return false;
  }
}

/** In-app QR scanning: Google's scanner in the APK, the camera through the browser on the web. */
export const canScanQr = isNativeApp || typeof navigator.mediaDevices?.getUserMedia === "function";

/**
 * QR scan with Google's code scanner (Play services): the camera opens in Google's own screen,
 * so H_CHAT needs no camera permission. APK only. Resolves to the text read, or null when cancelled.
 */
export async function scanQr(): Promise<string | null> {
  const { BarcodeScanner, BarcodeFormat } = await import("@capacitor-mlkit/barcode-scanning");
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule();
    throw new Error("The QR scanner is being installed by Google Play services. Try again in a moment.");
  }
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    return barcodes[0]?.rawValue || null;
  } catch {
    return null;
  }
}
