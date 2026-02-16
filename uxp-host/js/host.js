/**
 * UXP Host - Loading progress + color bridge
 */
const { action, core } = require("photoshop");

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

const LOAD_TIMEOUT_MS = 10000; // 10s timeout

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

// ============ Color Setting ============
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
    console.log(`✅ Foreground: rgb(${r}, ${g}, ${b})`);
  } catch (error) {
    console.error("Failed to set foreground color:", error);
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
    console.log(`✅ Background: rgb(${r}, ${g}, ${b})`);
  } catch (error) {
    console.error("Failed to set background color:", error);
  }
}

// ============ Message Listener ============
window.addEventListener("message", async (e) => {
  if (!e.origin.includes("food211.github.io") && !e.origin.includes("mixbox-palette.pages.dev")) {
    return;
  }

  const { type, target, color } = e.data || {};

  if (type === "loaded") {
    console.log(`✅ Loaded from: ${SOURCES[currentSourceIndex]}`);
    completeProgress();
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
    console.log(`✅ loadstop: ${SOURCES[currentSourceIndex]}`);
    completeProgress();
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
