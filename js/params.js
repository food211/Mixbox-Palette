/**
 * params.js — 全局渲染参数
 *
 * 所有水彩/热度/混色相关的可调常数集中在此。
 * 在 app.html 中最先加载，其余 JS 文件直接读取这些全局 const。
 *
 * 组织结构：
 *   1. 热度图系统（smudgeHeatmap / wetHeatmap / wetMaskHeatmap / depositHeatmap）
 *   2. 水彩主 shader（base-painter.js drawBrush：maskCold / maskHot 两路）
 *   3. 水彩 RAF 效果（wetpaper.js _applyWetColor / _applyWetBleed / _applyDepositColor）
 *   4. 混色 & 默认值
 *   5. GPU 历史池 & 异步任务
 *
 * 热度图系统总览：
 *   【smudgeHeatmap】    涂抹工具专用，记录笔触经过区域的热度
 *   【wetHeatmap】       水彩笔刷专用，驱动主 shader 的 maskCold / maskHot / maskDeposit
 *                        — maskCold    冷区，负责实时混色
 *                        — maskHot     热区，负责晕染（bleed 已禁用，交给 _applyWetBleed）
 *                        — maskDeposit 交界沉积，松开时由 _applyDepositColor 处理
 *   【wetMaskHeatmap】   水彩区域 mask，与 wetHeatmap 取交集才写色
 *   【depositHeatmap】   水彩累积覆盖区域（不衰减，松开时清空）→ 咖啡环
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. 热度图系统
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1.1 smudgeHeatmap（涂抹工具）─────────────────────────────────────────────

/** 涂抹每次 drawcall 叠加的热度量（0~1）。值越大升温越快，约 1/N 次到顶 */
const HEAT_ACCUMULATE_STEP = 0.03;

/** RAF 每帧衰减的热度量（0~1）。仅作用于 smudgeHeatmap */
const HEAT_DECAY_STEP = 0.02;

/** 衰减速度随湿度调制：wet=0 时 MAX 倍（干得快）、wet=1 时 MIN 倍（干得慢） */
/** 典型值：wet=0 ~0.5秒 干透、wet=0.5 ~1秒、wet=1 ~2秒 */
const HEAT_DECAY_SCALE_MIN = 0.42;
const HEAT_DECAY_SCALE_MAX = 1.68;

// ─── 1.2 wetHeatmap（水彩主热度图）───────────────────────────────────────────

/** wetHeatmap 衰减参数（与涂抹完全解耦，可独立调节湿润持续时间） */
const WET_HEAT_DECAY_STEP      = 0.02;
const WET_HEAT_DECAY_SCALE_MIN = 0.42;
const WET_HEAT_DECAY_SCALE_MAX = 1.68;

/** 方向变化超过此角度（度）才触发热度上限提升 */
const WET_HEAT_DIR_THRESHOLD_DEG = 30;

/** 每次方向突破后热度上限提升量 */
const WET_HEAT_CAP_STEP = 0.25;

/** 浓度→_applyWetColor 写入间隔（帧数）：浓度=0 时每 N_LOW 帧一次，浓度=100 时每 N_HIGH 帧一次。
 *  数值越大写入越稀。例：N_LOW=7 表示低浓度每 7 帧注一次热，N_HIGH=2 表示高浓度每 2 帧一次。 */
const WET_HEAT_INTERVAL_LOW  = 7;   // 浓度 0% 时的写入间隔（帧）
const WET_HEAT_INTERVAL_HIGH = 1;   // 浓度 100% 时的写入间隔（帧）

/** wetHeatmap 扩散采样半径（像素），随湿度调制：wet=0 时 MIN、wet=1 时 MAX
 *  控制扩散速度：radius 越大单帧向外爬得越远；浓度由邻居继承（max+falloff） */
const WET_SPREAD_RADIUS_MIN = 0.4;
const WET_SPREAD_RADIUS_MAX = 1;

/** wetHeatmap 扩散衰减（0~1）：每次外扩时邻居热度保留的比例，越接近 1 爬得越远才衰减到 0 */
const WET_SPREAD_FALLOFF = 0.995;

/** 通用/遗留扩散半径（像素），仅 _spreadHeatmapGeneric 使用 */
const WET_SPREAD_RADIUS = 2;

/** 扩散/噪点半径随 brushSize 线性缩放的基准尺寸。size=40 时 scale=1，size=80 时 scale=2 */
const WET_SIZE_SCALE_BASE = 40;
/** scale 的夹逼范围：太小会让扩散步长缩到亚像素，太大单帧爬得太远 */
const WET_SIZE_SCALE_MIN = 0.25;
const WET_SIZE_SCALE_MAX = 1.0;

// ─── 1.3 wetMaskHeatmap（水彩区域 mask）──────────────────────────────────────

/** 注入步长（每次 drawcall 叠加量，与 wetHeatmap 解耦） */
const WET_MASK_HEAT_ACCUMULATE_STEP = 0.1;

/** 衰减参数（独立于 wetHeatmap，控制 mask 区域的有效寿命）
 *  注：衰减须 < 注入才能积累；STEP=0.1 配 ACCUMULATE=0.1 → 需要多次叠加才能积累 */
const WET_MASK_HEAT_DECAY_STEP      = 0.1;
const WET_MASK_HEAT_DECAY_SCALE_MIN = 0.5;
const WET_MASK_HEAT_DECAY_SCALE_MAX = 2.0;

// ─── 1.4 depositHeatmap（咖啡环累积区域）──────────────────────────────────────
// 注热步长沿用 wetHeatmap 的 HEAT_ACCUMULATE_STEP（updateWetHeatmap 内一次 drawcall
// 同时写 wet/deposit/wetMask 三张）。

/** 扩散半径（像素），随湿度调制：wet=0 时 MIN、wet=1 时 MAX */
const WET_DEPOSIT_SPREAD_RADIUS_MIN = 0.3;
const WET_DEPOSIT_SPREAD_RADIUS_MAX = 1.0;

/** 扩散半径（遗留单值，保留兼容） */
const WET_DEPOSIT_SPREAD_RADIUS = 1.0;

/** 扩散衰减（0~1）：每次外扩邻居保留比例，<1 才能自然衰减 */
const WET_DEPOSIT_SPREAD_FALLOFF = 0.92;


// ═══════════════════════════════════════════════════════════════════════════
// 2. 水彩主 shader 参数（base-painter.js / drawBrush）
// ═══════════════════════════════════════════════════════════════════════════

/** 边缘堆积抛物线系数：heat*(1-heat)*N，N=4时heat=0.5峰值=1 */
const WET_DEPOSIT_PEAK = 4.0;

// ─── 2.1 冷区（maskCold：实时稀释混色）────────────────────────────────────────

/** 冷区基础混色强度（相对 baseMixStrength 的比例）
 * 注：km-painter 已不再乘此参数（对齐 km-paint），仅 mixbox-painter 使用。
 * 1.0 = 与 KM 同浓度（mixbox 覆盖力略强）；降低可让多笔累积感更明显。
 * 已去掉湿度 SCALE 调制，coldMix 在 MB 下恒定 = WET_COLD_MIX。
 */
const WET_COLD_MIX = 0.85;

// ─── 2.2 smudge 推色（冷区 smear 已禁用，保留 uniform 以防回滚）────────────

/** smudge 采样距离系数（相对 smearLen/brushRadius） */
const WET_SMEAR_REACH = 0.5;

/** 水彩 smudge 推色强度 */
const WET_SMUDGE_MIX = 0.1;

/** smudgeMix 随湿度调制：wet=0 时 MIN 倍，wet=1 时 MAX 倍 */
const WET_SMUDGE_SCALE_MIN = 0.01;
const WET_SMUDGE_SCALE_MAX = 1.0;

// ─── 2.3 热区（maskHot：bleedSample 已禁用，保留 uniform 以防回滚）────────

/** 晕染偏移半径（相对笔刷半径的比例） */
const WET_BLEED_RADIUS = 0.3;

/** 晕染混合强度（热区颜色向外渗出的比例） */
const WET_BLEED_MIX = 0.4;

/** bleedMix/bleedRadius 随湿度调制：wet=0 时 MIN 倍，wet=1 时 MAX 倍 */
const WET_BLEED_SCALE_MIN = 0.3;
const WET_BLEED_SCALE_MAX = 2.0;


// ═══════════════════════════════════════════════════════════════════════════
// 3. 水彩 RAF 效果（wetpaper.js）
// ═══════════════════════════════════════════════════════════════════════════
//
// 三个独立 pass，按 RAF 节拍跑：
//   _applyWetColor     —— 基于 wetHeatmap 梯度做额外沉积 + 高热区稀释
//   _applyWetBleed     —— 每帧把画布颜色从 depositHeatmap 高浓度区向低浓度区扩散
//   _applyDepositColor —— 松开画笔时 8 帧渐进咖啡环沉积

// ─── 3.1 _applyWetColor（梯度沉积 + 高热区稀释）─────────────────────────────

/** 梯度区颜料沉积的最大混色强度（0~1） */
const WET_DEPOSIT_STRENGTH = 0.1;

/** 高热区稀释已有颜色的最大强度（0~1） */
const WET_DILUTE_STRENGTH = 0.5;

/** 梯度采样半径（像素），越大边缘越宽 */
const WET_GRADIENT_RADIUS = 3.0;

/** 梯度沉积 smoothstep 区间（梯度落在这段才沉积）*/
const WET_DEPOSIT_GRAD_MIN = 0.05;
const WET_DEPOSIT_GRAD_MAX = 0.4;

/** 稀释的梯度抑制区间：梯度高于此值时不稀释（边缘保留） */
const WET_DILUTE_GRAD_SUPPRESS = 0.5;

/** depositStr 随湿度调制：wet=0 时 MAX 倍，wet=1 时 MIN 倍 */
const WET_DEPOSIT_SCALE_MAX = 0.8;
const WET_DEPOSIT_SCALE_MIN = 0.2;

/** diluteStr 随湿度调制：wet=0 时 MIN 倍，wet=1 时 MAX 倍 */
const WET_DILUTE_SCALE_MIN = 0.2;
const WET_DILUTE_SCALE_MAX = 1.8;

// ─── 3.2 _applyWetBleed（画布颜色扩散）───────────────────────────────────────
// 每帧把画布颜色从 depositHeatmap 高浓度区向低浓度区微量扩散。
// 先画的像素经过更多帧扩散 → 渗得远；后画的 → 只渗一点（时间演化天然实现）

/** 扩散采样半径（像素）。越大单帧扩散距离越远 */
const WET_CANVAS_BLEED_RADIUS = 3.0;

/** 扩散强度（0~1）：每帧邻居色混入当前像素的比例（会乘以邻居浓度差总和）*/
const WET_CANVAS_BLEED_STRENGTH = 0.7;

/** 扩散随湿度调制范围：wet=0 时 MIN 倍，wet=1 时 MAX 倍 */
const WET_CANVAS_BLEED_SCALE_MIN = 0.25;
const WET_CANVAS_BLEED_SCALE_MAX = 2.5;

/** depositRaw 低于此值时不扩散（避免空白区域被影响） */
const WET_CANVAS_BLEED_DEPOSIT_MIN = 0.02;

/** 扩散后稀释强度：本像素 deposit 越低（越靠边缘）越向纸色靠近。0=不稀释 */
const WET_CANVAS_BLEED_DILUTE = 0.6;

/** 扩散噪声强度（0~1）：模拟纸张纤维不规则性，让边缘不规则 */
const WET_CANVAS_BLEED_NOISE = 0.3;

/** 噪声网格随 brushSize 缩放的指数。1=与扩散半径同步线性放大；<1 让大笔刷颗粒不那么粗，
 *  保持细节在不同尺寸下接近一致。0.4 时 size=80 颗粒约 1.32×（而非 2×） */
const WET_CANVAS_BLEED_NOISE_SCALE_EXP = 0.4;

/** 湿度 gate 下限：wetHeatmap 低于此值的像素停止扩散（表示已干、定型） */
const WET_CANVAS_BLEED_WET_GATE_MIN = 0.02;

// ─── 3.4 drip（颜料水滴往下流挂 — CPU 粒子系统）────────────────────────────
// 模型：水彩笔触绘制时按笔触距离闸门触发"水滴生成"，沿用水彩笔刷的
//   35 颗粒分布（极坐标 sqrt 半径）随机抽 1~2 个当起点。
//   每个粒子是 CPU 维护的对象，每帧 RAF 更新位置 + 半径脉动 + alpha 衰减；
//   用 painter.drawBrush 软圆渲染。
//   寿命/重力随当前湿度（_wetness 0~1）线性映射；湿度=0 直接跳过。

/** 水滴生成的湿度门槛：湿度低于此值完全不产生水滴。
 *  视觉上水滴是"很湿"才会有的现象，半干状态没有水流挂感。 */
const DRIP_WETNESS_THRESHOLD = 0.5;

/** 笔触上每走过这么多像素触发一次水滴生成（基础值 + (1-wet)*range，湿度低更稀疏）。
 *  现在间隔拉远，配合"一簇 1-3 滴"获得稀疏成簇的视觉。 */
const DRIP_SPAWN_INTERVAL_PX_BASE  = 160;
const DRIP_SPAWN_INTERVAL_PX_RANGE = 240;

/** 一簇粒子数：每次触发抽 [MIN, MAX] 范围内随机数量 */
const DRIP_CLUSTER_MIN = 1;
const DRIP_CLUSTER_MAX = 2;

/** 单帧最大活跃粒子数（防爆量保险，正常笔触不会触顶）。
 *  水滴总数随笔触长度自然增长（按 spawn 间距），此处只作为极长笔触的安全阀。 */
const DRIP_MAX_PARTICLES_MIN = 80;
const DRIP_MAX_PARTICLES_MAX = 200;

/** 每帧重力（像素/帧）的湿度映射：wet=0→MIN、wet=1→MAX */
const DRIP_GRAVITY_MIN = 0.5;
const DRIP_GRAVITY_MAX = 0.9;

/** 水平蛇形扭动：振幅（像素）+ 相位频率（rad/帧） */
const DRIP_VX_AMP_PX = 1.2;
const DRIP_VX_OMEGA  = 0.05;

/** 粒子半径占笔刷半径的比例（最终半径 = brushRadius × (MIN + rand×RANGE)） */
const DRIP_PARTICLE_R_MIN   = 0.15;
const DRIP_PARTICLE_R_RANGE = 0.3;

/** 半径每帧的随机走步量（让水滴大小有微变化） */
const DRIP_PARTICLE_R_PULSE = 0.12;

/** 半径随寿命收缩的终点比例（age=0 时 1.0×，age=life 时 END×）。
 *  让水滴呈现"先大后小"的视觉，弥补无 pre-spread 后起步过小的问题。 */
const DRIP_R_SHRINK_END = 0.7;

/** 沉淀时机：寿命的此比例后水滴停止下落 + 半径不再收缩，定格成静止圆点。
 *  避免末端继续缩小变成尖尾巴；越小越早沉淀（尾部圆球更大），越大越晚沉淀（轨迹更长）。 */
const DRIP_SETTLE_AT = 0.65;

/** 沉淀阶段每隔多少帧强制 stamp 一次（位置不动了，距离阈值不再触发，需要主动盖章让圆点变浓） */
const DRIP_SETTLE_STAMP_STRIDE = 3;

/** 寿命（帧数）的湿度映射：wet 接近 0 短寿命，wet=1 最长寿命。
 *  60fps 下 240 帧 ≈ 4 秒。 */
const DRIP_LIFE_MIN = 50;
const DRIP_LIFE_MAX = 120;

/** 单个粒子渲染强度（占 baseMixStrength 的比例）。
 *  > 1.0 让水滴比主笔触浓，避免小尺寸下视觉太淡。 */
const DRIP_DRAW_STRENGTH = 1.6;

/** 粒子沿轨迹打章的间距（相对粒子半径）：
 *  位移 ≥ r * SPACING_FACTOR 才画下一颗印章。
 *  >1 让印章稀疏（点状），<1 让印章重叠（连续液柱）。
 *  0.25 ≈ 印章高度重叠形成连续轨迹，但仍比"每帧画"省得多。 */
const DRIP_STAMP_SPACING_FACTOR = 0.1;

/** 水滴轮廓扩散参数（_applyDripBleed）：
 *  以 wetHeatmap.g 当 mask + 梯度源，在湿区内做"邻居高浓度方向吸色"扩散，
 *  形成水滴外轮廓的颜色晕开效果。完全独立于主笔触 bleed。 */
const DRIP_BLEED_RADIUS   = 3.0;   // 8 邻居采样半径（像素）
const DRIP_BLEED_STRENGTH = 0.5;   // 单帧吸色比例（最终乘 gradWeight + gateScale）
const DRIP_BLEED_GATE_MIN = 0.005;  // wetHeatmap.g 低于此值不参与扩散（调低让末端小水滴也能扩散）
/** 像素级 hash 噪声强度（0~1）：扰动半径、吸色力度、采样方向 → 纤维粗细不均的纸感
 *  调高让边缘更碎、纤维感更强；调低让轮廓更圆滑 */
const DRIP_BLEED_NOISE    = 0.5;

// ─── 3.3 _applyDepositColor（咖啡环）────────────────────────────────────────
// 松开画笔时 8 帧渐进沉积，基于 depositHeatmap 的梯度做边缘强调。
// 目前复用 _applyWetColor 的 shader，参数见 3.1 的 WET_DEPOSIT_* 与 1.4 的 depositHeatmap 组。


// ═══════════════════════════════════════════════════════════════════════════
// 4. 混色 & 默认值
// ═══════════════════════════════════════════════════════════════════════════

/** 混色强度默认值（0~1），对应 UI 滑块初始位置 */
const DEFAULT_MIX_STRENGTH = 0.5;


// ═══════════════════════════════════════════════════════════════════════════
// 5. GPU 历史池 & 异步任务
// ═══════════════════════════════════════════════════════════════════════════

// ─── 5.1 GPU 显存预算 ────────────────────────────────────────────────────────

/** GPU 显存预算估算（MB）：首次尝试的预算 */
const GPU_BUDGET_MB = 200;

/** GPU 显存降级预算（MB）：检测到分配失败时回退到此预算 */
const GPU_BUDGET_FALLBACK_MB = 100;

/** GPU 运行时基础占用估算（MB），从预算中扣除 */
const GPU_RUNTIME_OVERHEAD_MB = 20;

// ─── 5.2 历史纹理槽 ──────────────────────────────────────────────────────────

/** GPU 历史纹理槽上限（受显存预算限制，不超过此值） */
const GPU_SLOTS_MAX = 50;

/** GPU 历史纹理槽下限（显存极小时保底） */
const GPU_SLOTS_MIN = 10;

/** 历史帧数组超出 GPU slot 上限多少帧后开始驱逐最老帧（含 CPU 备份残留） */
const HISTORY_OVERFLOW_BUFFER = 5;

/** 历史帧总数硬上限（含已压缩帧）。防止长时间绘制导致 CPU blob 无限堆积。 */
const HISTORY_FRAMES_HARD_CAP = 80;

/** 距离当前步 <= 此值的历史帧保持未压缩（快速撤销），更远的帧异步压成 WebP */
const HISTORY_UNCOMPRESSED_NEAR = 5;

// ─── 5.3 异步任务超时 ────────────────────────────────────────────────────────

/** requestIdleCallback 强制超时（ms）：CPU 历史备份任务 */
const IDLE_BACKUP_TIMEOUT_MS = 5000;

/** setTimeout 回退延迟（ms）：不支持 requestIdleCallback 时的 CPU 历史备份 */
const IDLE_BACKUP_FALLBACK_MS = 200;

/** 笔画结束后至少这么久没新笔画才启动 idle 备份（ms）。
 *  iOS Safari 的 requestIdleCallback 会在连续绘制的帧间隙里硬挤，导致偶发卡顿；
 *  在 painter 层自己加一道闸门：连续绘制时只挂 pending，等真正静默了再 rIC。 */
const STROKE_QUIET_DELAY_MS = 250;

/** requestIdleCallback 强制超时（ms）：画布 idle 保存任务 */
const IDLE_SAVE_TIMEOUT_MS = 3000;

/** setTimeout 回退延迟（ms）：不支持 requestIdleCallback 时的画布保存 */
const IDLE_SAVE_FALLBACK_MS = 100;


console.log('params.js 加载成功');
