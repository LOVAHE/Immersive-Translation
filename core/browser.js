export const api = globalThis.browser ?? globalThis.chrome;

export function callApi(fn, ...args) {
  if (!api) return Promise.reject(new Error('Browser extension API is not available.'));

  if (api === globalThis.browser) {
    try {
      return Promise.resolve(fn(...args));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (...callbackArgs) => {
      if (settled) return;
      settled = true;
      const err = api.runtime?.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      resolve(callbackArgs.length > 1 ? callbackArgs : callbackArgs[0]);
    };

    try {
      const maybePromise = fn(...args, finish);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(
          value => {
            if (!settled) {
              settled = true;
              resolve(value);
            }
          },
          err => {
            if (!settled) {
              settled = true;
              reject(err);
            }
          }
        );
      } else if (maybePromise !== undefined) {
        settled = true;
        resolve(maybePromise);
      }
    } catch (err) {
      if (!settled) {
        settled = true;
        reject(err);
      }
    }
  });
}
