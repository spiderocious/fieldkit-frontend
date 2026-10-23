import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom's Blob has no arrayBuffer(); every real browser's does. Fill it in
// with FileReader so the photo tier can be tested as it runs in production.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
