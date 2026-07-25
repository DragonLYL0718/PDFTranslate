# PDFTranslate

AI 驱动的 **PDF 翻译器**，尽量保持原文排版与位置（对标 Immersive Translate / BabelDOC 的效果）。**本地优先**：所有文档、翻译、术语库、API Key 都只存在浏览器本地（IndexedDB），不上传云端。

## 特性

- 📄 多方式导入：点击 / 拖拽 / 网络链接 / 本地文件；可选翻译页数范围
- 🌐 自动识别或手选原文语言，翻译为任意目标语言
- 🧩 保持排版：文字块原位置重排叠加，左右对照 / 仅译文 / 仅原文
- 📚 术语库：翻译时自动抽取专有名词，可编辑并按区域重新生成
- 💾 翻译记忆缓存：相同段落不重复翻译，省费提速（可在设置清除）
- 🔌 像 cc switch 一样配置多个 AI 提供商（OpenAI 兼容 / Claude / Gemini …），免费 Google 翻译兜底
- 📝 文字标注与评论 · 导出原文 / 纯译 / 双语 PDF
- 🎨 现代化 UI，深浅色主题

## 使用方式

### 方式 A：仅使用浏览器引擎（零配置）
- 访问 GitHub Pages 上的网站
- 使用默认的浏览器启发式引擎
- 完全在浏览器中工作，无需安装任何东西

### 方式 B：添加本地 BabelDOC 后端（高保真）

用 [uv](https://docs.astral.sh/uv/) 安装，无需克隆仓库：

```bash
# 1. 安装 BabelDOC（隔离 Python 3.12，提供 `babeldoc` 命令）
uv tool install --python 3.12 BabelDOC

# 2. 安装后端（提供 `pdftranslate-backend` 命令）
uv tool install --python 3.12 "git+https://github.com/DragonLYL0718/PDFTranslate.git#subdirectory=backend"

# 3. 启动后端（保持运行）
pdftranslate-backend
```

然后访问 GitHub Pages 站点，在「安装 BabelDOC」对话框点「测试连接」，成功后选择「高保真（BabelDOC）」引擎即可。之后每次只需再运行 `pdftranslate-backend`。

> 应用内的「安装 BabelDOC」对话框会根据你的部署地址自动填好上面的仓库 URL。

详见 [`backend/INSTALL.md`](backend/INSTALL.md)。

## 架构

- **引擎 A（浏览器启发式）**：PDF.js + AI LLM，部署在 GitHub Pages，无需配置。
- **引擎 B（高保真 BabelDOC）**：本地 Python 后端（AGPL-3.0，可选），提供最佳排版保留效果。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/
```

推送到 `main` 触发 GitHub Actions 构建并发布到 Pages。

## 许可证

前端代码采用 MIT。可选的 `backend/` 组件基于 BabelDOC，遵循 **AGPL-3.0**，作为独立进程通过本地 HTTP API 调用。
