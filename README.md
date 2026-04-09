# 🎨 Mixbox Palette for Adobe Photoshop

[点击查看中文版](#-mixbox-调色板---adobe-photoshop-插件)

A UXP plugin for realistic pigment mixing in Adobe Photoshop, with dual mixing engines.

![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)
![Mixbox License](https://img.shields.io/badge/Mixbox-CC%20BY--NC%204.0-lightgrey.svg)

## Features

### Professional Palettes
- **Winsor & Newton Cotman 16** - Classic pigment colors
- **Schmincke Horadam 16** - Professional artist-grade pigment colors
- **Kuretake Gansai 16** - Traditional Japanese pigment colors
- **Digital Artist Palette** - Common colors for digital painting

### Dual Mixing Engines
The plugin offers two physical color mixing engines, switchable via the **MB/KM** button in the top-left corner:

- **Mixbox (MB)** - Default engine. Uses the [Mixbox](https://scrtwpns.com/mixbox/) LUT-based algorithm for high-quality pigment mixing. Licensed under CC BY-NC 4.0.
- **KM** - Self-implemented engine. Uses a 32³ LUT to map RGB to 38-wavelength reflectance spectra (derived from [spectral.js](https://github.com/rvanwijnen/spectral.js), MIT), then applies Kubelka-Munk mixing in spectral space and converts back to RGB. GPL v3 licensed.

Both engines produce realistic subtractive color mixing (e.g., yellow + blue = green). You can switch between them at any time - the canvas is automatically repainted using your stroke history.

To compare both engines side by side, try the [KM Tuner](https://food211.github.io/Mixbox-Palette/km-tuner.html) tool included in this repository.

### Realistic Mixing
- **Adjustable paint concentration** (1-100) - Smooth curve mapping for finer control at low values
- **Brush size control** (2-50px)
- **6 brush presets** - Circle, Soft, Watercolor, Splatter, Flat, Dry; each tool remembers its last selected brush
- **Smudge tool** - Blend colors directly on canvas, with independent strength parameter
- **Right-click paint** - Right-click drag to paint with background color

### Tools & Shortcuts
- **Eyedropper** - `Alt + Left Click` for foreground, `Alt + Right Click` for background
- **Transfer to Photoshop** - Export a region of the mixing canvas directly to your active Photoshop layer
- **Zoom control** - 60%–150% zoom via the top-right dropdown
- **Focus indicator** - Blue bar at top when plugin captures keyboard focus
- **Undo/Redo** - Up to 50 steps of history
- **Auto-save** - Canvas, settings, and history automatically preserved
- **Bidirectional color sync** - Colors sync both ways: plugin selections update Photoshop, and Photoshop color changes (color picker, swatches, X to swap, D to reset) update the plugin

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

### From Adobe Marketplace

1. Visit [KM Watercolor Palette on Adobe Marketplace](https://exchange.adobe.com/apps/cc/cc9344fb/mixbox-watercolor-palette)
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
5. **Use in Photoshop** - Selected colors sync to Photoshop foreground/background automatically; conversely, changing colors in Photoshop (via color picker, swatches, or keyboard shortcuts) updates the plugin palette

### Transfer Pixels to Photoshop
1. Select an area on your Photoshop canvas with any selection tool
2. In the plugin, switch to the rect select tool (`M`)
3. Draw a region on the mixing canvas
4. The selected pixels are automatically transferred to the active layer at the selection bounds

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `B` | Brush tool |
| `S` | Smudge tool |
| `I` | Eyedropper tool |
| `M` | Rectangle select |
| `X` | Swap foreground/background colors |
| `Shift` (hold) | Temporary smudge tool |
| `Alt` (hold) | Temporary eyedropper |
| `Alt + Left Click` | Pick foreground color |
| `Alt + Right Click` | Pick background color |
| `Right Click` (drag) | Paint with background color |
| `Esc` | Exit rectangle select |

## Tech Stack

- **Mixing Engines**: Mixbox (LUT-based, CC BY-NC 4.0) + KM (38-wavelength Kubelka-Munk, spectral data from spectral.js MIT, GPL v3)
- **Rendering**: WebGL + Canvas 2D dual-buffer
- **Platform**: Adobe UXP + WebView
- **Hosting**: Cloudflare Pages (primary) / GitHub Pages (fallback)
- **Offline**: Service Worker with Cache-First strategy for reliable offline use
- **Storage**: localStorage for canvas, history, and settings persistence

## License

This project contains code under two licenses:

- **Original code** (KM engine, UI, etc.) — [GPL-3.0](LICENSE)
- **Mixbox library** (`js/mixbox.js`) — [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (non-commercial use only, by Secret Weapons)

When using the Mixbox engine, the CC BY-NC 4.0 restriction applies to the overall use. The KM engine has no such restriction.

## Trademarks

Adobe and Photoshop are either registered trademarks or trademarks of Adobe in the United States and/or other countries.

## Changelog

See [Changelog](https://food211.github.io/Mixbox-Palette/changelog.html) for version history.

## Support

- ⭐ Star this project
- 💬 [Join our Discord](https://discord.gg/d3ubWGpe) — bug reports, feedback, and discussion
- 🐛 [Report bugs](https://github.com/food211/Mixbox-Palette/issues)
- 💡 Suggest features
- ☕ Support my open-source work: Alipay food211@qq.com / WeChat 172660507

---

# 🎨 Mixbox 调色板 - Adobe Photoshop 插件

[Click here for English version](#-mixbox-palette-for-adobe-photoshop)

Adobe Photoshop UXP 调色板插件，内置双混色引擎，模拟真实颜料的混合效果。

## 功能特点

- **4 套专业调色盘预设** - 温莎牛顿 Cotman、施美尔 Horadam、吴竹 Gansai、数字艺术家
- **双混色引擎** - 左上角 MB/KM 按钮可随时切换：
  - **Mixbox (MB)** - 默认引擎，基于 [Mixbox](https://scrtwpns.com/mixbox/) LUT 算法（CC BY-NC 4.0）
  - **KM** - 自研引擎。使用 32³ LUT 将 RGB 映射到 38 波长反射率光谱（光谱数据来自 [spectral.js](https://github.com/rvanwijnen/spectral.js)，MIT 许可），在光谱空间中应用 Kubelka-Munk 公式混色后转回 RGB（GPL v3）
  - 切换引擎后画布会自动用笔画历史重绘，可使用 [KM Tuner](https://food211.github.io/Mixbox-Palette/km-tuner.html) 工具对比两种引擎的混色效果
- **可调节颜料浓度** (1-100)，低浓度区域平滑曲线映射，调节更细腻
- **6 种笔刷预设** - 圆形、柔和、水彩、飞溅、平头、干笔；画笔和涂抹工具各自记忆上次使用的笔刷
- **涂抹工具** - 在画布上直接混合颜色，独立强度参数
- **右键绘制** - 右键拖拽使用背景色绘制
- **吸管工具** - Alt + 左键/右键取色
- **传输至 PS** - 将混色画布的内容传输到 Photoshop 活动图层
- **缩放控制** - 右上角下拉菜单，60%–150%
- **焦点指示条** - 插件捕获键盘焦点时顶部亮起蓝色指示条
- **50 步撤销/重做**
- **自动保存** - 画布、历史记录和设置自动保存
- **双向颜色同步** - 插件选色自动同步到 Photoshop；反之，在 PS 中更改颜色（拾色器、色板、X 键交换、D 键复位）也会同步更新插件
- **中英文双语** - 自动跟随系统语言，支持手动切换

## 安装

### 通过 Adobe Marketplace

1. 访问 [KM Watercolor Palette - Adobe Marketplace](https://exchange.adobe.com/apps/cc/cc9344fb/mixbox-watercolor-palette)
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

## 快捷键

| 按键 | 功能 |
|------|------|
| `B` | 画笔工具 |
| `S` | 涂抹工具 |
| `I` | 吸管工具 |
| `M` | 矩形选取 |
| `X` | 交换前景/背景色 |
| `Shift`（按住）| 临时切换为涂抹工具 |
| `Alt`（按住）| 临时切换为吸管工具 |
| `Alt + 左键` | 取色为前景色 |
| `Alt + 右键` | 取色为背景色 |
| `右键`（拖拽）| 使用背景色绘制 |
| `Esc` | 退出矩形选取 |

## 使用说明

1. **选择调色盘** - 点击"Palette"按钮切换颜料品牌
2. **选取颜色** - 点击色块设置为前景色
3. **调整参数** - 笔刷大小和颜料浓度滑块
4. **混色** - 在混色画布上绘制以混合颜色
5. **同步到 PS** - 选取的颜色自动同步到 Photoshop 前景/背景色；反之，在 PS 中更改颜色也会同步到插件

### 传输像素到 Photoshop
1. 在 Photoshop 画布上用任意选区工具选好区域
2. 在插件中切换到矩形选取工具（`M`）
3. 在混色画布上框选要传输的内容
4. 所选像素自动传输到活跃图层的选区范围内

## 架构说明

插件采用 **WebView 混合架构**：远端（Cloudflare Pages / GitHub Pages）承载完整 UI 和混色引擎，本地 UXP Host 仅负责加载 WebView 和同步颜色到 Photoshop。支持双源自动切换（Cloudflare 优先，GitHub Pages 备用），首次加载后 Service Worker 以缓存优先策略提供离线支持。

## 许可证

本项目包含两种许可证的代码：

- **自研代码**（KM 引擎、UI 等）— [GPL-3.0](LICENSE)
- **Mixbox 库**（`js/mixbox.js`）— [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（仅限非商业用途，由 Secret Weapons 提供）

使用 Mixbox 引擎时，整体使用受 CC BY-NC 4.0 限制；KM 引擎无此限制。

## 商标声明

Adobe 和 Photoshop 是 Adobe 在美国和/或其他国家/地区的注册商标或商标。

## 更新日志

查看 [更新日志](https://food211.github.io/Mixbox-Palette/changelog.html) 了解版本历史。

## 赞助

- ⭐ Star 本项目
- 💬 [加入 Discord 社区](https://discord.gg/d3ubWGpe) — 反馈问题、提出建议、日常交流
- 🐛 [提交 Bug](https://github.com/food211/Mixbox-Palette/issues)
- 💡 提出功能建议
- ☕ 支持开源：支付宝 food211@qq.com / 微信 172660507
