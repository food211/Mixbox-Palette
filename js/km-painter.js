/**
 * KM 混色引擎 (Kubelka-Munk Mixing Engine)
 * 使用 38波长光谱 Kubelka-Munk 物理公式进行颜料混色
 * RGB → 38波长反射率LUT查表 → KM混合 → RGB
 * WebGL1 兼容，使用单张合并LUT纹理（1024×320）
 *
 * Copyright (C) 2026 food211
 * License: GPL-3.0 (https://www.gnu.org/licenses/gpl-3.0.html)
 * Repository: https://github.com/food211/Mixbox-Palette
 *
 * The 38-wavelength spectral basis (BASE reflectance coefficients) and CMF weights
 * used in the LUT generator are derived from spectral.js by Ronald van Wijnen,
 * used under the MIT License.
 * https://github.com/rvanwijnen/spectral.js
 * Copyright (c) Ronald van Wijnen
 */
class KMWebGLPainter {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;

        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = canvas.width;
        this.offscreenCanvas.height = canvas.height;
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });

        this.program = null;
        this.textures = {};
        this.framebuffers = {};
        this.buffers = {};
        this.locations = {};
        this.currentBrushTexture = null;

        this.baseMixStrength = 0.2;
    }

    setMixStrength(strength) {
        this.baseMixStrength = Math.max(0.01, Math.min(1.0, strength));
    }

    getMixStrength() {
        return this.baseMixStrength;
    }

    async init() {
        this.initWebGL();
        this.compileShaders();
        await this.loadLUT();
        this.setupTextures();
        this.setupFramebuffers();
        this.setupGeometry();

        console.log('✅ KMWebGLPainter 初始化完成（38波长光谱KM，WebGL1，32³LUT）');
    }

    initWebGL() {
        this.webglCanvas = document.createElement('canvas');
        this.webglCanvas.width = this.canvas.width;
        this.webglCanvas.height = this.canvas.height;

        this.gl = this.webglCanvas.getContext('webgl', {
            alpha: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });

        if (!this.gl) {
            throw new Error('WebGL 不支持');
        }

        const gl = this.gl;
        gl.disable(gl.BLEND);
    }

    compileShaders() {
        const gl = this.gl;

        const vsSource = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;

        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;

        uniform vec2 u_resolution;

        void main() {
            vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
            gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
            v_texCoord = a_texCoord;
            v_canvasCoord = a_position;
        }
        `;

        // WebGL1 不支持数组索引变量，用宏展开10次采样
        const fsSource = `
        precision highp float;

        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;

        uniform sampler2D u_canvasTexture;
        uniform sampler2D u_brushTexture;
        uniform sampler2D u_lut;
        uniform vec4 u_brushColor;
        uniform vec2 u_resolution;
        uniform vec2 u_currentPosition;
        uniform float u_brushRadius;
        uniform float u_baseMixStrength;
        uniform float u_useFalloff;
        uniform vec2 u_smearDir;
        uniform float u_smearLen;

        // XYZ→RGB 矩阵（列优先）
        const mat3 XYZ_TO_RGB = mat3(
             3.2409699419045226, -0.9692436362808796,  0.05563007969699366,
            -1.537383177570094,   1.8759675015077202, -0.20397695888897652,
            -0.4986107602930034,  0.04155505740717559, 1.0569715142428786
        );

        // CMF 权重（38波长，每4个打包为vec4，共10组）
        const vec4 CMF_X_0 = vec4(0.0000646920,0.0002194099,0.0011205744,0.0037666134);
        const vec4 CMF_X_1 = vec4(0.0118805536,0.0232864424,0.0345594182,0.0372237901);
        const vec4 CMF_X_2 = vec4(0.0324183761,0.0212332056,0.0104909908,0.0032958376);
        const vec4 CMF_X_3 = vec4(0.0005070352,0.0009486742,0.0062737181,0.0168646242);
        const vec4 CMF_X_4 = vec4(0.0286896490,0.0426748125,0.0562547481,0.0694703973);
        const vec4 CMF_X_5 = vec4(0.0830531517,0.0861260963,0.0904661377,0.0850038651);
        const vec4 CMF_X_6 = vec4(0.0709066691,0.0506288916,0.0354739619,0.0214682103);
        const vec4 CMF_X_7 = vec4(0.0125164568,0.0068045816,0.0034645658,0.0014976098);
        const vec4 CMF_X_8 = vec4(0.0007697005,0.0004073681,0.0001690104,0.0000952245);
        const vec4 CMF_X_9 = vec4(0.0000490310,0.0000199961,0.0,0.0);

        const vec4 CMF_Y_0 = vec4(0.0000018443,0.0000062053,0.0000310096,0.0001047484);
        const vec4 CMF_Y_1 = vec4(0.0003536405,0.0009514714,0.0022822632,0.0042073290);
        const vec4 CMF_Y_2 = vec4(0.0066887984,0.0098883960,0.0152494514,0.0214183109);
        const vec4 CMF_Y_3 = vec4(0.0334229302,0.0513100135,0.0704020839,0.0878387073);
        const vec4 CMF_Y_4 = vec4(0.0942490536,0.0979566703,0.0941521857,0.0867810237);
        const vec4 CMF_Y_5 = vec4(0.0788565339,0.0635267026,0.0537414168,0.0426460644);
        const vec4 CMF_Y_6 = vec4(0.0316173493,0.0208852059,0.0138601101,0.0081026402);
        const vec4 CMF_Y_7 = vec4(0.0046301023,0.0024913800,0.0012593034,0.0005416465);
        const vec4 CMF_Y_8 = vec4(0.0002779529,0.0001471081,0.0000610327,0.0000343873);
        const vec4 CMF_Y_9 = vec4(0.0000177060,0.0000072210,0.0,0.0);

        const vec4 CMF_Z_0 = vec4(0.0003050171,0.0010368067,0.0053131363,0.0179543926);
        const vec4 CMF_Z_1 = vec4(0.0570775815,0.1136516189,0.1733587262,0.1962065756);
        const vec4 CMF_Z_2 = vec4(0.1860823707,0.1399504754,0.0891745294,0.0478962114);
        const vec4 CMF_Z_3 = vec4(0.0281456254,0.0161376623,0.0077591019,0.0042961484);
        const vec4 CMF_Z_4 = vec4(0.0020055092,0.0008614711,0.0003690387,0.0001914287);
        const vec4 CMF_Z_5 = vec4(0.0001495556,0.0000923109,0.0000681349,0.0000288264);
        const vec4 CMF_Z_6 = vec4(0.0000157672,0.0000039406,0.0000015840,0.0);
        const vec4 CMF_Z_7 = vec4(0.0,0.0,0.0,0.0);
        const vec4 CMF_Z_8 = vec4(0.0,0.0,0.0,0.0);
        const vec4 CMF_Z_9 = vec4(0.0,0.0,0.0,0.0);

        float compand(float x) {
            x = max(0.0, x);
            return x > 0.0031308 ? 1.055 * pow(x, 1.0/2.4) - 0.055 : x * 12.92;
        }

        // LUT采样：RGB → 10个vec4（38波长反射率）
        // 纹理布局: x = gi*32+ri, y = band*32+bi，共1024×320
        // LUT存储sqrt(R)以提高暗色精度，采样后平方还原
        // r/b轴在各自段内连续，LINEAR自动插值；g轴跨段手动插值
        void sampleLUT(vec3 c,
            out vec4 R0, out vec4 R1, out vec4 R2, out vec4 R3, out vec4 R4,
            out vec4 R5, out vec4 R6, out vec4 R7, out vec4 R8, out vec4 R9)
        {
            vec3 f = clamp(c, 0.0, 1.0) * 31.0;
            float g0 = floor(f.g); float g1 = min(g0+1.0, 31.0); float gf = f.g - g0;
            float u0 = (g0 * 32.0 + f.r + 0.5) / 1024.0;
            float u1 = (g1 * 32.0 + f.r + 0.5) / 1024.0;

            // 在sqrt域采样并插值，然后平方还原反射率
            #define SAMPLE_BAND(band) mix( \
                texture2D(u_lut, vec2(u0, (float(band)*32.0 + f.b + 0.5) / 320.0)), \
                texture2D(u_lut, vec2(u1, (float(band)*32.0 + f.b + 0.5) / 320.0)), \
                gf)

            R0 = SAMPLE_BAND(0); R0 *= R0;
            R1 = SAMPLE_BAND(1); R1 *= R1;
            R2 = SAMPLE_BAND(2); R2 *= R2;
            R3 = SAMPLE_BAND(3); R3 *= R3;
            R4 = SAMPLE_BAND(4); R4 *= R4;
            R5 = SAMPLE_BAND(5); R5 *= R5;
            R6 = SAMPLE_BAND(6); R6 *= R6;
            R7 = SAMPLE_BAND(7); R7 *= R7;
            R8 = SAMPLE_BAND(8); R8 *= R8;
            R9 = SAMPLE_BAND(9); R9 *= R9;
            #undef SAMPLE_BAND
        }

        // 38波长反射率 → XYZ → RGB
        vec3 reflectanceToRGB(
            vec4 R0, vec4 R1, vec4 R2, vec4 R3, vec4 R4,
            vec4 R5, vec4 R6, vec4 R7, vec4 R8, vec4 R9)
        {
            float X = dot(CMF_X_0,R0)+dot(CMF_X_1,R1)+dot(CMF_X_2,R2)+dot(CMF_X_3,R3)+dot(CMF_X_4,R4)
                     +dot(CMF_X_5,R5)+dot(CMF_X_6,R6)+dot(CMF_X_7,R7)+dot(CMF_X_8,R8)+dot(CMF_X_9,R9);
            float Y = dot(CMF_Y_0,R0)+dot(CMF_Y_1,R1)+dot(CMF_Y_2,R2)+dot(CMF_Y_3,R3)+dot(CMF_Y_4,R4)
                     +dot(CMF_Y_5,R5)+dot(CMF_Y_6,R6)+dot(CMF_Y_7,R7)+dot(CMF_Y_8,R8)+dot(CMF_Y_9,R9);
            float Z = dot(CMF_Z_0,R0)+dot(CMF_Z_1,R1)+dot(CMF_Z_2,R2)+dot(CMF_Z_3,R3)+dot(CMF_Z_4,R4)
                     +dot(CMF_Z_5,R5)+dot(CMF_Z_6,R6)+dot(CMF_Z_7,R7)+dot(CMF_Z_8,R8)+dot(CMF_Z_9,R9);
            vec3 lin = XYZ_TO_RGB * vec3(X, Y, Z);
            return vec3(compand(lin.r), compand(lin.g), compand(lin.b));
        }

        float luminance(
            vec4 R0, vec4 R1, vec4 R2, vec4 R3, vec4 R4,
            vec4 R5, vec4 R6, vec4 R7, vec4 R8, vec4 R9)
        {
            float Y = dot(CMF_Y_0,R0)+dot(CMF_Y_1,R1)+dot(CMF_Y_2,R2)+dot(CMF_Y_3,R3)+dot(CMF_Y_4,R4)
                     +dot(CMF_Y_5,R5)+dot(CMF_Y_6,R6)+dot(CMF_Y_7,R7)+dot(CMF_Y_8,R8)+dot(CMF_Y_9,R9);
            return max(Y, 1e-7);
        }

        // KM混色（内联展开，避免WebGL1 loop限制）
        vec4 km_band(vec4 r1, vec4 r2, float conc1, float conc2, float totalConc) {
            vec4 rc1 = clamp(r1, 0.01, 1.0);
            vec4 rc2 = clamp(r2, 0.01, 1.0);
            vec4 ks1 = (1.0 - rc1) * (1.0 - rc1) / (2.0 * rc1);
            vec4 ks2 = (1.0 - rc2) * (1.0 - rc2) / (2.0 * rc2);
            vec4 km = (ks1 * conc1 + ks2 * conc2) / totalConc;
            return 1.0 + km - sqrt(max(vec4(0.0), km * km + 2.0 * km));
        }

        vec3 km_mix(vec3 c1, vec3 c2, float t) {
            vec4 A0,A1,A2,A3,A4,A5,A6,A7,A8,A9;
            vec4 B0,B1,B2,B3,B4,B5,B6,B7,B8,B9;
            sampleLUT(c1, A0,A1,A2,A3,A4,A5,A6,A7,A8,A9);
            sampleLUT(c2, B0,B1,B2,B3,B4,B5,B6,B7,B8,B9);

            // 用 t 直接控制颜料浓度比，使深浅方向都对称
            float conc1 = 1.0 - t;
            float conc2 = t;
            float totalConc = 1.0;

            vec3 result = reflectanceToRGB(
                km_band(A0,B0,conc1,conc2,totalConc),
                km_band(A1,B1,conc1,conc2,totalConc),
                km_band(A2,B2,conc1,conc2,totalConc),
                km_band(A3,B3,conc1,conc2,totalConc),
                km_band(A4,B4,conc1,conc2,totalConc),
                km_band(A5,B5,conc1,conc2,totalConc),
                km_band(A6,B6,conc1,conc2,totalConc),
                km_band(A7,B7,conc1,conc2,totalConc),
                km_band(A8,B8,conc1,conc2,totalConc),
                km_band(A9,B9,conc1,conc2,totalConc)
            );

            // 提亮补偿：仅修正KM算法本身的变暗偏差，不随笔刷衰减变化
            vec3 linearMix = mix(c1, c2, t);
            const vec3 LUM_COEFF = vec3(0.2126, 0.7152, 0.0722);
            float linearLum = dot(linearMix, LUM_COEFF);
            float resultLum = dot(result, LUM_COEFF);
            float brightnessCorrectionFactor = 0.4 + linearLum * 0.5;
            float loss = max(0.0, linearLum - resultLum);
            float compensationStrength = loss / max(linearLum, 0.001) * brightnessCorrectionFactor;
            result *= 1.0 + compensationStrength;

            return clamp(result, 0.0, 1.0);
        }

        void main() {
            vec4 brushSample = texture2D(u_brushTexture, v_texCoord);
            // 硬边笔刷（useFalloff=0）：二值化 alpha，消除抗锯齿半透明噪声
            // 软边笔刷（useFalloff=1）：保留渐变 alpha + radialFalloff
            // 喷溅笔刷（useFalloff=2）：保留渐变 alpha（抗锯齿），无 radialFalloff
            float brushAlpha = u_useFalloff < 0.5
                ? step(0.5, brushSample.a)
                : brushSample.a;

            if (brushAlpha < 0.01) {
                discard;
            }

            vec2 canvasUV = v_canvasCoord / u_resolution;
            canvasUV.y = 1.0 - canvasUV.y;
            vec4 canvasColor = texture2D(u_canvasTexture, canvasUV);

            float distToCenter = length(v_canvasCoord - u_currentPosition);
            float radialFalloff = (u_useFalloff > 0.5 && u_useFalloff < 1.5)
                ? 1.0 - smoothstep(0.0, u_brushRadius, distToCenter)
                : 1.0;

            float aBrush = radialFalloff * brushAlpha;
            float density = u_baseMixStrength * u_baseMixStrength;

            // 采样上游颜色（笔划来的方向）
            float smearReach = clamp(u_smearLen, 1.0, u_brushRadius) * 0.8;
            vec2 smearUV = (v_canvasCoord - u_smearDir * smearReach) / u_resolution;
            smearUV.y = 1.0 - smearUV.y;
            smearUV = clamp(smearUV, 0.0, 1.0);
            vec4 smearSample = texture2D(u_canvasTexture, smearUV);

            vec3 safeCanvasRGB = (canvasColor.a > 0.1) ? canvasColor.rgb : u_brushColor.rgb;
            vec3 safeSmearRGB  = (smearSample.a > 0.1) ? smearSample.rgb : safeCanvasRGB;

            vec3 smearTarget = km_mix(safeCanvasRGB, safeSmearRGB, aBrush * 0.6);

            vec3 finalColor;
            if (density > 0.98) {
                // 高浓度：纯上色
                float edgeWeight = clamp(aBrush * u_baseMixStrength, 0.0, 1.0);
                vec3 mixedColor = km_mix(canvasColor.rgb, u_brushColor.rgb, clamp(u_baseMixStrength, 0.0, 1.0));
                finalColor = mix(canvasColor.rgb, mixedColor, edgeWeight / max(u_baseMixStrength, 0.001));
            } else if (density < 0.01) {
                // 极低浓度：纯涂抹
                finalColor = smearTarget;
            } else {
                // 中间值：上色和涂抹按 density 过渡
                float edgeWeight = clamp(aBrush * u_baseMixStrength, 0.0, 1.0);
                vec3 mixedColor = km_mix(canvasColor.rgb, u_brushColor.rgb, clamp(u_baseMixStrength, 0.0, 1.0));
                vec3 paintResult = mix(canvasColor.rgb, mixedColor, edgeWeight / max(u_baseMixStrength, 0.001));
                finalColor = mix(smearTarget, paintResult, density);
            }

            gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
        }
        `;

        const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
        this.program = this.createProgram(vs, fs);

        this.locations = {
            a_position:        gl.getAttribLocation(this.program, 'a_position'),
            a_texCoord:        gl.getAttribLocation(this.program, 'a_texCoord'),
            u_resolution:      gl.getUniformLocation(this.program, 'u_resolution'),
            u_canvasTexture:   gl.getUniformLocation(this.program, 'u_canvasTexture'),
            u_brushTexture:    gl.getUniformLocation(this.program, 'u_brushTexture'),
            u_lut:             gl.getUniformLocation(this.program, 'u_lut'),
            u_brushColor:      gl.getUniformLocation(this.program, 'u_brushColor'),
            u_currentPosition: gl.getUniformLocation(this.program, 'u_currentPosition'),
            u_brushRadius:     gl.getUniformLocation(this.program, 'u_brushRadius'),
            u_baseMixStrength: gl.getUniformLocation(this.program, 'u_baseMixStrength'),
            u_useFalloff:      gl.getUniformLocation(this.program, 'u_useFalloff'),
            u_smearDir:        gl.getUniformLocation(this.program, 'u_smearDir'),
            u_smearLen:        gl.getUniformLocation(this.program, 'u_smearLen'),
        };
    }

    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('着色器编译错误:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(vs, fs) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('程序链接错误:', gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    // 纯JS PNG解码器：绕开 <img> 颜色管理，直接读取原始字节
    // 支持 RGBA8 deflate PNG，不依赖任何外部库
    _decodePNG(u8) {
        // 工具函数
        const u32 = (b, o) => ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0;

        // 收集所有 IDAT 数据
        let width = 0, height = 0;
        const idatChunks = [];
        let pos = 8; // 跳过PNG签名
        while (pos < u8.length) {
            const len = u32(u8, pos);
            const type = String.fromCharCode(u8[pos+4],u8[pos+5],u8[pos+6],u8[pos+7]);
            const data = u8.subarray(pos+8, pos+8+len);
            if (type === 'IHDR') {
                width  = u32(data, 0);
                height = u32(data, 4);
            } else if (type === 'IDAT') {
                idatChunks.push(data);
            } else if (type === 'IEND') {
                break;
            }
            pos += 12 + len;
        }

        // 合并 IDAT
        let totalLen = idatChunks.reduce((s, c) => s + c.length, 0);
        const zlibData = new Uint8Array(totalLen);
        let off = 0;
        for (const c of idatChunks) { zlibData.set(c, off); off += c.length; }

        // zlib inflate（存储模式 / deflate）— 手写inflate解析
        const raw = this._inflate(zlibData, width, height);

        // PNG filter 还原 → 输出 RGBA 像素
        const rowBytes = width * 4;
        const pixels = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            const filterType = raw[y * (rowBytes + 1)];
            const src = y * (rowBytes + 1) + 1;
            const dst = y * rowBytes;
            const prev = y > 0 ? pixels.subarray((y-1)*rowBytes, y*rowBytes) : null;
            for (let x = 0; x < rowBytes; x++) {
                const a = x >= 4 ? pixels[dst + x - 4] : 0;
                const b = prev ? prev[x] : 0;
                const c = (prev && x >= 4) ? prev[x - 4] : 0;
                let val = raw[src + x];
                if      (filterType === 1) val = (val + a) & 0xff;
                else if (filterType === 2) val = (val + b) & 0xff;
                else if (filterType === 3) val = (val + ((a + b) >> 1)) & 0xff;
                else if (filterType === 4) {
                    const p = a + b - c;
                    const pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
                    val = (val + (pa<=pb && pa<=pc ? a : pb<=pc ? b : c)) & 0xff;
                }
                pixels[dst + x] = val;
            }
        }
        return { width, height, pixels };
    }

    // zlib/deflate inflate，支持存储块和固定/动态霍夫曼
    _inflate(zlib, width, height) {
        // 跳过zlib头(2字节)，忽略尾部adler32(4字节)
        const deflate = zlib.subarray(2, zlib.length - 4);
        const rowBytes = width * 4;
        const out = new Uint8Array(height * (rowBytes + 1));
        let inPos = 0, outPos = 0;

        // 位读取器
        let bitBuf = 0, bitLen = 0;
        const readBits = (n) => {
            while (bitLen < n) { bitBuf |= deflate[inPos++] << bitLen; bitLen += 8; }
            const val = bitBuf & ((1<<n)-1); bitBuf >>= n; bitLen -= n; return val;
        };

        // 固定霍夫曼码长
        const fixedLitLen = new Array(288);
        for (let i=0;i<144;i++) fixedLitLen[i]=8;
        for (let i=144;i<256;i++) fixedLitLen[i]=9;
        for (let i=256;i<280;i++) fixedLitLen[i]=7;
        for (let i=280;i<288;i++) fixedLitLen[i]=8;
        const fixedDist = new Array(32).fill(5);

        // 改用正确的霍夫曼读取（带码长的table）
        const buildTree2 = (lens) => {
            const maxLen = lens.reduce((a,b)=>Math.max(a,b),0);
            if (maxLen === 0) return { sym: new Int32Array(0), len: new Int32Array(0), maxLen: 0 };
            const counts = new Int32Array(maxLen+1);
            for (const l of lens) if (l) counts[l]++;
            const nextCode = new Int32Array(maxLen+1);
            for (let i = 1; i < maxLen; i++) nextCode[i+1] = (nextCode[i]+counts[i])<<1;
            const size = 1<<maxLen;
            const symTable = new Int32Array(size).fill(-1);
            const lenTable = new Int32Array(size);
            for (let s = 0; s < lens.length; s++) {
                const l = lens[s]; if (!l) continue;
                let code = nextCode[l]++;
                let rev = 0;
                for (let i = 0; i < l; i++) { rev=(rev<<1)|(code&1); code>>=1; }
                for (let i = rev; i < size; i += (1<<l)) { symTable[i]=s; lenTable[i]=l; }
            }
            return { symTable, lenTable, maxLen };
        };
        const peekRead = (tree) => {
            while (bitLen < tree.maxLen) {
                if (inPos < deflate.length) { bitBuf |= deflate[inPos++] << bitLen; bitLen += 8; }
                else break;
            }
            const idx = bitBuf & ((1<<tree.maxLen)-1);
            const sym = tree.symTable[idx];
            const l   = tree.lenTable[idx];
            bitBuf >>= l; bitLen -= l;
            return sym;
        };

        const lenExtra  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
        const lenBase   = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
        const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
        const distBase  = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];

        const inflate_block = (litTree, distTree) => {
            while (true) {
                const sym = peekRead(litTree);
                if (sym < 256) {
                    out[outPos++] = sym;
                } else if (sym === 256) {
                    break;
                } else {
                    const li = sym - 257;
                    const length = lenBase[li] + readBits(lenExtra[li]);
                    const di = peekRead(distTree);
                    const dist = distBase[di] + readBits(distExtra[di]);
                    let copyPos = outPos - dist;
                    for (let i = 0; i < length; i++) out[outPos++] = out[copyPos++];
                }
            }
        };

        while (true) {
            const bfinal = readBits(1);
            const btype  = readBits(2);
            if (btype === 0) {
                // 存储块
                bitBuf = 0; bitLen = 0;
                const len  = deflate[inPos] | (deflate[inPos+1]<<8); inPos+=4;
                out.set(deflate.subarray(inPos, inPos+len), outPos);
                inPos += len; outPos += len;
            } else if (btype === 1) {
                // 固定霍夫曼
                inflate_block(buildTree2(fixedLitLen), buildTree2(fixedDist));
            } else if (btype === 2) {
                // 动态霍夫曼
                const hlit  = readBits(5) + 257;
                const hdist = readBits(5) + 1;
                const hclen = readBits(4) + 4;
                const clOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
                const clLens = new Array(19).fill(0);
                for (let i = 0; i < hclen; i++) clLens[clOrder[i]] = readBits(3);
                const clTree = buildTree2(clLens);
                const allLens = [];
                while (allLens.length < hlit + hdist) {
                    const s = peekRead(clTree);
                    if (s < 16) { allLens.push(s); }
                    else if (s === 16) { const rep = readBits(2)+3; for(let i=0;i<rep;i++) allLens.push(allLens[allLens.length-1]); }
                    else if (s === 17) { const rep = readBits(3)+3; for(let i=0;i<rep;i++) allLens.push(0); }
                    else              { const rep = readBits(7)+11; for(let i=0;i<rep;i++) allLens.push(0); }
                }
                inflate_block(buildTree2(allLens.slice(0,hlit)), buildTree2(allLens.slice(hlit)));
            }
            if (bfinal) break;
        }
        return out;
    }

    loadLUT() {
        return new Promise((resolve) => {
            const gl = this.gl;
            // 把 data:image/png;base64,... 解码为原始字节，绕开 <img> 颜色管理
            const b64 = KM_LUT_DATA.split(',')[1];
            const bin = atob(b64);
            const u8  = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

            const { width, height, pixels } = this._decodePNG(u8);

            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindTexture(gl.TEXTURE_2D, null);
            this.textures.lut = tex;
            console.log(`✅ LUT纹理加载完成（${width}×${height}，纯JS解码，无颜色管理）`);
            resolve();
        });
    }

    setupTextures() {
        const gl = this.gl;
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.textures.canvas = this.createEmptyTexture(w, h);
        this.textures.temp   = this.createEmptyTexture(w, h);
    }

    createEmptyTexture(width, height) {
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

    createTextureFromImage(image) {
        const gl = this.gl;
        const texture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return texture;
    }

    createBrushTextureFromCanvas(brushCanvas) {
        return this.createTextureFromImage(brushCanvas);
    }

    setupFramebuffers() {
        const gl = this.gl;

        this.framebuffers.canvas = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.canvas, 0);

        this.framebuffers.temp = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.temp, 0);

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer 创建失败');
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    setupGeometry() {
        const gl = this.gl;

        this.buffers.position = gl.createBuffer();

        const texCoords = new Float32Array([0,0, 1,0, 0,1, 1,1]);
        this.buffers.texCoord = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    }

    drawBrush(x, y, size, colorRGB, brushCanvas, useFalloff = true, smearDir = { x: 0, y: 0 }, smearLen = 0) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // 计算笔刷 AABB，clamp 到画布范围
        const halfSize = size / 2;
        const rx0 = Math.max(0, Math.floor(x - halfSize));
        const ry0 = Math.max(0, Math.floor(y - halfSize));
        const rx1 = Math.min(cw, Math.ceil(x + halfSize));
        const ry1 = Math.min(ch, Math.ceil(y + halfSize));
        const rw = rx1 - rx0;
        const rh = ry1 - ry0;

        if (rw <= 0 || rh <= 0) return null;

        if (brushCanvas !== this.lastBrushCanvas) {
            if (this.currentBrushTexture) gl.deleteTexture(this.currentBrushTexture);
            this.currentBrushTexture = this.createBrushTextureFromCanvas(brushCanvas);
            this.lastBrushCanvas = brushCanvas;
        }

        gl.useProgram(this.program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.viewport(0, 0, cw, ch);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.uniform1i(this.locations.u_canvasTexture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
        gl.uniform1i(this.locations.u_brushTexture, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.lut);
        gl.uniform1i(this.locations.u_lut, 2);

        gl.uniform2f(this.locations.u_resolution, cw, ch);
        gl.uniform4f(this.locations.u_brushColor, colorRGB.r, colorRGB.g, colorRGB.b, 1.0);
        gl.uniform2f(this.locations.u_currentPosition, x, y);
        gl.uniform1f(this.locations.u_brushRadius, size / 2);
        gl.uniform1f(this.locations.u_baseMixStrength, this.baseMixStrength);
        gl.uniform1f(this.locations.u_useFalloff, +useFalloff);
        gl.uniform2f(this.locations.u_smearDir, smearDir.x, smearDir.y);
        gl.uniform1f(this.locations.u_smearLen, smearLen);

        const positions = new Float32Array([
            x-halfSize, y-halfSize,
            x+halfSize, y-halfSize,
            x-halfSize, y+halfSize,
            x+halfSize, y+halfSize
        ]);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.locations.a_position);
        gl.vertexAttribPointer(this.locations.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.enableVertexAttribArray(this.locations.a_texCoord);
        gl.vertexAttribPointer(this.locations.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        this.swapTextures();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { x: rx0, y: ry0, w: rw, h: rh };
    }

    swapTextures() {
        const gl = this.gl;

        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        const tempTex = this.textures.canvas;
        this.textures.canvas = this.textures.temp;
        this.textures.temp = tempTex;

        const tempFB = this.framebuffers.canvas;
        this.framebuffers.canvas = this.framebuffers.temp;
        this.framebuffers.temp = tempFB;
    }

    readToCanvas2D(rect) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);

        const displayCtx = this.canvas.getContext('2d', { willReadFrequently: true });

        if (rect && rect.w > 0 && rect.h > 0) {
            // 局部回读：只读脏区
            const glY = ch - rect.y - rect.h;
            const pixels = new Uint8Array(rect.w * rect.h * 4);
            gl.readPixels(rect.x, glY, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            const flipped = new Uint8ClampedArray(pixels.length);
            const rowSize = rect.w * 4;
            for (let row = 0; row < rect.h; row++) {
                const srcRow = (rect.h - 1 - row) * rowSize;
                const dstRow = row * rowSize;
                flipped.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
            }

            if (displayCtx) {
                displayCtx.putImageData(new ImageData(flipped, rect.w, rect.h), rect.x, rect.y);
            }
        } else {
            // 全量回读（用于 clear / restore 等场景）
            const pixels = new Uint8Array(cw * ch * 4);
            gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            const flipped = new Uint8ClampedArray(pixels.length);
            const rowSize = cw * 4;
            for (let row = 0; row < ch; row++) {
                const srcRow = (ch - 1 - row) * rowSize;
                const dstRow = row * rowSize;
                flipped.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
            }

            this.offscreenCtx.putImageData(new ImageData(flipped, cw, ch), 0, 0);
            if (displayCtx) {
                displayCtx.clearRect(0, 0, cw, ch);
                displayCtx.drawImage(this.offscreenCanvas, 0, 0);
            }
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    writeFromCanvas2D() {
        const gl = this.gl;
        const ctx = this.offscreenCtx;

        const displayCtx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (displayCtx) {
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.drawImage(this.canvas, 0, 0);
        }

        const imageData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    getOffscreenContext() { return this.offscreenCtx; }
    getOffscreenCanvas() { return this.offscreenCanvas; }

    clear(color = { r: 1, g: 1, b: 1 }) {
        const gl = this.gl;

        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.clearColor(color.r, color.g, color.b, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.clearColor(color.r, color.g, color.b, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.readToCanvas2D();
    }
}

window.KMWebGLPainter = KMWebGLPainter;
console.log("KMWebGLPainter 加载成功");
