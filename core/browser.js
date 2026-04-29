export const api = globalThis.browser ?? globalThis.chrome;

export function callApi(fn, ...args) {
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = fn(...args, (...callbackArgs) => {
        resolve(callbackArgs.length > 1 ? callbackArgs : callbackArgs[0]);
      });
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve, reject);
      } else if (fn.length <= args.length) {
        resolve(maybePromise);
      }
    } catch (err) {
      reject(err);
    }
  });
}
