/**
 * params.js — 全局渲染参数
 *
 * 所有水彩/热度/混色相关的可调常数集中在此。
 * 在 app.html 中最先加载，其余 JS 文件直接读取这些全局 const。
 */

// ─── 热度图 ───────────────────────────────────────────────────────────────────
//
// 热度图系统有三张纹理，各司其职：
//
// 【smudgeHeatmap / wetHeatmap】（同一张纹理）
//   - 涂抹工具：记录笔触经过区域的热度，热区涂抹强、冷区弱
//   - 水彩笔刷：驱动主 shader 的三个蒙版：
//       maskCold    — 冷区，负责实时上色（混色 + smudge 推色）
//       maskHot     — 热区，负责晕染扩散（bleed）
//       maskDeposit — 交界沉积，松开时由 _applyDepositColor 处理
//   - RAF 每帧衰减（HEAT_DECAY_STEP），松开后自然消退
//
// 【depositHeatmap】
//   - 只在水彩笔刷时使用，记录笔触的累积覆盖区域（不衰减，松开时清空）
//   - 松开鼠标时触发 _applyDepositColor 做渐进咖啡环沉积
//
// 【wetpaper（_applyWetColor，wetpaper.js）】
//   - RAF 每帧独立运行，基于 wetHeatmap 的空间梯度做两件事：
//       梯度区（冷热交界）→ 额外颜料沉积
//       高热区 → 颜色稀释
//
// ─────────────────────────────────────────────────────────────────────────────

/** 水彩/涂抹每次 drawcall 叠加的热度量（0~1）。值越大升温越快，约 1/N 次到顶 */
const HEAT_ACCUMULATE_STEP = 0.03;

/** 水彩 depositHeatmap 每次 drawcall 叠加的热度量，控制咖啡环触发速度 */
const DEPOSITE_HEAT_ACCUMULATE_STEP = 0.12;

/** RAF 每帧衰减的热度量（0~1）。影响水彩上色范围和涂抹热度消退速度 */
const HEAT_DECAY_STEP = 0.02;

// ─── 混色 ─────────────────────────────────────────────────────────────────────

/** 混色强度默认值（0~1），对应 UI 滑块初始位置 */
const DEFAULT_MIX_STRENGTH = 0.5;

// ─── GPU 历史池 ───────────────────────────────────────────────────────────────

/** GPU 显存预算估算（MB）：假设可用总量 */
const GPU_BUDGET_MB = 200;

/** GPU 运行时基础占用估算（MB），从预算中扣除 */
const GPU_RUNTIME_OVERHEAD_MB = 20;

/** GPU 历史纹理槽上限（受显存预算限制，不超过此值） */
const GPU_SLOTS_MAX = 50;

/** GPU 历史纹理槽下限（显存极小时保底） */
const GPU_SLOTS_MIN = 10;

/** 历史帧数组超出 GPU slot 上限多少帧后开始驱逐最老帧 */
const HISTORY_OVERFLOW_BUFFER = 5;

// ─── 异步任务超时 ─────────────────────────────────────────────────────────────

/** requestIdleCallback 强制超时（ms）：CPU 历史备份任务 */
const IDLE_BACKUP_TIMEOUT_MS = 5000;

/** setTimeout 回退延迟（ms）：不支持 requestIdleCallback 时的 CPU 历史备份 */
const IDLE_BACKUP_FALLBACK_MS = 200;

/** requestIdleCallback 强制超时（ms）：画布 idle 保存任务 */
const IDLE_SAVE_TIMEOUT_MS = 3000;

/** setTimeout 回退延迟（ms）：不支持 requestIdleCallback 时的画布保存 */
const IDLE_SAVE_FALLBACK_MS = 100;

// ─── 水彩热度方向分段 ─────────────────────────────────────────────────────────

/** 方向变化超过此角度（度）才触发热度上限提升 */
const WET_HEAT_DIR_THRESHOLD_DEG = 30;

/** 每次方向突破后热度上限提升量 */
const WET_HEAT_CAP_STEP = 0.25;

// ─── 水彩主 shader 参数（base-painter.js / drawBrush）─────────────────────────

/** 边缘堆积抛物线系数：heat*(1-heat)*N，N=4时heat=0.5峰值=1 */
const WET_DEPOSIT_PEAK  = 4.0;

/** 晕染偏移半径（相对笔刷半径的比例） */
const WET_BLEED_RADIUS  = 0.3;

/** 晕染混合强度（热区颜色向外渗出的比例） */
const WET_BLEED_MIX     = 0.4;

/** 冷区基础混色强度（相对 baseMixStrength 的比例） */
const WET_COLD_MIX      = 0.25;

/** smudge 采样距离系数（相对 smearLen/brushRadius） */
const WET_SMEAR_REACH   = 0.8;

/** 水彩 smudge 推色强度 */
const WET_SMUDGE_MIX    = 0.38;

/** bleedMix/bleedRadius 随湿度的调制范围：wet=0 时为 MIN 倍，wet=1 时为 MAX 倍 */
const WET_BLEED_SCALE_MIN = 0.3;
const WET_BLEED_SCALE_MAX = 1.3;

/** coldMix 随湿度的调制范围：wet=0 时为 MAX 倍，wet=1 时为 MIN 倍 */
const WET_COLD_SCALE_MAX = 1.3;
const WET_COLD_SCALE_MIN = 0.2;

// ─── 水彩 RAF 效果参数（wetpaper.js / _applyWetColor）────────────────────────

/** 梯度区颜料沉积的最大混色强度（0~1） */
const WET_DEPOSIT_STRENGTH = 0.5;

/** 高热区稀释已有颜色的最大强度（0~1） */
const WET_DILUTE_STRENGTH = 0.3;

/** 梯度采样半径（像素），越大边缘越宽 */
const WET_GRADIENT_RADIUS = 3.0;

/** 热度扩散采样半径（像素），越大晕染范围越宽 */
const WET_SPREAD_RADIUS = 2.0;

/** 热度扩散强度（0~1），越大扩散越快 */
const WET_SPREAD_STRENGTH = 0.15;

/** 梯度沉积的 smoothstep 区间下限（梯度低于此值不沉积） */
const WET_DEPOSIT_GRAD_MIN = 0.05;

/** 梯度沉积的 smoothstep 区间上限 */
const WET_DEPOSIT_GRAD_MAX = 0.4;

/** 稀释的梯度抑制区间：梯度高于此值时不稀释（边缘保留） */
const WET_DILUTE_GRAD_SUPPRESS = 0.5;

/** depositStr 随湿度的调制范围：wet=0 时为 MAX 倍，wet=1 时为 MIN 倍 */
const WET_DEPOSIT_SCALE_MAX = 1.8;
const WET_DEPOSIT_SCALE_MIN = 0.2;

/** diluteStr 随湿度的调制范围：wet=0 时为 MIN 倍，wet=1 时为 MAX 倍 */
const WET_DILUTE_SCALE_MIN = 0.2;
const WET_DILUTE_SCALE_MAX = 1.8;

console.log('params.js 加载成功');
