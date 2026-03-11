# 更新日志 / Changelog

## V1.0.2

### 新增

- 支持从 Photoshop 获取颜色（双向颜色同步）
- 在 PS 中更改前景色/背景色（拾色器、色板、X 键交换、D 键复位）会自动同步到插件
- **双混色引擎** - 新增基于 Kubelka-Munk 物理光学理论的自研混色引擎（KM），作为可选的替代混色模式
- **引擎切换按钮** - 左上角新增 **MB/KM** 切换按钮，可在 Mixbox 和 KM 两种混色引擎之间自由切换
- **画布自动重绘** - 切换引擎后，画布根据笔画历史自动使用新引擎重绘，无需手动重画
- **KM Tuner 调试工具** - 新增在线工具 [KM Tuner](https://food211.github.io/Mixbox-Palette/km-tuner.html)，可直观对比两种引擎的混色效果差异

### 改进

- 优化 Service Worker 缓存，新增 KM 引擎相关文件的离线缓存支持
- 新增引擎切换相关的中英文界面文案

### 技术说明

- **Mixbox (MB)** - 默认引擎，基于 Mixbox LUT 算法，混色品质高（CC BY-NC 4.0 许可）
- **KM** - 自研引擎，基于 Kubelka-Munk 物理公式计算颜料的吸收与散射，无需 LUT 查找表，无外部依赖（GPL v3 许可）
- 两种引擎均实现物理级减色混合（如黄 + 蓝 = 绿），可随时切换对比效果


## V1.0.1

- 多语言支持（中文/英文，自动跟随系统语言）
- 双源加载（Cloudflare Pages 优先，GitHub Pages 备用）
- Bug 修复与图标更新

## V1.0.0

- 首次发布
- 4 套专业调色盘预设
- Mixbox 物理混色引擎
- 6 种笔刷预设
- 涂抹工具、吸管工具
- 50 步撤销/重做
- 自动保存

---

# Changelog (English)

## V1.0.2

### New Features

- Bidirectional color sync with Photoshop — changing foreground/background color in PS (color picker, swatches, X to swap, D to reset) now updates the plugin automatically
- **Dual mixing engines** — Added a self-implemented mixing engine based on Kubelka-Munk physical optics theory (KM) as an alternative mixing mode
- **Engine toggle button** — New **MB/KM** button in the top-left corner to switch between Mixbox and KM engines
- **Auto canvas repaint** — Switching engines automatically repaints the canvas using stroke history with the new engine
- **KM Tuner tool** — New online tool [KM Tuner](https://food211.github.io/Mixbox-Palette/km-tuner.html) for visually comparing the mixing results of both engines

### Improvements

- Updated Service Worker cache to include KM engine files for offline support
- Added bilingual (EN/ZH) UI labels for engine toggle

### Technical Notes

- **Mixbox (MB)** — Default engine. LUT-based algorithm with high-quality pigment mixing (CC BY-NC 4.0 license)
- **KM** — Self-implemented engine based on Kubelka-Munk theory, calculating pigment absorption and scattering. No LUT, no external dependencies (GPL v3 license)
- Both engines produce realistic subtractive color mixing (e.g., yellow + blue = green) and can be switched at any time

## V1.0.1

- Multilingual support (English / Chinese, auto-detects system language)
- Dual-source loading (Cloudflare Pages primary, GitHub Pages fallback)
- Bug fixes and icon updates

## V1.0.0

- Initial release
- 4 professional palette presets
- Mixbox physical color mixing engine
- 6 brush presets
- Smudge tool, eyedropper tool
- 50-step undo/redo
- Auto-save
