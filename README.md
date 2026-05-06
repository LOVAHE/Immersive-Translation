[English](README.md) | [简体中文](README-zhcn.md)

# Immersive Translation v3.0.1

Immersive Translation is a browser extension for inline translation and bilingual reading. It focuses on translating content in-place (instead of redirecting to external pages) and supports multiple providers, OCR, YouTube subtitles, and dictionary-style word explanations.

## What this project does

- Translate selected text from the context menu.
- Translate full web pages block-by-block and render bilingual content inline.
- Show dictionary-style explanations when a selection looks like a single word.
- Translate YouTube subtitles with optional bilingual overlay.
- Translate text in images and PDF files via OCR (Tesseract.js) and provider APIs.
- Let users switch translation providers and tune prompts/styles in the options page.

## Core capabilities

### 1) Inline web translation
The extension injects content scripts and inserts translated text directly below paragraphs, list items, and headings while keeping the original page structure.

### 2) Multi-provider architecture
Provider adapters are modular and currently include:

- OpenAI
- Gemini
- Google Translate
- Azure Translator
- DeepL
- Chrome built-in AI (when available)

### 3) OCR and PDF support
- `ocr/tesseract.js` provides local OCR integration.
- `pdf/extract.js` and `pages/pdf_viewer.*` handle PDF text extraction/preview workflows.
- Bundled assets in `vendor/` avoid runtime CDN dependency for OCR/PDF engines.

### 4) YouTube subtitle translation
`content/youtube.js` provides subtitle detection, translation, and bilingual rendering logic.

### 5) Options and customization
Users can configure:

- provider, source/target language
- dictionary mode behavior
- translation bubble style (font, size, colors)
- custom prompts
- OCR and subtitle behavior

## Project structure

```text
background.js             Background event orchestration
content/                  Page translation / image overlay / YouTube logic
core/                     Settings, browser wrappers, i18n, utils, logging
providers/                Provider adapters and routing
options/                  Extension options UI and prompt editor
prompts/                  Shared prompt templates/helpers
ocr/                      OCR pipeline
pdf/                      PDF extraction helpers
pages/                    Internal extension pages (PDF viewer)
vendor/                   Bundled third-party runtime assets
_locales/                 I18n message catalogs
```

## Install for development

1. Open `chrome://extensions` (or the equivalent extension debug page in your browser).
2. Enable Developer Mode.
3. Click “Load unpacked”.
4. Select this repository folder.
5. Open extension options and configure at least one translation provider.

## Privacy notes

- This project does not include a backend service operated by the repository owner.
- Translation requests are sent directly from the extension to the provider selected by the user.
- API keys and user settings are stored in browser extension storage.

See also: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
