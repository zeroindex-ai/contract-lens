// Side-effect polyfill, imported before pdfjs-dist loads.
//
// pdfjs-dist v5 calls `Promise.withResolvers()` in ~80 places (notably the
// text-layer / streaming paths). That API only shipped in iOS Safari 17.4 and
// Chrome 119, so on older mobile browsers the *page* still renders (canvas path)
// but `getTextContent()` / `TextLayer.render()` throw "undefined is not a
// function" — which is why the citation highlights silently fail on phones while
// the fields + PDF still appear. Define it before pdfjs evaluates.

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
