import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  IMMERSIVE_PAGE_CSS,
  chooseTranslationLayout,
  createTranslationDescriptor,
  normalizeTranslationTheme,
  rangesIntersect
} from '../content/immersivePage.js';
import { OrderedUniqueQueue } from '../core/orderedQueue.js';

test('page translations use the Immersive Translate wrapper contract', () => {
  const descriptor = createTranslationDescriptor({
    status: 'translated',
    targetLang: 'zh',
    theme: 'underline'
  });

  assert.deepEqual(descriptor.outerClasses, [
    'notranslate',
    'immersive-translate-target-wrapper'
  ]);
  assert.equal(descriptor.tagName, 'font');
  assert.equal(descriptor.layout, 'block');
  assert.ok(descriptor.wrapperClasses.includes('immersive-translate-target-translation-block-wrapper'));
  assert.ok(descriptor.wrapperClasses.includes('immersive-translate-target-translation-block-wrapper-theme-underline'));
  assert.ok(descriptor.innerClasses.includes('immersive-translate-target-inner'));
  assert.ok(descriptor.innerClasses.includes('immersive-translate-target-translation-theme-underline-inner'));
  assert.ok(descriptor.innerClasses.includes('is-translated'));
  assert.deepEqual(descriptor.attributes, {
    translate: 'no',
    dir: 'auto',
    lang: 'zh',
    'data-it-translation-target': 'true',
    'data-immersive-translate-translation-element-mark': '1'
  });
});

test('short translations use the upstream inline rhythm while longer text stays block-level', () => {
  assert.equal(chooseTranslationLayout(null, 'Short text'), 'inline');
  assert.equal(chooseTranslationLayout(null, 'one two three four five'), 'block');
  assert.equal(chooseTranslationLayout(null, 'This sentence is longer than twenty-four characters.'), 'block');

  const inline = createTranslationDescriptor({ layout: 'inline' });
  assert.ok(inline.wrapperClasses.includes('immersive-translate-target-translation-inline-wrapper'));
});

test('unknown translation themes fall back to the unstyled Immersive default', () => {
  assert.equal(normalizeTranslationTheme('none'), 'none');
  assert.equal(normalizeTranslationTheme('weakening'), 'weakening');
  assert.equal(normalizeTranslationTheme('not-a-theme'), 'none');
});

test('default bilingual CSS inherits the page and adds only the upstream eight-pixel rhythm', () => {
  assert.match(IMMERSIVE_PAGE_CSS, /\[imt-state="dual"\][\s\S]*margin:\s*8px 0 !important/);
  assert.match(IMMERSIVE_PAGE_CSS, /font:\s*inherit !important/);
  assert.match(IMMERSIVE_PAGE_CSS, /line-height:\s*inherit !important/);
  assert.match(IMMERSIVE_PAGE_CSS, /letter-spacing:\s*inherit !important/);
  assert.match(IMMERSIVE_PAGE_CSS, /immersive-translate-target-translation-inline-wrapper/);
  assert.doesNotMatch(
    IMMERSIVE_PAGE_CSS.match(/\.immersive-translate-target-wrapper\s*\{[^}]*\}/)?.[0] || '',
    /background|box-shadow|border-radius|padding/
  );
});

test('range intersection follows the DOM Range sign contract', () => {
  const constants = { END_TO_START: 3, START_TO_END: 1 };
  const intersecting = {
    compareBoundaryPoints(which) {
      return which === constants.END_TO_START ? 1 : -1;
    }
  };
  const disjoint = {
    compareBoundaryPoints(which) {
      return which === constants.END_TO_START ? -1 : -1;
    }
  };

  assert.equal(rangesIntersect(intersecting, {}, constants), true);
  assert.equal(rangesIntersect(disjoint, {}, constants), false);
});

test('content page translation delegates to the immersive renderer instead of card rendering', async () => {
  const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');

  assert.match(source, /content\/immersivePage\.js/);
  assert.match(source, /mountImmersiveTranslation/);
  assert.match(source, /removeAllImmersiveTranslations/);
  assert.match(source, /new queueTools\.OrderedUniqueQueue\(\)/);
  assert.match(source, /drainPageTranslationQueue/);
  assert.match(source, /PAGE_TRANSLATION_BATCH_SIZE\s*=\s*40/);
  assert.match(source, /contextId:\s*session\.contextId/);
  assert.match(source, /function pruneDetachedPageBlocks\(session\)/);
  assert.match(source, /session\.translationQueue\.clear\(\)/);
  assert.doesNotMatch(source, /createPageVisibilityObserver/);
  assert.doesNotMatch(source, /slice\.forEach\(\(el, idx\) => insertBelow\(el/);
});

test('full-page queue is unique and always drains in document order', () => {
  const node = position => ({
    position,
    compareDocumentPosition(other) {
      return this.position < other.position ? 4 : 2;
    }
  });
  const [first, second, third, inserted] = [node(1), node(2), node(3), node(1.5)];
  const queue = new OrderedUniqueQueue();

  queue.enqueue([third, first, second, first]);
  assert.deepEqual(queue.take(1), [first]);
  queue.enqueue([inserted]);
  assert.deepEqual(queue.take(3), [inserted, second, third]);
  assert.equal(queue.size, 0);
});

test('selection rendering reuses the context-menu result and its captured range', async () => {
  const contentSource = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
  const backgroundSource = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  assert.match(backgroundSource, /sourceText:\s*info\.selectionText/);
  assert.match(contentSource, /takeSelectionRange\(\s*msg\.sourceText/);
  assert.doesNotMatch(contentSource, /const multiResp = await api\.runtime\.sendMessage/);
});

test('transient reasoning popovers have an idempotent owner disposer', async () => {
  const contentSource = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');

  assert.match(contentSource, /function disposeThinkPopover\(holder\)/);
  assert.match(contentSource, /if \(!holder\.isConnected\) disposeThinkPopover\(holder\)/);
  assert.match(contentSource, /disposeThinkPopover\(pop\);\s*pop\.remove\(\)/);
});
