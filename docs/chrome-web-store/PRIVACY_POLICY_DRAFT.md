# Privacy Policy Draft

Last updated: 2026-07-16

Adaptive Translation translates web content that you explicitly ask it to translate. This policy explains what data the extension may process locally, when content may be sent to user-selected third-party translation providers, and what the developer does not collect.

## Developer Data Collection

Adaptive Translation does not collect, record, sell, or upload user data to servers controlled by the extension developer.

The developer does not operate a backend service for this extension. The extension does not send browsing history, translated content, API keys, settings, or analytics to the developer.

## Data The Extension May Process Locally

The extension may process:

- Text you select for translation.
- Page text when you choose to translate a page.
- Image or PDF content when you choose OCR or vision translation.
- YouTube caption text when you enable caption translation.
- Extension settings such as source language, target language, selected provider, OCR settings, and translation display style.
- API keys or endpoint settings you enter for translation providers.
- The status of the optional local Codex companion connection. The extension does not read, copy, or store Codex credentials.

## How Data Is Used

Adaptive Translation uses content and settings only to perform the features requested by the user, such as translation, dictionary lookup, OCR, caption translation, and display customization.

Content is processed only after the user triggers a translation action or enables a translation feature. API keys and settings are stored in browser extension storage and are used only to call the translation provider selected by the user.

When OCR is used, the extension may download the selected Tesseract language data from jsDelivr. That request downloads language-model data only; the image or PDF being recognized is not sent to jsDelivr.

This data is not sent to the extension developer.

## Third-Party Translation Providers

Depending on your selected provider and enabled features, translation content may be sent to one of the following services:

- OpenAI
- Google Gemini
- Google Translate
- Microsoft Azure Translator
- DeepL
- OpenAI Codex, only when the experimental Codex provider is selected and its local companion is enabled

Requests are sent directly from the extension to the provider selected and configured by the user. The extension developer does not receive these requests.

Each provider processes submitted content according to its own terms and privacy policy. Users are responsible for reviewing the privacy policies and terms of the third-party provider they choose.

For Codex translation, text is passed over Chrome Native Messaging to the separately installed Adaptive Translation companion. The companion uses the official Codex SDK with a dedicated ChatGPT sign-in stored by Codex in an isolated local profile. It rejects API-key authentication and does not inherit API-key environment variables or the user's ordinary Codex configuration. Codex work is globally serial. A webpage, opened PDF, or individual YouTube task can reuse one bounded read-only, no-network-tools, no-approval thread for consistent terminology; unrelated tasks do not share a conversation, and selection translation uses a short thread. Sessions are discarded on cancellation, timeout, failure, configuration change, explicit close, capacity rotation, or host shutdown. Every turn returns only structured translations. Eligibility, configured-model availability, and usage limits depend on the signed-in ChatGPT account; the extension cannot inspect the subscription plan. Organization-managed Codex policy may still apply.

Unregistering the native companion does not automatically erase that isolated Codex profile. The companion's explicit logout option asks Codex to clear its cached ChatGPT authentication, while non-credential local session files may remain until the user removes the profile.

## Data Sharing And Sale

The extension developer does not sell user data and does not use translated content for advertising.

The extension does not share user data with the developer. User-requested translation content may be sent only to the third-party translation provider selected by the user in order to provide the requested translation feature.

## Browsing Activity

The extension can run on web pages so it can provide inline translation. It does not collect browsing history for analytics or advertising. Page content is processed only to provide translation features requested by the user.

## API Keys

API keys entered in the options page are stored in local browser extension storage. They are used only to call the provider selected by the user. They are not sent to the extension developer.

## Contact

Add developer contact email or support URL here before publishing.
