/**
 * 画布持久化存储类
 * 负责保存和加载画布状态、调色盘预设、笔刷设置和历史记录
 */
class PaletteStorage {
    constructor(key = 'mixbox_canvas_v1', paletteKey = 'mixbox_palette_preset', brushKey = 'mixbox_brush_settings', historyKey = 'mixbox_history') {
        this.key = key;
        this.paletteKey = paletteKey;
        this.brushKey = brushKey;
        this.historyKey = historyKey;
        this.autoSaveTimer = null;
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
            console.log('💾 调色盘预设已保存:', presetName);
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
            if (savedPreset) {
                console.log('✅ 加载已保存的调色盘预设:', savedPreset);
                return savedPreset;
            }
        } catch (e) {
            console.error('调色盘预设加载失败:', e);
        }
        return null;
    }
    
    /**
     * 保存笔刷设置
     */
    saveBrushSettings(settings) {
        try {
            localStorage.setItem(this.brushKey, JSON.stringify(settings));
            console.log('💾 笔刷设置已保存');
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
     * 保存历史记录
     */
    saveHistory(historyData, historyStep) {
        try {
            const data = JSON.stringify({ history: historyData, step: historyStep });
            localStorage.setItem(this.historyKey, data);
            console.log('💾 历史记录已保存');
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
        console.log('🗑️ 画布、调色盘预设、笔刷设置和历史记录已清除');
    }
}