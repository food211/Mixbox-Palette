// ============ WebView 通信 ============
// 远端要求的最低宿主版本（宿主版本低于此值时提示用户更新插件）
const MIN_HOST_VERSION = '1.0.4';

// 画布背景色（模拟水彩纸的暖白色，RGB 约 248/248/245）
const CANVAS_BG = { r: 1, g: 1, b: 1 };

// 自定义提示弹窗（替代 alert）
function showAlert(message) {
  const modal = document.getElementById('alertModal');
  const text = document.getElementById('alertModalText');
  const okBtn = document.getElementById('alertModalOkBtn');
  text.textContent = message;
  modal.classList.add('active');
  okBtn.onclick = () => modal.classList.remove('active');
}

// 检测是否在 UXP WebView 环境中
function isInWebView() {
  return typeof window.uxpHost !== 'undefined';
}

// 获取宿主版本号（从 URL 参数 ?host=x.x.x 读取）
function getHostVersion() {
  const params = new URLSearchParams(window.location.search);
  return params.get('host');
}

// 比较版本号，返回 -1/0/1
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

// 检查宿主版本兼容性，不兼容时显示提示并返回 false
function checkHostCompatibility() {
  if (!isInWebView()) return true; // 浏览器直接访问，无需检查
  const hostVer = getHostVersion();
  if (!hostVer) return true; // 无版本参数，跳过检查（兼容未传参的旧宿主）
  if (compareVersions(hostVer, MIN_HOST_VERSION) >= 0) return true;

  const lang = navigator.language || '';
  const isZH = lang.startsWith('zh');
  document.body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#2b2b2b;color:#e0e0e0;font-family:sans-serif;text-align:center;padding:20px">'
    + '<div style="font-size:48px;margin-bottom:20px">⚠️</div>'
    + '<h2>' + (isZH ? '插件版本过低' : 'Plugin Update Required') + '</h2>'
    + '<p style="color:#aaa;max-width:400px">' + (isZH
      ? '当前 Photoshop 插件版本 (v' + hostVer + ') 与远端不兼容，请在 Adobe Exchange 中更新到最新版本。'
      : 'Your Photoshop plugin (v' + hostVer + ') is incompatible with the current remote version. Please update via Adobe Exchange.')
    + '</p>'
    + '</div>';
  return false;
}

// 发送颜色到 Photoshop
function sendColorToPS(target, hexColor) {
  if (isInWebView()) {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);

    window.uxpHost.postMessage({
      type: "setColor",
      target: target,
      color: { r, g, b, hex: hexColor }
    });
  }
}
// 在外部浏览器中打开链接（兼容 UXP WebView 和普通浏览器）
function openExternalURL(url) {
  console.log('[openExternalURL] url:', url, 'isWebView:', isInWebView());
  if (isInWebView()) {
    console.log('[openExternalURL] posting message to uxpHost');
    window.uxpHost.postMessage({ type: "openURL", url });
  } else {
    window.open(url, '_blank');
  }
}
