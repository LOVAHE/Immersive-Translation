# Chrome Web Store Permission Justifications

Use these as the starting point for the Chrome Web Store privacy and permissions forms.

## Single Purpose

This extension translates user-requested web content in place. It supports selected text translation, page translation, dictionary bubbles, image/PDF OCR translation, YouTube caption translation, and customization of the translation display.

## Permissions

### contextMenus

Used to add right-click menu actions for translating selected text, translating a page, translating an image, and opening a PDF in the extension viewer.

### storage

Used to save extension settings, including target language, selected translation provider, OCR settings, display style preferences, and user-provided provider API keys.

### scripting

Used to inject the bundled content script when the user triggers a translation action on a page where the content script is not already available.

### activeTab

Used with user-triggered context menu actions to access the current tab for translation.

### tabs

Used to send translation messages to the active tab and to open the extension options page or bundled PDF viewer.

### offscreen

Used only for Chrome AI / local model flows that require a document context instead of the Manifest V3 service worker context.

### nativeMessaging (optional)

Requested only after the user selects Codex and clicks **Enable connection**. It connects to the separately installed Adaptive Translation Codex companion, which sends user-requested translation text through a dedicated ChatGPT sign-in managed by Codex in an isolated local profile. The extension does not read Codex credential files, invoke a shell, or connect to arbitrary native hosts.

## Host Permissions

### <all_urls> content script access

The extension needs to run a content script on pages the user wants to translate so it can read selected/page text and render translations inline. The extension does not translate page content unless the user triggers a translation action.

### translation.googleapis.com

Used only when the user selects Google Translate as the provider.

### api.cognitive.microsofttranslator.com

Used only when the user selects Azure Translator as the provider.

### api.deepl.com and api-free.deepl.com

Used only when the user selects DeepL as the provider.

### api.openai.com

Used only when the user selects OpenAI as the provider.

### generativelanguage.googleapis.com

Used only when the user selects Gemini as the provider.

### cdn.jsdelivr.net

Used only to download Tesseract OCR language data after the user triggers OCR. The extension does not load executable code from this host.

### https://*/v1/*

Used for OpenAI-compatible custom endpoints entered by the user. This is a broad permission and may need extra review justification or a future optional-permission flow before public release.

### http://*/*, https://*/*, and file:///* (optional)

Requested for only the origin of a PDF link the user explicitly opens from the context menu. The permission lets the bundled PDF reader fetch that document. The PDF URL is handed to the reader through one-time extension storage and is removed immediately after use.

## Store Review Notes

- All executable code is bundled in the submitted package. The jsDelivr permission is limited to non-executable OCR language data.
- The extension sends user-requested text/image/PDF/caption content only to the provider selected by the user.
- Codex is an experimental, explicitly selected provider. It requires a separately installed local companion; it is never used as an automatic fallback.
