const MIN_TEXT_CHARACTERS = 40;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function multiplyTransforms(left, right) {
  const [a, b, c, d, e, f] = left.map(value => finiteNumber(value));
  const [g, h, i, j, k, l] = right.map(value => finiteNumber(value));
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f
  ];
}

function rounded(value) {
  const next = Math.round(value * 1000) / 1000;
  return Object.is(next, -0) ? 0 : next;
}

/**
 * Convert a PDF.js text item to a CSS-pixel rectangle. PDF text origins are
 * baselines, so the rectangle is built from the transformed baseline and
 * ascender vectors instead of assuming an unrotated bottom-left origin.
 */
export function textItemToViewportRect(item, viewport) {
  const itemTransform = Array.isArray(item?.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
  const viewportTransform = Array.isArray(viewport?.transform) ? viewport.transform : [1, 0, 0, 1, 0, 0];
  const transform = multiplyTransforms(viewportTransform, itemTransform);
  const scale = Math.max(0.0001, finiteNumber(viewport?.scale, 1));

  const baselineLength = Math.hypot(transform[0], transform[1]) || 1;
  const width = Math.max(0, finiteNumber(item?.width)) * scale;
  const widthVector = [
    (transform[0] / baselineLength) * width,
    (transform[1] / baselineLength) * width
  ];

  let heightVector = [transform[2], transform[3]];
  if (Math.hypot(...heightVector) < 0.001) {
    const height = Math.max(1, finiteNumber(item?.height, baselineLength / scale)) * scale;
    heightVector = [
      (-transform[1] / baselineLength) * height,
      (transform[0] / baselineLength) * height
    ];
  }

  const origin = [transform[4], transform[5]];
  const corners = [
    origin,
    [origin[0] + widthVector[0], origin[1] + widthVector[1]],
    [origin[0] + heightVector[0], origin[1] + heightVector[1]],
    [origin[0] + widthVector[0] + heightVector[0], origin[1] + widthVector[1] + heightVector[1]]
  ];
  const xs = corners.map(point => point[0]);
  const ys = corners.map(point => point[1]);
  return [rounded(Math.min(...xs)), rounded(Math.min(...ys)), rounded(Math.max(...xs)), rounded(Math.max(...ys))];
}

function normalizeItem(item, index) {
  const text = String(item?.text ?? item?.str ?? '').replace(/\s+/g, ' ').trim();
  const rawBox = Array.isArray(item?.bbox) ? item.bbox : [0, 0, 0, 0];
  const bbox = rawBox.slice(0, 4).map(value => finiteNumber(value));
  if (bbox[2] < bbox[0]) [bbox[0], bbox[2]] = [bbox[2], bbox[0]];
  if (bbox[3] < bbox[1]) [bbox[1], bbox[3]] = [bbox[3], bbox[1]];
  return {
    ...item,
    id: item?.id || `pdf-text-${index}`,
    text,
    bbox,
    width: Math.max(0, bbox[2] - bbox[0]),
    height: Math.max(1, bbox[3] - bbox[1]),
    centerY: (bbox[1] + bbox[3]) / 2
  };
}

function unionBox(items) {
  return [
    Math.min(...items.map(item => item.bbox[0])),
    Math.min(...items.map(item => item.bbox[1])),
    Math.max(...items.map(item => item.bbox[2])),
    Math.max(...items.map(item => item.bbox[3]))
  ];
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
}

/**
 * Reserve a bounded region for each translated paragraph. A region may grow
 * into whitespace below its source box, but never past the next paragraph in
 * the same visual column. The renderer can then fit or scroll long text inside
 * the region without painting over a following paragraph.
 */
export function layoutPdfTranslationParagraphs(paragraphs = [], {
  pageWidth,
  pageHeight,
  gap = 2
} = {}) {
  const widthLimit = Math.max(1, finiteNumber(pageWidth, 1));
  const heightLimit = Math.max(1, finiteNumber(pageHeight, 1));
  const requestedGap = Math.max(0, finiteNumber(gap, 2));
  const regions = paragraphs.map((paragraph, index) => {
    const box = normalizeItem(paragraph, index).bbox;
    const x = Math.min(widthLimit - 0.5, Math.max(0, box[0]));
    const y = Math.min(heightLimit - 0.5, Math.max(0, box[1]));
    const right = Math.min(widthLimit, Math.max(x + 0.5, box[2]));
    const bottom = Math.min(heightLimit, Math.max(y + 0.5, box[3]));
    return {
      paragraph,
      sourceIndex: index,
      x,
      y,
      right,
      sourceBottom: bottom
    };
  });

  return regions.map(region => {
    const ownWidth = Math.max(0.5, region.right - region.x);
    let nextTop = heightLimit;
    for (const candidate of regions) {
      if (candidate === region || candidate.y <= region.y) continue;
      const overlap = Math.max(0, Math.min(region.right, candidate.right) - Math.max(region.x, candidate.x));
      if (overlap <= 0) continue;
      nextTop = Math.min(nextTop, candidate.y);
    }

    const available = Math.max(0.001, nextTop - region.y);
    const safeGap = Math.min(requestedGap, Math.max(0, available - 0.001));
    const maxHeight = Math.max(0.001, Math.min(heightLimit - region.y, available - safeGap));
    const sourceHeight = Math.max(0.5, region.sourceBottom - region.y);
    return {
      paragraph: region.paragraph,
      sourceIndex: region.sourceIndex,
      x: region.x,
      y: region.y,
      width: ownWidth,
      sourceHeight: Math.min(sourceHeight, maxHeight),
      maxHeight
    };
  });
}

function makeLine(items) {
  const sorted = [...items].sort((a, b) => a.bbox[0] - b.bbox[0]);
  return {
    items: sorted,
    text: sorted.map(item => item.text).join(' ').replace(/\s+([,.;:!?])/g, '$1'),
    bbox: unionBox(sorted),
    height: Math.max(...sorted.map(item => item.height))
  };
}

function splitRowIntoLines(row) {
  const sorted = [...row.items].sort((a, b) => a.bbox[0] - b.bbox[0]);
  const lines = [];
  let current = [];

  for (const item of sorted) {
    const previous = current.at(-1);
    if (previous) {
      const gap = item.bbox[0] - previous.bbox[2];
      const averageCharacterWidth = previous.text.length ? previous.width / previous.text.length : previous.height / 2;
      const columnGap = Math.max(28, previous.height * 3.5, averageCharacterWidth * 8);
      if (gap > columnGap) {
        lines.push(makeLine(current));
        current = [];
      }
    }
    current.push(item);
  }
  if (current.length) lines.push(makeLine(current));
  return lines;
}

/** Group positioned text into reading-order paragraphs without crossing columns. */
export function groupPdfTextItems(inputItems = []) {
  const items = inputItems
    .map(normalizeItem)
    .filter(item => item.text && item.width >= 0 && item.height > 0)
    .sort((a, b) => (a.centerY - b.centerY) || (a.bbox[0] - b.bbox[0]));
  if (!items.length) return [];

  const rows = [];
  for (const item of items) {
    const row = rows.find(candidate => {
      const tolerance = Math.max(2.5, Math.min(candidate.height, item.height) * 0.45);
      return Math.abs(candidate.centerY - item.centerY) <= tolerance;
    });
    if (row) {
      row.items.push(item);
      row.centerY = row.items.reduce((sum, entry) => sum + entry.centerY, 0) / row.items.length;
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ items: [item], centerY: item.centerY, height: item.height });
    }
  }

  const lines = rows
    .sort((a, b) => a.centerY - b.centerY)
    .flatMap(splitRowIntoLines)
    .sort((a, b) => (a.bbox[1] - b.bbox[1]) || (a.bbox[0] - b.bbox[0]));

  const paragraphs = [];
  for (const line of lines) {
    let best = null;
    for (const paragraph of paragraphs) {
      const previousLine = paragraph.lines.at(-1);
      const verticalGap = line.bbox[1] - previousLine.bbox[3];
      const overlap = horizontalOverlap(previousLine.bbox, line.bbox);
      const narrowWidth = Math.max(1, Math.min(
        previousLine.bbox[2] - previousLine.bbox[0],
        line.bbox[2] - line.bbox[0]
      ));
      const sameColumn = overlap / narrowWidth >= 0.35;
      const closeEnough = verticalGap >= -Math.min(previousLine.height, line.height) * 0.4
        && verticalGap <= Math.max(previousLine.height, line.height) * 1.25;
      if (!sameColumn || !closeEnough) continue;

      const score = verticalGap - (overlap / narrowWidth) * Math.max(previousLine.height, line.height);
      if (!best || score < best.score) best = { paragraph, score };
    }

    if (best) {
      const paragraph = best.paragraph;
      paragraph.lines.push(line);
      paragraph.text = `${paragraph.text} ${line.text}`.replace(/\s+/g, ' ').trim();
      paragraph.bbox = unionBox(paragraph.lines);
      paragraph.height = Math.max(paragraph.height, line.height);
    } else {
      paragraphs.push({
        text: line.text,
        bbox: [...line.bbox],
        height: line.height,
        lines: [line]
      });
    }
  }

  return paragraphs
    .sort((a, b) => (a.bbox[1] - b.bbox[1]) || (a.bbox[0] - b.bbox[0]))
    .map(({ lines: _lines, height: _height, ...paragraph }, index) => ({
      ...paragraph,
      id: `pdf-paragraph-${index}`
    }));
}

export function chunkPdfParagraphs(paragraphs = [], { maxItems = 24, maxChars = 5000 } = {}) {
  const itemLimit = Math.max(1, Math.floor(finiteNumber(maxItems, 24)));
  const characterLimit = Math.max(1, Math.floor(finiteNumber(maxChars, 5000)));
  const chunks = [];
  let current = [];
  let characters = 0;

  for (const paragraph of paragraphs) {
    const length = String(paragraph?.text ?? '').length;
    if (length > characterLimit) {
      throw new RangeError(`A PDF paragraph exceeds the ${characterLimit}-character translation limit.`);
    }
    if (current.length && (current.length >= itemLimit || characters + length > characterLimit)) {
      chunks.push(current);
      current = [];
      characters = 0;
    }
    current.push(paragraph);
    characters += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function isUsablePdfText(items = []) {
  const text = items.map(item => String(item?.text ?? item?.str ?? '')).join(' ').trim();
  if (text.length < MIN_TEXT_CHARACTERS) return false;

  const replacements = (text.match(/\ufffd/g) || []).length;
  const meaningful = (text.match(/[\p{L}\p{N}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const validBoxes = items.filter(item => Array.isArray(item?.bbox) && item.bbox.length >= 4 && item.bbox.every(Number.isFinite));
  return replacements / text.length < 0.08
    && meaningful >= Math.min(24, Math.floor(text.length * 0.45))
    && validBoxes.length > 0;
}
