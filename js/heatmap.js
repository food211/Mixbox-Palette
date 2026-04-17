/**
 * heatmap.js — 涂抹热度图系统
 *
 * 以 mixin 形式扩展 BaseWebGLPainter，包含：
 *  - 热度图纹理与 FB 创建
 *  - 热度图更新 program（_initHeatmapProgram / updateSmudgeHeatmap）
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
    this.textures.smudgeHeatmap  = this._createR8Texture(w, h);
    this.textures.smudgeHeatTemp = this._createR8Texture(w, h);
    // wetHeatmap 复用同一张纹理，不再单独分配
    this.textures.wetHeatmap  = this.textures.smudgeHeatmap;
    this.textures.wetHeatTemp = this.textures.smudgeHeatTemp;
    // 沉积热度图：松开时清空，不衰减，专门驱动咖啡圈效果
    this.textures.depositHeatmap  = this._createR8Texture(w, h);
    this.textures.depositHeatTemp = this._createR8Texture(w, h);
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

    // wetHeatmap FB 复用同一个
    this.framebuffers.wetHeatmap  = this.framebuffers.smudgeHeatmap;
    this.framebuffers.wetHeatTemp = this.framebuffers.smudgeHeatTemp;

    // 沉积热度图 FB
    this.framebuffers.depositHeatmap = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.depositHeatmap, 0);

    this.framebuffers.depositHeatTemp = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatTemp);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.depositHeatTemp, 0);

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
        uniform float u_heatMax;

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
            float newHeat = min(u_heatMax, prevHeat + aBrush * u_heatStep);
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
        u_heatMax:         gl.getUniformLocation(this._heatmapProgram, 'u_heatMax'),
    };
}

/**
 * 在笔刷覆盖区域更新热度图（每次涂抹 drawcall 后调用）
 * heatStep：每步叠加量，约 0.05 → 约 20 次 drawcall 到顶（约 4 次完整覆盖）
 */
function updateSmudgeHeatmap(x, y, size, brushCanvas, useFalloff, heatStep = HEAT_ACCUMULATE_STEP) {
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
    gl.uniform1f(this._heatmapLocations.u_heatMax,  this._wetHeatCap ?? WET_HEAT_CAP_STEP);

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


/**
 * 向沉积热度图注热（与 wetHeatmap 同步调用，不衰减，松开时清空）
 */
function updateDepositHeatmap(x, y, size, useFalloff, heatStep = DEPOSITE_HEAT_ACCUMULATE_STEP) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const halfSize = size / 2;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatTemp);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._heatmapProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
    gl.uniform1i(this._heatmapLocations.u_brushTexture, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatTemp);
    gl.uniform1i(this._heatmapLocations.u_heatmapTexture, 1);

    gl.uniform2f(this._heatmapLocations.u_resolution, cw, ch);
    gl.uniform2f(this._heatmapLocations.u_currentPosition, x, y);
    gl.uniform1f(this._heatmapLocations.u_brushRadius, size / 2);
    gl.uniform1f(this._heatmapLocations.u_useFalloff, +useFalloff);
    gl.uniform1f(this._heatmapLocations.u_heatStep, heatStep);
    gl.uniform1f(this._heatmapLocations.u_heatMax,  this._wetHeatCap ?? WET_HEAT_CAP_STEP);

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

/**
 * 清空沉积热度图（每笔松开时调用）
 */
function clearDepositHeatmap() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatTemp);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
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

            // 热成像色阶：蓝→青→绿→黄→红→白
            vec3 heatColor(float t) {
                vec3 c0 = vec3(0.0, 0.0, 1.0); // 蓝
                vec3 c1 = vec3(0.0, 1.0, 1.0); // 青
                vec3 c2 = vec3(0.0, 1.0, 0.0); // 绿
                vec3 c3 = vec3(1.0, 1.0, 0.0); // 黄
                vec3 c4 = vec3(1.0, 0.0, 0.0); // 红
                vec3 c5 = vec3(1.0, 1.0, 1.0); // 白

                if (t < 0.2) return mix(c0, c1, t / 0.2);
                if (t < 0.4) return mix(c1, c2, (t - 0.2) / 0.2);
                if (t < 0.6) return mix(c2, c3, (t - 0.4) / 0.2);
                if (t < 0.8) return mix(c3, c4, (t - 0.6) / 0.2);
                return mix(c4, c5, (t - 0.8) / 0.2);
            }

            void main() {
                float heat = texture2D(u_heatmap, v_uv).r;
                if (heat < 0.01) discard;
                float alpha = pow(heat, 0.5) * 0.75 * u_opacity;
                gl_FragColor = vec4(heatColor(heat), alpha);
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

    // 互斥：关闭湿纸 debug
    this._debugWetPaperEnabled = false;

    this._debugHeatmapEnabled = true;
    this._flushDebugHeatmap();
    console.log('[debugHeatmap] 开启 — 调用 window._painter.debugHeatmap(false) 关闭');
}

/**
 * 通用热成像 overlay 渲染，可传入任意热度图纹理。
 * 供 debugHeatmap 和 debugWetPaper 共用。
 */
function _flushHeatOverlay(texture, opacity = 1.0) {
    if (!this._debugHeatProgram) return;

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this._debugHeatProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this._debugHeatUTex, 0);
    gl.uniform1f(this._debugHeatUOpacity, opacity);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._debugHeatBuf);
    gl.enableVertexAttribArray(this._debugHeatAPos);
    gl.vertexAttribPointer(this._debugHeatAPos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
}

function _flushDebugHeatmap(opacity = 1.0) {
    if (!this._debugHeatmapEnabled) return;
    this._flushHeatOverlay(this.textures.smudgeHeatmap, opacity);
}

// ─── 热度衰减 program ─────────────────────────────────────────────────────────

/**
 * 初始化热度衰减 shader：每帧把热度图乘以衰减系数写回
 */
function _initHeatDecayProgram() {
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);
    const fs = this.createShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform sampler2D u_heatmap;
        uniform float u_step;
        varying vec2 v_uv;
        void main() {
            float heat = texture2D(u_heatmap, v_uv).r;
            gl_FragColor = vec4(max(heat - u_step, 0.0), 0.0, 0.0, 1.0);
        }
    `);

    const prog = this.createProgram(vs, fs);
    this._heatDecayProgram   = prog;
    this._heatDecayAPos      = gl.getAttribLocation(prog, 'a_pos');
    this._heatDecayUTex      = gl.getUniformLocation(prog, 'u_heatmap');
    this._heatDecayUStep     = gl.getUniformLocation(prog, 'u_step');

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,-1,  1,-1,  -1,1,  1,1
    ]), gl.STATIC_DRAW);
    this._heatDecayBuf = buf;
}

/**
 * 对热度图执行一次衰减 pass（写回 smudgeHeatmap）
 */
function _decayHeatmap(decay = 0.02) {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // 先拷贝当前热度图到 temp
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatTemp);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 用 decay shader 写回 smudgeHeatmap
    gl.useProgram(this._heatDecayProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatTemp);
    gl.uniform1i(this._heatDecayUTex, 0);
    gl.uniform1f(this._heatDecayUStep, decay);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._heatDecayBuf);
    gl.enableVertexAttribArray(this._heatDecayAPos);
    gl.vertexAttribPointer(this._heatDecayAPos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * 在 mixCanvas 上直接用主 WebGL context 渲染沉积热度图叠加层（纯 GPU，零 readPixels）。
 * console 调用：
 *   window._painter.debugDepositHeatmap(true)   → 开启
 *   window._painter.debugDepositHeatmap(false)  → 关闭
 */
function debugDepositHeatmap(enable = true) {
    if (!enable) {
        this._debugDepositHeatmapEnabled = false;
        console.log('[debugDepositHeatmap] 关闭');
        return;
    }

    // 复用已有的 debugHeatProgram
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

            // 热成像色阶：蓝→青→绿→黄→红→白
            vec3 heatColor(float t) {
                vec3 c0 = vec3(0.0, 0.0, 1.0); // 蓝
                vec3 c1 = vec3(0.0, 1.0, 1.0); // 青
                vec3 c2 = vec3(0.0, 1.0, 0.0); // 绿
                vec3 c3 = vec3(1.0, 1.0, 0.0); // 黄
                vec3 c4 = vec3(1.0, 0.0, 0.0); // 红
                vec3 c5 = vec3(1.0, 1.0, 1.0); // 白

                if (t < 0.2) return mix(c0, c1, t / 0.2);
                if (t < 0.4) return mix(c1, c2, (t - 0.2) / 0.2);
                if (t < 0.6) return mix(c2, c3, (t - 0.4) / 0.2);
                if (t < 0.8) return mix(c3, c4, (t - 0.6) / 0.2);
                return mix(c4, c5, (t - 0.8) / 0.2);
            }

            void main() {
                float heat = texture2D(u_heatmap, v_uv).r;
                if (heat < 0.01) discard;
                float alpha = pow(heat, 0.5) * 0.75 * u_opacity;
                gl_FragColor = vec4(heatColor(heat), alpha);
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

    // 互斥：关闭其他 debug 模式
    this._debugHeatmapEnabled = false;
    this._debugWetPaperEnabled = false;

    this._debugDepositHeatmapEnabled = true;
    this._flushDebugDepositHeatmap();
    console.log('[debugDepositHeatmap] 开启 — 调用 window._painter.debugDepositHeatmap(false) 关闭');
}

function _flushDebugDepositHeatmap(opacity = 1.0) {
    if (!this._debugDepositHeatmapEnabled) return;
    this._flushHeatOverlay(this.textures.depositHeatmap, opacity);
}

// ─── 常驻 RAF：热度衰减 + debug overlay ──────────────────────────────────────

/**
 * 启动常驻 RAF，每帧衰减热度图并刷新 overlay。
 * 落笔时调用（_resetHeatmapFade 打断后重新启动）。
 * 热度全部衰减到阈值以下时自动停止。
 */
/**
 * 控制是否允许向热度图写入新热度（updateSmudgeHeatmap）。
 * 衰减 RAF 始终运行，切换工具不会打断已有热度的自然消退。
 * 目前仅涂抹工具激活时为 true，未来可按需扩展到其他工具。
 */
function setHeatmapDecayActive(active) {
    this._heatmapDecayActive = !!active;
}

function startHeatmapFadeOut() {
    // RAF 已在运行则不重复启动
    if (this._fadeRafId) return;

    const painter = this;

    function tick() {
        // 热度衰减（始终运行，让已有热度自然消退）
        painter._decayHeatmap(HEAT_DECAY_STEP);

        // 水彩激活时：热度帧计数 > 0 才跑扩散和颜色 pass，避免全屏空跑
        if (painter._wetPaperActive && painter._wetHeatFrames > 0) {
            painter._wetHeatFrames--;

            painter._spreadWetHeatmap();

            // 仅绘制期间把湿度图渲染为颜色写入 canvas
            if (painter._wetIsDrawing && painter._wetColor) {
                painter._applyWetColor(painter._wetColor);
                painter.flush();
            }
        }

        // 任一 debug overlay 开启时刷新一次屏幕
        if (painter._debugHeatmapEnabled || painter._debugWetPaperEnabled || painter._debugDepositHeatmapEnabled) painter.flush();

        painter._fadeRafId = requestAnimationFrame(tick);
    }

    this._fadeRafId = requestAnimationFrame(tick);
}

/**
 * 新笔触开始时调用，打断衰减 RAF（涂抹期间不衰减，由 updateSmudgeHeatmap 叠加）。
 * 笔触结束后 endStroke 再调用 startHeatmapFadeOut 重启衰减。
 */
function _resetHeatmapFade() {
    // RAF 常驻运行，无需任何操作
}

/**
 * 停止衰减 RAF。切换引擎或销毁 painter 时调用，避免旧实例的 RAF 持续运行。
 */
function stopHeatmapFadeOut() {
    if (this._fadeRafId) {
        cancelAnimationFrame(this._fadeRafId);
        this._fadeRafId = null;
    }
}


// ─── 挂载到 BaseWebGLPainter.prototype ───────────────────────────────────────

Object.assign(BaseWebGLPainter.prototype, {
    _createR8Texture,
    setupHeatmapTextures,
    setupHeatmapFramebuffers,
    _initHeatmapProgram,
    _initHeatDecayProgram,
    updateSmudgeHeatmap,
    updateDepositHeatmap,
    clearDepositHeatmap,
    _decayHeatmap,
    debugHeatmap,
    debugDepositHeatmap,
    _flushHeatOverlay,
    _flushDebugHeatmap,
    _flushDebugDepositHeatmap,
    setHeatmapDecayActive,
    startHeatmapFadeOut,
    stopHeatmapFadeOut,
    _resetHeatmapFade,
});

console.log('heatmap.js 加载成功');
