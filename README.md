# 🎨 Mixbox Palette for Adobe Photoshop

[点击查看中文版](#-mixbox-调色板---adobe-photoshop-插件) · [日本語版はこちら](README.ja.md)

A watercolor palette for Adobe Photoshop where colors mix like real paint.

Mix colors right in your browser: [Use it online for free](https://mixbox-palette.pages.dev/) (to send your colors or painting to Photoshop, install the [plugin](#installation))

![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)
![Mixbox License](https://img.shields.io/badge/Mixbox-CC%20BY--NC%204.0-lightgrey.svg)

<img src="https://raw.githubusercontent.com/food211/Mixbox-Palette/main/icons/Designed_for_Adobe_Photoshop_badge_dark.svg#gh-dark-mode-only" height="40">
<img src="https://raw.githubusercontent.com/food211/Mixbox-Palette/main/icons/Designed_for_Adobe_Photoshop_badge_light.svg#gh-light-mode-only" height="40">

<img src="./assets/gifs/red_blue_yellow.gif" alt="Red + blue + yellow mixing" width="480">

*Mixes like real paint — yellow + blue makes green, not muddy gray.*

---

## Watercolor brushes

<img src="./assets/gifs/watercolor.gif" alt="Watercolor strokes" width="480">

Layered watercolor strokes blend naturally — wet edges, soft transitions, adjustable concentration (1–100).

## Smudge & blend on canvas

<img src="./assets/gifs/watercolor_mix.gif" alt="Smudge tool blending watercolor" width="480">

Smudge tool blends colors directly on the canvas, just like mixing paint on a palette.

## Value ruler

<img src="./assets/gifs/value_ruler.gif" alt="Value ruler tracks brightness" width="480">

Picks a color, the ruler shows its perceived brightness. Great for keeping values under control.

## Resizable canvas

<img src="./assets/gifs/resize_canvas.gif" alt="Drag handles to resize canvas" width="480">

Drag the handles on either side of the black panel to resize the mixing canvas (480–2000px).

---

## Two Mixing Engines — KM and MB

The plugin offers two ways of mixing paint: **KM** (the default, made for this plugin) and **MB** (Mixbox). Most mixes look nearly the same in both, so you can simply stay with the default.

- **KM — sensitive.** Small differences between two paints show up in the mix, the way real paint behaves. Some blue + yellow mixes lean a little greener.
- **MB — forgiving.** Slightly different paints still give nearly the same mix.

You'll notice the difference most when two colors are mixed in roughly equal amounts.

**Selling your work?** KM is the safe choice. Mixbox's license only allows non-commercial use; KM was made from scratch without that restriction. See [License](#license).

**To switch**, click the panel title in the top-left (it reads **KM Palette** or **Mixbox Palette**, with a ⇄ arrow next to it). What you've painted is redrawn with the new engine, so nothing is lost. To compare the two side by side, open the [KM Tuner](https://food211.github.io/Mixbox-Palette/km-tuner.html).

<details>
<summary>Technical details</summary>

- **Why two engines**: the plugin was first built on [Mixbox](https://scrtwpns.com/mixbox/) (CC BY-NC 4.0, non-commercial). KM was written from scratch as a replacement and released under GPL v3; Mixbox stays as an option.
- **KM**: models how pigment layers absorb and scatter light. A 32³ lookup table maps RGB to a 38-wavelength reflectance spectrum (spectral data from [spectral.js](https://github.com/rvanwijnen/spectral.js), MIT), then Kubelka-Munk mixing is done in spectral space.
- **MB**: the official Mixbox LUT library (`js/mixbox.js`), unmodified; it models paint with a set of hand-tuned base pigments.
- **Where they differ**: mostly at mix ratios of roughly 25–75%, and in some blue + yellow mixes.
- **Switching**: the canvas is repainted from stroke history with the new engine.

</details>

---

## More Features

- **4 professional palettes** — Winsor & Newton Cotman, Schmincke Horadam, Kuretake Gansai, Digital Artist
- **6 brush presets** — Circle, Soft, Watercolor, Splatter, Flat, Dry; brush and smudge each remember their last preset
- **Right-click paint** — drag to paint with background color
- **Eyedropper** — `Alt + Left/Right Click` for foreground/background
- **Move pixels between Photoshop and the plugin** — import Photoshop selections into the mixing canvas, then send your edits back to a new layer at the original position
- **Colors stay in sync with Photoshop** — both ways, including the color picker, swatches, X (swap) and D (reset)
- **Zoom** — 60%–150% via top-right dropdown
- **Undo/Redo** — up to 50 steps
- **Auto-save** — canvas, settings, and history persist automatically
- **Multilingual** — English / 中文 / 日本語, auto-detects system language

---

## Requirements

Mixbox Palette is a web app, so it runs on any platform with a modern browser — use it inside Photoshop, or on its own in the browser on a computer, tablet or phone.

- **In Photoshop**: Photoshop 2022 (v23.3) or later
- **In the browser**: a recent Chrome, Edge, Firefox or Safari
- **A graphics card that supports WebGL 2** — most devices from recent years do. If you keep seeing "Engine initialization failed", try updating your graphics driver
- **Internet on first launch** — after that it also works offline
- **Pen pressure**: works with Apple Pencil on iPad and with Wacom tablets (on Windows, turn on Windows Ink in the Wacom driver settings)

## Installation

### Use Online
Open [https://mixbox-palette.pages.dev/](https://mixbox-palette.pages.dev/) in your browser — nothing to install. Works on computers, tablets and phones.

### From Adobe Marketplace
1. Visit [MixBox Watercolor Palette on Adobe Marketplace](https://exchange.adobe.com/apps/cc/cc9344fb/mixbox-watercolor-palette)
2. Install and open from Photoshop `Plugins` menu

### From Release (.ccx)
1. Download the latest `.ccx` file from [Releases](https://github.com/food211/Mixbox-Palette/releases)
2. Double-click the `.ccx` file to install
3. Open from Photoshop `Plugins` menu

### Developer Mode
1. Clone this repository
2. Open Adobe UXP Developer Tool
3. Load the `uxp-host/` directory (NOT the root directory)
4. Open from Photoshop `Plugins` menu

## Usage

1. **Select a palette** — click the "Palette" button to switch paint brands
2. **Pick a color** — click a swatch to set as foreground color
3. **Paint** — draw on the mixing canvas to blend colors
4. **Use in Photoshop** — selected colors sync to PS automatically; PS color changes sync back

### Transfer Pixels Between Photoshop and the Plugin

#### Photoshop → plugin

1. Create a selection on the Photoshop canvas.
2. In the plugin, click **Import from PS**.
3. Drag to select a destination area on the mixing canvas. The pixels from the Photoshop selection will fill this area, ready for painting and blending.

#### Plugin → Photoshop

1. Create or keep a selection on the Photoshop canvas.
2. In the plugin, click **Send to PS**. If selection mode opens, drag to select the area of the mixing canvas to send.
3. The selected pixels are fitted to the Photoshop selection and placed on a **new layer** above the active layer.

**Keep pixel proportions:** Hold `Shift` while dragging a rectangular selection in both Photoshop and the plugin to make both selections square. This keeps the width-to-height ratio identical in both areas and avoids stretching.

**Blend directly at the original position:** Import a Photoshop selection, then paint or blend it in the plugin. Keep the original Photoshop selection and the plugin canvas size unchanged, then click **Send to PS**. The plugin automatically sends the original import area back without another drag selection, placing your blended result at the original position on a **new layer**.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `B` | Brush tool |
| `S` | Smudge tool |
| `I` | Eyedropper tool |
| `X` | Swap foreground/background colors |
| `Shift` (hold) | Temporary smudge while painting; constrain drag selections to a square |
| `Alt` (hold) | Temporary eyedropper |
| `Alt + Left Click` | Pick foreground color |
| `Alt + Right Click` | Pick background color |
| `Right Click` (drag) | Paint with background color |
| `Esc` | Exit rectangle select |

## Architecture

WebView hybrid: UI and mixing engines hosted remotely (Cloudflare Pages, GitHub Pages fallback). The local UXP host is a minimal bridge that loads the remote UI and syncs colors to Photoshop. Updates roll out automatically without reinstalling. Service Worker caches everything for offline use after first load.

## Tech Stack

- **Mixing Engines**: KM (default, spectral Kubelka-Munk, GPL v3) + Mixbox (optional, CC BY-NC 4.0)
- **Rendering**: WebGL (mixing) + Canvas 2D (cursor, overlays)
- **Platform**: Adobe UXP + WebView
- **Hosting**: Cloudflare Pages (primary) / GitHub Pages (fallback)
- **Offline**: Service Worker, Cache-First strategy
- **Storage**: localStorage for canvas, history, and settings

## License

This project contains code under two licenses:

- **Original code** (KM engine, UI, etc.) — [GPL-3.0](LICENSE). Commercial use is allowed.
- **Mixbox library** (`js/mixbox.js`, by Secret Weapons) — [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Non-commercial use only.

These licenses cover the plugin's code — using, copying and redistributing it. GPL-3.0 places no restriction on what you paint with the KM engine. If you redistribute this project (modified or not), you must share its source under GPL-3.0; to redistribute it commercially, remove `js/mixbox.js`. If you plan to use the MB engine for paid work, check [Mixbox's terms](https://scrtwpns.com/mixbox/) first.

## Trademarks

Adobe and Photoshop are either registered trademarks or trademarks of Adobe in the United States and/or other countries.

## Changelog

See [Changelog](https://food211.github.io/Mixbox-Palette/changelog.html) for version history.

## Support

- ⭐ Star this project
- 💬 [Join our Discord](https://discord.gg/d3ubWGpe) — bug reports, feedback, and discussion
- 🐛 [Report bugs](https://github.com/food211/Mixbox-Palette/issues)
- 💡 Suggest features

---

# 🎨 Mixbox 调色板 - Adobe Photoshop 插件

[Click here for English version](#-mixbox-palette-for-adobe-photoshop) · [日本語版はこちら](README.ja.md)

Adobe Photoshop 水彩调色板插件，颜色像真实颜料一样混合。

直接在浏览器里调色：[在线免费使用](https://mixbox-palette.pages.dev/)（如需把调好的颜色或画面传到 PS，需要安装[插件](#安装)）

<img src="./assets/gifs/red_blue_yellow.gif" alt="红蓝黄三原色混合" width="480">

*像真实颜料一样混色 —— 黄+蓝=绿，不是糊成灰。*

---

## 水彩笔刷

<img src="./assets/gifs/watercolor.gif" alt="水彩笔触" width="480">

水彩叠笔自然过渡，湿边、柔和衔接，浓度可调（1–100）。

## 画布上的涂抹混色

<img src="./assets/gifs/watercolor_mix.gif" alt="涂抹工具混合水彩" width="480">

涂抹工具直接在画布上混色，就像在调色盘里调颜料。

## 明度标尺

<img src="./assets/gifs/value_ruler.gif" alt="明度标尺显示色彩明度" width="480">

吸取颜色，标尺自动显示该颜色的感知亮度，控制画面明度关系很顺手。

## 可调画布大小

<img src="./assets/gifs/resize_canvas.gif" alt="拖动 handle 调整画布大小" width="480">

拖拽黑色面板两侧的手柄调整混色画布宽度（480–2000px）。

---

## 两个混色引擎 —— KM 和 MB

插件提供两种混色方式：**KM**（默认，为本插件自研）和 **MB**（Mixbox）。大多数混色两者看起来差不多，用默认的就好。

- **KM —— 灵敏。** 两种颜料的细微差别会体现在混色里，和真实颜料一样。部分蓝+黄混色会稍微偏绿。
- **MB —— 稳定。** 颜料略有不同，混出来也差不多。

两色用量差不多时，差别最明显。

**要拿作品商用？** 选 KM 最稳妥。Mixbox 的许可只允许非商业用途；KM 是从零自研的，没有这个限制。详见[许可证](#许可证)。

**切换方法**：点左上角的面板标题（显示为 **KM 调色板** 或 **Mixbox 调色板**，旁边带 ⇄ 箭头）。已经画的内容会用新引擎重新画一遍，不会丢。想并排对比，可以打开 [KM Tuner](https://food211.github.io/Mixbox-Palette/km-tuner.html)。

<details>
<summary>技术细节</summary>

- **为什么有两个引擎**：插件最早基于 [Mixbox](https://scrtwpns.com/mixbox/)（CC BY-NC 4.0，禁止商用）。KM 是从零自研的替代引擎，以 GPL v3 发布；Mixbox 作为可选引擎保留。
- **KM**：模拟颜料层对光的吸收与散射。用 32³ 查找表把 RGB 映射到 38 个波长的反射率光谱（光谱数据来自 [spectral.js](https://github.com/rvanwijnen/spectral.js)，MIT），再在光谱空间按 Kubelka-Munk 公式混色。
- **MB**：直接使用官方 Mixbox LUT 库（`js/mixbox.js`），未作修改；它用一组人工调校的基础颜料来模拟颜料。
- **差异位置**：主要在混合比例约 25–75% 的区间，以及部分蓝+黄混色。
- **切换**：画布按笔画历史用新引擎重绘。

</details>

---

## 更多特性

- **4 套专业调色盘** —— 温莎牛顿 Cotman、施美尔 Horadam、吴竹 Gansai、数字艺术家
- **6 种笔刷预设** —— 圆形、柔和、水彩、飞溅、平头、干笔；画笔和涂抹工具各自记忆上次使用的笔刷
- **右键绘制** —— 右键拖拽使用背景色绘制
- **吸管工具** —— `Alt + 左键/右键` 取色为前景/背景
- **双向像素传输** —— 将 Photoshop 选区导入混色画布，修改后可传回原位置的新图层
- **双向颜色同步** —— 插件 ↔ Photoshop，包含拾色器、色板、X 交换、D 复位
- **缩放控制** —— 右上角下拉菜单，60%–150%
- **50 步撤销/重做**
- **自动保存** —— 画布、历史和设置自动保存
- **多语言支持** —— English / 中文 / 日本語，自动跟随系统语言，可手动切换

---

## 系统要求

Mixbox 调色板是网页应用，有现代浏览器的平台都能用 —— 可以在 Photoshop 里用，也可以直接在电脑、平板或手机的浏览器里用。

- **在 Photoshop 中使用**：Photoshop 2022（v23.3）或更新版本
- **在浏览器中使用**：较新的 Chrome、Edge、Firefox 或 Safari
- **支持 WebGL 2 的显卡** —— 近几年的设备基本都支持。如果一直提示“引擎初始化失败”，可以先更新显卡驱动
- **首次启动需要联网** —— 之后断网也能用
- **压感**：支持 iPad 上的 Apple Pencil 和 Wacom 数位板（Windows 上需在 Wacom 驱动设置里开启 Windows Ink）

## 安装

### 在线使用
直接在浏览器打开 [https://mixbox-palette.pages.dev/](https://mixbox-palette.pages.dev/)，无需安装。电脑、平板、手机都能用。

### 通过 Adobe Marketplace
1. 访问 [MixBox Watercolor Palette - Adobe Marketplace](https://exchange.adobe.com/apps/cc/cc9344fb/mixbox-watercolor-palette)
2. 安装后从 Photoshop `插件` 菜单打开

### 从 Release 下载 (.ccx)
1. 从 [Releases](https://github.com/food211/Mixbox-Palette/releases) 下载最新 `.ccx`
2. 双击 `.ccx` 文件安装
3. 从 Photoshop `插件` 菜单打开

### 开发者模式
1. 克隆本仓库
2. 打开 Adobe UXP Developer Tool
3. 加载 `uxp-host/` 目录（注意不是根目录）
4. 从 Photoshop `插件` 菜单打开

## 使用说明

1. **选择调色盘** —— 点击"Palette"按钮切换颜料品牌
2. **选取颜色** —— 点击色块设置为前景色
3. **混色** —— 在混色画布上绘制
4. **同步到 PS** —— 选取的颜色自动同步到 Photoshop；反之 PS 改色也会同步回插件

### 与 Photoshop 双向传输像素

#### Photoshop → 插件

1. 在 Photoshop 画布上选好要导入的区域。
2. 在插件中点击 **从 PS 导入**。
3. 在混色画布上框选接收区域，PS 选区内的像素会填入这个区域，随后即可绘制、涂抹和混色。

#### 插件 → Photoshop

1. 在 Photoshop 画布上创建或保留选区。
2. 在插件中点击 **传输至PS**。如果进入框选模式，在混色画布上框选要发送的区域。
3. 所选像素会缩放适配 PS 选区，并放到活动图层上方的**新图层**中。

**保持像素比例：** 在 Photoshop 和插件中框选时，都按住 `Shift` 绘制正方形选区。两边都使用正方形选区，可以保持像素的宽高比例完全一致，避免拉伸变形。

**在原位置直接绘制混色效果：** 从 PS 导入选区后，在插件里绘制或混色。保留 PS 侧的原选区，并保持插件画布尺寸不变，再点击 **传输至PS**，插件就会自动使用原来的导入区域回传，无需再次框选。混色结果会出现在 PS 的原位置，并**新建图层**保存。

## 快捷键

| 按键 | 功能 |
|------|------|
| `B` | 画笔工具 |
| `S` | 涂抹工具 |
| `I` | 吸管工具 |
| `X` | 交换前景/背景色 |
| `Shift`（按住）| 绘制时临时切换为涂抹工具；框选时约束为正方形 |
| `Alt`（按住）| 临时切换为吸管工具 |
| `Alt + 左键` | 取色为前景色 |
| `Alt + 右键` | 取色为背景色 |
| `右键`（拖拽）| 使用背景色绘制 |
| `Esc` | 退出矩形选取 |

## 架构说明

WebView 混合架构：UI 和混色引擎托管在远端（Cloudflare Pages，GitHub Pages 备用）。本地 UXP Host 是个最小桥接，负责加载远端 UI 和同步颜色到 Photoshop。更新自动下发不需要重装。首次加载后 Service Worker 缓存全部内容供离线使用。

## 许可证

本项目包含两种许可证的代码：

- **自研代码**（KM 引擎、UI 等）— [GPL-3.0](LICENSE)。允许商用。
- **Mixbox 库**（`js/mixbox.js`，由 Secret Weapons 提供）— [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)。仅限非商业用途。

这些许可约束的是插件代码本身——使用、复制和再分发。GPL-3.0 不限制你用 KM 引擎画出来的作品。再分发本项目（无论是否修改）须按 GPL-3.0 提供源码；商业再分发时请移除 `js/mixbox.js`。如果打算用 MB 引擎做商业作品，请先查看 [Mixbox 的条款](https://scrtwpns.com/mixbox/)。

## 商标声明

Adobe 和 Photoshop 是 Adobe 在美国和/或其他国家/地区的注册商标或商标。

## 更新日志

查看 [更新日志](https://food211.github.io/Mixbox-Palette/changelog.html) 了解版本历史。

## 赞助

- ⭐ Star 本项目
- 💬 [加入 Discord 社区](https://discord.gg/d3ubWGpe) — 反馈问题、提出建议、日常交流
- 🐛 [提交 Bug](https://github.com/food211/Mixbox-Palette/issues)
- 💡 提出功能建议
