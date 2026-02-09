/**
 * UXP Host - 加载进度条 + 颜色传递
 */
const { action, core } = require("photoshop");

// ============ 全局变量 ============
let loadingContainer, progressBar, progressPercent, loadingText, errorMessage, retryBtn, webview;
let progress = 0;
let progressInterval = null;
let currentSourceIndex = 0;

// 模拟加载进度
function startProgress() {
  progress = 0;
  updateProgress(0);

  progressInterval = setInterval(() => {
    // 快速到 30%，然后慢慢增加到 90%
    if (progress < 30) {
      progress += 5;
    } else if (progress < 60) {
      progress += 2;
    } else if (progress < 90) {
      progress += 0.5;
    }
    updateProgress(progress);
  }, 100);
}

function updateProgress(value) {
  progressBar.style.width = value + '%';
  progressPercent.textContent = Math.round(value) + '%';
}

function completeProgress() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  // 快速完成到 100%
  progress = 100;
  updateProgress(100);

  // 延迟隐藏加载界面
  setTimeout(() => {
    loadingContainer.classList.add('hidden');
    webview.classList.add('loaded');
  }, 300);
}

function showError(message) {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  loadingText.textContent = '加载失败';
  errorMessage.textContent = message || '请检查网络连接';
  errorMessage.classList.add('show');
  retryBtn.classList.add('show');
}

function loadSource(index) {
  currentSourceIndex = index;
  errorMessage.classList.remove('show');
  retryBtn.classList.remove('show');
  loadingText.textContent = '正在加载 Mixbox Palette...';
  startProgress();
  webview.src = SOURCES[index];
}

function tryNextSource() {
  const nextIndex = currentSourceIndex + 1;
  if (nextIndex < SOURCES.length) {
    console.log(`⏭️ 尝试备用源: ${SOURCES[nextIndex]}`);
    loadSource(nextIndex);
  } else {
    showError("所有源均加载失败，请检查网络连接");
  }
}

function retry() {
  loadSource(0);
}

// ============ 颜色设置 ============
async function setForegroundColor(r, g, b) {
  try {
    await core.executeAsModal(async () => {
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "color", _property: "foregroundColor" }],
        to: {
          _obj: "RGBColor",
          red: r,
          green: g,
          blue: b
        }
      }], {});
    }, { commandName: "Set Foreground Color" });
    console.log(`✅ 前景色: rgb(${r}, ${g}, ${b})`);
  } catch (error) {
    console.error("设置前景色失败:", error);
  }
}

async function setBackgroundColor(r, g, b) {
  try {
    await core.executeAsModal(async () => {
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "color", _property: "backgroundColor" }],
        to: {
          _obj: "RGBColor",
          red: r,
          green: g,
          blue: b
        }
      }], {});
    }, { commandName: "Set Background Color" });
    console.log(`✅ 背景色: rgb(${r}, ${g}, ${b})`);
  } catch (error) {
    console.error("设置背景色失败:", error);
  }
}

// ============ 消息监听 ============
window.addEventListener("message", async (e) => {
  if (!e.origin.includes("food211.github.io") && !e.origin.includes("mixbox-palette.pages.dev")) {
    return;
  }

  const { type, target, color } = e.data || {};

  if (type === "setColor" && color) {
    if (target === "foreground") {
      await setForegroundColor(color.r, color.g, color.b);
    } else if (target === "background") {
      await setBackgroundColor(color.r, color.g, color.b);
    }
  }
});

// ============ 初始化 ============
function init() {
  // 获取 DOM 元素
  loadingContainer = document.getElementById('loadingContainer');
  progressBar = document.getElementById('progressBar');
  progressPercent = document.getElementById('progressPercent');
  loadingText = document.getElementById('loadingText');
  errorMessage = document.getElementById('errorMessage');
  retryBtn = document.getElementById('retryBtn');
  webview = document.getElementById('mixboxWebview');

  // 检查元素是否存在
  if (!webview) {
    console.error("❌ WebView 元素未找到！");
    return;
  }

  console.log("✅ DOM 元素已加载");

  // 绑定重试按钮
  retryBtn.addEventListener('click', retry);

  // 绑定 WebView 事件
  webview.addEventListener("loadstart", () => {
    console.log("⏳ WebView 开始加载...", webview.src);
  });

  webview.addEventListener("loadstop", () => {
    console.log("✅ Mixbox Palette 已加载");
    completeProgress();
  });

  webview.addEventListener("loaderror", (e) => {
    console.error(`❌ 源 ${SOURCES[currentSourceIndex]} 加载失败:`, e.message || e.code);
    tryNextSource();
  });

  webview.addEventListener("loadabort", () => {
    console.error(`⚠️ 源 ${SOURCES[currentSourceIndex]} 加载被中止`);
    tryNextSource();
  });

  // 加载第一个源
  loadSource(0);
}

// ============ WebView 事件 ============
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  // DOM 已经加载完成
  init();
}

console.log("✅ UXP Host 脚本就绪");