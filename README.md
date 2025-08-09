# Immersive Translate (Modular, MV3)

A modular, privacy-minded translation extension for Chromium browsers (Manifest V3). It adds **inline translations** (embedded under original text), a **dictionary bubble** for single words, optional **reasoning peek** (🧠) for LLMs that return chain-of-thought, **YouTube bilingual captions**, and **PDF/Image OCR → translate**—with **i18n** and a pluggable provider system.

---

## Features

- **Inline page translation** – injects the translation directly under each paragraph/list/header (no big popup).
- **Dictionary bubble** – when the selection looks like a single word, show a concise learner’s entry.
- **Reasoning peek (🧠)** – if the model returns `<think>…</think>`, display a small button to reveal it on demand.
- **YouTube captions** – bilingual overlay; choose **Built-in** vs **API** priority.
- **PDF & Image** – extract text with local **Tesseract.js** OCR and (optionally) fall back to **LLM Vision**.
- **Providers (modular)** – **OpenAI**, **Gemini**, **Azure Translator** out of the box; adding others follows the same interface.
- **Prompts editor** – customize **System/User** prompts for translation & dictionary.
- **i18n UI** – English, 中文, 日本語, 한국어, Français, Deutsch, Español.
- **Diagnostics & logging** – toggle debug logs; quick ping & self-test.

---

## Settings (Options)

### General
- **Provider**: OpenAI / Gemini / Azure Translator  
- **Source language**: `"auto"` or a specific code  
- **Target language**: independent from UI language  
- **Dictionary mode**: use dictionary view for single-word selections

### Advanced
- **UI language** (i18n)
- **YouTube captions**
  - **Translation source priority**: *Prefer built-in* / *Prefer API*
  - **Bilingual overlay**: original + translation
- **OCR**
  - Enable local OCR (Tesseract.js)
  - OCR languages (comma-separated, e.g., `eng,chi_sim,jpn`)
  - OCR engine: *Local (Tesseract.js)* or *LLM Vision fallback only*
  - Use LLM Vision fallback if OCR fails
- **Prompts**
  - **Translate Prompt**: System & User
  - **Dictionary Prompt**: System & User
- **Diagnostics**
  - Enable debug logs / Ping / Self-test

> API keys/endpoints are configured on the options page and stored via `chrome.storage.sync`.

---

## How It Works

- **Content script** embeds a small translation card **under** each text block.
- **Main-content detection** prefers `<article>` / `<main>` / `[role="main"]` and common content containers, with fallback to the full page.
- **Dictionary JSON** contract:
  ```json
  {
    "headword": "string",
    "phonetic": "string|null",
    "senses": [
      { "pos": "string", "gloss_tl": "string", "examples": [ { "src": "string", "tgt": "string" } ] }
    ],
    "synonyms": ["string", "..."]
  }

* **Reasoning**: if the provider returns `<think>…</think>`, it is stripped from the final translation and exposed separately so the UI can show a 🧠 popover.

---

## Providers

Built-in adapters:

* **OpenAI** (Chat Completions, JSON mode for dictionary)
* **Gemini** (Generative Language API; JSON via `response_mime_type: application/json`)
* **Azure Translator** (standard text translation API)

Structure:

* `providers/base.js` – common interface
* `providers/openai.js`, `providers/gemini.js`, `providers/azure.js` – concrete adapters
* `prompts/common.js` – shared prompt builders (provider-agnostic)

Adding a provider:

1. Implement `translate()` / `define()` (and optionally `visionTranslate()`).
2. Register it in `providers/index.js`.
3. Add fields to the Options UI for keys/endpoints if needed.

---

## Install (Development)

1. Clone the repo.
2. Open **chrome://extensions** → enable **Developer mode**.
3. Click **Load unpacked** → select the project folder.
4. Open the **Options** page → set provider keys, target language, and (optionally) prompts.

> If styles on the Options page don’t appear, ensure `tailwind.min.css` (or your bundled CSS) is present and referenced.

---

## Permissions & Privacy

* **Permissions**: `contextMenus`, `storage`, `scripting`, `activeTab`, `tabs`
* **Host permissions**: only the APIs you enable (OpenAI, Gemini, Azure, etc.)
* **Privacy**

  * Text is sent **only** to the provider you select, and only for explicit translation actions.
  * Keys are stored locally via `chrome.storage.sync`.
  * Local OCR runs fully in-page (Tesseract.js).
  * Debug logging is opt-in on the Options page.

**Please follow the Terms of Service** of each provider.

---

## Keyboard & Menus

Right-click:

* **Translate** (selection)
* **Translate Page**
* **Translate Image**
* **Translate PDF (open viewer)**

---

## Internationalization (i18n)

Locales included: `en`, `zh`, `ja`, `ko`, `fr`, `de`, `es`.
To add languages, place `_locales/<lang>/messages.json` following existing keys.

---

## Roadmap

* Custom keybindings
