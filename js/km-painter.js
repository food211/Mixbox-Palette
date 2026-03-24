/**
 * KM 混色引擎 (Kubelka-Munk Mixing Engine)
 * 使用 38波长光谱 Kubelka-Munk 物理公式进行颜料混色
 * RGB → 38波长反射率LUT查表 → KM混合 → RGB
 * WebGL1 兼容，使用单张合并LUT纹理（1024×320）
 *
 * Copyright (C) 2026 food211
 * License: GPL-3.0 (https://www.gnu.org/licenses/gpl-3.0.html)
 * Repository: https://github.com/food211/Mixbox-Palette
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
        this.loadLUT();
        this.setupTextures();
        this.setupFramebuffers();
        this.setupGeometry();

        console.log('✅ KMWebGLPainter 初始化完成（38波长光谱KM，WebGL1）');
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
        // 纹理布局: x = gi*32+ri, y = band*32+bi，NEAREST采样
        void sampleLUT(vec3 c,
            out vec4 R0, out vec4 R1, out vec4 R2, out vec4 R3, out vec4 R4,
            out vec4 R5, out vec4 R6, out vec4 R7, out vec4 R8, out vec4 R9)
        {
            vec3 idx = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5);
            float u = (idx.g * 32.0 + idx.r + 0.5) / 1024.0;
            float b = idx.b;
            R0 = texture2D(u_lut, vec2(u, (0.0*32.0 + b + 0.5) / 320.0));
            R1 = texture2D(u_lut, vec2(u, (1.0*32.0 + b + 0.5) / 320.0));
            R2 = texture2D(u_lut, vec2(u, (2.0*32.0 + b + 0.5) / 320.0));
            R3 = texture2D(u_lut, vec2(u, (3.0*32.0 + b + 0.5) / 320.0));
            R4 = texture2D(u_lut, vec2(u, (4.0*32.0 + b + 0.5) / 320.0));
            R5 = texture2D(u_lut, vec2(u, (5.0*32.0 + b + 0.5) / 320.0));
            R6 = texture2D(u_lut, vec2(u, (6.0*32.0 + b + 0.5) / 320.0));
            R7 = texture2D(u_lut, vec2(u, (7.0*32.0 + b + 0.5) / 320.0));
            R8 = texture2D(u_lut, vec2(u, (8.0*32.0 + b + 0.5) / 320.0));
            R9 = texture2D(u_lut, vec2(u, (9.0*32.0 + b + 0.5) / 320.0));
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
            vec4 rc1 = clamp(r1, 1e-4, 1.0);
            vec4 rc2 = clamp(r2, 1e-4, 1.0);
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

            float lum1 = luminance(A0,A1,A2,A3,A4,A5,A6,A7,A8,A9);
            float lum2 = luminance(B0,B1,B2,B3,B4,B5,B6,B7,B8,B9);
            float conc1 = (1.0 - t) * (1.0 - t) * lum1;
            float conc2 = t * t * lum2;
            float totalConc = max(conc1 + conc2, 1e-7);

            return reflectanceToRGB(
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
        }

        void main() {
            vec4 brushSample = texture2D(u_brushTexture, v_texCoord);
            float brushAlpha = brushSample.a;

            if (brushAlpha < 0.01) {
                discard;
            }

            vec2 canvasUV = v_canvasCoord / u_resolution;
            canvasUV.y = 1.0 - canvasUV.y;
            vec4 canvasColor = texture2D(u_canvasTexture, canvasUV);

            float distToCenter = length(v_canvasCoord - u_currentPosition);
            float radialFalloff = 1.0 - smoothstep(0.0, u_brushRadius, distToCenter);

            float mixAmount = radialFalloff * brushAlpha * u_baseMixStrength;
            // KM内部用t²计算浓度，对外暴露sqrt(t)使感知混色量线性化
            float kmT = sqrt(clamp(mixAmount, 0.0, 1.0));

            gl_FragColor = vec4(km_mix(canvasColor.rgb, u_brushColor.rgb, kmT), 1.0);
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

    loadLUT() {
        const gl = this.gl;
        const N = 38;
        const LUT_N = 32;
        const LUT_W = LUT_N * LUT_N;   // 1024
        const LUT_BAND_H = LUT_N;       // 32
        const NUM_BANDS = 10;
        const LUT_H = LUT_BAND_H * NUM_BANDS; // 320

        // 38波长 Spectral BASE 数据
        const BASE_W=[1.00116072718764,1.00116065159728,1.00116031922747,1.00115867270789,1.00115259844552,1.00113252528998,1.00108500663327,1.00099687889453,1.00086525152274,1.0006962900094,1.00050496114888,1.00030808187992,1.00011966602013,0.999952765968407,0.999821836899297,0.999738609557593,0.999709551639612,0.999731930210627,0.999799436346195,0.999900330316671,1.00002040652611,1.00014478793658,1.00025997903412,1.00035579697089,1.00042753780269,1.00047623344888,1.00050720967508,1.00052519156373,1.00053509606896,1.00054022097482,1.00054272816784,1.00054389569087,1.00054448212151,1.00054476959992,1.00054489887762,1.00054496254689,1.00054498927058,1.000544996993];
        const BASE_C=[0.970585001322962,0.970592498143425,0.970625348729891,0.970786806119017,0.971368673228248,0.973163230621252,0.976740223158765,0.981587605491377,0.986280265652949,0.989949147689134,0.99249270153842,0.994145680405256,0.995183975033212,0.995756750110818,0.99591281828671,0.995606157834528,0.994597600961854,0.99221571549237,0.986236452783249,0.967943337264541,0.891285004244943,0.536202477862053,0.154108119001878,0.0574575093228929,0.0315349873107007,0.0222633920086335,0.0182022841492439,0.016299055973264,0.0153656239334613,0.0149111568733976,0.0146954339898235,0.0145964146717719,0.0145470156699655,0.0145228771899495,0.0145120341118965,0.0145066940939832,0.0145044507314479,0.0145038009464639];
        const BASE_M=[0.990673557319988,0.990671524961979,0.990662582353421,0.990618107644795,0.99045148087871,0.989871081400204,0.98828660875964,0.984290692797504,0.973934905625306,0.941817838460145,0.817390326195156,0.432472805065729,0.13845397825887,0.0537347216940033,0.0292174996673231,0.021313651750859,0.0201349530181136,0.0241323096280662,0.0372236145223627,0.0760506552706601,0.205375471942399,0.541268903460439,0.815841685086486,0.912817704123976,0.946339830166962,0.959927696331991,0.966260595230312,0.969325970058424,0.970854536721399,0.971605066528128,0.971962769757392,0.972127272274509,0.972209417745812,0.972249577678424,0.972267621998742,0.97227650946215,0.972280243306874,0.97228132482656];
        const BASE_Y=[0.0210523371789306,0.0210564627517414,0.0210746178695038,0.0211649058448753,0.0215027957272504,0.0226738799041561,0.0258235649693629,0.0334879385639851,0.0519069663740307,0.100749014833473,0.239129899706847,0.534804312272748,0.79780757864303,0.911449894067384,0.953797963004507,0.971241615465429,0.979303123807588,0.983380119507575,0.985461246567755,0.986435046976605,0.986738250670141,0.986617882445032,0.986277776758643,0.985860592444056,0.98547492767621,0.985176934765558,0.984971574014181,0.984846303415712,0.984775351811199,0.984738066625265,0.984719648311765,0.984711023391939,0.984706683300676,0.984704554393091,0.98470359630937,0.984703124077552,0.98470292561509,0.984702868122795];
        const BASE_R=[0.0315605737777207,0.0315520718330149,0.0315148215513658,0.0313318044982702,0.0306729857725527,0.0286480476989607,0.0246450407045709,0.0192960753663651,0.0142066612220556,0.0102942608878609,0.0076191460521811,0.005898041083542,0.0048233247781713,0.0042298748350633,0.0040599171299341,0.0043533695594676,0.0053434425970201,0.0076917201010463,0.0135969795736536,0.0316975442661115,0.107861196355249,0.463812603168704,0.847055405272011,0.943185409393918,0.968862150696558,0.978030667473603,0.982043643854306,0.983923623718707,0.984845484154382,0.985294275814596,0.985507295219825,0.985605071539837,0.985653849933578,0.985677685033883,0.985688391806122,0.985693664690031,0.985695879848205,0.985696521463762];
        const BASE_G=[0.0095560747554212,0.0095581580120851,0.0095673245444588,0.0096129126297349,0.0097837090401843,0.010378622705871,0.0120026452378567,0.0160977721473922,0.026706190223168,0.0595555440185881,0.186039826532826,0.570579820116159,0.861467768400292,0.945879089767658,0.970465486474305,0.97841363028445,0.979589031411224,0.975533536908632,0.962288755397813,0.92312157451312,0.793434018943111,0.459270135902429,0.185574103666303,0.0881774959955372,0.05436302287667,0.0406288447060719,0.034221520431697,0.0311185790956966,0.0295708898336134,0.0288108739348928,0.0284486271324597,0.0282820301724731,0.0281988376490237,0.0281581655342037,0.0281398910216386,0.0281308901665811,0.0281271086805816,0.0281260133612096];
        const BASE_B=[0.979404752502014,0.97940070684313,0.979382903470261,0.979294364945594,0.97896301460857,0.977814466694043,0.974724321133836,0.967198482343973,0.949079657530575,0.900850128940977,0.76315044546224,0.465922171649319,0.201263280451005,0.0877524413419623,0.0457176793291679,0.0284706050521843,0.020527176756985,0.0165302792310211,0.0145135107212858,0.0136003508637687,0.0133604258769571,0.013548894314568,0.0139594356366992,0.014443425575357,0.0148854440621406,0.0152254296999746,0.0154592848180209,0.0156018026485961,0.0156824871281936,0.0157248764360615,0.0157458108784121,0.0157556123350225,0.0157605443964911,0.0157629637515278,0.0157640525629106,0.015764589232951,0.0157648147772649,0.0157648801149616];

        function uncompand(x) {
            return x > 0.04045 ? Math.pow((x+0.055)/1.055, 2.4) : x/12.92;
        }

        const data = new Uint8Array(LUT_W * LUT_H * 4);

        for (let bi = 0; bi < LUT_N; bi++) {
            for (let gi = 0; gi < LUT_N; gi++) {
                for (let ri = 0; ri < LUT_N; ri++) {
                    const r = ri / (LUT_N - 1);
                    const g = gi / (LUT_N - 1);
                    const b = bi / (LUT_N - 1);

                    let lr = uncompand(r), lg = uncompand(g), lb = uncompand(b);
                    let w = Math.min(lr, lg, lb);
                    lr -= w; lg -= w; lb -= w;
                    const c  = Math.min(lg, lb);
                    const m  = Math.min(lr, lb);
                    const y  = Math.min(lr, lg);
                    const rd = Math.max(0, Math.min(lr-lb, lr-lg));
                    const gd = Math.max(0, Math.min(lg-lb, lg-lr));
                    const bd = Math.max(0, Math.min(lb-lg, lb-lr));

                    const px = gi * LUT_N + ri;
                    for (let band = 0; band < NUM_BANDS; band++) {
                        const py = band * LUT_BAND_H + bi;
                        const idx = (py * LUT_W + px) * 4;
                        for (let ch = 0; ch < 4; ch++) {
                            const wi = band * 4 + ch;
                            if (wi < N) {
                                const val = Math.max(1e-7,
                                    w*BASE_W[wi] + c*BASE_C[wi] + m*BASE_M[wi] + y*BASE_Y[wi] +
                                    rd*BASE_R[wi] + gd*BASE_G[wi] + bd*BASE_B[wi]);
                                data[idx + ch] = Math.round(Math.min(1, val) * 255);
                            } else {
                                data[idx + ch] = 0;
                            }
                        }
                    }
                }
            }
        }

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_W, LUT_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        this.textures.lut = tex;
        console.log('✅ LUT纹理生成完成（JS计算，无CORS）');
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

    drawBrush(x, y, size, colorRGB, brushCanvas) {
        const gl = this.gl;

        if (brushCanvas !== this.lastBrushCanvas) {
            if (this.currentBrushTexture) gl.deleteTexture(this.currentBrushTexture);
            this.currentBrushTexture = this.createBrushTextureFromCanvas(brushCanvas);
            this.lastBrushCanvas = brushCanvas;
        }

        gl.useProgram(this.program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.uniform1i(this.locations.u_canvasTexture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
        gl.uniform1i(this.locations.u_brushTexture, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.lut);
        gl.uniform1i(this.locations.u_lut, 2);

        gl.uniform2f(this.locations.u_resolution, this.canvas.width, this.canvas.height);
        gl.uniform4f(this.locations.u_brushColor, colorRGB.r, colorRGB.g, colorRGB.b, 1.0);
        gl.uniform2f(this.locations.u_currentPosition, x, y);
        gl.uniform1f(this.locations.u_brushRadius, size / 2);
        gl.uniform1f(this.locations.u_baseMixStrength, this.baseMixStrength);

        const halfSize = size / 2;
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

    readToCanvas2D() {
        const gl = this.gl;
        const ctx = this.offscreenCtx;

        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        const pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4);
        gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        const flippedPixels = new Uint8ClampedArray(pixels.length);
        const width = this.canvas.width;
        const height = this.canvas.height;
        const rowSize = width * 4;

        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * rowSize;
            const dstRow = y * rowSize;
            for (let x = 0; x < rowSize; x++) {
                flippedPixels[dstRow + x] = pixels[srcRow + x];
            }
        }

        ctx.putImageData(new ImageData(flippedPixels, width, height), 0, 0);

        const displayCtx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (displayCtx) {
            displayCtx.clearRect(0, 0, width, height);
            displayCtx.drawImage(this.offscreenCanvas, 0, 0);
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
