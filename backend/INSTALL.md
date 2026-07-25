# BabelDOC 后端安装指南

PDFTranslate 的高保真引擎（引擎 B）需要一个本地 Python 后端。

## 使用方式

有两种使用 PDFTranslate 的方式：

### 方式 1：完整本地部署（后端 + 前端）
- 前端在本地运行：`npm run dev` 或后端提供
- 后端在本地运行：`python -m pdftranslate_backend`
- 访问：http://localhost:8787

**优点**：无需网络、所有数据本地保存
**推荐用于**：开发、完全离线工作

### 方式 2：GitHub Pages 前端 + 本地后端（推荐用户方案）
- 前端在 GitHub Pages 上：https://dragonlyl0718.github.io/PDFTranslate
- 后端在本地运行：`python -m pdftranslate_backend`
- 前端自动发现本地后端

**优点**：一次安装，前端总是最新；后端保证数据隐私
**推荐用于**：最终用户、日常使用

## 前置要求

- **Python 3.12+**（或系统 Python 3.10+）
- **uv** 或 **pip**

## 快速开始（推荐：用 uv，无需克隆仓库）

**第 1 步：安装 BabelDOC**（提供 `babeldoc` 命令）
```bash
uv tool install --python 3.12 BabelDOC
babeldoc --version   # 验证
```

**第 2 步：安装后端**（提供 `pdftranslate-backend` 命令）
```bash
uv tool install --python 3.12 "git+https://github.com/DragonLYL0718/PDFTranslate.git#subdirectory=backend"
```

**第 3 步：启动**
```bash
pdftranslate-backend
```

就这样！后端会在 `http://localhost:8787` 上运行。之后每次只需再运行 `pdftranslate-backend`。

> 没有 uv？先装（装完重启终端）：`curl -LsSf https://astral.sh/uv/install.sh | sh`

### 一键脚本（可选，需 Node.js）

如果已装 Node.js，可用应用内「安装 BabelDOC」对话框提供的一条命令自动完成上述步骤。

### 从源码开发

如果你克隆了仓库要改代码：
```bash
uv pip install -e ./backend
python -m pdftranslate_backend
```

## 验证

成功启动后，你应该看到：
```
INFO:     Uvicorn running on http://127.0.0.1:8787
```

### 验证后端是否正常运行

```bash
curl http://localhost:8787/api/health
```

应该看到：
```json
{
  "ok": true,
  "name": "pdftranslate-backend",
  "version": "0.1.0",
  "babeldoc": "babeldoc 0.6.4"
}
```

### 访问 PDFTranslate 前端

**选项 1：完整本地部署**
- 访问 http://localhost:8787（后端自动提供前端）

**选项 2：GitHub Pages（推荐用户方案）**
- 访问 https://dragonlyl0718.github.io/PDFTranslate/
- 前端会自动发现本地后端
- 选择「高保真（BabelDOC）」引擎开始翻译

## 常见问题排查

### ❌ "BabelDOC 命令不可用"

```bash
# 1. 检查是否安装
which babeldoc

# 2. 验证 Python 环境
python -m site

# 3. 重启终端（必要）
# 关闭所有终端窗口，重新打开
```

**macOS/Linux 用户**：可能需要将 uv 的 bin 目录加入 PATH。安装后会有提示。

### ❌ "连接后端失败"

检查清单：
1. **后端是否运行？**
   ```bash
   curl http://localhost:8787/api/health
   ```

2. **前端是否构建？**
   ```bash
   # 检查 dist/ 目录是否存在
   ls dist/
   ```
   如果不存在，运行 `npm run build`

3. **BabelDOC 是否安装？**
   ```bash
   babeldoc --version
   ```

4. **查看后端错误日志**
   - 后端启动时应该显示 BabelDOC 版本信息
   - 如果显示"⚠️ 前端文件未找到"，运行 `npm run build` 再重启

### ❌ "npm run build 失败"

```bash
# 1. 清除 node_modules
rm -rf node_modules
npm install

# 2. 重新构建
npm run build

# 3. 检查构建输出
ls -la dist/
```

### ❌ "pip install -e ./backend 失败"

```bash
# 使用 uv 而不是 pip
uv pip install -e ./backend

# 或升级 pip
pip install --upgrade pip setuptools wheel
pip install -e ./backend
```

## 一键安装脚本

在 PDFTranslate 目录中运行（需要 Node.js）：

```bash
curl -fsSL https://your-pdftranslate-url/install-babeldoc.mjs | node --input-type=module
```

这会自动：
1. 检查/安装 uv
2. 安装 BabelDOC
3. 构建前端
4. 安装后端
5. 显示启动命令

## Docker 方式（可选）

```bash
# 构建镜像
docker build -t pdftranslate-backend ./backend

# 运行容器
docker run -p 8787:8787 pdftranslate-backend
```

需要前端已构建在 `dist/` 目录。

## 文件结构

```
PDFTranslate/
├── backend/
│   ├── pyproject.toml          # 后端配置
│   ├── pdftranslate_backend/
│   │   └── __init__.py         # 主程序
│   ├── Dockerfile              # Docker 配置
│   └── INSTALL.md              # 本文件
├── public/
│   └── install-babeldoc.mjs    # 一键安装脚本
├── dist/                       # 前端构建输出（运行 npm run build）
├── package.json
└── README.md
```

## 卸载

```bash
# 卸载后端包
pip uninstall pdftranslate-backend

# 卸载 BabelDOC
pip uninstall BabelDOC
uv tool uninstall BabelDOC
```

## 获取帮助

- [BabelDOC 官方仓库](https://github.com/funstory-ai/BabelDOC)
- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [uv 文档](https://docs.astral.sh/uv/)
