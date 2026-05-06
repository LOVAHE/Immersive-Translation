[English](README.md) | [简体中文](README-zhcn.md)

# 沉浸式翻译扩展 v3.0.1

这是一个用于浏览器的沉浸式翻译扩展，核心目标是“就地双语阅读”：在网页原文附近直接插入译文，而不是跳转到外部翻译页面。项目同时支持多翻译服务、图片/PDF OCR、YouTube 字幕翻译和词典式释义。

## 项目主要用途

- 右键划词翻译选中文本。
- 整页逐块翻译，并以内嵌方式显示双语内容。
- 当选中内容像单词时，显示词典式解释。
- 翻译 YouTube 字幕，并可显示双语字幕层。
- 通过 OCR 与翻译服务处理图片和 PDF 中的文字。
- 在选项页中自定义 Provider、提示词、样式和行为。

## 核心能力说明

### 1）网页内嵌翻译
扩展通过内容脚本对页面文本块（段落、列表、标题等）进行处理，把译文插入在原文附近，尽可能保持原页面阅读体验。

### 2）多 Provider 架构
当前实现了模块化 Provider 适配器，包含：

- OpenAI
- Gemini
- Google Translate
- Azure Translator
- DeepL
- Chrome 内置 AI（在可用环境下）

### 3）OCR 与 PDF 支持
- `ocr/tesseract.js`：本地 OCR 集成。
- `pdf/extract.js` 与 `pages/pdf_viewer.*`：PDF 文本提取和页面处理。
- `vendor/`：打包了 OCR/PDF 相关运行时资源，减少运行时外部依赖。

### 4）YouTube 字幕翻译
`content/youtube.js` 负责字幕检测、翻译与双语渲染逻辑。

### 5）选项与可定制能力
可配置内容包括：

- Provider、源语言、目标语言
- 单词词典模式行为
- 翻译气泡样式（字体、字号、颜色）
- 自定义提示词
- OCR 与字幕相关行为

## 项目结构

```text
background.js             后台事件与任务调度
content/                  网页翻译 / 图片覆盖 / YouTube 逻辑
core/                     设置、浏览器封装、i18n、工具与日志
providers/                各翻译服务适配器与路由
options/                  选项页与提示词编辑器
prompts/                  公共提示词模板与辅助逻辑
ocr/                      OCR 流程
pdf/                      PDF 提取辅助逻辑
pages/                    扩展内部页面（如 PDF viewer）
vendor/                   打包的第三方运行时资源
_locales/                 多语言文案
```

## 开发安装方式

1. 打开 `chrome://extensions`（或浏览器对应扩展调试页）。
2. 启用开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库目录。
5. 打开扩展选项页，至少配置一个翻译 Provider。

## 隐私说明

- 本项目本身不提供由仓库作者运营的在线后端。
- 翻译请求由扩展直接发送到用户选择的第三方 Provider。
- API Key 与用户设置保存在浏览器扩展存储中。

详见：[PRIVACY_POLICY.md](PRIVACY_POLICY.md)。

## 许可证

GNU General Public License v3.0，详见 [LICENSE](LICENSE)。
