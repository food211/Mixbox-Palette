/**
 * MixboxWebGLPainter — Mixbox 物理混色引擎
 * 继承 BaseWebGLPainter，只包含 Mixbox 专有部分：
 *  - 含 mixbox_lerp 的片段着色器
 *  - mixbox LUT 纹理加载
 *  - LUT 绑定到纹理槽 0
 */
class MixboxWebGLPainter extends BaseWebGLPainter {

    async init() {
        await super.init();
        console.log('✅ MixboxWebGLPainter 初始化完成');
    }

    // ─── 片段着色器 ───────────────────────────────

    _buildFragmentShader() {
        return `
        precision highp float;

        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;

        uniform sampler2D u_canvasTexture;
        uniform sampler2D u_brushTexture;
        uniform sampler2D mixbox_lut;
        uniform vec4 u_brushColor;
        uniform vec2 u_resolution;
        uniform vec2 u_currentPosition;
        uniform float u_brushRadius;
        uniform float u_baseMixStrength;
        uniform float u_useFalloff;
        uniform vec2 u_smearDir;
        uniform float u_smearLen;
        uniform float u_disableSmear;
        uniform float u_smudgeAlpha;
        uniform float u_isSmudge;
        uniform float u_smudgeSampleRadius;
        uniform float u_smudgeAngle;
        uniform float u_smudgeMix;
        uniform sampler2D u_smudgeHeatmap;
        uniform sampler2D u_wetHeatmap;
        uniform float u_isWatercolor;

        ${mixbox.glsl()}

        // 13点环形采样，从实时画布采样（搅动效果）
        // 颜色与白色的距离（0=纯白，1=最远离白色）
        float colorness(vec3 rgb) {
            return length(vec3(1.0) - rgb);
        }

        vec3 sampleSmudgeColor(vec2 center, float radius, float angle) {
            vec3 col = vec3(0.0);
            float totalW = 0.0;

            // 中心点，权重 0.4
            vec2 uv0 = center / u_resolution;
            uv0.y = 1.0 - uv0.y;
            vec3 s0 = texture2D(u_canvasTexture, uv0).rgb;
            float w0 = 0.4 * colorness(s0);
            col += s0 * w0; totalW += w0;

            // 内环 4点，半径 * 0.4，权重各 0.1
            float r1 = radius * 0.4;
            for (int i = 0; i < 4; i++) {
                float a = angle + float(i) * 1.5707963;
                vec2 offset = vec2(cos(a), -sin(a)) * r1;
                vec2 uv = (center + offset) / u_resolution;
                uv.y = 1.0 - uv.y;
                uv = clamp(uv, 0.0, 1.0);
                vec3 s = texture2D(u_canvasTexture, uv).rgb;
                float w = 0.1 * colorness(s);
                col += s * w; totalW += w;
            }

            // 外环 8点，半径 * 1.0，权重各 0.025
            for (int i = 0; i < 8; i++) {
                float a = angle + float(i) * 0.7853982;
                vec2 offset = vec2(cos(a), -sin(a)) * radius;
                vec2 uv = (center + offset) / u_resolution;
                uv.y = 1.0 - uv.y;
                uv = clamp(uv, 0.0, 1.0);
                vec3 s = texture2D(u_canvasTexture, uv).rgb;
                float w = 0.025 * colorness(s);
                col += s * w; totalW += w;
            }

            if (totalW < 0.001) return vec3(1.0); // 全是白色，返回白色
            return col / totalW;
        }

        void main() {
            // 喷溅笔刷在 GPU 旋转纹理，模拟搅动感；角度为 0 时跳过（其他笔刷不旋转）
            vec2 brushUV = v_texCoord;
            if (u_smudgeAngle != 0.0) {
                vec2 centered = brushUV - 0.5;
                float s = sin(u_smudgeAngle);
                float c = cos(u_smudgeAngle);
                brushUV = vec2(c * centered.x - s * centered.y,
                               s * centered.x + c * centered.y) + 0.5;
            }
            vec4 brushSample = texture2D(u_brushTexture, brushUV);
            float brushAlpha = u_useFalloff < 0.5
                ? step(0.5, brushSample.a)
                : brushSample.a;

            if (brushAlpha < 0.01) discard;

            vec2 canvasUV = v_canvasCoord / u_resolution;
            canvasUV.y = 1.0 - canvasUV.y;
            vec4 canvasColor = texture2D(u_canvasTexture, canvasUV);

            float distToCenter = length(v_canvasCoord - u_currentPosition);
            float radialFalloff = (u_useFalloff > 0.5 && u_useFalloff < 1.5)
                ? 1.0 - smoothstep(0.0, u_brushRadius, distToCenter)
                : 1.0;

            float aBrush = radialFalloff * brushAlpha;

            // 涂抹模式：从画布采样混色，替代 JS 传入的固定颜色
            vec3 activeColor = (u_isSmudge > 0.5)
                ? sampleSmudgeColor(v_canvasCoord, u_smudgeSampleRadius, u_smudgeAngle)
                : u_brushColor.rgb;

            // 涂抹模式下：热度图重映射混合强度，冷区=1%，热区=用户设定值
            float effectiveMixStrength = u_baseMixStrength;
            if (u_isSmudge > 0.5) {
                vec2 heatUV = v_canvasCoord / u_resolution;
                heatUV.y = 1.0 - heatUV.y;
                float heat = texture2D(u_smudgeHeatmap, heatUV).r;
                effectiveMixStrength = mix(0.01, u_baseMixStrength, heat);
            }

            // 水彩笔：读取湿纸热度，影响混色行为
            vec2 wetUV = v_canvasCoord / u_resolution;
            wetUV.y = 1.0 - wetUV.y;
            float wetness = (u_isWatercolor > 0.5) ? texture2D(u_wetHeatmap, wetUV).r : 0.0;

            if (u_isWatercolor > 0.5) {
                // 湿区抑制新颜料（越湿越难上色）
                effectiveMixStrength *= (1.0 - wetness * 0.85);

                // 湿区晕染：在湿度高的地方，采样位置向外偏移，颜色往外渗
                float bleedRadius = wetness * u_brushRadius * 0.3;
                vec2 bleedDir = normalize(v_canvasCoord - u_currentPosition + vec2(0.001));
                vec2 bleedUV = (v_canvasCoord + bleedDir * bleedRadius) / u_resolution;
                bleedUV.y = 1.0 - bleedUV.y;
                bleedUV = clamp(bleedUV, 0.0, 1.0);
                vec4 bleedSample = texture2D(u_canvasTexture, bleedUV);
                // 湿度高时，canvasColor 混入周围渗出的颜色
                canvasColor = mix(canvasColor, bleedSample, wetness * 0.4);
            }

            vec3 outRGB;
            if (u_disableSmear > 0.5) {
                outRGB = mixbox_lerp(canvasColor.rgb, activeColor, aBrush * effectiveMixStrength);
            } else {
                float density = effectiveMixStrength * effectiveMixStrength;

                float smearReach = clamp(u_smearLen, 1.0, u_brushRadius) * 0.8;
                vec2 smearUV = (v_canvasCoord - u_smearDir * smearReach) / u_resolution;
                smearUV.y = 1.0 - smearUV.y;
                smearUV = clamp(smearUV, 0.0, 1.0);
                vec4 smearSample = texture2D(u_canvasTexture, smearUV);

                vec3 safeCanvasRGB = (canvasColor.a > 0.1) ? canvasColor.rgb : activeColor;
                vec3 safeSmearRGB  = (smearSample.a > 0.1) ? smearSample.rgb : safeCanvasRGB;

                // 涂抹模式（u_smudgeMix > 0）：把后方颜色与当前颜色做物理混色，
                // u_smudgeMix 控制后方颜色参与比例，保留当前位置颜色感
                vec3 smearTarget;
                if (u_smudgeMix > 0.0) {
                    smearTarget = mixbox_lerp(safeCanvasRGB, safeSmearRGB, aBrush * u_smudgeMix);
                } else {
                    smearTarget = mixbox_lerp(safeCanvasRGB, safeSmearRGB, aBrush * 0.6);
                }

                if (density > 0.98) {
                    outRGB = mixbox_lerp(canvasColor.rgb, activeColor, aBrush * effectiveMixStrength);
                } else if (density < 0.01) {
                    outRGB = smearTarget;
                } else {
                    vec3 paintResult = mixbox_lerp(canvasColor.rgb, activeColor, aBrush * effectiveMixStrength);
                    outRGB = mixbox_lerp(smearTarget, paintResult, density);
                }
            }

            gl_FragColor = vec4(outRGB, 1.0);
        }
        `;
    }

    // ─── LUT ─────────────────────────────────────

    _getExtraUniformNames() {
        return ['mixbox_lut'];
    }

    async _loadLUT() {
        this.textures.lut = mixbox.lutTexture(this.gl);
    }

    _bindLUT() {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.lut);
        gl.uniform1i(this.locations.mixbox_lut, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.uniform1i(this.locations.u_canvasTexture, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
        gl.uniform1i(this.locations.u_brushTexture, 2);
    }
}

window.MixboxWebGLPainter = MixboxWebGLPainter;
console.log('MixboxWebGLPainter 加载成功');
