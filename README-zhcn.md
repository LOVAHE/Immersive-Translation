# 沉浸式翻译（V3）

一个模块化、注重隐私的 Chromium 浏览器翻译扩展（Manifest V3）。  
它支持 **内嵌翻译**（直接显示在原文下方）、**单词词典气泡**、可选的 **推理查看**（🧠，用于支持链路推理的 LLM）、**YouTube 双语字幕**、以及 **PDF/图片 OCR → 翻译**——并且内置 **国际化（i18n）** 与可插拔的翻译服务系统。

---

## 功能特性

- **内嵌页面翻译** – 将译文直接注入到每个段落/列表/标题下方（无大型弹窗）。
- **词典气泡** – 当选中文本是单个单词时，显示简洁的学习词条。
- **推理查看（🧠）** – 如果模型返回 `<think>…</think>`，则显示一个按钮，可按需展开查看。
- **YouTube 字幕** – 双语覆盖；可选择 **内置** 或 **API** 优先。
- **PDF & 图片** – 使用本地 **Tesseract.js** OCR 提取文本，必要时回退至 **LLM 视觉识别**。
- **翻译服务（模块化）** – 内置 **OpenAI**、**Gemini**、**Azure Translator**，可按相同接口添加其他服务。
- **提示词编辑器** – 可自定义翻译和词典的 **System/User** 提示词。
- **多语言 UI（i18n）** – 英语、中文、日语、韩语、法语、德语、西班牙语。
- **诊断与日志** – 可开启调试日志；支持快速 ping 与自检。

---

## 设置（选项）

### 基本
- **翻译服务**：OpenAI / Gemini / ChromeAI / Google Translator / Azure Translator / DeepL Translator
- **源语言**：`"auto"` 或指定语言代码  
- **目标语言**：与 UI 语言独立  
- **词典模式**：当选中单词时使用词典视图

### 高级
- **UI 语言**（国际化）
- **YouTube 字幕**
  - **翻译源优先级**：*优先内置* / *优先 API*
  - **双语覆盖**：原文 + 译文
- **OCR**
  - 启用本地 OCR（Tesseract.js）
  - OCR 语言（逗号分隔，如 `eng,chi_sim,jpn`）
  - OCR 引擎：*本地（Tesseract.js）* 或 *仅 LLM Vision 回退*
  - 当 OCR 失败时使用 LLM Vision 回退
- **提示词**
  - **翻译提示词**：System & User
  - **词典提示词**：System & User
- **诊断**
  - 启用调试日志 / Ping / 自检

> API 密钥和接口地址在选项页配置，并通过 `chrome.storage.sync` 存储。

---

## 工作原理

- **内容脚本**会在每个文本块下方嵌入一个小型翻译卡片。
- **主要内容检测**优先选择 `<article>` / `<main>` / `[role="main"]` 及常见内容容器，若无则回退到整页。
- **词典 JSON** 数据格式：
  ```json
  {
    "headword": "string",
    "phonetic": "string|null",
    "senses": [
      { "pos": "string", "gloss_tl": "string", "examples": [ { "src": "string", "tgt": "string" } ] }
    ],
    "synonyms": ["string", "..."]
  }

* **推理**：如果翻译服务返回 `<think>…</think>`，则会从最终译文中去除，并单独暴露，以便 UI 显示 🧠 悬浮框。

---

## 翻译服务

内置适配器：

* **OpenAI**（Chat Completions，词典使用 JSON 模式）
* **Gemini**（生成式语言 API；词典通过 `response_mime_type: application/json` 获取 JSON）
* **Azure Translator**（标准文本翻译 API）

结构：

* `providers/base.js` – 公共接口
* `providers/openai.js`、`providers/gemini.js`、`providers/azure.js` – 具体适配器
* `prompts/common.js` – 通用提示词构建器（与服务无关）

添加新服务：

1. 实现 `translate()` / `define()`（可选实现 `visionTranslate()`）。
2. 在 `providers/index.js` 注册。
3. 如果需要密钥/接口地址，在选项 UI 添加输入字段。

---

## 安装（开发模式）

1. 克隆仓库。
2. 打开 **chrome://extensions** → 启用 **开发者模式**。
3. 点击 **加载已解压的扩展程序** → 选择项目文件夹。
4. 打开 **选项** 页 → 设置翻译服务密钥、目标语言，以及（可选）提示词。

> 如果选项页样式未显示，请确认 `tailwind.min.css`（或打包后的 CSS）存在并已被引用。

---

## 权限与隐私

* **权限**：`contextMenus`、`storage`、`scripting`、`activeTab`、`tabs`
* **站点权限**：仅启用你配置的翻译 API（OpenAI、Gemini、Azure 等）
* **隐私**

  * 文本仅发送至你选择的翻译服务，并且只在明确的翻译操作时发送。
  * 密钥通过 `chrome.storage.sync` 本地存储。
  * 本地 OCR（Tesseract.js）完全在页面内运行。
  * 调试日志可在选项页手动开启。

**请遵守各翻译服务的使用条款。**

---

## 快捷键与菜单

右键菜单：

* **翻译**（选中内容）
* **翻译页面**
* **翻译图片**
* **翻译 PDF（打开查看器）**

---

## 国际化（i18n）

已包含的语言：`en`、`zh`、`ja`、`ko`、`fr`、`de`、`es`。
若要添加新语言，请在 `_locales/<lang>/messages.json` 中按照现有键值格式编写。

---

## 路线图

* 自定义快捷键
