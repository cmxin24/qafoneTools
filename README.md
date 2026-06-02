# qafoneTools

qafoneTools 是为QAF中文站志愿者制作的字幕组工具合集，支持 macOS 与 Windows 双平台。

## 功能

### 预处理

| 工具 | 说明 |
|------|------|
| 视频字幕提取 | 使用本地 AI 模型进行语音识别，输出 SRT 字幕文件 |
| 音频提取 | 从视频中提取音轨，支持试听、选轨、格式与码率设置 |
| 小版本压制 | 输出便于成员间传输的小体积 MP4 |
| 硬字幕提取 | 从已嵌入硬字幕的视频帧中提取文字字幕 |

### 翻译

导入原文 SRT，在时间轴视图中逐行翻译，支持波形图辅助对齐。

### 时间轴 / 二轴

制作中...

### 校对

导入翻译并生成校对稿，与翻译界面相同的时间轴视图和波形图辅助，并支持一键生成校对笔记。

### 特效

| 工具 | 说明 |
|------|------|
| 双语字幕分离 | 将双语 SRT 拆分为独立的中文与外语字幕文件 |
| ASS 样式配置 | SRT/ASS 转标准 ASS，按分辨率自动配置字体、字号和边距预设 |
| 致谢名单生成 | 从职位-姓名列表一键生成带淡入淡出效果的 ASS 致谢字幕 |
| Logo 生成器 | 按分辨率等比缩放，生成 QAFONE logo 的 ASS 特效代码 |
| 常用字体 | 下载字幕组常用字体，并自动检测安装情况 |

### 压制

| 工具 | 说明 |
|------|------|
| FFmpeg 命令生成器 | 通过可视化界面配置压制参数，生成可直接使用的 FFmpeg 命令 |

## 开发

### 环境要求

- **Node.js** ≥ 18
- **Rust** 稳定版（通过 [rustup](https://rustup.rs) 安装）
- **CMake** 和 C++ 编译器（用于编译 whisper.cpp）
  - macOS：`xcode-select --install`
  - Windows：Visual Studio Build Tools + CMake

### 本地启动

```bash
# 安装前端依赖
npm install

# 启动开发模式（Tauri 窗口 + Vite HMR）
npm run tauri:dev
```

### 构建发行版

```bash
npm run tauri:build
```

产物位于 `src-tauri/target/release/bundle/`。

### GitHub Release

项目已配置 GitHub Actions 自动构建 macOS 与 Windows 安装包。发布新版本时：

1. 确认版本号已更新：`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json`。
2. 提交并推送代码。
3. 在 GitHub 的 Actions 页面手动运行 `Release` workflow，或推送版本标签：

```bash
git tag qafoneTools-v0.1.0
git push origin qafoneTools-v0.1.0
```

构建完成后，GitHub 会创建一个 draft release，并上传 macOS `.dmg` 与 Windows `.exe` 安装包。

### 目录结构

```
src/                    # 前端（React）
  components/           # 通用组件（布局、UI）
  pages/                # 页面
    tools/              # 预处理工具页面
    effects/            # 特效工具页面
    encoding/           # 压制工具页面
  i18n/                 # 国际化（en.ts / zh.ts）
  contexts/             # React Context
src-tauri/              # 后端（Rust / Tauri）
  src/commands/         # Tauri 命令（ASR、压制、下载等）
  binaries/             # sherpa-onnx sidecar 二进制
```

## License

本项目采用 [AGPL-3.0 协议](LICENSE) 开源。
