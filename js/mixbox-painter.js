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

        ${mixbox.glsl()}

        void main() {
            vec4 brushSample = texture2D(u_brushTexture, v_texCoord);
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

            vec3 outRGB;
            if (u_disableSmear > 0.5) {
                float edgeWeight = clamp(aBrush * u_smudgeAlpha, 0.0, 1.0);
                vec3 mixedColor = mixbox_lerp(canvasColor.rgb, u_brushColor.rgb, u_smudgeAlpha * 0.5);
                outRGB = mix(canvasColor.rgb, mixedColor, edgeWeight);
            } else {
                float density = u_baseMixStrength * u_baseMixStrength;

                float smearReach = clamp(u_smearLen, 1.0, u_brushRadius) * 0.8;
                vec2 smearUV = (v_canvasCoord - u_smearDir * smearReach) / u_resolution;
                smearUV.y = 1.0 - smearUV.y;
                smearUV = clamp(smearUV, 0.0, 1.0);
                vec4 smearSample = texture2D(u_canvasTexture, smearUV);

                vec3 safeCanvasRGB = (canvasColor.a > 0.1) ? canvasColor.rgb : u_brushColor.rgb;
                vec3 safeSmearRGB  = (smearSample.a > 0.1) ? smearSample.rgb : safeCanvasRGB;

                vec3 smearTarget = mixbox_lerp(safeCanvasRGB, safeSmearRGB, aBrush * 0.6);

                if (density > 0.98) {
                    outRGB = mixbox_lerp(canvasColor.rgb, u_brushColor.rgb, aBrush * u_baseMixStrength);
                } else if (density < 0.01) {
                    outRGB = smearTarget;
                } else {
                    vec3 paintResult = mixbox_lerp(canvasColor.rgb, u_brushColor.rgb, aBrush * u_baseMixStrength);
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
