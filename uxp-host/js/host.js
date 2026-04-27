/**
 * UXP Host - Loading progress + color bridge
 */
const { action, core } = require("photoshop");
const shell = require("uxp").shell;

// ============ Global Variables ============
const HOST_VERSION = "1.2.0";
const SOURCES = [
  "http://localhost:5173/app.html",
  "https://mixbox-palette.pages.dev/",
  "https://food211.github.io/Mixbox-Palette/"
].map(url => url + '?host=' + HOST_VERSION);

let loadingContainer, progressBar, progressPercent, loadingText, errorMessage, retryBtn, webview;
let progressAnimation = null;
let loadTimeout = null;
let currentSourceIndex = 0;
let loaded = false;
let firstLoadStopped = false; // 竞速页 loadstop 后忽略后续 loaderror

const LOAD_TIMEOUT_MS = 5000; // 5s timeout

// Indeterminate progress animation
function startProgress() {
  loaded = false;
  progressBar.style.transition = 'none';
  progressBar.style.width = '0%';
  progressPercent.textContent = '';

  let pos = 0;
  let dir = 1;
  progressAnimation = setInterval(() => {
    pos += dir * 3;
    if (pos >= 80) dir = -1;
    if (pos <= 0) dir = 1;
    progressBar.style.width = (20 + pos * 0.5) + '%';
    progressBar.style.marginLeft = pos + '%';
  }, 30);

  // Timeout: try next source
  loadTimeout = setTimeout(() => {
    if (!loaded) {
      console.error(`⏰ Timeout: ${SOURCES[currentSourceIndex]}`);
      tryNextSource();
    }
  }, LOAD_TIMEOUT_MS);
}

function stopTimers() {
  if (progressAnimation) {
    clearInterval(progressAnimation);
    progressAnimation = null;
  }
  if (loadTimeout) {
    clearTimeout(loadTimeout);
    loadTimeout = null;
  }
}

function completeProgress() {
  if (loaded) return;
  loaded = true;
  stopTimers();

  progressBar.style.transition = 'width 0.3s ease';
  progressBar.style.marginLeft = '0';
  progressBar.style.width = '100%';
  progressPercent.textContent = '';

  setTimeout(() => {
    loadingContainer.classList.add('hidden');
    webview.classList.add('loaded');
  }, 300);
}

function showError(message) {
  stopTimers();

  loadingText.textContent = 'Load Failed';
  errorMessage.textContent = message || 'Please check your network connection';
  errorMessage.classList.add('show');
  retryBtn.classList.add('show');
  progressBar.style.marginLeft = '0';
  progressBar.style.width = '0%';
}

function loadSource(index) {
  currentSourceIndex = index;
  firstLoadStopped = false;
  errorMessage.classList.remove('show');
  retryBtn.classList.remove('show');
  loadingText.textContent = 'Loading Mixbox Palette...';
  startProgress();
  webview.src = SOURCES[index];
}

function tryNextSource() {
  const nextIndex = currentSourceIndex + 1;
  if (nextIndex < SOURCES.length) {
    console.log(`⏭️ Trying fallback: ${SOURCES[nextIndex]}`);
    loadSource(nextIndex);
  } else {
    showError("All sources failed. Please check your network connection.");
  }
}

function retry() {
  loadSource(0);
}


// ============ PS Color Event Listener ============
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hsbToRgb(h, s, b) {
  s /= 100; b /= 100;
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => b * (1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  return {
    red: Math.round(f(5) * 255),
    green: Math.round(f(3) * 255),
    blue: Math.round(f(1) * 255)
  };
}

// 插件主动设色时暂时屏蔽回写，避免死循环
let suppressPsEvent = false;

async function sendColorToWebView(target, colorObj) {
  if (suppressPsEvent) {
    console.log(`⏭️ sendColorToWebView suppressed (${target})`);
    return;
  }
  // PS 可能返回 HSB/Lab 等格式，统一转成 RGB
  let rgb = colorObj;
  if (colorObj._obj === "HSBColorClass") {
    rgb = hsbToRgb(colorObj.hue?._value ?? colorObj.hue, colorObj.saturation, colorObj.brightness);
  } else if (colorObj._obj !== "RGBColor") {
    console.warn("⚠️ Unknown color format:", colorObj._obj, "- attempting direct use");
  }
  const r = Math.round(rgb.red);
  const g = Math.round(rgb.grain ?? rgb.green);
  const b = Math.round(rgb.blue);
  const hex = rgbToHex(r, g, b);
  webview.postMessage({
    type: "psColorChanged",
    target,
    color: { r, g, b, hex }
  }, "*");
}

let colorEventsRegistered = false;

function toRgb(colorObj) {
  if (!colorObj) return null;
  let rgb = colorObj;
  if (colorObj._obj === "HSBColorClass") {
    rgb = hsbToRgb(colorObj.hue?._value ?? colorObj.hue, colorObj.saturation, colorObj.brightness);
  }
  const r = Math.round(rgb.red), g = Math.round(rgb.grain ?? rgb.green), b = Math.round(rgb.blue);
  return { r, g, b, hex: rgbToHex(r, g, b) };
}

async function fetchAndSendBothColors() {
  try {
    let fg, bg;
    await core.executeAsModal(async () => {
      const result = await action.batchPlay([
        { _obj: "get", _target: [{ _property: "foregroundColor" }, { _ref: "application", _enum: "ordinal", _value: "targetEnum" }] },
        { _obj: "get", _target: [{ _property: "backgroundColor" }, { _ref: "application", _enum: "ordinal", _value: "targetEnum" }] }
      ], {});
      fg = result[0]?.foregroundColor;
      bg = result[1]?.backgroundColor;
    }, { commandName: "Get PS Colors" });
    const msg = {
      type: "psInitColors",
      foreground: toRgb(fg),
      background: toRgb(bg)
    };
    webview.postMessage(msg, "*");
  } catch (e) {
    console.error("❌ fetchAndSendBothColors failed:", e.message || e);
  }
}

function listenPSColorEvents() {
  if (colorEventsRegistered) {
    console.log("⚠️ listenPSColorEvents already registered, skipping");
    return;
  }
  colorEventsRegistered = true;
  console.log("🎧 Registering PS color event listeners...");

  // "set" covers color picker / swatches changes
  // "exchange" covers pressing X to swap fg/bg
  // "reset" covers pressing D to reset to black/white
  action.addNotificationListener(["set", "exchange", "reset"], async (event, descriptor) => {
    console.log(`🔔 PS event: ${event}`, JSON.stringify(descriptor).slice(0, 200));
    try {
      // "set" 只在目标是颜色时处理，避免每次图层操作都触发
      if (event === "set") {
        const prop = descriptor?._target?.[0]?._property;
        console.log(`  set target prop: ${prop}`);
        if (prop !== "foregroundColor" && prop !== "backgroundColor") return;

        const colorData = descriptor?.to;
        if (!colorData) return;

        if (prop === "foregroundColor") {
          await sendColorToWebView("foreground", colorData);
        } else {
          await sendColorToWebView("background", colorData);
        }
      } else {
        // exchange / reset 时两色都变，延迟读取确保 PS 已完成颜色更新
        setTimeout(() => fetchAndSendBothColors(), 100);
      }
    } catch (e) {
      console.error(`❌ ${event} handler error:`, e.message || e);
    }
  });

  console.log("✅ PS color listeners registered");
}

// ============ Color Setting ============
async function setForegroundColor(r, g, b) {
  try {
    suppressPsEvent = true;
    await core.executeAsModal(async () => {
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "color", _property: "foregroundColor" }],
        to: { _obj: "RGBColor", red: r, green: g, blue: b }
      }], {});
    }, { commandName: "Set Foreground Color" });

  } catch (error) {
    console.error("Failed to set foreground color:", error);
  } finally {
    suppressPsEvent = false;
  }
}

async function setBackgroundColor(r, g, b) {
  try {
    suppressPsEvent = true;
    await core.executeAsModal(async () => {
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "color", _property: "backgroundColor" }],
        to: { _obj: "RGBColor", red: r, green: g, blue: b }
      }], {});
    }, { commandName: "Set Background Color" });

  } catch (error) {
    console.error("Failed to set background color:", error);
  } finally {
    suppressPsEvent = false;
  }
}

// ============ Paste Pixels Handler ============
async function handlePastePixels(data) {
  const app = require("photoshop").app;
  const { storage } = require("uxp");
  const fs = storage.localFileSystem;

  function sendResult(success, error) {
    webview.postMessage({ type: "pastePixelsResult", success, error }, "*");
  }

  try {
    const doc = app.activeDocument;
    if (!doc) {
      sendResult(false, "rectSelectNoDocument");
      return;
    }

    // 检查是否有活动选区
    let selBounds = null;
    await core.executeAsModal(async () => {
      try {
        const result = await action.batchPlay([{
          _obj: "get",
          _target: [
            { _property: "selection" },
            { _ref: "document", _enum: "ordinal", _value: "targetEnum" }
          ]
        }], {});
        const sel = result[0]?.selection;
        if (sel && sel.top !== undefined) {
          selBounds = {
            top: sel.top._value ?? sel.top,
            left: sel.left._value ?? sel.left,
            bottom: sel.bottom._value ?? sel.bottom,
            right: sel.right._value ?? sel.right
          };
        }
      } catch (err) {
        // 没有选区时 batchPlay 可能抛错
        console.log("No selection:", err.message);
      }
    }, { commandName: "Check Selection" });

    if (!selBounds) {
      sendResult(false, "rectSelectNoSelection");
      return;
    }

    const selWidth = selBounds.right - selBounds.left;
    const selHeight = selBounds.bottom - selBounds.top;
    if (selWidth < 1 || selHeight < 1) {
      sendResult(false, "rectSelectNoSelection");
      return;
    }

    // 解码 base64 PNG 并写入临时文件
    const base64Data = data.imageDataURL.replace(/^data:image\/png;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const tempFolder = await fs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("mixbox_paste.png", { overwrite: true });
    await tempFile.write(bytes.buffer);
    const token = await fs.createSessionToken(tempFile);

    await core.executeAsModal(async () => {
      // 在活动图层上方创建新图层
      await action.batchPlay([{
        _obj: "make",
        _target: [{ _ref: "layer" }]
      }], {});

      // 用 placeEvent 放置图片到新图层
      await action.batchPlay([{
        _obj: "placeEvent",
        null: { _path: token, _kind: "local" },
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" }
      }], {});

      // 获取放置图层的边界
      const placedLayer = doc.activeLayers[0];
      const lb = placedLayer.bounds;
      const imgWidth = lb.right - lb.left;
      const imgHeight = lb.bottom - lb.top;

      // 计算等比缩放适配选区
      const scale = Math.min(selWidth / imgWidth, selHeight / imgHeight);

      // 计算偏移：将图层中心移到选区中心
      const selCenterX = selBounds.left + selWidth / 2;
      const selCenterY = selBounds.top + selHeight / 2;
      const layerCenterX = (lb.left + lb.right) / 2;
      const layerCenterY = (lb.top + lb.bottom) / 2;
      const offsetX = selCenterX - layerCenterX;
      const offsetY = selCenterY - layerCenterY;

      console.log(`[paste] selBounds: ${JSON.stringify(selBounds)}, selSize: ${selWidth}x${selHeight}`);
      console.log(`[paste] imgBounds: L${lb.left} T${lb.top} R${lb.right} B${lb.bottom}, imgSize: ${imgWidth}x${imgHeight}`);
      console.log(`[paste] scale: ${scale}, offset: ${offsetX},${offsetY}`);

      // 第一步：移动到选区中心
      await action.batchPlay([{
        _obj: "move",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: offsetX },
          vertical: { _unit: "pixelsUnit", _value: offsetY }
        }
      }], {});

      // 第二步：以中心为锚点缩放
      await action.batchPlay([{
        _obj: "transform",
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        width: { _unit: "percentUnit", _value: scale * 100 },
        height: { _unit: "percentUnit", _value: scale * 100 },
        interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" }
      }], {});

      // 栅格化智能对象
      await action.batchPlay([{
        _obj: "rasterizeLayer",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
      }], {});

      // 向下合并到原活动图层
      await action.batchPlay([{
        _obj: "mergeLayersNew"
      }], {});

    }, { commandName: "Paste Pixels to Selection" });

    sendResult(true);
    console.log("✅ Pixels pasted to selection");

  } catch (err) {
    console.error("❌ handlePastePixels failed:", err.message || err);
    sendResult(false, "rectSelectFailed");
  }
}

// ============ Import Pixels Handler ============
async function handleImportPixels() {
  const app = require("photoshop").app;
  const imaging = require("photoshop").imaging;

  function sendResult(success, error, payload) {
    webview.postMessage({ type: "importPixelsResult", success, error, ...payload }, "*");
  }

  try {
    const doc = app.activeDocument;
    if (!doc) {
      sendResult(false, "importNoDocument", {});
      return;
    }

    let selBounds = null;
    await core.executeAsModal(async () => {
      try {
        const result = await action.batchPlay([{
          _obj: "get",
          _target: [
            { _property: "selection" },
            { _ref: "document", _enum: "ordinal", _value: "targetEnum" }
          ]
        }], {});
        const sel = result[0]?.selection;
        if (sel && sel.top !== undefined) {
          selBounds = {
            top: Math.round(sel.top._value ?? sel.top),
            left: Math.round(sel.left._value ?? sel.left),
            bottom: Math.round(sel.bottom._value ?? sel.bottom),
            right: Math.round(sel.right._value ?? sel.right)
          };
        }
      } catch (err) {
        console.log("No selection:", err.message);
      }
    }, { commandName: "Check Selection for Import" });

    if (!selBounds) {
      sendResult(false, "importNoSelection", {});
      return;
    }

    const width = selBounds.right - selBounds.left;
    const height = selBounds.bottom - selBounds.top;
    if (width < 1 || height < 1) {
      sendResult(false, "importNoSelection", {});
      return;
    }

    let rgbaBuffer = null;
    await core.executeAsModal(async () => {
      const result = await imaging.getPixels({
        documentID: doc.id,
        sourceBounds: { left: selBounds.left, top: selBounds.top, width, height },
        componentSize: 8,
        colorSpace: "RGB"
      });
      const pixelData = await result.imageData.getData();
      const components = result.imageData.components; // 通常是 3（RGB）或 4（RGBA）

      // 统一转成 RGBA Uint8ClampedArray
      const pixelCount = width * height;
      const rgba = new Uint8ClampedArray(pixelCount * 4);
      if (components === 4) {
        rgba.set(pixelData);
      } else {
        for (let i = 0; i < pixelCount; i++) {
          rgba[i * 4]     = pixelData[i * 3];
          rgba[i * 4 + 1] = pixelData[i * 3 + 1];
          rgba[i * 4 + 2] = pixelData[i * 3 + 2];
          rgba[i * 4 + 3] = 255;
        }
      }
      result.imageData.dispose();
      rgbaBuffer = rgba.buffer;
    }, { commandName: "Import Pixels from Selection" });

    // 分块 spread 比逐字节拼接快 3-5 倍，避免大 buffer 栈溢出
    const bytes = new Uint8Array(rgbaBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    webview.postMessage({
      type: "importPixelsResult",
      success: true,
      width,
      height,
      pixels: base64
    }, "*");

    console.log(`✅ Import pixels: ${width}x${height}`);

  } catch (err) {
    console.error("❌ handleImportPixels failed:", err.message || err);
    sendResult(false, "importFailed", {});
  }
}

// ============ Message Listener ============
window.addEventListener("message", async (e) => {
  console.log('[host] message received, origin:', e.origin, 'data:', JSON.stringify(e.data).slice(0, 200));
  if (!e.origin.includes("food211.github.io") && !e.origin.includes("mixbox-palette.pages.dev") && !e.origin.includes("localhost")) {
    console.log('[host] origin rejected');
    return;
  }

  const { type, target, color } = e.data || {};
  console.log('[host] message type:', type);

  if (type === "loaded") {
    console.log(`✅ Remote loaded | version: ${e.data.version || 'unknown'} | cache: ${e.data.cache || 'unknown'} | source: ${SOURCES[currentSourceIndex]}`);
    completeProgress();
    listenPSColorEvents();
    return;
  }

  if (type === "openURL" && e.data.url) {
    console.log('[host] openURL:', e.data.url);
    try {
      const result = await shell.openExternal(e.data.url, "Opening link from Mixbox Palette");
      console.log('[host] openExternal result:', result);
    } catch (err) {
      console.error('[host] openExternal failed:', err.message || err);
    }
    return;
  }

  if (type === "setColor" && color) {
    if (target === "foreground") {
      await setForegroundColor(color.r, color.g, color.b);
    } else if (target === "background") {
      await setBackgroundColor(color.r, color.g, color.b);
    }
  }

  if (type === "pastePixels") {
    await handlePastePixels(e.data);
  }

  if (type === "importPixels") {
    await handleImportPixels();
  }
});

// ============ Initialization ============
function init() {
  loadingContainer = document.getElementById('loadingContainer');
  progressBar = document.getElementById('progressBar');
  progressPercent = document.getElementById('progressPercent');
  loadingText = document.getElementById('loadingText');
  errorMessage = document.getElementById('errorMessage');
  retryBtn = document.getElementById('retryBtn');
  webview = document.getElementById('mixboxWebview');

  if (!webview) {
    console.error("❌ WebView element not found!");
    return;
  }

  console.log("✅ DOM ready");

  retryBtn.addEventListener('click', retry);

  webview.addEventListener("loadstart", () => {
    console.log("⏳ Loading:", webview.src);
  });

  webview.addEventListener("loadstop", () => {
    console.log(`✅ loadstop: ${webview.src}`);
    firstLoadStopped = true;
    // completeProgress 由 WebView 端 app.js 发送 "loaded" 消息触发
  });

  webview.addEventListener("loaderror", (e) => {
    if (firstLoadStopped) {
      console.log(`⏭️ loaderror ignored (page navigating): ${e.message || e.code}`);
      return;
    }
    console.error(`❌ Load error [${SOURCES[currentSourceIndex]}]:`, e.message || e.code);
    // localhost 连接失败立即切换，不等超时
    if (SOURCES[currentSourceIndex].includes('localhost')) stopTimers();
    tryNextSource();
  });

  webview.addEventListener("loadabort", () => {
    if (firstLoadStopped) {
      console.log(`⏭️ loadabort ignored (page navigating)`);
      return;
    }
    console.error(`⚠️ Load aborted: ${SOURCES[currentSourceIndex]}`);
    if (SOURCES[currentSourceIndex].includes('localhost')) stopTimers();
    tryNextSource();
  });

  loadSource(0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

console.log(`✅ UXP Host ready | host: ${HOST_VERSION} | sources: ${SOURCES[0]}`);
