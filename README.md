# 🎨 Mixbox Watercolor Palette - Photoshop Plugin

A Photoshop UXP plugin for realistic watercolor mixing, powered by the [Mixbox](https://scrtwpns.com/mixbox/) physical color mixing algorithm.

![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)
![Mixbox](https://img.shields.io/badge/Powered%20by-Mixbox-blue)

## Features

### Professional Palettes
- **Winsor & Newton Cotman 16** - Classic watercolor pigments
- **Schmincke Horadam 16** - Professional artist-grade pigments
- **Kuretake Gansai 16** - Traditional Japanese watercolors
- **Digital Artist Palette** - Common colors for digital painting

### Realistic Mixing
- **Physical color mixing** - Mixbox algorithm simulates real pigment blending
- **Adjustable paint concentration** (1-50%) - Control color opacity and blending strength
- **Brush size control** (2-50px)
- **6 brush presets** - Circle, Soft, Watercolor, Splatter, Flat, Dry
- **Smudge tool** - Blend colors directly on canvas

### Tools & Shortcuts
- **Eyedropper** - `Alt + Left Click` for foreground, `Alt + Right Click` for background
- **Undo/Redo** - Up to 50 steps of history
- **Auto-save** - Canvas, settings, and history automatically preserved
- **Auto color sync** - Foreground/background color changes sync to Photoshop automatically

### Multilingual
- English and Chinese (中文) supported
- Auto-detects system language, with manual toggle (EN/ZH button)

## Architecture

This plugin uses a **WebView hybrid architecture**:

- **Remote UI** (GitHub Pages / Cloudflare Pages) - Full plugin UI, mixing engine, and brush system
- **UXP Host** (local `uxp-host/` directory) - Minimal bridge that loads the WebView and syncs colors to Photoshop via `executeAsModal` + `batchPlay`

Benefits: Users get updates automatically without reinstalling. Offline use is supported via Service Worker caching after first load.

### Dual-Source Failover
The plugin loads from Cloudflare Pages (`mixbox-palette.pages.dev`) by default, with automatic fallback to GitHub Pages if the primary source fails. This ensures accessibility for users in regions where GitHub may be restricted.

## Installation

### From Adobe Marketplace (Coming Soon)
> The plugin is currently under review. It will be available on Adobe Marketplace once approved.

1. Search for "Mixbox Watercolor Palette" in Adobe Marketplace
2. Install and open from Photoshop `Plugins` menu

### From Release (.ccx)
1. Download the latest `.ccx` file from [Releases](https://github.com/food211/Mixbox-Palette/releases)
2. Double-click the `.ccx` file to install
3. Open from Photoshop `Plugins` menu

### Developer Mode (UXP Developer Tool)
1. Clone this repository
2. Open Adobe UXP Developer Tool
3. Load the `uxp-host/` directory (NOT the root directory)
4. Open from Photoshop `Plugins` menu

## Usage

1. **Select a palette** - Click the "Palette" button to switch between paint brands
2. **Pick a color** - Click a color swatch to set as foreground color
3. **Adjust settings** - Brush size and paint concentration sliders
4. **Paint** - Draw on the mixing canvas to blend colors
5. **Use in Photoshop** - Selected colors sync to PS foreground/background automatically

### Eyedropper
- Hold `Alt` key to enter eyedropper mode
- `Alt + Left Click` on canvas → foreground color
- `Alt + Right Click` on canvas → background color

## Tech Stack

- **Mixing Engine**: [Mixbox](https://scrtwpns.com/mixbox/) - Physical pigment mixing algorithm
- **Rendering**: WebGL + Canvas 2D dual-buffer
- **Platform**: Adobe UXP + WebView
- **Hosting**: Cloudflare Pages (primary) / GitHub Pages (fallback)
- **Offline**: Service Worker with Stale-While-Revalidate caching
- **Storage**: localStorage for canvas, history, and settings persistence

## License

CC BY-NC 4.0 (Non-commercial use only) - Due to Mixbox library licensing.

## Support

- ⭐ Star this project
- 🐛 [Report bugs](https://github.com/food211/Mixbox-Palette/issues)
- 💡 Suggest features
- ☕ Support my open-source work: Alipay food211@qq.com / WeChat 172660507

---

# 🎨 Mixbox 水彩调色板 - Photoshop 插件

基于 [Mixbox](https://scrtwpns.com/mixbox/) 物理混色算法的 Photoshop UXP 调色板插件，模拟真实水彩颜料的混合效果。

## 功能特点

- **4 套专业调色盘预设** - 温莎牛顿 Cotman、施美尔 Horadam、吴竹 Gansai、数字艺术家
- **物理级混色** - 基于 Mixbox 算法，模拟真实水彩颜料混合
- **可调节颜料浓度** (1-50%)
- **6 种笔刷预设** - 圆形、柔和、水彩、飞溅、平头、干笔
- **涂抹工具** - 在画布上直接混合颜色
- **吸管工具** - Alt + 左键/右键取色
- **50 步撤销/重做**
- **自动保存** - 画布、历史记录和设置自动保存
- **前景色/背景色自动同步** - 颜色变化自动同步到 Photoshop
- **中英文双语** - 自动跟随系统语言，支持手动切换

## 安装

### 通过 Adobe Marketplace（即将上线）
> 插件正在审核中，审核通过后将上架 Adobe Marketplace。

1. 在 Adobe Marketplace 搜索 "Mixbox Watercolor Palette"
2. 安装后从 Photoshop `插件` 菜单打开

### 从 Release 下载 (.ccx)
1. 从 [Releases](https://github.com/food211/Mixbox-Palette/releases) 下载最新的 `.ccx` 文件
2. 双击 `.ccx` 文件即可安装
3. 从 Photoshop `插件` 菜单打开

### 开发者模式
1. 克隆本仓库
2. 打开 Adobe UXP Developer Tool
3. 加载 `uxp-host/` 目录（注意不是根目录）
4. 从 Photoshop `插件` 菜单打开

## 架构说明

插件采用 **WebView 混合架构**：远端（Cloudflare Pages / GitHub Pages）承载完整 UI 和混色引擎，本地 UXP Host 仅负责加载 WebView 和同步颜色到 Photoshop。支持双源自动切换（Cloudflare 优先，GitHub Pages 备用），首次加载后通过 Service Worker 支持离线使用。

## 许可证

CC BY-NC 4.0（仅限非商业用途）- 受 Mixbox 库许可证限制。

## 赞助

- ⭐ Star 本项目
- 🐛 [提交 Bug](https://github.com/food211/Mixbox-Palette/issues)
- 💡 提出功能建议
- ☕ 支持开源：支付宝 food211@qq.com / 微信 172660507
