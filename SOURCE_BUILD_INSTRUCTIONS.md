# Source Build Instructions for AMO Review

This source archive is for Mozilla Add-ons review of Adaptive Translation.

## Submitted Extension

The submitted Firefox extension is generated from this source tree using:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-firefox.ps1
```

Run the command from the repository root.

Before packaging, run the source verification gate:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\verify.ps1
```

If `node` is not on `PATH`, pass its executable path with `-NodePath`.

The script:

1. Creates a timestamped staging folder under `dist/`.
2. Copies the extension source files and bundled dependencies.
3. Uses `manifest.firefox.json` as the package `manifest.json`.
4. Excludes the unused browser-side Tailwind compiler from the release package.
5. Creates a Firefox `.xpi` file under `dist/`.

No package manager install step is required for this submitted package.

## Bundled Third-Party Dependencies

The `vendor/` directory contains bundled third-party libraries used by extension features:

- PDF.js files are used for PDF parsing/rendering.
- Tesseract.js files are used for OCR.

These executable files are included locally in the extension package. OCR language data is downloaded from jsDelivr as needed; executable extension code is not downloaded at runtime.

## Notes

- `manifest.chrome.json` is included only for Chrome Web Store packaging and is not used for the Firefox AMO package.
- `manifest.firefox.json` is the source manifest used to create the Firefox package.
- Generated `dist/` artifacts are intentionally not included in this source archive.
