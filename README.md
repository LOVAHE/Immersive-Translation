[简体中文](README-zhcn.md)

# Adaptive Translation 3.2.0

Adaptive Translation is a privacy-minded browser extension for inline translation. It can translate selected text, translate full pages paragraph by paragraph, show dictionary bubbles for single words, customize translation bubble styles, and optionally translate captions, images, and PDFs with user-selected providers.

The extension is designed as a modular WebExtension project with separate Chrome and Firefox release manifests.

---

## Features

- **Selection translation**: translate selected text from the context menu.
- **Inline page translation**: insert translations below original paragraphs, list items, headings, and other readable text blocks.
- **Dictionary bubble**: show a learner-friendly dictionary entry when a selection looks like a single word.
- **Custom styles**: configure translation font, font size, text color, bubble color, and border color.
- **YouTube captions**: optional bilingual caption overlay with built-in/API priority.
- **Image and PDF translation**: on-device OCR plus a lazy bilingual PDF reader with original/translation page pairs, selectable source text, and translated layout overlays.
- **Prompt editor**: customize LLM system/user prompts for translation and dictionary mode.
- **Provider adapters**: OpenAI, Gemini, Google Translate, Azure Translator, DeepL, Chrome AI, and an experimental local Codex connection where available.
- **Internationalized UI**: English, Chinese, Japanese, Korean, French, German, and Spanish.
- **Diagnostics**: debug logging, background ping, and provider self-test.

---

## Privacy Model

Adaptive Translation does not collect, record, sell, or upload user data to servers controlled by the extension developer.

Content is processed only when the user triggers a translation feature or enables a related feature such as caption translation. Depending on the selected provider, selected text, page text, OCR content, image/PDF content, or captions may be sent directly from the extension to the third-party translation provider configured by the user.

API keys are stored in local browser extension storage; ordinary preferences may use synchronized extension storage. They are used only to call the provider selected by the user. Users should review the privacy policies and terms of the third-party providers they choose.

The experimental Codex provider uses a separately installed local companion and the official Codex SDK. It requires a dedicated ChatGPT sign-in managed by Codex in an isolated local profile; the extension and companion do not read or copy the credential file. Only user-requested translation text is sent through that Codex session, and API-key authentication is rejected so the provider cannot silently switch to API billing. Translation is globally serial, with one bounded conversation per webpage, opened PDF, or YouTube video. Complete translation rules and user preferences are sent only on the first turn of each physical thread; later batches send the current text and a short continuation constraint. The model can be left on the Codex-recommended default or set to an exact custom ID.

See [PRIVACY_POLICY_DRAFT.md](docs/chrome-web-store/PRIVACY_POLICY_DRAFT.md) for the current store-facing privacy policy draft.

---

## Supported Providers

- **OpenAI**: chat completions and vision-capable translation flows.
- **Gemini**: text, dictionary JSON, and vision-capable translation flows.
- **Google Translate**: text translation.
- **Azure Translator**: text translation.
- **DeepL**: text translation.
- **Chrome AI**: local Chrome AI provider where the browser exposes the required APIs. This is Chrome-only and not advertised for Firefox builds.
- **Codex (Experimental)**: Chrome/Chromium native connection to the local Codex SDK companion, with automatic or explicit model selection and bounded task-scoped conversation reuse. No API key is entered into the extension; Firefox support is not included in this release.

Providers are implemented in `providers/`, with shared prompt helpers in `prompts/`.

---

## Settings

### General

- Translation provider
- Source language
- Target language
- Dictionary mode for single-word selections

### Style

- Font family
- Font size
- Text color
- Bubble background color
- Border color
- Live preview

### Advanced

- UI language
- Prompt editor
- OCR settings
- YouTube caption preferences
- Debug logging and diagnostics

---

## Development Install

### Chrome / Chromium

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Open the extension options page and configure a provider.

To use the experimental Codex provider, select Codex in Settings and open **Setup guide** after loading the extension. The same release must include the separately built companion ZIP and checksum. Developer installation details and the exact Extension ID requirement are documented in [companion/README.md](companion/README.md).

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.firefox.json` or a packaged Firefox build manifest.

For AMO packaging, use the build script described below.

---

## Verification

Run the zero-install verification gate before packaging:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\verify.ps1
```

If `node` is not on `PATH`, pass its executable path with `-NodePath`.

## Packaging

Generated files are written to `dist/`. Do not commit `dist/` to source control.

### Firefox AMO Package

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-firefox.ps1
```

This creates a timestamped `.xpi` under `dist/`.

### AMO Source Package

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-amo-source.ps1
```

This creates a source archive for Mozilla review. It includes source files, bundled dependencies, manifests, build scripts, and `SOURCE_BUILD_INSTRUCTIONS.md`, but excludes generated `dist/` artifacts.

### Chrome Web Store Package

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-chrome.ps1
```

This creates a Chrome upload zip using `manifest.chrome.json`.

---

## Store Manifests

- `manifest.json`: original cross-browser development manifest.
- `manifest.chrome.json`: Chrome Web Store release manifest.
- `manifest.firefox.json`: Firefox AMO release manifest.

Firefox packaging uses `background.scripts`. Chrome packaging uses `background.service_worker`.

---

## Project Layout

```text
background.js             Extension background entry
content/                  Page translation, image overlay, YouTube overlay
core/                     Browser API, settings, routing, i18n, logging
options/                  Options UI and prompt editor
providers/                Translation provider adapters
prompts/                  Shared prompt builders
ocr/                      OCR integration
pdf/                      PDF extraction helpers
companion/                Optional local Codex SDK native-messaging host
vendor/                   Bundled PDF.js and Tesseract.js assets
_locales/                 Browser extension localization files
tools/                    Release packaging scripts
docs/                     Store listing, privacy, and review notes
```

---

## Internationalization

Included locales:

```text
en, zh, ja, ko, fr, de, es
```

To add a locale, create `_locales/<lang>/messages.json` with the same message keys.

---

## Notes For Reviewers

PDF.js and the Tesseract.js runtime are bundled locally for PDF parsing and OCR. OCR language data is downloaded from jsDelivr as needed; executable extension code is not downloaded at runtime.

Dynamic `import()` is used to load extension-bundled modules via `browser.runtime.getURL(...)` / `chrome.runtime.getURL(...)` when the user triggers image, PDF, OCR, or YouTube-related features.

---

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
