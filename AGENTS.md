# Mixbox Palette 开发指导

## 结构与边界

- 先读 `README.md`；如本地存在 `CLAUDE.md`，保留其中的项目约定，但测试能力以当前 `tests/` 和实际执行结果为准。
- `app.html` 是调色板入口，按顺序加载原生 JavaScript 全局脚本；`index.html` 是加载/跳转页。改动脚本依赖时检查入口中的加载顺序。
- `js/app.js` 管理输入、工具状态、历史操作与自动保存；`js/base-painter.js` 提供两个引擎共用的 WebGL、GPU 历史池及 Worker 调度；`js/km-painter.js`、`js/mixbox-painter.js` 实现混色引擎；`js/params.js` 集中渲染参数。
- `js/palette-storage.js` 封装 localStorage，`js/history-worker.js` 处理历史帧压缩。修改历史或保存流程时同时检查异步完成顺序、失败重试、刷新/卸载及引擎切换。
- `uxp-host/` 是 Photoshop UXP 宿主，开发者工具加载该目录；浏览器测试只能验证 Web UI 和模拟桥接消息，Photoshop 的颜色/像素传输需另做真实宿主验证。
- `css/` 为界面样式，`locales/` 为翻译源，`js/i18n-translations.js` 为生成的翻译表。翻译变更需同步源文件与生成结果；本地生成器如存在，见 `scripts/gen-i18n.js`。

## 本地运行与验证

本地 `package.json` 提供 Vite 开发命令；它与 lockfile、`scripts/` 当前被 Git 忽略，检查本地是否存在所需工具，不强制添加这些文件到版本控制。

```sh
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 8765 --strictPort
node tests/preset-colors.cjs http://127.0.0.1:8765/app.html
node --test tests/canvas-persistence.cjs
```

- 浏览器测试需要可解析的 `playwright` 包。可通过进程级 `NODE_PATH` 指向外部验证依赖；`CHROMIUM_PATH` 可指定本机 Chromium/Edge，避免下载浏览器。保存回归可用 `PALETTE_TEST_URL` 指定其他开发地址。
- `preset-colors.cjs` 覆盖色板、键盘、多语言布局、双引擎绘画、取色、撤销/重做、压感和模拟 PS 消息；`canvas-persistence.cjs` 覆盖历史操作刷新持久化、存储失败重试、卸载时正在编码的画布。
- 修改 JavaScript 后对受影响脚本运行 `node --check <文件>`；跨模块改动检查 `js/*.js`、`uxp-host/js/*.js` 和 `sw.js`。当前没有配置 lint、TypeScript 类型检查或统一 `npm test`，汇报时分别说明。
- Vite 默认构建只产出 `index.html`，不能代替 `app.html` 的运行验证，也不是可安装的 UXP 包。旧 `packer.js` 的根目录文件清单不符合当前宿主结构；需要打包时先核对 `uxp-host/manifest.json` 和实际打包流程。

## 实现约束

- 保持两种引擎共享基类的职责；验证 GPU 快照和 CPU/Worker 回退路径，不仅检查可见的最后一笔。保留 WebGL 的 `preserveDrawingBuffer` 及像素读写的 Y 翻转约定。
- localStorage 写入可能返回失败；延迟保存必须保留未落盘状态。高频输入继续走现有防抖/节流，关键节点使用已有 flush 接口。
- 修改宿主消息时两端一起核对 `js/ps-bridge.js`、`js/app.js` 与 `uxp-host/js/host.js`，保留 origin 校验及版本兼容规则。
- 保留自研代码、Mixbox 和光谱数据各自的许可声明；第三方库与 LUT 不作为日常代码整理目标。
- `sw.js` 在 localhost/127.0.0.1 不缓存。生产快照内资源变更需在发布时换 `CACHE_NAME`，新增资源加入 `CACHE_URLS`；dev 日常修改不提前更新发布版本。发布流程参考本地 `CLAUDE.md`（如存在）及 `CHANGELOG.md`；发布日志编辑时读 `.claude/rules/changelog.md`（如存在）。

## 相关 skills

- 修改本指导时使用 `writing-for-agents`；发现正确性或性能问题时使用 `diagnosing-bugs`，先复现再修复；浏览器交互验证使用 `playwright`，优先复用已有回归。
- 如存在项目 `.agents/skills/`，只读取与当前任务相关的 `SKILL.md`；当前仓库没有该目录，无需为初始化复制一套通用 skills。
