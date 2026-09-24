/**
 * Polyfills for the new typed-array binary helpers that pdfjs-dist v6 relies
 * on (`Uint8Array.prototype.toHex` etc., TC39 proposal adopted in the newest
 * WebView engines). Engines without them throw `n.toHex is not a function`
 * during pdf.js document fingerprinting — which surfaced as a swallowed
 * "We couldn't read that file" toast on every PDF upload.
 *
 * Imported on the main thread (before pdf.js use) AND inside the worker
 * wrapper (pdf-worker.ts) — worker code runs in its own realm with its own
 * prototypes, so both need the patch.
 */

function installPolyfills(): void {
  // Map.prototype.getOrInsertComputed — TC39 upsert proposal, used by
  // pdfjs-dist v6 alongside the typed-array helpers.
  const mapProto = Map.prototype as unknown as Record<string, unknown>;
  if (typeof mapProto["getOrInsertComputed"] !== "function") {
    Object.defineProperty(mapProto, "getOrInsertComputed", {
      value: function getOrInsertComputed<K, V>(
        this: Map<K, V>,
        key: K,
        callback: (key: K) => V,
      ): V {
        if (!this.has(key)) this.set(key, callback(key));
        return this.get(key) as V;
      },
      writable: true,
      configurable: true,
    });
  }
  if (typeof mapProto["getOrInsert"] !== "function") {
    Object.defineProperty(mapProto, "getOrInsert", {
      value: function getOrInsert<K, V>(this: Map<K, V>, key: K, value: V): V {
        if (!this.has(key)) this.set(key, value);
        return this.get(key) as V;
      },
      writable: true,
      configurable: true,
    });
  }

  const proto = Uint8Array.prototype as unknown as Record<string, unknown>;

  if (typeof proto["toHex"] !== "function") {
    Object.defineProperty(proto, "toHex", {
      value: function toHex(this: Uint8Array): string {
        let out = "";
        for (let i = 0; i < this.length; i++) {
          out += (this[i] as number).toString(16).padStart(2, "0");
        }
        return out;
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof proto["toBase64"] !== "function") {
    Object.defineProperty(proto, "toBase64", {
      value: function toBase64(this: Uint8Array): string {
        let binary = "";
        for (let i = 0; i < this.length; i++) {
          binary += String.fromCharCode(this[i] as number);
        }
        return btoa(binary);
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof proto["setFromBase64"] !== "function") {
    Object.defineProperty(proto, "setFromBase64", {
      value: function setFromBase64(
        this: Uint8Array,
        b64: string,
      ): { read: number; written: number } {
        const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
        const bin = atob(clean);
        const written = Math.min(this.length, bin.length);
        for (let i = 0; i < written; i++) this[i] = bin.charCodeAt(i);
        return { read: bin.length, written };
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof proto["setFromHex"] !== "function") {
    Object.defineProperty(proto, "setFromHex", {
      value: function setFromHex(this: Uint8Array, hex: string): { read: number; written: number } {
        const bytes = Math.min(this.length, Math.floor(hex.length / 2));
        for (let i = 0; i < bytes; i++) {
          this[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return { read: bytes * 2, written: bytes };
      },
      writable: true,
      configurable: true,
    });
  }
}

// Worker realms have no `window`; guard before installing the polyfills.
if (typeof self !== "undefined" && typeof Uint8Array !== "undefined") {
  installPolyfills();
}

export {};
