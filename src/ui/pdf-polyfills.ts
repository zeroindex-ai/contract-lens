// Side-effect polyfill, imported before pdfjs-dist loads. Backfills two web APIs
// that iOS WebKit (Safari — and therefore iOS Chrome too) lacks but pdfjs v5 uses
// on the main thread, so on iPhones the page rendered (via the worker) but the
// text step threw "undefined is not a function" and citation highlights silently
// failed while the fields + PDF still showed.

/* 1. ReadableStream async iteration — THE iOS bug.
   pdfjs's page.getTextContent() does `for await (const chunk of streamTextContent())`,
   and `streamTextContent()` returns a ReadableStream. `for await…of` needs
   ReadableStream.prototype[Symbol.asyncIterator], which WebKit does not implement —
   so the loop throws "undefined is not a function (near 't of e')". This installs
   the spec-defined async iterator; it's additive and a no-op where the engine
   already provides it (e.g. Chrome, and Node in tests). */
type StreamAsyncIterable = {
  [Symbol.asyncIterator]?: (opts?: { preventCancel?: boolean }) => AsyncIterableIterator<unknown>;
  values?: unknown;
};
const streamProto =
  typeof ReadableStream !== 'undefined'
    ? (ReadableStream.prototype as unknown as StreamAsyncIterable)
    : null;

if (streamProto && typeof streamProto[Symbol.asyncIterator] !== 'function') {
  streamProto[Symbol.asyncIterator] = function asyncIterator(
    this: ReadableStream<unknown>,
    opts?: { preventCancel?: boolean }
  ): AsyncIterableIterator<unknown> {
    const preventCancel = opts?.preventCancel ?? false;
    const reader = this.getReader();
    return {
      next(): Promise<IteratorResult<unknown>> {
        return reader.read().then((r) =>
          r.done ? { done: true, value: undefined } : { done: false, value: r.value }
        );
      },
      return(value?: unknown): Promise<IteratorResult<unknown>> {
        if (!preventCancel) {
          const cancelled = reader.cancel(value);
          reader.releaseLock();
          return cancelled.then(() => ({ done: true, value }));
        }
        reader.releaseLock();
        return Promise.resolve({ done: true, value });
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
        return this;
      },
    };
  };
  // Some callers use stream.values() instead of the well-known symbol.
  if (typeof streamProto.values !== 'function') {
    streamProto.values = streamProto[Symbol.asyncIterator];
  }
}

/* 2. Promise.withResolvers — defensive backfill for iOS Safari < 17.4 / Chrome < 119.
   pdfjs uses it widely; harmless no-op on modern engines. */
type WithResolvers = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};
const P = Promise as unknown as { withResolvers?: WithResolvers };
if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
