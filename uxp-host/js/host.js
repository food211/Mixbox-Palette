/**
 * UXP Host - Loading progress + color bridge
 */
const { action, core } = require("photoshop");
const shell = require("uxp").shell;

// ============ Global Variables ============
const SOURCES = [
  "https://mixbox-palette.pages.dev/",
  "https://food211.github.io/Mixbox-Palette/"
];

let loadingContainer, progressBar, progressPercent, loadingText, errorMessage, retryBtn, webview;
let progressAnimation = null;
let loadTimeout = null;
let currentSourceIndex = 0;
let loaded = false;

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

// ============ Message Listener ============
window.addEventListener("message", async (e) => {
  console.log('[host] message received, origin:', e.origin, 'data:', JSON.stringify(e.data).slice(0, 200));
  if (!e.origin.includes("food211.github.io") && !e.origin.includes("mixbox-palette.pages.dev")) {
    console.log('[host] origin rejected');
    return;
  }

  const { type, target, color } = e.data || {};
  console.log('[host] message type:', type);

  if (type === "loaded") {
    console.log(`✅ Loaded from: ${SOURCES[currentSourceIndex]}`);
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
    // completeProgress 由 WebView 端 app.js 发送 "loaded" 消息触发
  });

  webview.addEventListener("loaderror", (e) => {
    console.error(`❌ Load error [${SOURCES[currentSourceIndex]}]:`, e.message || e.code);
    tryNextSource();
  });

  webview.addEventListener("loadabort", () => {
    console.error(`⚠️ Load aborted: ${SOURCES[currentSourceIndex]}`);
    tryNextSource();
  });

  loadSource(0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

console.log("✅ UXP Host ready");
