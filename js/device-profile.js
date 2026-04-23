/**
 * DeviceProfile — 设备自适应渲染参数
 *
 * 根据是否存在高精度指针（鼠标 / 触控板 / 数位笔）分流：
 *   fine = true  → 桌面 / iPad+Pencil      → 放开性能
 *   fine = false → 纯触控平板 / 手机        → 保守，省 fillrate
 *
 * `any-pointer: fine` 判据比 UA 检测稳：iPad Pro + Pencil 被归为桌面级，
 * 只有手指触控的平板才走触控配置。
 */
(function(global) {
    const hasFinePointer = typeof matchMedia === 'function'
        && matchMedia('(any-pointer: fine)').matches;

    // iPad 识别：原生 UA 或伪装 Mac（"请求桌面网站"模式下 platform=MacIntel，
    // 但 maxTouchPoints>1 暴露真身；真 Mac 触控板 maxTouchPoints 为 0/1）
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isIPad = /iPad/.test(ua) ||
        (typeof navigator !== 'undefined'
            && navigator.platform === 'MacIntel'
            && (navigator.maxTouchPoints || 0) > 1);

    const DeviceProfile = {
        hasFinePointer,
        isIPad,

        // 目标帧率：桌面 100Hz（高刷屏也只限到 100），触控 60Hz
        TARGET_FPS: hasFinePointer ? 100 : 60,

        // 水彩扩散/颜色 GPU pass 批处理步长（N 帧合并一次）
        WET_PASS_STRIDE: hasFinePointer ? 1 : 2,

        // scheduler 单帧 drawBrush 次数上限
        // iPad（含 Pencil 伪装桌面）：单帧 drawBrush 超 6 次容易超 16ms 预算 → 卡顿
        // 桌面：保持高上限（CPU 强，极少触发）
        // 纯触控：保守兜底
        MAX_STEPS_PER_FRAME: isIPad ? 15 : hasFinePointer ? 120 : 15,
    };

    global.DeviceProfile = DeviceProfile;
})(window);
