# 更新日志 / Changelog

== V1.5.1 ==
[ZH]
### 修复
- **大笔刷水彩晕染更自然** — 笔刷调大到 60-80px 时，水彩的扩散范围和颗粒感不会再"跟不上"，整体观感和小笔刷保持一致

[EN]
### Fix
- **Large watercolor brushes feel more natural** — When brush size is 60-80px, the watercolor diffusion and texture no longer feel "behind" the stroke; the overall look stays consistent with smaller brushes

== V1.5.0 ==
[ZH]
### 新增
- **压感灵敏度四档可选** — 顶部新增四个圆点按钮（从大到小），代表笔尖从最软到最硬。最软档轻触就能画出细淡的线、用力按还能画出比笔刷设置更大的笔触；最硬档需要稳定用力才能画出饱满的线。适合不同手感偏好
- **涂抹工具也支持压感** — 之前压感只影响笔刷；现在涂抹工具的大小、推拖距离、涂抹强度都会跟随压力变化，轻触点戳、重压拖拽
- **笔刷上限扩到 80px** — 最大笔刷尺寸从 50px 提高到 80px，适合大画布的铺色

### 优化
- **iPad 绘画体验大幅改善** — 针对纯触控平板（无鼠标/数位笔）自动启用降频模式，水彩笔和 dry 笔在大画布上的卡顿明显减轻；快速画曲线时不再出现"折线"断帧
- **压感曲线更平滑** — 数位笔原始压力读数加入滤波，软档位下轻画的粗细抖动消失
- **落笔首点自然** — 数位笔落笔瞬间不再出现异常大的笔触（之前压力读数未稳时容易画出一个粗黑点）
- **移动端页面可滚动和缩放** — 之前整个页面禁用触控手势导致 iPad/手机上无法用手指浏览界面；现在画布外的区域可以正常滚动、双指缩放页面
- **画布宽度调整条更好按** — 左右两侧的拖拽条触控热区加宽三倍（实际宽度不变），iPad 上手指也能轻松点到；拖拽时的光晕更明显

### 修复
- **数位笔抬笔瞬间偶尔画出超大笔触** — 某些设备在松笔瞬间会误报满压力，被代码当成"重压"处理；现已纠正
- **多指误触干扰** — 数位笔画画时手掌搭到屏幕上，或者两指同时按下，会互相打断笔画；现在只认第一指，笔画不会串线

[EN]
### New
- **Four pressure sensitivity presets** — Four round buttons (large → small dots) added at the top, representing tip softness from softest to firmest. The softest lets light touches draw thin, faint lines and pressed strokes go larger than your brush size; the firmest requires steady pressure for full strokes. Different feels for different hands
- **Smudge tool now pressure-sensitive** — Previously pressure only affected the brush; now smudge size, drag distance, and intensity all react to pressure — tap lightly for small pokes, press harder for long smears
- **Brush size upper limit raised to 80px** — Max brush size increased from 50px to 80px for broader strokes on large canvases

### Improvement
- **Major iPad painting improvements** — Pure touchscreen tablets (no mouse / stylus) now auto-enable a lower-frequency mode, making watercolor and dry brushes much smoother on large canvases; fast curves no longer break into "line segments"
- **Smoother pressure curve** — Stylus raw pressure readings now pass through a low-pass filter; wobbly thickness on the softest setting is gone
- **Natural stroke start** — Stylus touches no longer produce an oversized first dab (previously unstable initial pressure readings caused a thick black dot on landing)
- **Mobile page scrolls and zooms properly** — Previously the whole page disabled touch gestures, making it impossible to scroll/pinch-zoom the UI on iPad/phone; now areas outside the canvas allow normal scrolling and pinch-zoom
- **Canvas-width drag handles easier to grab** — The left/right drag handles have a 3× wider touch hit zone (visual size unchanged), much easier to hit with a finger on iPad; the glow feedback during drag is also more visible

### Fix
- **Stylus lift-off occasionally drew huge strokes** — Some devices briefly report full pressure during lift-off, which the code treated as a hard press; now corrected
- **Multi-touch interference** — With a stylus, resting your palm on the screen or tapping with a second finger used to interrupt the current stroke; now only the first pointer counts, strokes stay clean

== V1.4.1 ==
[ZH]
### 新增
- **日语界面支持** — 新增日文 UI，语言按钮点击可在英语 / 中文 / 日语间循环切换；首次打开会自动跟随系统语言。界面中的颜料名仍保留英文，方便日本水彩圈对照专业术语
- **操作说明新增一条** — 使用水彩笔时推荐切换到 KM 引擎，混色结果会更自然

### 优化
- **语言选择现在会被记住** — 切换语言后刷新或重开插件，会停留在你上次选的语言，不会被重置
- **底部信息区微调** — 当前模式上移至操作说明之前，展开说明时状态也能一眼看到；整体留白稍收紧

[EN]
### New
- **Japanese UI** — Japanese interface added. The language button now cycles through English / 中文 / 日本語, and first-time users follow their system language automatically. Pigment names stay in English so Japanese watercolorists can cross-reference professional terminology easily
- **New instruction tip** — When using the watercolor brush, switching to the KM engine produces more natural blending

### Improvement
- **Language selection persists** — Your chosen language now sticks across refreshes and plugin reopens, no longer silently resetting
- **Info panel tweaks** — The current mode line moved above Instructions so the status stays visible even when the guide is expanded; overall padding tightened a bit

== V1.4.0 ==
[ZH]
### 新增
- **默认引擎改为 KM** — 经过实际对比，KM 引擎在大多数颜料组合下混合结果更接近真实调色的观感，因此从本版开始新用户默认启用 KM 引擎；老用户设置保留不变，可随时手动切换
- **水彩笔刷体验重做** — 全面调整水彩笔的颜料沉积、边缘晕染、咖啡圈强度与湿区扩散范围，笔触更细腻、颜色堆积更自然；浓度滑条的响应也更接近真实水彩（低浓度清透、高浓度浓重但不生硬）
- **三工具独立记忆** — 笔刷、水彩、涂抹现在各自记住自己的大小、笔型、混色/浓度/强度，切换工具不会再互相干扰

### 优化
- **切换引擎不再卡顿** — 切 KM ↔ Mixbox 时的 shader 编译、色彩查找表、顶点缓存改为全局复用，一次会话内切换几乎无感
- **绘制性能进一步优化** — 削减热路径上的重复计算与重绘，长时间绘制更轻
- **光标显示更稳定** — 笔刷光标改用 GPU 合成层移动，不再触发整页布局重新计算，复杂画面下依然稳定跟随

### 修复
- **调色盘 RGB 校准** — Cotman、伦勃朗、温莎牛顿 Gouache 等调色盘的部分颜料 RGB 值经过二轮校准，修复了这些颜料在 KM 引擎下混合表现异常的问题（KM 的物理混合对颜料 RGB 的准确度要求比 Mixbox 更高）。感谢 Reddit 用户 **digitizerstylus** 提供的详细反馈
- **修复笔刷间距被错误套用到涂抹工具** — 之前调整普通笔刷的笔触间距后，涂抹工具的行为也会被一起改变；本版重构了工具设置的存储方式，两者彻底独立

[EN]
### New
- **KM is now the default engine** — After side-by-side comparison, KM produces color mixes closer to real-life pigment behavior across most palettes, so new users now start with KM by default. Existing users keep their current setting and can switch at any time
- **Watercolor brush overhaul** — Reworked pigment deposition, edge bleed, coffee-ring intensity, and wet-area spread. Strokes feel finer, pigment buildup is more natural, and the strength slider now behaves more like real watercolor (translucent at low values, rich but never harsh at high values)
- **Per-tool memory** — Brush, Watercolor, and Smudge now each remember their own size, brush type, and strength / mix settings. Switching tools no longer overwrites the other two

### Improvement
- **Engine switching no longer stutters** — Shader compilation, color LUT, and vertex buffers are reused across engines, making KM ↔ Mixbox switching nearly instant within a session
- **Faster brush rendering** — Trimmed redundant work along the hot path; long sessions stay lighter
- **Smoother cursor** — The brush preview cursor now moves via a GPU compositor layer instead of page-level positioning, so it no longer triggers layout recalculation on complex canvases

### Fix
- **Palette RGB recalibration** — Several pigments across Cotman, Rembrandt, and Winsor & Newton Gouache palettes received a second-pass RGB correction. This fixes mixing behavior that looked off under the KM engine (KM's physically-based mixing is more sensitive to pigment RGB accuracy than Mixbox). Thanks to Reddit user **digitizerstylus** for the detailed feedback
- **Brush spacing no longer leaks into the Smudge tool** — Changing brush spacing used to silently affect the Smudge tool as well. The tool settings storage has been refactored so the two are fully independent now

== V1.3.8 ==
[ZH]
### 优化
- **长时间绘制更稳定** — 大画布反复绘制、修改画布尺寸、切换引擎时的内存管理全面改进，显著降低卡顿与黑屏概率
- **撤销/重做更流畅** — 修复了连续撤销时偶发的画面错乱；超长历史记录也不会再越积越多拖慢浏览器
- **绘制性能提升** — 笔触渲染路径底层优化，持续绘制时更省资源

### 修复
- 修复极端情况下切换引擎或修改画布后出现黑屏的问题
- 修复画布尺寸修改后偶尔画不上颜色的问题

[EN]
### Improvement
- **More stable long sessions** — Overhauled memory handling around large canvases, canvas resize, and engine switching; far fewer stutters and black-screen incidents
- **Smoother undo / redo** — Fixed an occasional wrong-frame flash when clicking undo repeatedly; long history stacks no longer bloat memory over time
- **Faster brush rendering** — Lower-level drawing path optimized; continuous painting uses less resources

### Fix
- Fixed rare black-screen after switching engine or resizing the canvas
- Fixed a case where strokes wouldn't register after resizing the canvas

== V1.3.7 ==
[ZH]
### 新增
- **匿名使用统计** — 新增匿名统计功能，仅记录笔刷、引擎、调色盘的使用偏好以及绘制时长，用于帮助我改进插件。不会收集任何画作内容或个人信息，如不希望参与可通过浏览器的广告拦截插件屏蔽 Google Analytics

[EN]
### New
- **Anonymous usage analytics** — Added opt-out anonymous tracking of brush / engine / palette preferences and stroke duration to help improve the plugin. No artwork or personal info is collected; you can block Google Analytics with any ad blocker if you'd rather not participate

== V1.3.6 ==
[ZH]
### 优化
- **启动速度提升** — 启动加载方式全面优化，首屏响应更快
- **更新提示改进** — 支持一次展示多个未读版本的更新说明，不会再错过中间版本

[EN]
### Improvement
- **Faster startup** — Overhauled loading pipeline for snappier first paint
- **Better update notifications** — Missed several releases? Now you'll see all their changelogs at once

== V1.3.5a ==
[ZH]
### 优化
- **新增2款色板** — 温莎牛顿 Designers Gouache, 伦勃朗 Rembrandt 油画 16色

[EN]
### Improvement
- **New Color Palettes** - Winsor & Newton Designers Gouache Mix, Rembrandt Oil 16

== V1.3.5 ==
[ZH]
### 优化
- **水彩笔重做** — 重新设计水彩笔的渲染效果，更加具有真实感。新增湿度（Wet）参数，湿度低时颜料浓重、沉积感强，湿度高时晕染扩散、颜色更轻盈

[EN]
### Improvement
- **Watercolor brush rework** — Redesigned the watercolor brush rendering for a more realistic feel. Added a Wetness (Wet) parameter: low wetness produces dense, heavy paint with strong deposits; high wetness creates soft diffusion and lighter color spread

== V1.3.4b ==
[ZH]
### 优化
- **调色盘颜色校准** — 调整白色颜料的色值，使其更贴近真实颜料的观感，在白色画布上也能看出笔迹

[EN]
### Improvement
- **Palette color calibration** — Adjusted white paint colors to better match real-world pigment appearance, making strokes visible on white canvas

== V1.3.4a ==
[ZH]
### 修复
- **紧急修复** — 修复缩放功能在特定刷新时机下将画布宽度错误扩大的问题

[EN]
### Fix
- **Hotfix** — Fixed an issue where switching zoom could incorrectly expand canvas width under certain refresh conditions

== V1.3.4 ==
[ZH]
### 新增
- **吸管光标** — 使用吸管工具时显示专属光标图标
### 优化
- **缩放自适应** — 切换缩放比例后，若控件栏折行则自动扩展面板宽度并同步画布尺寸

[EN]
### New
- **Eyedropper cursor** — A dedicated cursor icon is shown when using the eyedropper tool
### Improvement
- **Zoom adaptive width** — Switching zoom levels now automatically expands the panel width and canvas size if the control bar would wrap

== V1.3.3c ==
[ZH]
### 新增
- **Discord 按钮** — 面板右下角新增 Discord 社区跳转按钮
### 优化
- **拖拽边缘提示** — 鼠标悬停在面板边缘时蓝色发光，拖动时变为黄色，拖拽状态更直观
[EN]
### New
- **Discord button** — Added a Discord community link button in the bottom-right corner of the panel
### Improvement
- **Resize handle glow** — Panel edges glow blue on hover and yellow while dragging for clearer visual feedback

== V1.3.3b ==
[ZH]
### 修复
- **缩放显示修复** — 修复页面缩放比例不为 100% 时，拖动窗口导致面板宽度异常变化的问题
[EN]
### Fix
- **Zoom display fix** — Fixed an issue where dragging the window while page zoom is not 100% caused the panel width to change unexpectedly

== V1.3.3 ==
[ZH]
### 优化
- **使用说明折叠** — 操作说明区域可点击展开/收起，状态自动保存
- **放大模式准心修复** — 启用页面缩放后，笔刷准心与实际绘制位置保持一致
- **焦点卡住提示** — 键盘焦点卡在插件内时，短时间内重复按下无效按键会触发顶部提示条闪烁红色，提示按住 Space 并点击 PS 画布归还焦点
[EN]
### Improvement
- **Collapsible instructions** — The instructions panel can be expanded or collapsed with a click; state is saved automatically
- **Zoom cursor fix** — Brush cursor now aligns correctly with actual paint position when page zoom is active
- **Stuck focus warning** — If keyboard focus gets trapped in the plugin, repeatedly pressing an unrecognized key triggers a red flash on the top bar, reminding you to hold Space and click the PS canvas to return focus

== V1.3.2 ==
[ZH]
### 新功能
- **画布尺寸调整** — 拖动面板左右两侧边缘可调整画布大小；扩大时四周增加空白画布，缩小时内容整体等比缩小
- **Value Ruler** — 面板中新增明度标尺，基于感知亮度将颜色的明度值可视化在黑白轴上，帮助你准确感知当前色彩的明暗位置
- **Send to PS 遮罩提示** — 进入矩形选取模式时画布立即显示暗色遮罩，状态更清晰

### 优化
- **涂抹工具改进** — 调整涂抹的混色方式，颜料之间的混合更符合物理直觉
- **加载页面本地化** — 加载界面跟随系统语言，中文系统显示中文，其他语言显示英文
- **界面布局** — 切换中英文时控件位置保持一致，不再因文字长短而移位
[EN]
### New Features
- **Canvas resize** — Drag the left or right edge of the panel to resize the canvas; expanding adds blank space around the content, shrinking scales the content down proportionally
- **Value Ruler** — A value scale in the panel header visualizes the perceptual luminance of your colors on a black-to-white axis, helping you accurately read the value of any color you mix
- **Rect Select overlay** — Entering rect-select mode immediately shows a dark overlay, making the mode change more obvious

### Improvement
- **Smudge tool improvement** — Reworked the color blending behavior for more physically accurate paint mixing
- **Loading page localization** — The loading screen now follows the system language; Chinese systems show Chinese, all others show English
- **UI layout** — Controls no longer shift position when switching between languages

== V1.3.1 ==
[ZH]
### 优化
- **涂抹工具重新设计** — 涂抹效果更自然
[EN]
### Improvement
- **Smudge tool redesigned** — More natural smudge effect

== V1.3.0 ==
[ZH]
### 性能优化
- **历史记录提速** — 撤销/重做改为全程在显卡内存中操作，每次笔触结束不再卡顿
- **后台自动保存** — 画布存档改为在浏览器空闲时异步写入，不占用绘画响应时间
[EN]
### Performance
- **Faster history** — Undo/redo now operates entirely in GPU memory, eliminating the stutter after each stroke
- **Background auto-save** — Canvas snapshots are now written to storage asynchronously during browser idle time

== V1.2.0 ==
[ZH]
### 新功能
- **压感支持** — 数位板笔触可根据压力改变笔刷大小（需在 Wacom 驱动中开启 Windows Ink），可通过笔刷大小旁的按钮开关
- **干笔刷优化** — 落笔时固定材质，整笔过程中不再随机变化；调整点分布使中间区域更饱满
- **水彩笔优化** — 改为边缘堆积效果，边缘混色更深、中间柔和过渡，更贴近水彩质感
- **圆笔刷硬边** — 圆形笔刷边缘改为清晰硬边，不再产生渐变
- **喷溅笔涂抹** — 涂抹工具配合喷溅笔时，改为渐进均匀化效果，多涂几遍颜色逐渐混匀

### 修复
- **本地打开不再报错** — 用 file:// 协议直接打开时不再显示 Service Worker 注册失败的错误

[EN]
### New Features
- **Pressure Sensitivity** — Pen pressure controls brush size (requires Windows Ink enabled in Wacom driver); toggle via button next to brush size
- **Dry Brush Improvement** — Texture is fixed at stroke start and no longer randomizes mid-stroke; dot distribution improved for a fuller center
- **Watercolor Brush Improvement** — Reworked to an edge-accumulation effect with deeper edges and soft center transition
- **Circle Brush Hard Edge** — Circle brush now has a crisp hard edge instead of a gradient falloff
- **Splatter Smudge** — Smudge tool with splatter brush now gradually blends colors over multiple passes

### Fixes
- **No error on local open** — No longer shows Service Worker registration error when opened via file:// protocol

== V1.1.9b ==
[ZH]
### 修复
- **修复撤销丢失笔触** — 修复画了较多笔触后，点击撤销会一次性丢失多笔的问题

[EN]
### Fixes
- **Fix undo losing strokes** — Fixed an issue where clicking undo after many strokes would cause multiple strokes to disappear at once

== V1.1.9 ==
[ZH]
### 改进
- **笔刷工具与涂抹工具重新设计** — 全面重新设计画笔和涂抹工具的交互体验，笔触更流畅自然，涂抹过渡更柔和

[EN]
### Improvements
- **Brush and smudge tool redesign** — Completely redesigned the brush and smudge tool interaction for smoother, more natural strokes and softer smudge transitions

== V1.1.8 ==
[ZH]
### 修复
- **修复全选后传输异常** — 修复在 Photoshop 中使用 Ctrl+A 全选画布后，插件无法正确识别选区范围的问题

[EN]
### Fixes
- **Fix transfer after Select All** — Fixed an issue where using Ctrl+A to select the entire canvas in Photoshop caused the plugin to fail to recognize the selection bounds correctly

== V1.1.7 ==
[ZH]
### 改进
- **笔刷材质重新设计** — 喷溅笔刷全面重制，圆点更柔和自然，中心密集边缘稀疏，整体过渡更平滑，笔触更有水彩感
- **工具独立记忆笔刷** — 画笔和涂抹工具现在各自记住上次使用的笔刷，切换工具时自动恢复

[EN]
### Improvements
- **Brush texture redesign** — Splatter brush completely rebuilt with softer, more natural dots, denser at center and sparser at edges, smoother overall transition and more watercolor-like strokes
- **Per-tool brush memory** — Brush and smudge tools now each remember their last selected brush, automatically restored when switching tools

== V1.1.6 ==
[ZH]
### 改进
- **KM混色深度优化** — 对 Kubelka-Munk 物理混色引擎进行全面优化，混色效果更自然准确，在保证性能的同时修复了多项混色表现问题

[EN]
### Improvements
- **KM mixing refined** — Comprehensive refinement of the Kubelka-Munk physical mixing engine for more natural and accurate color blending, improving performance while fixing several mixing behavior issues

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
