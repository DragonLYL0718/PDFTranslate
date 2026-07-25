#!/usr/bin/env node
// PDFTranslate BabelDOC backend setup helper (optional convenience wrapper).
//
// Does the same as the recommended manual steps, in one command:
//   1. install BabelDOC via uv          (provides the `babeldoc` command)
//   2. install this app's backend via uv (provides `pdftranslate-backend`)
//   3. print how to start it
//
// The frontend injects two env vars so URLs are correct for your deployment:
//   PDFT_GIT  — GitHub repo URL, e.g. https://github.com/DragonLYL0718/PDFTranslate
//   PDFT_APP  — the page URL to return to after setup
//
// Run (from the app's "安装 BabelDOC" dialog, which fills in the env vars):
//   curl -fsSL <origin>/install-babeldoc.mjs | PDFT_GIT=... PDFT_APP=... node --input-type=module
import { execSync } from "node:child_process";

const GIT = process.env.PDFT_GIT || "";
const APP = process.env.PDFT_APP || "";

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf-8", timeout: 300000 }).trim(); }
  catch { return null; }
}

console.log("\n" + "=".repeat(60));
console.log("PDFTranslate BabelDOC 后端安装程序");
console.log("=".repeat(60));

// 1. uv is required
console.log("\n[1/3] 检查 uv...");
const uv = sh("uv --version");
if (!uv) {
  console.log("\n⚠️  需要先安装 uv（Python 包/工具管理器）：");
  console.log("  curl -LsSf https://astral.sh/uv/install.sh | sh");
  console.log("然后重启终端，再运行本脚本。\n");
  process.exit(1);
}
console.log(`✓ ${uv}`);

// 2. Install BabelDOC (isolated Python 3.12) — provides the `babeldoc` command
console.log("\n[2/3] 安装 BabelDOC（首次约 1-2 分钟）...");
sh("uv tool install --python 3.12 BabelDOC 2>&1");
const ver = sh("babeldoc --version 2>&1");
if (!ver) {
  console.log("\n❌ BabelDOC 未装好或不在 PATH 中。请重启终端后手动运行：");
  console.log("  uv tool install --python 3.12 BabelDOC\n");
  process.exit(1);
}
console.log(`✓ ${ver}`);

// 3. Install this app's backend from GitHub — provides `pdftranslate-backend`
console.log("\n[3/3] 安装 PDFTranslate 后端...");
if (!GIT || GIT.includes("<")) {
  console.log("\n⚠️  无法确定 GitHub 仓库地址（可能在本地开发环境运行）。");
  console.log("请手动安装后端：");
  console.log('  uv tool install --python 3.12 "git+https://github.com/DragonLYL0718/PDFTranslate.git#subdirectory=backend"\n');
} else {
  const spec = `git+${GIT}.git#subdirectory=backend`;
  const ok = sh(`uv tool install --python 3.12 "${spec}" 2>&1`);
  if (ok === null) {
    console.log("\n⚠️  后端安装失败，请手动运行：");
    console.log(`  uv tool install --python 3.12 "${spec}"\n`);
  } else {
    console.log("✓ PDFTranslate 后端已安装");
  }
}

// Done — how to run and use
console.log("\n" + "=".repeat(60));
console.log("✅ 安装完成！");
console.log("=".repeat(60));
console.log("\n📖 快速开始：");
console.log("1. 启动后端服务（保持这个窗口打开）：");
console.log("   pdftranslate-backend");
if (APP) {
  console.log("\n2. 回到 PDFTranslate 页面：");
  console.log(`   ${APP}`);
} else {
  console.log("\n2. 回到你打开的 PDFTranslate 页面");
}
console.log("\n3. 在「安装 BabelDOC」对话框点「测试连接」，成功后即可选高保真引擎。");
console.log("\n" + "=".repeat(60));
console.log("\n💡 提示：");
console.log("   • 后端需持续运行（终端不能关闭）");
console.log("   • 默认监听 http://localhost:8787");
console.log("   • 数据只保存在你的设备上，之后每次只需再运行 pdftranslate-backend\n");
