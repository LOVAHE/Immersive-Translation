[English](README.md)

# 自适应翻译(v3.1.0)

自适应翻译是一个注重隐私的浏览器内嵌翻译扩展。它支持划词翻译、整页逐段翻译、单词词典气泡、翻译气泡样式自定义，并可选支持 YouTube 字幕、图片和 PDF 的 OCR/视觉翻译。

项目采用模块化 WebExtension 结构，并提供 Chrome 与 Firefox 的独立上架 manifest。

---

## 功能特性

- **划词翻译**：通过右键菜单翻译选中文本。
- **整页内嵌翻译**：将译文插入到原文段落、列表、标题等文本块下方。
- **词典气泡**：当选中内容像单个单词时，显示学习型词典结果。
- **样式自定义**：可设置字体、字号、文字颜色、气泡颜色和边框颜色。
- **YouTube 字幕**：可选双语字幕覆盖，并支持内置字幕/API 翻译优先级。
- **图片与 PDF 翻译**：使用内置 Tesseract.js 做本地 OCR，并可选使用支持视觉能力的 provider 兜底。
- **提示词编辑器**：可自定义 LLM 翻译和词典模式的 System/User 提示词。
- **多 provider 支持**：OpenAI、Gemini、Google Translate、Azure Translator、DeepL，以及可用时的 Chrome AI。
- **多语言 UI**：英文、中文、日文、韩文、法文、德文、西班牙文。
- **诊断工具**：调试日志、后台 Ping、provider 自检。

---

## 隐私模型

自适应翻译不会收集、记录、出售用户数据，也不会把用户数据上传到扩展开发者控制的服务器。

只有当用户主动触发翻译功能，或启用了字幕翻译等相关功能时，内容才会被处理。根据用户选择的 provider，选中文本、网页文本、OCR 内容、图片/PDF 内容或字幕可能会直接从扩展发送给用户配置的第三方翻译服务。

API Key 和偏好设置存储在浏览器扩展存储中，只用于调用用户选择的 provider。用户应自行查看所选第三方 provider 的隐私政策和服务条款。

当前上架用隐私政策草稿见：[PRIVACY_POLICY_DRAFT.md](docs/chrome-web-store/PRIVACY_POLICY_DRAFT.md)。

---

## 支持的 Provider

- **OpenAI**：文本翻译、词典模式和视觉相关翻译流程。
- **Gemini**：文本翻译、词典 JSON 和视觉相关翻译流程。
- **Google Translate**：文本翻译。
- **Azure Translator**：文本翻译。
- **DeepL**：文本翻译。
- **Chrome AI**：浏览器提供相关 API 时可用，仅 Chrome 支持，不作为 Firefox 版卖点。

Provider 位于 `providers/`，共享提示词逻辑位于 `prompts/`。

---

## 设置项

### 通用

- 翻译 provider
- 源语言
- 目标语言
- 单词选择时启用词典模式

### 样式

- 字体
- 字号
- 文字颜色
- 气泡背景颜色
- 边框颜色
- 实时预览

### 高级

- UI 语言
- 提示词编辑器
- OCR 设置
- YouTube 字幕设置
- 调试日志和诊断

---

## 开发模式安装

### Chrome / Chromium

1. 打开 `chrome://extensions`。
2. 启用 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择本项目目录。
5. 打开扩展选项页，配置 provider。

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 点击 **Load Temporary Add-on**。
3. 选择 `manifest.firefox.json`，或选择已打包 Firefox 构建中的 manifest。

正式 AMO 打包请使用下面的脚本。

---

## 打包

生成文件会写入 `dist/`。不要把 `dist/` 提交到源码仓库。

### Firefox AMO 安装包

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-firefox.ps1
```

会在 `dist/` 下生成带时间戳的 `.xpi`。

### AMO 源码审核包

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-amo-source.ps1
```

会生成供 Mozilla 审核使用的源码包，包含源码、vendor、manifest、构建脚本和 `SOURCE_BUILD_INSTRUCTIONS.md`，但不包含生成的 `dist/` 产物。

### Chrome Web Store 安装包

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-chrome.ps1
```

会使用 `manifest.chrome.json` 生成 Chrome 上传 zip。

---

## 上架 Manifest

- `manifest.json`：原始跨浏览器开发 manifest。
- `manifest.chrome.json`：Chrome Web Store 上架 manifest。
- `manifest.firefox.json`：Firefox AMO 上架 manifest。

Firefox 包使用 `background.scripts`。Chrome 包使用 `background.service_worker`。

---

## 项目结构

```text
background.js             扩展后台入口
content/                  页面翻译、图片覆盖、YouTube 覆盖
core/                     浏览器 API、设置、路由、i18n、日志
options/                  设置页和提示词编辑器
providers/                翻译 provider 适配器
prompts/                  共享提示词构建逻辑
ocr/                      OCR 集成
pdf/                      PDF 提取辅助逻辑
vendor/                   打包的 PDF.js 和 Tesseract.js 资源
_locales/                 浏览器扩展多语言文件
tools/                    发布打包脚本
docs/                     商店文案、隐私政策和审核说明
```

---

## 国际化

已包含语言：

```text
en, zh, ja, ko, fr, de, es
```

如需新增语言，请创建 `_locales/<lang>/messages.json` 并保持同样的 message keys。

---

## 审核说明

PDF.js 和 Tesseract.js 已作为本地依赖打包，用于 PDF 解析和 OCR。扩展运行时不会从远程地址下载这些代码。

动态 `import()` 仅用于在用户触发图片、PDF、OCR 或 YouTube 相关功能时，通过 `browser.runtime.getURL(...)` / `chrome.runtime.getURL(...)` 加载扩展内置模块。

---

## 许可证

本项目使用 GNU General Public License v3.0。详见 [LICENSE](LICENSE)。
