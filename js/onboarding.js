/**
 * 新手引导气泡：依次提示"切笔刷 → 切调色板 → 试引擎"
 * 老用户（localStorage 中已有任一使用痕迹）自动跳过，零打扰。
 */
(function () {
  const STORAGE_KEY = 'onboarding_v1';
  const STEPS = ['brush', 'palette', 'engine', 'smudge'];

  const ANCHOR = {
    brush:   { id: 'brushPreviewBtn', i18nKey: 'onboardingBrush',   placement: 'top' },
    palette: { id: 'paletteBtn',       i18nKey: 'onboardingPalette', placement: 'bottom' },
    engine:  { id: 'engineBtn',        i18nKey: 'onboardingEngine',  placement: 'bottom' },
    smudge:  { id: 'smudgeBtn',        i18nKey: 'onboardingSmudge',  placement: 'top' },
  };

  const SMUDGE_MIN_STROKES = 15;  // 至少累计 15 笔后才考虑提示涂抹

  // 用户操作过的痕迹 key——任一存在即视为老用户
  const EXISTING_USER_KEYS = [
    'mixbox_canvas_v1',
    'mixbox_history',
    'mb_tool_brush',
    'mb_tool_watercolor',
    'mb_tool_smudge',
    'mixbox_palette_preset',
    'mixbox_engine',
    'mixbox_app_settings',
  ];

  const FIRST_STROKE_DELAY_MS = 1500;     // 第一次笔触结束后多久弹"切笔刷"
  const NEXT_STEP_DELAY_MS    = 2500;     // 完成上一步后多久弹下一步
  const AUTO_DISMISS_MS       = 30000;    // 30 秒无操作自动隐藏（不写 dismissed）
  const PAINT_HIDE_MS         = 600;      // 用户开始画画时短暂隐藏

  let state = null;
  let bubbleEl = null;
  let arrowEl  = null;
  let textEl   = null;
  let closeEl  = null;
  let currentStep = null;
  let autoHideTimer = null;
  let pendingShowTimer = null;
  let strokeCount = 0;
  let paletteSwitchCount = 0;
  let smudgeUsed = false;  // 用户是否点过涂抹按钮（true 后 smudge 步骤永久跳过）

  function isExistingUser() {
    for (const key of EXISTING_USER_KEYS) {
      if (localStorage.getItem(key) !== null) return true;
    }
    return false;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function gtagTrack(name, params) {
    try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch (_) {}
  }

  function nextPendingStep() {
    for (const s of STEPS) {
      if (state[s] === 'pending') return s;
    }
    return null;
  }

  function buildBubble() {
    if (bubbleEl) return;
    bubbleEl = document.createElement('div');
    bubbleEl.id = 'onboarding-bubble';
    bubbleEl.className = 'onboarding-bubble hidden';
    bubbleEl.setAttribute('role', 'dialog');
    bubbleEl.innerHTML = '<div class="onboarding-arrow"></div>'
      + '<div class="onboarding-text"></div>'
      + '<button class="onboarding-close" aria-label="dismiss">×</button>';
    document.body.appendChild(bubbleEl);
    arrowEl = bubbleEl.querySelector('.onboarding-arrow');
    textEl  = bubbleEl.querySelector('.onboarding-text');
    closeEl = bubbleEl.querySelector('.onboarding-close');

    closeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissCurrent();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && currentStep) dismissCurrent();
    });
  }

  function translate(key) {
    if (typeof window.t === 'function') return window.t(key);
    if (window.I18N && typeof window.I18N.t === 'function') return window.I18N.t(key);
    return key;
  }

  function positionBubble(anchorEl, placement) {
    const rect = anchorEl.getBoundingClientRect();
    const isMobile = window.matchMedia('(max-width: 600px)').matches;

    if (isMobile) {
      // 移动端：固定底部，避免遮挡画布
      bubbleEl.classList.add('mobile');
      bubbleEl.style.left = '50%';
      bubbleEl.style.top  = '';
      bubbleEl.style.right = '';
      bubbleEl.style.bottom = '16px';
      bubbleEl.style.transform = 'translateX(-50%)';
      arrowEl.style.display = 'none';
      return;
    }

    bubbleEl.classList.remove('mobile');
    arrowEl.style.display = '';
    bubbleEl.style.bottom = '';
    bubbleEl.style.transform = '';

    // 先临时显示以测量尺寸
    const prevVis = bubbleEl.style.visibility;
    bubbleEl.style.visibility = 'hidden';
    bubbleEl.classList.remove('hidden');
    const bw = bubbleEl.offsetWidth;
    const bh = bubbleEl.offsetHeight;
    bubbleEl.style.visibility = prevVis;

    const margin = 12;
    let top, left;
    bubbleEl.dataset.placement = placement;

    if (placement === 'top') {
      top  = rect.top - bh - margin;
      left = rect.left + rect.width / 2 - bw / 2;
      if (top < 8) { // 顶部空间不够，翻到下面
        top = rect.bottom + margin;
        bubbleEl.dataset.placement = 'bottom';
      }
    } else { // 'bottom'
      top  = rect.bottom + margin;
      left = rect.left + rect.width / 2 - bw / 2;
      if (top + bh > window.innerHeight - 8) {
        top = rect.top - bh - margin;
        bubbleEl.dataset.placement = 'top';
      }
    }

    // 水平防越界
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));

    bubbleEl.style.left = left + 'px';
    bubbleEl.style.top  = top + 'px';
  }

  function showStep(step) {
    if (!state || state[step] !== 'pending') return;
    const cfg = ANCHOR[step];
    const anchorEl = document.getElementById(cfg.id);
    if (!anchorEl) return;
    buildBubble();
    textEl.textContent = translate(cfg.i18nKey);
    positionBubble(anchorEl, cfg.placement);
    bubbleEl.classList.remove('hidden');
    currentStep = step;
    state[step] = 'shown';
    saveState();
    gtagTrack('onboarding_step_shown', { step });

    clearTimeout(autoHideTimer);
    autoHideTimer = setTimeout(() => {
      // 自动隐藏：不写 dismissed，下次会话仍可弹
      if (currentStep === step && state[step] === 'shown') {
        hideBubble();
        state[step] = 'pending';
        saveState();
        currentStep = null;
      }
    }, AUTO_DISMISS_MS);

    // 锚点点击 = 完成（延后绑定避免立即触发当前事件循环里的 click）
    setTimeout(() => attachAnchorListener(step, anchorEl), 0);

    // 重新定位（窗口大小变化）
    window.addEventListener('resize', repositionCurrent, { passive: true });
  }

  function attachAnchorListener(step, anchorEl) {
    const handler = () => {
      if (currentStep === step) completeCurrent();
      anchorEl.removeEventListener('click', handler, true);
    };
    anchorEl.addEventListener('click', handler, true);
  }

  function repositionCurrent() {
    if (!currentStep) return;
    const cfg = ANCHOR[currentStep];
    const anchorEl = document.getElementById(cfg.id);
    if (anchorEl && bubbleEl && !bubbleEl.classList.contains('hidden')) {
      positionBubble(anchorEl, cfg.placement);
    }
  }

  function hideBubble() {
    if (bubbleEl) bubbleEl.classList.add('hidden');
    clearTimeout(autoHideTimer);
    window.removeEventListener('resize', repositionCurrent);
  }

  function completeCurrent() {
    if (!currentStep) return;
    const step = currentStep;
    state[step] = 'completed';
    saveState();
    gtagTrack('onboarding_step_completed', { step });
    hideBubble();
    currentStep = null;
    scheduleNextStep(NEXT_STEP_DELAY_MS);
  }

  function dismissCurrent() {
    if (!currentStep) return;
    const step = currentStep;
    state[step] = 'dismissed';
    saveState();
    gtagTrack('onboarding_step_dismissed', { step });
    hideBubble();
    currentStep = null;
    scheduleNextStep(NEXT_STEP_DELAY_MS);
  }

  function scheduleNextStep(delay) {
    clearTimeout(pendingShowTimer);
    const step = nextPendingStep();
    if (!step) return;
    // engine 步骤额外要求：用户至少切过一次调色板
    if (step === 'engine' && paletteSwitchCount === 0) return;
    // smudge 步骤额外要求：累计画了 N 笔且从未点过涂抹按钮
    if (step === 'smudge') {
      if (smudgeUsed) {
        state.smudge = 'completed';
        saveState();
        return;
      }
      if (strokeCount < SMUDGE_MIN_STROKES) return;
    }
    pendingShowTimer = setTimeout(() => {
      if (state[step] === 'pending') showStep(step);
    }, delay);
  }

  // 公开钩子：app.js 在 endStroke 末尾、switchPalette 内、switchEngine 内、点击 smudgeBtn 时调用
  function onPaintStrokeEnd() {
    strokeCount++;
    if (currentStep && bubbleEl) {
      // 用户在画画时短暂隐藏当前气泡，避免遮挡
      bubbleEl.classList.add('paint-hidden');
      setTimeout(() => bubbleEl.classList.remove('paint-hidden'), PAINT_HIDE_MS);
    }
    // 第一次笔触后才弹"切笔刷"
    if (strokeCount === 1 && state && state.brush === 'pending' && !currentStep) {
      pendingShowTimer = setTimeout(() => {
        if (state.brush === 'pending' && !currentStep) showStep('brush');
      }, FIRST_STROKE_DELAY_MS);
    }
    // 累计够多笔触后尝试解锁 smudge 步骤
    if (strokeCount === SMUDGE_MIN_STROKES && state && state.smudge === 'pending' && !currentStep) {
      scheduleNextStep(NEXT_STEP_DELAY_MS);
    }
  }

  function onPaletteSwitch() {
    paletteSwitchCount++;
    // 切了调色板可能解锁 engine 步骤
    if (!currentStep && state && state.palette !== 'pending' && state.engine === 'pending') {
      scheduleNextStep(NEXT_STEP_DELAY_MS);
    }
  }

  function onEngineSwitch() {
    // 留作埋点扩展位
  }

  function onSmudgeUse() {
    smudgeUsed = true;
    // 用户已经发现涂抹工具，永久跳过该步骤
    if (state && state.smudge === 'pending') {
      state.smudge = 'completed';
      saveState();
    }
  }

  function init() {
    if (state !== null) return; // 防重入
    let stored = loadState();
    if (stored === null) {
      if (isExistingUser()) {
        stored = { brush: 'skipped_existing_user', palette: 'skipped_existing_user', engine: 'skipped_existing_user', smudge: 'skipped_existing_user' };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch (_) {}
        gtagTrack('onboarding_skipped', { reason: 'existing_user' });
      } else {
        stored = { brush: 'pending', palette: 'pending', engine: 'pending', smudge: 'pending' };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch (_) {}
        gtagTrack('onboarding_started', {});
      }
    } else if (stored.smudge === undefined) {
      // 老 schema 升级：之前的 onboarding_v1 没有 smudge 字段
      stored.smudge = 'pending';
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch (_) {}
    }
    state = stored;
  }

  window.Onboarding = {
    init,
    onPaintStrokeEnd,
    onPaletteSwitch,
    onEngineSwitch,
    onSmudgeUse,
  };
})();
