const DOCUMENT_POSITION_PRECEDING = 2;
const DOCUMENT_POSITION_FOLLOWING = 4;

export function compareDocumentOrder(left, right) {
  if (left === right) return 0;
  if (typeof left?.compareDocumentPosition !== 'function') return 0;
  const position = left.compareDocumentPosition(right);
  if (position & DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

export class OrderedUniqueQueue {
  #compare;
  #items = [];
  #known = new Set();

  constructor(compare = compareDocumentOrder) {
    this.#compare = compare;
  }

  get size() {
    return this.#items.length;
  }

  enqueue(items) {
    let changed = false;
    for (const item of items || []) {
      if (item == null || this.#known.has(item)) continue;
      this.#known.add(item);
      this.#items.push(item);
      changed = true;
    }
    if (changed) this.#items.sort(this.#compare);
    return changed;
  }

  take(limit = 1) {
    const count = Math.max(0, Math.floor(Number(limit) || 0));
    if (!count) return [];
    const items = this.#items.splice(0, count);
    items.forEach(item => this.#known.delete(item));
    return items;
  }

  delete(item) {
    if (!this.#known.delete(item)) return false;
    const index = this.#items.indexOf(item);
    if (index >= 0) this.#items.splice(index, 1);
    return true;
  }

  clear() {
    this.#items.length = 0;
    this.#known.clear();
  }
}
