// Image compression off the main thread.
//
// A 12 MP photo decodes to about 48 MB of RGBA. Doing that on the thread
// that draws the UI drops frames for hundreds of milliseconds; on a cheap
// phone it looks like a crash. This worker decodes one image at a time,
// resizes it, and encodes JPEG at falling quality until it fits the byte
// budget. The input buffer arrives transferred, not copied.

export interface CompressRequest {
  buffer: ArrayBuffer;
  type: string;
  budgetBytes: number;
  maxDimension: number;
}

export interface CompressResponse {
  buffer: ArrayBuffer;
  bytes: number;
  width: number;
  height: number;
  quality: number;
  elapsedMs: number;
}

self.onmessage = async (e: MessageEvent<CompressRequest>) => {
  const started = performance.now();
  const { buffer, type, budgetBytes, maxDimension } = e.data;
  const bitmap = await createImageBitmap(new Blob([buffer], { type }));
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, width, height);

    let quality = 0.85;
    let out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    while (out.size > budgetBytes && quality > 0.4) {
      quality = Math.round((quality - 0.1) * 100) / 100;
      out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    const result = await out.arrayBuffer();
    const response: CompressResponse = {
      buffer: result,
      bytes: result.byteLength,
      width,
      height,
      quality,
      elapsedMs: Math.round(performance.now() - started),
    };
    // Transfer the result back; the worker does not keep a copy.
    self.postMessage(response, [result]);
  } finally {
    bitmap.close();
  }
};
