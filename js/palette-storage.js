/**
 * 画布持久化存储类
 * 负责保存和加载画布状态、调色盘预设、笔刷设置和历史记录
 */
class PaletteStorage {
    constructor(key = 'mixbox_canvas_v1', paletteKey = 'mixbox_palette_preset', brushKey = 'mixbox_brush_settings', historyKey = 'mixbox_history', settingsKey = 'mixbox_app_settings') {
        this.key = key;
        this.paletteKey = paletteKey;
        this.brushKey = brushKey;
        this.historyKey = historyKey;
        this.settingsKey = settingsKey;
        this.autoSaveTimer = null;

        // appSettings 内存缓存 + debounce：避免滑条/颜色变动时每次都走
        // getItem+parse+merge+stringify+setItem 的同步 I/O 循环。
        this._appSettingsCache = null;     // null 表示尚未读取过
        this._appSettingsDirty = false;
        this._appSettingsTimer = null;
        this._appSettingsDelay = 300;
    }

    /**
     * 保存画布内容
     */
    save(canvasDataURL) {
        try {
            localStorage.setItem(this.key, canvasDataURL);
            console.log('💾 画布已自动保存');
            return true;
        } catch (e) {
            console.error('保存失败:', e);
            return false;
        }
    }

    /**
     * 加载画布内容
     */
    load() {
        try {
            const saved = localStorage.getItem(this.key);
            if (saved) {
                console.log('✅ 加载已保存的画布');
                return saved;
            }
        } catch (e) {
            console.error('加载失败:', e);
        }
        return null;
    }

    /**
     * 保存调色盘预设
     */
    savePalettePreset(presetName) {
        try {
            localStorage.setItem(this.paletteKey, presetName);
            return true;
        } catch (e) {
            console.error('调色盘预设保存失败:', e);
            return false;
        }
    }

    /**
     * 加载调色盘预设
     */
    loadPalettePreset() {
        try {
            const savedPreset = localStorage.getItem(this.paletteKey);
            if (savedPreset) return savedPreset;
        } catch (e) {
            console.error('调色盘预设加载失败:', e);
        }
        return null;
    }

    /**
     * 保存笔刷设置（旧接口，内部合并到 appSettings）
     */
    saveBrushSettings(settings) {
        try {
            localStorage.setItem(this.brushKey, JSON.stringify(settings));
            return true;
        } catch (e) {
            console.error('笔刷设置保存失败:', e);
            return false;
        }
    }

    /**
     * 加载笔刷设置
     */
    loadBrushSettings() {
        try {
            const savedSettings = localStorage.getItem(this.brushKey);
            if (savedSettings) {
                console.log('✅ 加载已保存的笔刷设置');
                return JSON.parse(savedSettings);
            }
        } catch (e) {
            console.error('笔刷设置加载失败:', e);
        }
        return null;
    }

    /**
     * 保存应用全局设置（颜色、混合强度等）
     * settings: { foregroundColor, backgroundColor, brushMixStrength,
     *             smudgeBrushSize, smudgeStrength }
     *
     * 改为内存缓存 + debounce 写入：滑条/颜色连续触发时只有最后一次真正落盘。
     * 页面关闭前通过 flushAppSettings() 同步 flush；beforeunload 钩子已接好。
     */
    saveAppSettings(settings) {
        // 首次访问时把磁盘内容灌进缓存
        if (this._appSettingsCache === null) {
            this._appSettingsCache = this._readAppSettingsFromDisk() || {};
        }
        Object.assign(this._appSettingsCache, settings);
        this._appSettingsDirty = true;
        if (this._appSettingsTimer) clearTimeout(this._appSettingsTimer);
        this._appSettingsTimer = setTimeout(() => this.flushAppSettings(), this._appSettingsDelay);
        return true;
    }

    /**
     * 强制把缓存中的 appSettings 同步写入 localStorage。
     * beforeunload / 切引擎 / resize 等关键节点调用。
     */
    flushAppSettings() {
        if (this._appSettingsTimer) {
            clearTimeout(this._appSettingsTimer);
            this._appSettingsTimer = null;
        }
        if (!this._appSettingsDirty || !this._appSettingsCache) return;
        try {
            localStorage.setItem(this.settingsKey, JSON.stringify(this._appSettingsCache));
            this._appSettingsDirty = false;
        } catch (e) {
            console.error('应用设置保存失败:', e);
        }
    }

    /**
     * 加载应用全局设置。命中缓存时直接返回，避免重复 parse。
     */
    loadAppSettings() {
        if (this._appSettingsCache !== null) return this._appSettingsCache;
        const disk = this._readAppSettingsFromDisk();
        this._appSettingsCache = disk || {};
        return disk;
    }

    _readAppSettingsFromDisk() {
        try {
            const saved = localStorage.getItem(this.settingsKey);
            if (saved) return JSON.parse(saved);
        } catch (e) {
            console.error('应用设置加载失败:', e);
        }
        return null;
    }

    /**
     * 保存历史记录
     */
    saveHistory(historyData, historyStep) {
        try {
            const data = JSON.stringify({ history: historyData, step: historyStep });
            localStorage.setItem(this.historyKey, data);
            return true;
        } catch (e) {
            console.error('历史记录保存失败:', e);
            return false;
        }
    }

    /**
     * 加载历史记录
     */
    loadHistory() {
        try {
            const saved = localStorage.getItem(this.historyKey);
            if (saved) {
                const data = JSON.parse(saved);
                console.log('✅ 加载已保存的历史记录');
                return data;
            }
        } catch (e) {
            console.error('历史记录加载失败:', e);
        }
        return null;
    }

    /**
     * 自动保存（防抖）
     */
    autoSave(canvasDataURL, delay = 2000) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = setTimeout(() => {
            this.save(canvasDataURL);
        }, delay);
    }

    /**
     * 保存全部数据（画布、调色盘预设和笔刷设置）
     */
    saveAll(canvasDataURL, palettePreset, brushSettings) {
        this.save(canvasDataURL);
        this.savePalettePreset(palettePreset);
        if (brushSettings) {
            this.saveBrushSettings(brushSettings);
        }
    }

    /**
     * 自动保存全部数据（防抖）
     */
    autoSaveAll(canvasDataURL, palettePreset, brushSettings, delay = 2000) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = setTimeout(() => {
            this.saveAll(canvasDataURL, palettePreset, brushSettings);
        }, delay);
    }

    /**
     * 清除
     */
    clear() {
        localStorage.removeItem(this.key);
        console.log('🗑️ 画布已清除');
    }

    /**
     * 清除全部数据
     */
    clearAll() {
        localStorage.removeItem(this.key);
        localStorage.removeItem(this.paletteKey);
        localStorage.removeItem(this.brushKey);
        localStorage.removeItem(this.historyKey);
        localStorage.removeItem(this.settingsKey);
        console.log('🗑️ 所有数据已清除');
    }
}
