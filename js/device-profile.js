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

    const DeviceProfile = {
        hasFinePointer,

        // 目标帧率：桌面 100Hz（高刷屏也只限到 100），触控 60Hz
        TARGET_FPS: hasFinePointer ? 100 : 60,

        // 水彩扩散/颜色 GPU pass 批处理步长（N 帧合并一次）
        WET_PASS_STRIDE: hasFinePointer ? 1 : 2,

        // scheduler 单帧 drawBrush 次数上限；桌面设高到几乎不触发，触控兜底
        MAX_STEPS_PER_FRAME: hasFinePointer ? 120 : 15,
    };

    global.DeviceProfile = DeviceProfile;
})(window);
