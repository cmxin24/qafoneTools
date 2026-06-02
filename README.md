# qafoneTools

qafoneTools 是为 QAF 中文站志愿者制作的字幕组桌面工具合集，支持 macOS 与 Windows 双平台。

## 功能状态

### 已可用

| 模块 | 工具 | 说明 |
|------|------|------|
| 预处理 | 视频字幕提取 | 使用本地 ASR 模型从视频或音频中提取 SRT 字幕，支持模型下载、识别进度、SRT 预览与导出 |
| 预处理 | 音频提取 | 使用 FFmpeg 读取视频音轨，支持试听、选轨、输出格式与码率设置 |
| 预处理 | 小版本压制 | 使用 FFmpeg 自动检测黑边、缩放分辨率，输出便于成员间传输的小体积 MP4 |
| 翻译 | 翻译工作台 | 导入视频与 SRT，逐行编辑译文，支持原文/译文/双语导出、翻译笔记、词汇对照表、波形辅助和字幕位置调整 |
| 校对 | 校对工作台 | 导入视频、翻译稿与校对文件，生成校对副本，支持最终译文编辑、校对笔记、校对文件导出、词汇对照表和波形辅助 |
| 特效 | 双语字幕分离 | 将双语 SRT 拆分为独立中文与外语字幕文件 |
| 特效 | ASS 样式配置 | 将 SRT/ASS 转换为标准 ASS，并按目标分辨率配置字体、字号和边距 |
| 特效 | 致谢名单生成 | 从职位-姓名列表生成带淡入淡出效果的 ASS 致谢字幕文本 |
| 特效 | Logo 生成器 | 按视频分辨率生成 QAFONE logo 的 ASS 特效代码 |
| 特效 | 常用字体 | 检测、下载并安装字幕组常用字体 |
| 压制 | FFmpeg 命令生成 | 根据视频和 ASS 字幕生成测试片段与正式压制命令 |

### 开发中

| 模块 | 状态 |
|------|------|
| 翻译 / 校对 | 基础编辑流程已可用，AI 辅助翻译等增强能力仍在开发中 |
| 时间轴 / 二轴 | 等待施法中 |
| 硬字幕提取 | 等待施法中 |

## 使用说明

- 视频字幕提取会下载本地模型文件，模型不会随安装包一起分发。
- 音频提取、小版本压制、分辨率检测、波形提取和压制命令测试依赖 FFmpeg。
- macOS / Windows 安装包暂未配置正式代码签名证书，首次打开时系统可能出现安全提示。

## 开发

### 环境要求

- **Node.js** `^20.19.0 || >=22.12.0`
- **Rust** 通过 [rustup](https://rustup.rs) 安装
- **CMake & C++ 编译器** 用于编译 whisper.cpp
  - macOS：`xcode-select --install`
  - Windows：Visual Studio Build Tools + CMake
- **FFmpeg** 建议安装到系统 PATH，便于本地调试音视频相关功能

### 本地启动

```bash
npm install
npm run tauri:dev
```

### 构建发行版

```bash
npm run tauri:build
```

产物位于：

```text
src-tauri/target/release/bundle/
```

## GitHub Release

项目已配置 GitHub Actions 自动构建 macOS 与 Windows 安装包。发布新版本时：

1. 更新版本号：`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json`。
2. 提交并推送代码。
3. 在 GitHub Actions 页面手动运行 `Release` workflow，或推送版本标签：

```bash
git tag qafoneTools-v0.1.0
git push origin qafoneTools-v0.1.0
```

构建完成后，GitHub 会创建 draft release，并上传 macOS `.dmg` 与 Windows `.exe` 安装包。

## 目录结构

```text
src/                    # 前端 React 代码
  components/           # 通用组件、布局和字幕编辑组件
  contexts/             # React Context
  i18n/                 # 中英文界面文案
  pages/                # 页面
    tools/              # 预处理工具
    effects/            # 字幕特效工具
    encoding/           # 压制辅助工具
src-tauri/              # Tauri / Rust 后端
  capabilities/         # Tauri 权限配置
  icons/                # 应用图标
  src/commands/         # Tauri 命令：ASR、FFmpeg、字体、模型管理等
```

## License

本项目采用 [AGPL-3.0 协议](LICENSE) 开源。
