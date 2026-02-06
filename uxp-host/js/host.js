/**
 * UXP Host - 加载进度条 + 颜色传递
 */
const { action } = require("photoshop");

// ============ 进度条控制 ============
const loadingContainer = document.getElementById('loadingContainer');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const loadingText = document.getElementById('loadingText');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');
const webview = document.getElementById('mixboxWebview');

let progress = 0;
let progressInterval = null;

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

function retry() {
  errorMessage.classList.remove('show');
  retryBtn.classList.remove('show');
  loadingText.textContent = '正在加载 Mixbox Palette...';
  startProgress();
  webview.src = webview.src; // 重新加载
}

// 重试按钮
retryBtn.addEventListener('click', retry);

// ============ 颜色设置 ============
async function setForegroundColor(r, g, b) {
  try {
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
    console.log(`✅ 前景色: rgb(${r}, ${g}, ${b})`);
  } catch (error) {
    console.error("设置前景色失败:", error);
  }
}

async function setBackgroundColor(r, g, b) {
  try {
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
    console.log(`✅ 背景色: rgb(${r}, ${g}, ${b})`);
  } catch (error) {
    console.error("设置背景色失败:", error);
  }
}

// ============ 消息监听 ============
window.addEventListener("message", async (e) => {
  if (!e.origin.includes("brairou.github.io")) {
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

// ============ WebView 事件 ============
document.addEventListener("DOMContentLoaded", () => {
  startProgress();

  webview.addEventListener("loadstart", () => {
    console.log("⏳ WebView 开始加载...");
  });

  webview.addEventListener("loadstop", () => {
    console.log("✅ Mixbox Palette 已加载");
    completeProgress();
  });

  webview.addEventListener("loaderror", (e) => {
    console.error("❌ 加载失败:", e.message);
    showError(e.message);
  });
});

console.log("✅ UXP Host 就绪");