/**
 * KMWebGLPainter — Kubelka-Munk 物理混色引擎
 * 继承 BaseWebGLPainter，只包含 KM 专有部分：
 *  - 38波长光谱 KM 片段着色器
 *  - 纯 JS PNG 解码 + LUT 加载（绕开浏览器颜色管理）
 *  - LUT 绑定到纹理槽 2
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
class KMWebGLPainter extends BaseWebGLPainter {

    async init() {
        await super.init();
        console.log('✅ KMWebGLPainter 初始化完成（38波长光谱KM，WebGL1，32³LUT）');
    }

    // ─── 片段着色器 ───────────────────────────────

    _buildFragmentShader() {
        return `
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
        uniform float u_disableSmear;
        uniform float u_smudgeAlpha;

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

        void sampleLUT(vec3 c,
            out vec4 R0, out vec4 R1, out vec4 R2, out vec4 R3, out vec4 R4,
            out vec4 R5, out vec4 R6, out vec4 R7, out vec4 R8, out vec4 R9)
        {
            vec3 f = clamp(c, 0.0, 1.0) * 31.0;
            float g0 = floor(f.g); float g1 = min(g0+1.0, 31.0); float gf = f.g - g0;
            float u0 = (g0 * 32.0 + f.r + 0.5) / 1024.0;
            float u1 = (g1 * 32.0 + f.r + 0.5) / 1024.0;

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

            vec3 finalColor;
            if (u_disableSmear > 0.5) {
                float edgeWeight = clamp(aBrush * u_smudgeAlpha, 0.0, 1.0);
                vec3 mixedColor = km_mix(canvasColor.rgb, u_brushColor.rgb, u_smudgeAlpha * 0.5);
                finalColor = mix(canvasColor.rgb, mixedColor, edgeWeight);
            } else {
                float density = u_baseMixStrength * u_baseMixStrength;

                float smearReach = clamp(u_smearLen, 1.0, u_brushRadius) * 0.8;
                vec2 smearUV = (v_canvasCoord - u_smearDir * smearReach) / u_resolution;
                smearUV.y = 1.0 - smearUV.y;
                smearUV = clamp(smearUV, 0.0, 1.0);
                vec4 smearSample = texture2D(u_canvasTexture, smearUV);

                vec3 safeCanvasRGB = (canvasColor.a > 0.1) ? canvasColor.rgb : u_brushColor.rgb;
                vec3 safeSmearRGB  = (smearSample.a > 0.1) ? smearSample.rgb : safeCanvasRGB;

                vec3 smearTarget = km_mix(safeCanvasRGB, safeSmearRGB, aBrush * 0.6);

                if (density > 0.98) {
                    float edgeWeight = clamp(aBrush * u_baseMixStrength, 0.0, 1.0);
                    vec3 mixedColor = km_mix(canvasColor.rgb, u_brushColor.rgb, clamp(u_baseMixStrength, 0.0, 1.0));
                    finalColor = mix(canvasColor.rgb, mixedColor, edgeWeight / max(u_baseMixStrength, 0.001));
                } else if (density < 0.01) {
                    finalColor = smearTarget;
                } else {
                    float edgeWeight = clamp(aBrush * u_baseMixStrength, 0.0, 1.0);
                    vec3 mixedColor = km_mix(canvasColor.rgb, u_brushColor.rgb, clamp(u_baseMixStrength, 0.0, 1.0));
                    vec3 paintResult = mix(canvasColor.rgb, mixedColor, edgeWeight / max(u_baseMixStrength, 0.001));
                    finalColor = mix(smearTarget, paintResult, density);
                }
            }

            gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
        }
        `;
    }

    // ─── LUT ─────────────────────────────────────

    _getExtraUniformNames() {
        return ['u_lut'];
    }

    async _loadLUT() {
        const b64 = KM_LUT_DATA.split(',')[1];
        const bin = atob(b64);
        const u8  = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

        const { width, height, pixels } = this._decodePNG(u8);

        const gl = this.gl;
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
        console.log(`✅ KM LUT 加载完成（${width}×${height}，纯JS解码）`);
    }

    _bindLUT() {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.uniform1i(this.locations.u_canvasTexture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
        gl.uniform1i(this.locations.u_brushTexture, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.lut);
        gl.uniform1i(this.locations.u_lut, 2);
    }

    // ─── PNG 解码器（绕开浏览器颜色管理）────────────

    _decodePNG(u8) {
        const u32 = (b, o) => ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0;

        let width = 0, height = 0;
        const idatChunks = [];
        let pos = 8;
        while (pos < u8.length) {
            const len  = u32(u8, pos);
            const type = String.fromCharCode(u8[pos+4],u8[pos+5],u8[pos+6],u8[pos+7]);
            const data = u8.subarray(pos+8, pos+8+len);
            if      (type === 'IHDR') { width = u32(data, 0); height = u32(data, 4); }
            else if (type === 'IDAT') { idatChunks.push(data); }
            else if (type === 'IEND') { break; }
            pos += 12 + len;
        }

        let totalLen = idatChunks.reduce((s, c) => s + c.length, 0);
        const zlibData = new Uint8Array(totalLen);
        let off = 0;
        for (const c of idatChunks) { zlibData.set(c, off); off += c.length; }

        const raw = this._inflate(zlibData, width, height);

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

    _inflate(zlib, width, height) {
        const deflate = zlib.subarray(2, zlib.length - 4);
        const rowBytes = width * 4;
        const out = new Uint8Array(height * (rowBytes + 1));
        let inPos = 0, outPos = 0;

        let bitBuf = 0, bitLen = 0;
        const readBits = (n) => {
            while (bitLen < n) { bitBuf |= deflate[inPos++] << bitLen; bitLen += 8; }
            const val = bitBuf & ((1<<n)-1); bitBuf >>= n; bitLen -= n; return val;
        };

        const fixedLitLen = new Array(288);
        for (let i=0;i<144;i++) fixedLitLen[i]=8;
        for (let i=144;i<256;i++) fixedLitLen[i]=9;
        for (let i=256;i<280;i++) fixedLitLen[i]=7;
        for (let i=280;i<288;i++) fixedLitLen[i]=8;
        const fixedDist = new Array(32).fill(5);

        const buildTree2 = (lens) => {
            const maxLen = lens.reduce((a,b)=>Math.max(a,b),0);
            if (maxLen === 0) return { symTable: new Int32Array(0), lenTable: new Int32Array(0), maxLen: 0 };
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
                bitBuf = 0; bitLen = 0;
                const len = deflate[inPos] | (deflate[inPos+1]<<8); inPos+=4;
                out.set(deflate.subarray(inPos, inPos+len), outPos);
                inPos += len; outPos += len;
            } else if (btype === 1) {
                inflate_block(buildTree2(fixedLitLen), buildTree2(fixedDist));
            } else if (btype === 2) {
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
}

window.KMWebGLPainter = KMWebGLPainter;
console.log('KMWebGLPainter 加载成功');
