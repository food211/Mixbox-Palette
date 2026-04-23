/**
 * history-worker.js
 *
 * 负责历史帧的无损压缩与解压：
 *   - compress:   Uint8ClampedArray → Blob (image/webp lossless)
 *   - decompress: Blob → Uint8ClampedArray
 *
 * 主线程消息格式：
 *   { type: 'compress',   id, pixels (ArrayBuffer), w, h, flipY? }
 *   { type: 'decompress', id, blob, w, h }
 *
 * 其中 flipY=true 表示 pixels 是 WebGL readPixels 的 raw 数据（原点在左下），
 * worker 内部会做 Y 翻转后再 putImageData，节省主线程 for-loop 开销。
 *
 * Worker 回复：
 *   { type: 'compressed',   id, blob }       // 压缩完成
 *   { type: 'decompressed', id, pixels }     // 解压完成（pixels 为 ArrayBuffer）
 *   { type: 'error',        id, reason }
 */

function flipYInPlace(src, w, h) {
    // src: Uint8ClampedArray (length = w*h*4)
    // 就地 Y 翻转；逐行 swap，复用一行的 tmp buffer。
    const rowSize = w * 4;
    const tmp = new Uint8ClampedArray(rowSize);
    const half = h >>> 1;
    for (let row = 0; row < half; row++) {
        const topOff = row * rowSize;
        const botOff = (h - 1 - row) * rowSize;
        tmp.set(src.subarray(topOff, topOff + rowSize));
        src.set(src.subarray(botOff, botOff + rowSize), topOff);
        src.set(tmp, botOff);
    }
    return src;
}

async function compress(pixels, w, h, flipY) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    let arr = new Uint8ClampedArray(pixels);
    if (flipY) arr = flipYInPlace(arr, w, h);
    const imageData = new ImageData(arr, w, h);
    ctx.putImageData(imageData, 0, 0);
    // WebP 无损：quality=1 且 type=webp。浏览器支持度高。
    return await canvas.convertToBlob({ type: 'image/webp', quality: 1 });
}

async function decompress(blob, w, h) {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const imageData = ctx.getImageData(0, 0, w, h);
    return imageData.data.buffer; // Transferable
}

self.onmessage = async (e) => {
    const { type, id } = e.data;
    try {
        if (type === 'compress') {
            const blob = await compress(e.data.pixels, e.data.w, e.data.h, !!e.data.flipY);
            self.postMessage({ type: 'compressed', id, blob });
        } else if (type === 'decompress') {
            const buf = await decompress(e.data.blob, e.data.w, e.data.h);
            self.postMessage({ type: 'decompressed', id, pixels: buf }, [buf]);
        }
    } catch (err) {
        self.postMessage({ type: 'error', id, reason: String(err) });
    }
};
