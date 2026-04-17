/**
 * history-worker.js
 *
 * 负责历史帧的无损压缩与解压：
 *   - compress:   Uint8ClampedArray → Blob (image/webp lossless)
 *   - decompress: Blob → Uint8ClampedArray
 *
 * 主线程消息格式：
 *   { type: 'compress',   id, pixels (ArrayBuffer), w, h }
 *   { type: 'decompress', id, blob, w, h }
 *
 * Worker 回复：
 *   { type: 'compressed',   id, blob }       // 压缩完成
 *   { type: 'decompressed', id, pixels }     // 解压完成（pixels 为 ArrayBuffer）
 *   { type: 'error',        id, reason }
 */

async function compress(pixels, w, h) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(pixels), w, h);
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
            const blob = await compress(e.data.pixels, e.data.w, e.data.h);
            self.postMessage({ type: 'compressed', id, blob });
        } else if (type === 'decompress') {
            const buf = await decompress(e.data.blob, e.data.w, e.data.h);
            self.postMessage({ type: 'decompressed', id, pixels: buf }, [buf]);
        }
    } catch (err) {
        self.postMessage({ type: 'error', id, reason: String(err) });
    }
};
