# Chrome Web Store Release Checklist

## Before Packaging

- Confirm `manifest.chrome.json` has no Firefox-only fields.
- Confirm `manifest.chrome.json` has no remote code host such as `cdn.jsdelivr.net`.
- Confirm every executable dependency is bundled in the extension package.
- Confirm no test API keys or private secrets are present.
- Confirm screenshots and listing text match actual behavior.
- Decide whether `https://*/v1/*` is acceptable for public review or should be replaced with a narrower endpoint list.

## Local Testing

- Load the packaged staging folder in `chrome://extensions`.
- Open the options page.
- Save provider settings.
- Switch UI language.
- Adjust translation style and confirm preview updates.
- Translate selected text.
- Translate a full page.
- Test dictionary mode.
- Test YouTube captions if listing mentions it.
- Test image/PDF OCR if listing mentions it.
- Run provider self-test for each provider you plan to advertise.

## Store Submission

- Upload the generated zip.
- Fill in listing title, short description, detailed description, category, and language.
- Upload screenshots.
- Fill in privacy practices.
- Paste permission justifications from `PERMISSION_JUSTIFICATIONS.md`.
- Provide a public privacy policy URL.
- Submit for review.

## Expected Review Risk Areas

- Broad `<all_urls>` content script access.
- Broad `https://*/v1/*` custom endpoint host permission.
- Handling page content and sending it to third-party translation providers.
- OCR/image/PDF processing.
- Any dependency that looks like remotely hosted code.
