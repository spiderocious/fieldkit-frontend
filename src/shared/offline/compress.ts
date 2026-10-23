// Main-thread side of the compression worker.
import type { CompressRequest, CompressResponse } from './compress.worker';
import { photoBudgetBytes } from './storage';

export interface CompressedImage {
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  quality: number;
  elapsedMs: number;
}

export interface CompressOptions {
  budgetBytes?: number;
  maxDimension?: number;
}

/**
 * Compresses one image in a worker. The file's bytes are transferred to the
 * worker and the result transferred back, so the main thread never holds a
 * decoded copy. One worker per call keeps memory flat: the worker and its
 * bitmap are released when the call ends.
 */
export async function compressImage(file: Blob, opts: CompressOptions = {}): Promise<CompressedImage> {
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module' });
  try {
    const request: CompressRequest = {
      buffer,
      type: file.type || 'image/jpeg',
      budgetBytes: opts.budgetBytes ?? photoBudgetBytes(),
      maxDimension: opts.maxDimension ?? 1600,
    };
    const response = await new Promise<CompressResponse>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<CompressResponse>) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage(request, [buffer]);
    });
    return {
      blob: new Blob([response.buffer], { type: 'image/jpeg' }),
      bytes: response.bytes,
      width: response.width,
      height: response.height,
      quality: response.quality,
      elapsedMs: response.elapsedMs,
    };
  } finally {
    worker.terminate();
  }
}
