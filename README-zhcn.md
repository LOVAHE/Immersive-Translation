# 自适应翻译（3.2.0）

[English](README.md)

自适应翻译是一个注重隐私的浏览器内嵌翻译扩展。它支持划词翻译、整页逐段翻译、单词词典气泡、翻译气泡样式自定义，并可选支持 YouTube 字幕、图片和 PDF 的 OCR/视觉翻译。

项目采用模块化 WebExtension 结构，并提供 Chrome 与 Firefox 的独立上架 manifest。

---

## 功能特性

- **划词翻译**：通过右键菜单翻译选中文本。
- **整页内嵌翻译**：将译文插入到原文段落、列表、标题等文本块下方。
- **词典气泡**：当选中内容像单个单词时，显示学习型词典结果。
- **样式自定义**：可设置字体、字号、文字颜色、气泡颜色和边框颜色。
- **YouTube 字幕**：可选双语字幕覆盖，并支持内置字幕/API 翻译优先级。
- **图片与 PDF 翻译**：提供设备端 OCR，以及按可见页加载的双语 PDF 阅读器；原页与译页左右对照，原文可选择，译文按版面覆盖。
- **提示词编辑器**：可自定义 LLM 翻译和词典模式的 System/User 提示词。
- **多 provider 支持**：OpenAI、Gemini、Google Translate、Azure Translator、DeepL、可用时的 Chrome AI，以及实验性的本机 Codex 连接。
- **多语言 UI**：英文、中文、日文、韩文、法文、德文、西班牙文。
- **诊断工具**：调试日志、后台 Ping、provider 自检。

---

## 隐私模型

自适应翻译不会收集、记录、出售用户数据，也不会把用户数据上传到扩展开发者控制的服务器。

只有当用户主动触发翻译功能，或启用了字幕翻译等相关功能时，内容才会被处理。根据用户选择的 provider，选中文本、网页文本、OCR 内容、图片/PDF 内容或字幕可能会直接从扩展发送给用户配置的第三方翻译服务。

API Key 只存储在本机浏览器扩展存储中，普通偏好设置可以使用同步扩展存储；它们只用于调用用户选择的 provider。用户应自行查看所选第三方 provider 的隐私政策和服务条款。

实验性的 Codex provider 通过单独安装的本机 companion 和官方 Codex SDK 工作。它使用由 Codex 管理、存放在隔离本机配置中的专用 ChatGPT 登录；扩展与 companion 都不会读取或复制凭据文件。只有用户主动要求翻译的文本会经该 Codex 会话处理，并且强制拒绝 API Key 登录，避免静默切换为 API 计费。翻译请求全局串行；每个网页、打开的 PDF 或 YouTube 视频各自复用一个有界对话。完整翻译规则与用户偏好只在物理线程首轮发送，后续批次只发送当前文本和简短续接约束。模型可以使用 Codex 为该账户选择的默认值，也可以填写准确的自定义模型 ID。

当前上架用隐私政策草稿见：[PRIVACY_POLICY_DRAFT.md](docs/chrome-web-store/PRIVACY_POLICY_DRAFT.md)。

---

## 支持的 Provider

- **OpenAI**：文本翻译、词典模式和视觉相关翻译流程。
- **Gemini**：文本翻译、词典 JSON 和视觉相关翻译流程。
- **Google Translate**：文本翻译。
- **Azure Translator**：文本翻译。
- **DeepL**：文本翻译。
- **Chrome AI**：浏览器提供相关 API 时可用，仅 Chrome 支持，不作为 Firefox 版卖点。
- **Codex（实验性）**：Chrome/Chromium 通过 Native Messaging 连接本机 Codex SDK companion，支持自动或准确的自定义模型，并按翻译任务复用有界上下文；扩展中无需填写 API Key，当前 Firefox 版不支持。

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

如需使用实验性的 Codex provider，请在加载扩展后于设置中选择 Codex 并打开“安装指南”。同一版本发布物应同时提供独立的 companion ZIP 与校验文件。开发环境安装方法以及必须填写的准确扩展 ID 见 [companion/README.md](companion/README.md)。

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 点击 **Load Temporary Add-on**。
3. 选择 `manifest.firefox.json`，或选择已打包 Firefox 构建中的 manifest。

正式 AMO 打包请使用下面的脚本。

---

## 验证

打包前运行无需安装依赖的统一验证入口：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\verify.ps1
```

如果 `node` 不在 `PATH` 中，请通过 `-NodePath` 传入其可执行文件路径。

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
companion/                可选的本机 Codex SDK Native Messaging host
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

PDF.js 和 Tesseract.js 运行时代码已作为本地依赖打包，用于 PDF 解析和 OCR。OCR 语言数据会按需从 jsDelivr 下载；扩展运行时不会下载可执行代码。

动态 `import()` 仅用于在用户触发图片、PDF、OCR 或 YouTube 相关功能时，通过 `browser.runtime.getURL(...)` / `chrome.runtime.getURL(...)` 加载扩展内置模块。

---

## 许可证

本项目使用 GNU General Public License v3.0。详见 [LICENSE](LICENSE)。
