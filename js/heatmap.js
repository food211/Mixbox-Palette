/**
 * heatmap.js — 涂抹热度图系统
 *
 * 以 mixin 形式扩展 BaseWebGLPainter，包含：
 *  - 热度图 / 累积混色缓存的纹理与 FB 创建
 *  - 热度图更新 program（_initHeatmapProgram / updateSmudgeHeatmap）
 *  - 累积混色缓存 program（_initAccumProgram / updateSmudgeAccum）
 *  - 调试可视化（debugHeatmap / _flushDebugHeatmap）
 *
 * 依赖 BaseWebGLPainter 上已存在的：
 *  this.gl, this.canvas, this.textures, this.framebuffers, this.buffers
 *  this.createShader(), this.createProgram(), this.createEmptyTexture()
 *  this.currentBrushTexture, this.lastBrushCanvas
 */

// ─── 纹理 & FB 创建 ──────────────────────────────────────────────────────────

/**
 * 创建单通道 R8 纹理（WebGL1 用 RGBA，仅写入 R 通道）
 */
function _createR8Texture(width, height) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

/**
 * 在 setupTextures() 中追加热度图 & 累积混色纹理
 * 由 BaseWebGLPainter.setupTextures() 调用
 */
function setupHeatmapTextures(w, h) {
    this.textures.smudgeHeatmap   = this._createR8Texture(w, h);
    this.textures.smudgeHeatTemp  = this._createR8Texture(w, h);
    this.textures.smudgeAccum     = this.createEmptyTexture(w, h);
    this.textures.smudgeAccumTemp = this.createEmptyTexture(w, h);
}

/**
 * 在 setupFramebuffers() 中追加热度图 & 累积混色 FB
 * 由 BaseWebGLPainter.setupFramebuffers() 调用
 */
function setupHeatmapFramebuffers() {
    const gl = this.gl;

    this.framebuffers.smudgeHeatmap = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.smudgeHeatmap, 0);

    this.framebuffers.smudgeHeatTemp = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatTemp);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.smudgeHeatTemp, 0);

    this.framebuffers.smudgeAccum = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeAccum);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.smudgeAccum, 0);

    this.framebuffers.smudgeAccumTemp = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeAccumTemp);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.smudgeAccumTemp, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 热度图更新 program ───────────────────────────────────────────────────────

function _initHeatmapProgram() {
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        uniform vec2 u_resolution;
        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;
        void main() {
            vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
            gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
            v_texCoord = a_texCoord;
            v_canvasCoord = a_position;
        }
    `);
    const fs = this.createShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;
        uniform sampler2D u_brushTexture;
        uniform sampler2D u_heatmapTexture;
        uniform vec2 u_resolution;
        uniform vec2 u_currentPosition;
        uniform float u_brushRadius;
        uniform float u_useFalloff;
        uniform float u_heatStep;

        void main() {
            vec4 brushSample = texture2D(u_brushTexture, v_texCoord);
            float brushAlpha = u_useFalloff < 0.5
                ? step(0.5, brushSample.a)
                : brushSample.a;
            if (brushAlpha < 0.01) discard;

            float distToCenter = length(v_canvasCoord - u_currentPosition);
            float radialFalloff = (u_useFalloff > 0.5 && u_useFalloff < 1.5)
                ? 1.0 - smoothstep(0.0, u_brushRadius, distToCenter)
                : 1.0;

            float aBrush = radialFalloff * brushAlpha;

            vec2 uv = v_canvasCoord / u_resolution;
            uv.y = 1.0 - uv.y;
            float prevHeat = texture2D(u_heatmapTexture, uv).r;
            float newHeat = min(1.0, prevHeat + aBrush * u_heatStep);
            gl_FragColor = vec4(newHeat, 0.0, 0.0, 1.0);
        }
    `);

    this._heatmapProgram = this.createProgram(vs, fs);
    this._heatmapLocations = {
        a_position:        gl.getAttribLocation(this._heatmapProgram, 'a_position'),
        a_texCoord:        gl.getAttribLocation(this._heatmapProgram, 'a_texCoord'),
        u_resolution:      gl.getUniformLocation(this._heatmapProgram, 'u_resolution'),
        u_currentPosition: gl.getUniformLocation(this._heatmapProgram, 'u_currentPosition'),
        u_brushRadius:     gl.getUniformLocation(this._heatmapProgram, 'u_brushRadius'),
        u_useFalloff:      gl.getUniformLocation(this._heatmapProgram, 'u_useFalloff'),
        u_brushTexture:    gl.getUniformLocation(this._heatmapProgram, 'u_brushTexture'),
        u_heatmapTexture:  gl.getUniformLocation(this._heatmapProgram, 'u_heatmapTexture'),
        u_heatStep:        gl.getUniformLocation(this._heatmapProgram, 'u_heatStep'),
    };
}

/**
 * 在笔刷覆盖区域更新热度图（每次涂抹 drawcall 后调用）
 * heatStep：每步叠加量，约 0.05 → 约 20 次 drawcall 到顶（约 4 次完整覆盖）
 */
function updateSmudgeHeatmap(x, y, size, brushCanvas, useFalloff, heatStep = 0.05) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const halfSize = size / 2;

    // 把当前热度图拷贝到 temp 纹理，作为 shader 的上一帧输入
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatTemp);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (brushCanvas !== this.lastBrushCanvas) {
        if (this.currentBrushTexture) gl.deleteTexture(this.currentBrushTexture);
        this.currentBrushTexture = this.createBrushTextureFromCanvas(brushCanvas);
        this.lastBrushCanvas = brushCanvas;
    }

    gl.useProgram(this._heatmapProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
    gl.uniform1i(this._heatmapLocations.u_brushTexture, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatTemp);
    gl.uniform1i(this._heatmapLocations.u_heatmapTexture, 1);

    gl.uniform2f(this._heatmapLocations.u_resolution, cw, ch);
    gl.uniform2f(this._heatmapLocations.u_currentPosition, x, y);
    gl.uniform1f(this._heatmapLocations.u_brushRadius, size / 2);
    gl.uniform1f(this._heatmapLocations.u_useFalloff, +useFalloff);
    gl.uniform1f(this._heatmapLocations.u_heatStep, heatStep);

    const positions = new Float32Array([
        x - halfSize, y - halfSize,
        x + halfSize, y - halfSize,
        x - halfSize, y + halfSize,
        x + halfSize, y + halfSize,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this._heatmapLocations.a_position);
    gl.vertexAttribPointer(this._heatmapLocations.a_position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
    gl.enableVertexAttribArray(this._heatmapLocations.a_texCoord);
    gl.vertexAttribPointer(this._heatmapLocations.a_texCoord, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 累积混色缓存 program ─────────────────────────────────────────────────────

/**
 * 累积混色缓存 program：
 * 每次涂抹后，在笔刷覆盖区域把当前画布采样色按 1/(slotCount+1) 混入 accum。
 * slotCount 由热度图 heat * 4 近似（0~4档）。
 */
function _initAccumProgram() {
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        uniform vec2 u_resolution;
        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;
        void main() {
            vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
            gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
            v_texCoord = a_texCoord;
            v_canvasCoord = a_position;
        }
    `);

    const fs = this.createShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;
        uniform sampler2D u_brushTexture;
        uniform sampler2D u_accumTexture;
        uniform sampler2D u_snapshotTexture;
        uniform sampler2D u_heatmapTexture;
        uniform vec2 u_resolution;
        uniform vec2 u_currentPosition;
        uniform float u_brushRadius;
        uniform float u_useFalloff;

        float colorness(vec3 rgb) {
            return length(vec3(1.0) - rgb);
        }

        vec3 sampleCanvas(vec2 center, float radius) {
            vec3 col = vec3(0.0);
            float totalW = 0.0;

            vec2 uv0 = center / u_resolution;
            uv0.y = 1.0 - uv0.y;
            vec3 s0 = texture2D(u_snapshotTexture, uv0).rgb;
            float w0 = 0.4 * colorness(s0);
            col += s0 * w0; totalW += w0;

            float r1 = radius * 0.4;
            for (int i = 0; i < 4; i++) {
                float a = float(i) * 1.5707963;
                vec2 offset = vec2(cos(a), -sin(a)) * r1;
                vec2 uv = (center + offset) / u_resolution;
                uv.y = 1.0 - uv.y;
                uv = clamp(uv, 0.0, 1.0);
                vec3 s = texture2D(u_snapshotTexture, uv).rgb;
                float w = 0.1 * colorness(s);
                col += s * w; totalW += w;
            }

            for (int i = 0; i < 8; i++) {
                float a = float(i) * 0.7853982;
                vec2 offset = vec2(cos(a), -sin(a)) * radius;
                vec2 uv = (center + offset) / u_resolution;
                uv.y = 1.0 - uv.y;
                uv = clamp(uv, 0.0, 1.0);
                vec3 s = texture2D(u_snapshotTexture, uv).rgb;
                float w = 0.025 * colorness(s);
                col += s * w; totalW += w;
            }

            if (totalW < 0.001) return vec3(1.0);
            return col / totalW;
        }

        void main() {
            vec4 brushSample = texture2D(u_brushTexture, v_texCoord);
            float brushAlpha = u_useFalloff < 0.5
                ? step(0.5, brushSample.a)
                : brushSample.a;
            if (brushAlpha < 0.01) discard;

            float distToCenter = length(v_canvasCoord - u_currentPosition);
            float radialFalloff = (u_useFalloff > 0.5 && u_useFalloff < 1.5)
                ? 1.0 - smoothstep(0.0, u_brushRadius, distToCenter)
                : 1.0;
            float aBrush = radialFalloff * brushAlpha;

            vec2 uv = v_canvasCoord / u_resolution;
            uv.y = 1.0 - uv.y;

            vec3 prevAccum = texture2D(u_accumTexture, uv).rgb;
            float heat = texture2D(u_heatmapTexture, uv).r;

            // slotCount=0 时新色占50%，随热度升高新色比例递减
            float newColorWeight = 1.0 / (heat * 4.0 + 1.0);
            vec3 newColor = sampleCanvas(v_canvasCoord, u_brushRadius);
            vec3 newAccum = mix(prevAccum, newColor, newColorWeight * aBrush);

            gl_FragColor = vec4(newAccum, 1.0);
        }
    `);

    this._accumProgram = this.createProgram(vs, fs);
    this._accumLocations = {
        a_position:        gl.getAttribLocation(this._accumProgram, 'a_position'),
        a_texCoord:        gl.getAttribLocation(this._accumProgram, 'a_texCoord'),
        u_resolution:      gl.getUniformLocation(this._accumProgram, 'u_resolution'),
        u_currentPosition: gl.getUniformLocation(this._accumProgram, 'u_currentPosition'),
        u_brushRadius:     gl.getUniformLocation(this._accumProgram, 'u_brushRadius'),
        u_useFalloff:      gl.getUniformLocation(this._accumProgram, 'u_useFalloff'),
        u_brushTexture:    gl.getUniformLocation(this._accumProgram, 'u_brushTexture'),
        u_accumTexture:    gl.getUniformLocation(this._accumProgram, 'u_accumTexture'),
        u_snapshotTexture: gl.getUniformLocation(this._accumProgram, 'u_snapshotTexture'),
        u_heatmapTexture:  gl.getUniformLocation(this._accumProgram, 'u_heatmapTexture'),
    };
}

/**
 * 在笔刷覆盖区域更新累积混色缓存（每次涂抹 drawcall 后调用，在 updateSmudgeHeatmap 之后）
 */
function updateSmudgeAccum(x, y, size, brushCanvas, useFalloff) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const halfSize = size / 2;

    // 把当前 accum 拷贝到 temp 纹理，作为 shader 的上一帧输入
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeAccum);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeAccumTemp);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._accumProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeAccum);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
    gl.uniform1i(this._accumLocations.u_brushTexture, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeAccumTemp);
    gl.uniform1i(this._accumLocations.u_accumTexture, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeSnapshot);
    gl.uniform1i(this._accumLocations.u_snapshotTexture, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatmap);
    gl.uniform1i(this._accumLocations.u_heatmapTexture, 3);

    gl.uniform2f(this._accumLocations.u_resolution, cw, ch);
    gl.uniform2f(this._accumLocations.u_currentPosition, x, y);
    gl.uniform1f(this._accumLocations.u_brushRadius, size / 2);
    gl.uniform1f(this._accumLocations.u_useFalloff, +useFalloff);

    const positions = new Float32Array([
        x - halfSize, y - halfSize,
        x + halfSize, y - halfSize,
        x - halfSize, y + halfSize,
        x + halfSize, y + halfSize,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this._accumLocations.a_position);
    gl.vertexAttribPointer(this._accumLocations.a_position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
    gl.enableVertexAttribArray(this._accumLocations.a_texCoord);
    gl.vertexAttribPointer(this._accumLocations.a_texCoord, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 调试可视化 ───────────────────────────────────────────────────────────────

/**
 * 在 mixCanvas 上直接用主 WebGL context 渲染热度图叠加层（纯 GPU，零 readPixels）。
 * console 调用：
 *   window._painter.debugHeatmap(true)   → 开启
 *   window._painter.debugHeatmap(false)  → 关闭
 */
function debugHeatmap(enable = true) {
    if (!enable) {
        this._debugHeatmapEnabled = false;
        console.log('[debugHeatmap] 关闭');
        return;
    }

    if (!this._debugHeatProgram) {
        const gl = this.gl;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `
            attribute vec2 a_pos;
            varying vec2 v_uv;
            void main() {
                v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
                gl_Position = vec4(a_pos, 0.0, 1.0);
            }
        `);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, `
            precision mediump float;
            uniform sampler2D u_heatmap;
            uniform float u_opacity;
            varying vec2 v_uv;
            void main() {
                float heat = texture2D(u_heatmap, v_uv).r;
                if (heat < 0.01) discard;
                float alpha = pow(heat, 0.5) * 0.75 * u_opacity;
                gl_FragColor = vec4(1.0, 0.15, 0.0, alpha);
            }
        `);
        gl.compileShader(fs);

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        this._debugHeatProgram  = prog;
        this._debugHeatAPos     = gl.getAttribLocation(prog, 'a_pos');
        this._debugHeatUTex     = gl.getUniformLocation(prog, 'u_heatmap');
        this._debugHeatUOpacity = gl.getUniformLocation(prog, 'u_opacity');

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1,-1,  1,-1,  -1,1,  1,1
        ]), gl.STATIC_DRAW);
        this._debugHeatBuf = buf;
    }

    this._debugHeatmapEnabled = true;
    this._flushDebugHeatmap();
    console.log('[debugHeatmap] 开启 — 调用 window._painter.debugHeatmap(false) 关闭');
}

function _flushDebugHeatmap(opacity = 1.0) {
    if (!this._debugHeatmapEnabled || !this._debugHeatProgram) return;

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this._debugHeatProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatmap);
    gl.uniform1i(this._debugHeatUTex, 0);
    gl.uniform1f(this._debugHeatUOpacity, opacity);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._debugHeatBuf);
    gl.enableVertexAttribArray(this._debugHeatAPos);
    gl.vertexAttribPointer(this._debugHeatAPos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
}

/**
 * 笔触结束时调用：2秒内将热度图 overlay 线性淡出到不可见。
 * 如果期间开始了新笔触，captureSmudgeSnapshot 会调用 _resetHeatmapFade 打断淡出。
 */
function startHeatmapFadeOut() {
    if (!this._debugHeatmapEnabled) return;

    // 打断上一次未完成的淡出
    if (this._fadeRafId) {
        cancelAnimationFrame(this._fadeRafId);
        this._fadeRafId = null;
    }

    const FADE_MS = 2000;
    const startTime = performance.now();
    const painter = this;

    function tick(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / FADE_MS, 1.0);
        painter._debugHeatOpacity = 1.0 - t;

        // 重新 flush 一帧（blit canvas + overlay）
        painter.flush();

        if (t < 1.0) {
            painter._fadeRafId = requestAnimationFrame(tick);
        } else {
            painter._fadeRafId = null;
            painter._debugHeatOpacity = 1.0; // 下次笔触恢复满透明度
        }
    }

    this._fadeRafId = requestAnimationFrame(tick);
}

/**
 * 新笔触开始时调用，打断正在进行的淡出动画并恢复满透明度。
 */
function _resetHeatmapFade() {
    if (this._fadeRafId) {
        cancelAnimationFrame(this._fadeRafId);
        this._fadeRafId = null;
    }
    this._debugHeatOpacity = 1.0;
}

// ─── 挂载到 BaseWebGLPainter.prototype ───────────────────────────────────────

Object.assign(BaseWebGLPainter.prototype, {
    _createR8Texture,
    setupHeatmapTextures,
    setupHeatmapFramebuffers,
    _initHeatmapProgram,
    updateSmudgeHeatmap,
    _initAccumProgram,
    updateSmudgeAccum,
    debugHeatmap,
    _flushDebugHeatmap,
    startHeatmapFadeOut,
    _resetHeatmapFade,
});

console.log('heatmap.js 加载成功');
