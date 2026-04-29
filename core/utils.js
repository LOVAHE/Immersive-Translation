import { api, callApi } from './browser.js';

export async function createContextMenus(items) {
  await callApi(api.contextMenus.removeAll.bind(api.contextMenus));
  items.forEach(item => api.contextMenus.create(item));
}

export async function withTimeout(promise, ms = 25000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('Request timed out')), ms);
  });
  try {
    const res = await Promise.race([promise, timeout]);
    return res;
  } finally {
    clearTimeout(t);
  }
}
