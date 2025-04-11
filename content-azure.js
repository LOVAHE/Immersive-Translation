# Please rename to context.js for Azure Translate API

console.log('Content script loaded');

const TEXT_ELEMENTS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'FIGCAPTION', 'DIV', 'SPAN'];

const CONFIG = {
  targetLanguage: 'zh-CN',
  fontFamily: 'Quicksand, 楷体, KaiTi, STKaiti, serif',
  languages: {
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    'en': '英语',
    'ja': '日语',
    'ko': '韩语',
    'fr': '法语',
    'es': '西班牙语',
    'de': '德语'
  }
};

const API_CONFIG = {
  key: 'YOUR_API_KEY',
  region: 'YOUR_REGION',   // "eastus"
  url: 'https://api.cognitive.microsofttranslator.com/translate'
};

const SELECTORS = {
  main: [
    'article',
    'main',
    '[role="main"]',
    '.article',
    '.post',
    '.content',
    '#content',
    '.main-content',
    '.article-content',
    '.post-content'
  ],
  translate: [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'td',
    'th',
    'figcaption',
    'div:not(:has(>*))',
    'span:not(:has(>*))'
  ].join(','),
  exclude: [
    'nav',
    'header',
    'footer',
    '.nav',
    '.menu',
    '.sidebar',
    '.comment',
    '.advertisement',
    'script',
    'style',
    'noscript',
    '.immersive-translation'
  ].join(',')
};

class UIComponents {
  static createLoadingIndicator() {
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10001;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 200px;
      transition: opacity 1s ease-out;
    `;

    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      overflow: hidden;
    `;

    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
      width: 0%;
      height: 100%;
      background: #4CAF50;
      border-radius: 2px;
      transition: width 0.3s ease;
    `;

    progressBar.appendChild(progressFill);
    loadingDiv.appendChild(progressBar);
    loadingDiv.progressFill = progressFill;
    
    return loadingDiv;
  }

  static updateProgress(loadingDiv, current, total) {
    const percentage = Math.round((current / total) * 100);
    loadingDiv.progressFill.style.width = `${percentage}%`;
    loadingDiv.textContent = `Translating... ${percentage}%`;
    loadingDiv.appendChild(loadingDiv.progressFill.parentElement);
  }

  static showMessage(message, isError = false) {
    const div = document.createElement('div');
    div.textContent = message;
    div.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${isError ? 'rgba(255, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.8)'};
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10001;
      transition: opacity 1s ease-out;
      opacity: 1;
    `;
    document.body.appendChild(div);
    
    setTimeout(() => {
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 1000);
    }, 2000);
  }

  static createTranslationPopup(translatedText, rect) {
    const bodyStyles = window.getComputedStyle(document.body);
    const backgroundColor = bodyStyles.backgroundColor;
    const color = bodyStyles.color;
    const bgColor = backgroundColor.startsWith('rgb(') 
      ? backgroundColor.replace('rgb(', 'rgba(').replace(')', ', 0.95)')
      : backgroundColor.startsWith('rgba(') 
        ? backgroundColor.replace(/[\d.]+\)$/, '0.95)')
        : `rgba(255, 255, 255, 0.95)`;

    const popup = document.createElement('div');
    popup.className = 'word-translation-popup';
    popup.style.cssText = `
      position: fixed;
      max-width: 300px;
      padding: 12px;
      background: ${bgColor};
      color: ${color};
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      font-family: ${CONFIG.fontFamily};
      font-size: 14px;
      line-height: 1.6;
      white-space: pre-wrap;
      backdrop-filter: blur(5px);
    `;

    const closeButton = document.createElement('span');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      cursor: pointer;
      color: ${color};
      font-size: 16px;
      width: 20px;
      height: 20px;
      line-height: 20px;
      text-align: center;
    `;
    closeButton.addEventListener('click', () => popup.remove());

    const content = document.createElement('div');
    content.style.paddingRight = '20px';
    content.textContent = translatedText;

    popup.appendChild(closeButton);
    popup.appendChild(content);

    return popup;
  }

  static createSimpleLoadingIndicator() {
    const loadingDiv = document.createElement('div');
    loadingDiv.textContent = 'Translating...';
    loadingDiv.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10001;
    `;
    return loadingDiv;
  }
}

class TranslationService {
  static async translateText(text) {
    try {
      const url = `${API_CONFIG.url}?api-version=3.0&to=${CONFIG.targetLanguage}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': API_CONFIG.key,
          'Ocp-Apim-Subscription-Region': API_CONFIG.region,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ Text: text }]),
      });

      if (!response.ok) {
        throw new Error(response.status === 500 ?
          'Internal server error' :
          `Request failed: ${response.status}`
        );
      }

      const result = await response.json();
      return result[0]?.translations[0]?.text.trim();
    } catch (error) {
      console.error('Translation error:', error);
      return error.message || 'Translation failed';
    }
  }

  static async translateWord(word) {
    try {
      const url = `${API_CONFIG.url}?api-version=3.0&to=${CONFIG.targetLanguage}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': API_CONFIG.key,
          'Ocp-Apim-Subscription-Region': API_CONFIG.region,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ Text: word }]),
      });

      if (!response.ok) {
        throw new Error(response.status === 500 ?
          'Internal server error' :
          `Request failed: ${response.status}`
        );
      }

      const result = await response.json();
      return result[0]?.translations[0]?.text.trim();
    } catch (error) {
      console.error('Translation error:', error);
      return error.message || 'Translation failed';
    }
  }
}

class PageHandler {
  static findMainContent() {
    for (const selector of SELECTORS.main) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > 500) {
        return element;
      }
    }
    return document.body;
  }

  static getTranslatableElements(container) {
    return Array.from(container.querySelectorAll(SELECTORS.translate))
      .filter(element => {
        if (element.closest(SELECTORS.exclude)) return false;
        const text = element.textContent.trim();
        return text.length > 0 && 
               text.length < 1000 && 
               !/^\d+$/.test(text) && 
               !element.closest('.immersive-translation');
      });
  }

  static isWordOrPhrase(text) {
    text = text.trim();
    const isChinese = /[\u4e00-\u9fa5]/.test(text);
    if (isChinese) return text.length <= 4;
    const wordCount = text.split(/\s+/).length;
    const hasSentenceEnding = /[.!?。！？]/.test(text);
    return wordCount <= 3 && !hasSentenceEnding;
  }
}

class Translator {
  static async translatePage() {
    try {
      const loadingDiv = UIComponents.createLoadingIndicator();
      document.body.appendChild(loadingDiv);

      const mainContent = PageHandler.findMainContent();
      if (!mainContent) throw new Error('No main content found');

      const elements = PageHandler.getTranslatableElements(mainContent);
      if (elements.length === 0) throw new Error('No translatable content found');

      UIComponents.updateProgress(loadingDiv, 0, elements.length);

      const BATCH_SIZE = 5;
      for (let i = 0; i < elements.length; i += BATCH_SIZE) {
        const batch = elements.slice(i, Math.min(i + BATCH_SIZE, elements.length));
        await this.translateBatch(batch);
        UIComponents.updateProgress(loadingDiv, Math.min(i + BATCH_SIZE, elements.length), elements.length);
      }

      loadingDiv.textContent = 'Translation completed!';
      loadingDiv.style.transition = 'opacity 1s ease-out';
      loadingDiv.style.opacity = '1';
      
      setTimeout(() => {
        loadingDiv.style.opacity = '0';
        setTimeout(() => loadingDiv.remove(), 1000);
      }, 1000);

    } catch (error) {
      console.error('Page translation error:', error);
      UIComponents.showMessage(`Translation failed: ${error.message}`, true);
    }
  }

  static async translateBatch(elements) {
    const translations = await Promise.all(
      elements.map(async element => {
        const text = element.textContent.trim();
        const translation = await TranslationService.translateText(text);
        return { element, translation };
      })
    );

    translations.forEach(({ element, translation }) => {
      if (translation && translation !== 'Translation failed') {
        this.addTranslation(element, translation);
      }
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  static addTranslation(element, translatedText) {
    const existingTranslation = element.nextElementSibling;
    if (existingTranslation?.classList.contains('immersive-translation')) {
      existingTranslation.remove();
    }

    const translationDiv = document.createElement('div');
    translationDiv.className = 'immersive-translation';

    const closeButton = document.createElement('span');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
      position: absolute;
      top: 5px;
      right: 5px;
      cursor: pointer;
      font-size: 16px;
      color: #666;
      width: 20px;
      height: 20px;
      line-height: 20px;
      text-align: center;
      background-color: rgba(255, 255, 255, 0.8);
      border-radius: 50%;
    `;
    closeButton.addEventListener('click', () => translationDiv.remove());

    const textContainer = document.createElement('div');
    textContainer.textContent = translatedText;
    textContainer.style.cssText = 'padding-right: 25px;';

    translationDiv.appendChild(closeButton);
    translationDiv.appendChild(textContainer);

    const computedStyle = window.getComputedStyle(element);
    translationDiv.style.cssText = `
      font-family: ${CONFIG.fontFamily};
      font-size: ${parseFloat(computedStyle.fontSize) * 1.2}px;
      color: ${computedStyle.color};
      margin-top: 0.5em;
      padding: 10px;
      background-color: rgba(0, 0, 0, 0.05);
      border-radius: 8px;
      position: relative;
    `;

    if (element.tagName === 'LI') {
      element.appendChild(translationDiv);
    } else {
      element.parentNode.insertBefore(translationDiv, element.nextSibling);
    }
  }

  static async translateSelection() {
    try {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      const selectedText = selection.toString().trim();
      if (!selectedText) return;

      const range = selection.getRangeAt(0);
      const loadingDiv = UIComponents.createSimpleLoadingIndicator();
      document.body.appendChild(loadingDiv);

      try {
        if (PageHandler.isWordOrPhrase(selectedText)) {
          const translatedWord = await TranslationService.translateWord(selectedText);
          if (translatedWord && translatedWord !== 'Translation failed') {
            this.addWordTranslation(range, translatedWord);
          }
        } else {
          const nodesToTranslate = this.getSelectedNodes(range);
          for (const node of nodesToTranslate) {
            const text = node.textContent.trim();
            if (text) {
              const translatedText = await TranslationService.translateText(text);
              if (translatedText && translatedText !== 'Translation failed') {
                this.addTranslation(node, translatedText);
              }
            }
          }
        }
      } finally {
        loadingDiv.remove();
      }
    } catch (error) {
      console.error('Selection translation error:', error);
      UIComponents.showMessage(`Translation failed: ${error.message}`, true);
    }
  }

  static getSelectedNodes(range) {
    const nodes = [];
    let node = range.startContainer;
    while (node && !TEXT_ELEMENTS.includes(node.nodeName)) {
      node = node.parentNode;
    }

    while (node) {
      if (TEXT_ELEMENTS.includes(node.nodeName) && range.intersectsNode(node)) {
        if (node.nodeName === 'UL' || node.nodeName === 'OL') {
          nodes.push(node);
        } else if (node.nodeName !== 'LI' || !nodes.includes(node.parentNode)) {
          nodes.push(node);
        }
      }

      if (node === range.endContainer || node.contains(range.endContainer)) break;
      node = node.nextElementSibling || (node.parentNode && node.parentNode.nextElementSibling);
    }

    return nodes;
  }

  static addWordTranslation(range, translatedText) {
    const existingPopup = document.querySelector('.word-translation-popup');
    if (existingPopup) existingPopup.remove();

    const rect = range.getBoundingClientRect();
    const popup = UIComponents.createTranslationPopup(translatedText, rect);

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    popup.style.left = `${scrollX + rect.left}px`;
    popup.style.top = `${scrollY + rect.bottom + 8}px`;

    document.body.appendChild(popup);

    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth) {
      popup.style.left = `${scrollX + rect.right - popupRect.width}px`;
    }
    if (popupRect.bottom > window.innerHeight) {
      popup.style.top = `${scrollY + rect.top - popupRect.height - 8}px`;
    }

    const closePopup = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closePopup);
      }
    };
    
    setTimeout(() => document.addEventListener('click', closePopup), 0);
  }
}


if (typeof browser !== 'undefined') {
  // Firefox
  browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message:', request);
    if (request.action === "translateSelection") {
      Translator.translateSelection();
    } else if (request.action === "translatePage") {
      Translator.translatePage();
    }
    return true;
  });
} else {
  // Chrome
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message:', request);
    if (request.action === "translateSelection") {
      Translator.translateSelection();
    } else if (request.action === "translatePage") {
      Translator.translatePage();
    }
    return true;
  });
}

console.log('Translation features enabled');
