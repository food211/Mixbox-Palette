# 更新日志 / Changelog

== V1.1.5 ==
[ZH]
### 改进
- **混色引擎升级** — 混色算法升级为38波长完整光谱 Kubelka-Munk，蓝+黄可正确混出绿色，颜色更自然准确

[EN]
### Improvements
- **Mixing engine upgrade** — Mixing algorithm upgraded to full 38-wavelength spectral Kubelka-Munk, blue + yellow correctly produces green, more natural and accurate color mixing

== V1.1.4 ==
[ZH]
### 新功能
- **焦点指示条** — 插件获得键盘焦点时顶部亮起蓝色指示条，提示快捷键已被插件捕获
- **涂抹强度独立参数** — 涂抹工具和画笔工具使用独立的强度参数，切换工具时自动切换
- **界面优化** — 调整插件整体UI布局，配合焦点指示条重新设计顶部区域

### 改进
- **颜料浓度调节优化** — 滑条范围扩大至1-100，采用平滑曲线映射，低浓度区域调节更细腻
- **缩放范围扩展** — 最大缩放比例从120%提升至150%

[EN]
### New Features
- **Focus indicator** — A blue bar appears at the top when the plugin captures keyboard focus, reminding users to click PS canvas to return shortcuts
- **Independent smudge strength** — Smudge tool and brush tool now have separate strength parameters
- **UI redesign** — Redesigned top area layout to accommodate the new focus indicator

### Improvements
- **Paint concentration slider** — Range expanded to 1-100 with smooth curve mapping for finer control at low values
- **Zoom range expanded** — Maximum zoom increased from 120% to 150%

== V1.1.3 ==
[ZH]
### 新功能
- **工具快捷键** — 支持键盘快捷键切换工具：`B` 画笔 / `S` 涂抹 / `I` 吸管 / `M` 矩形选取 / `X` 互换前后景色，再次按下同一快捷键可回切上一个工具
- **临时涂抹** — 按住 `Shift` 临时切换到涂抹工具，松开自动切回画笔
- **右键绘制** — 在混色区右键拖动使用背景色绘制
- **右键选色** — 右键点击颜料色块直接设为背景色

### 修复
- 修复颜料名称提示挡住相邻色块的点击

[EN]
### New Features
- **Tool shortcuts** — Keyboard shortcuts for tool switching: `B` Brush / `S` Smudge / `I` Eyedropper / `M` Rect Select / `X` Swap FG/BG; press the same key again to return to previous tool
- **Temporary smudge** — Hold `Shift` to temporarily switch to smudge tool, release to return to brush
- **Right-click paint** — Right-click drag on canvas to paint with background color
- **Right-click color** — Right-click a color swatch to set it as background color

### Fixes
- Fixed color name tooltip blocking clicks on adjacent swatches

== V1.1.2 ==
[ZH]
### 改进
- **选区传输提示优化** — 选区传输的提示弹窗样式优化

### 修复
- 修复选区框显示异常

[EN]
### Improvements
- **Selection transfer prompt** — Improved style of the selection transfer prompt dialog

### Fixes
- Fixed selection box display issues

== V1.1.1 ==
[ZH]
### 改进
- **工具图标优化** — 工具栏图标改为独立 SVG 文件引用，涂抹工具更换为调色盘图标

[EN]
### Improvements
- **Tool icon update** — Toolbar icons extracted to standalone SVG files, smudge tool icon replaced with palette icon

== V1.1.0 ==
[ZH]
### 新功能
- **矩形选取传输至PS** — 在混色区框选颜色区域，自动传输到 Photoshop 活动图层的选区内，可配合混合器画笔采样使用

[EN]
### New Features
- **Rect Select to PS** — Select a region from the mixing canvas and transfer pixels into the active layer's selection in Photoshop, useful for Mixer Brush sampling

== V1.0.4 ==
[ZH]
### 改进
- **双源竞速加载** — 启动时自动探测最快可用源，加速插件加载
- 拆分页面架构，index.html 改为竞速跳转页，主界面迁移至 app.html
- 修复 Cloudflare Pages 308 重定向导致 Service Worker 缓存异常的问题
- 修复 UXP 宿主加载竞速页时误触发 loaderror 切换备用源的问题

[EN]
### Improvements
- **Dual-source race loading** — Automatically probes the fastest available source on startup for faster loading
- Split page architecture: index.html is now a race-redirect page, main UI moved to app.html
- Fixed Cloudflare Pages 308 redirect causing Service Worker cache errors
- Fixed UXP host incorrectly triggering loaderror when loading the race page

== V1.0.3b ==
[ZH]
### 改进
- GitHub 链接改为图标按钮，界面更简洁
- 版本号改为可点击按钮，跳转至更新日志

[EN]
### Improvements
- Replaced GitHub text link with icon button for cleaner UI
- Version label is now a clickable button linking to changelog

== V1.0.3 ==
[ZH]
### 新增
- **背景色绘制支持** — 选中背景色目标时，笔刷现在使用背景色绘制

### 改进
- 修复颜色切换（X 键）和复位（D 键）后颜色同步不稳定的问题，改为延迟读取确保 PS 完成更新
- 修复从 PS 获取绿色通道时偶发读取错误字段（`grain` 字段兼容处理）
- 优化获取 PS 颜色的 batchPlay 请求格式，提高兼容性

[EN]
### New Features
- **Background color painting** — Brush now uses the background color when background target is selected

### Improvements
- Fixed unstable color sync after X (swap) / D (reset) color events — now uses a short delay to ensure PS finishes updating
- Fixed occasional wrong field read for green channel (`grain` field compatibility)
- Updated batchPlay query format for fetching PS colors for better compatibility

== V1.0.2 ==
[ZH]
- ⚠️ **此版本不再兼容，已下架**
### 新增
- 支持从 Photoshop 获取颜色（双向颜色同步）
- 在 PS 中更改前景色/背景色（拾色器、色板、X 键交换、D 键复位）会自动同步到插件
- **双混色引擎** — 新增基于 Kubelka-Munk 物理光学理论的自研混色引擎（KM），可作为 Mixbox 的替代引擎
- **引擎切换按钮** — 左上角新增 MB/KM 切换按钮
- **画布自动重绘** — 切换引擎后，画布根据笔画历史自动使用新引擎重绘
- **KM Tuner 调试工具** — 新增在线工具，可直观对比两种引擎的混色效果

### 改进
- 优化 Service Worker 缓存，新增 KM 引擎相关文件的离线缓存支持
- 新增引擎切换相关的中英文界面文案

[EN]
- ⚠️ **This version is no longer compatible and has been delisted**
### New Features
- Bidirectional color sync with Photoshop — changing foreground/background color in PS (color picker, swatches, X to swap, D to reset) now updates the plugin automatically
- **Dual mixing engines** — Added a self-implemented KM engine based on Kubelka-Munk physical optics theory as an alternative to Mixbox
- **Engine toggle button** — New MB/KM button in the top-left corner
- **Auto canvas repaint** — Switching engines automatically repaints the canvas using stroke history
- **KM Tuner tool** — New online tool for visually comparing the mixing results of both engines

### Improvements
- Updated Service Worker cache to include KM engine files for offline support
- Added bilingual (EN/ZH) UI labels for engine toggle

== V1.0.1 ==
[ZH]
- ⚠️ **此版本不再兼容，已下架**
- 多语言支持（中文/英文，自动跟随系统语言）
- 双源加载（Cloudflare Pages 优先，GitHub Pages 备用）
- Bug 修复与图标更新

[EN]
- ⚠️ **This version is no longer compatible and has been delisted**
- Multilingual support (English / Chinese, auto-detects system language)
- Dual-source loading (Cloudflare Pages primary, GitHub Pages fallback)
- Bug fixes and icon updates

== V1.0.0 ==
[ZH]
- ⚠️ **此版本不再兼容，已下架**
- 首次发布
- 4 套专业调色盘预设
- Mixbox 物理混色引擎
- 6 种笔刷预设
- 涂抹工具、吸管工具
- 50 步撤销/重做
- 自动保存

[EN]
- ⚠️ **This version is no longer compatible and has been delisted**
- Initial release
- 4 professional palette presets
- Mixbox physical color mixing engine
- 6 brush presets
- Smudge tool, eyedropper tool
- 50-step undo/redo
- Auto-save
