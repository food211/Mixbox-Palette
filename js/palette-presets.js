// 颜料预设
const palettePresets = {
    // 温莎牛顿 Cotman 16 色
    winsorNewtonCotman: {
        name: "温莎牛顿 Cotman 16色",
        colors: [
            { hex: '#F4E04A', name: 'Lemon Yellow', nameCN: '柠檬黄' },
            { hex: '#F5C42E', name: 'Cadmium Yellow Pale Hue', nameCN: '镉黄浅' },
            { hex: '#ED7F3D', name: 'Cadmium Orange Hue', nameCN: '镉橙' },
            { hex: '#E85D5D', name: 'Cadmium Red Pale Hue', nameCN: '镉红浅' },
            { hex: '#9C2542', name: 'Alizarin Crimson Hue', nameCN: '茜素深红' },
            { hex: '#7A2E6C', name: 'Purple Lake', nameCN: '紫湖' },
            { hex: '#1C3575', name: 'Ultramarine', nameCN: '群青' },
            { hex: '#3B7FA8', name: 'Cerulean Blue Hue', nameCN: '天蓝' },
            { hex: '#0E8060', name: 'Viridian Hue', nameCN: '翠绿' },
            { hex: '#5C7028', name: 'Sap Green', nameCN: '树汁绿' },
            { hex: '#C18E45', name: 'Yellow Ochre', nameCN: '黄赭' },
            { hex: '#8F4A2A', name: 'Raw Sienna', nameCN: '生赭' },
            { hex: '#7A3F13', name: 'Burnt Sienna', nameCN: '熟赭' },
            { hex: '#362320', name: 'Burnt Umber', nameCN: '熟褐' },
            { hex: '#424B5A', name: 'Payne\'s Gray', nameCN: '佩恩灰' },
            { hex: '#F2EEE3', name: 'Chinese White', nameCN: '中国白' }
        ]
    },
    // 数字艺术家调色板
    digitalArtist: {
        name: "数字艺术家调色板",
        colors: [
            { hex: '#FFFF00', name: 'Yellow', nameCN: '黄色' },
            { hex: '#FFA500', name: 'Orange', nameCN: '橙色' },
            { hex: '#FF0000', name: 'Red', nameCN: '红色' },
            { hex: '#FF69B4', name: 'Hot Pink', nameCN: '粉红' },
            { hex: '#8A2BE2', name: 'Violet', nameCN: '紫色' },
            { hex: '#0000FF', name: 'Blue', nameCN: '蓝色' },
            { hex: '#00BFFF', name: 'Deep Sky Blue', nameCN: '天蓝' },
            { hex: '#008000', name: 'Green', nameCN: '绿色' },
            { hex: '#00FF7F', name: 'Spring Green', nameCN: '春绿' },
            { hex: '#8B4513', name: 'Brown', nameCN: '棕色' },
            { hex: '#D2B48C', name: 'Tan', nameCN: '棕褐' },
            { hex: '#FFD700', name: 'Gold', nameCN: '金色' },
            { hex: '#F7F6ED', name: 'White', nameCN: '纯白' },
            { hex: '#808080', name: 'Gray', nameCN: '灰色' },
            { hex: '#2F4F4F', name: 'Dark Slate Gray', nameCN: '深灰' },
            { hex: '#000000', name: 'Black', nameCN: '黑色' }
        ]
    },
    // 施美尔 Schmincke Horadam 16色（参考 schmincke.de 官方色卡）
    schminckeHoradam: {
        name: "施美尔 Horadam 16色",
        colors: [
            { hex: '#F4E04A', name: 'Lemon Yellow', nameCN: '柠檬黄' },
            { hex: '#F0A920', name: 'Indian Yellow', nameCN: '印度黄' },
            { hex: '#E63E22', name: 'Vermilion', nameCN: '朱红' },
            { hex: '#C2185B', name: 'Ruby Red', nameCN: '宝石红' },
            { hex: '#A02060', name: 'Magenta', nameCN: '洋红' },
            { hex: '#7B4FA6', name: 'Mauve', nameCN: '淡紫' },
            { hex: '#1F3A7A', name: 'Ultramarine Finest', nameCN: '特级群青' },
            { hex: '#1B3A5C', name: 'Prussian Blue', nameCN: '普鲁士蓝' },
            { hex: '#3B7FA8', name: 'Cerulean Blue', nameCN: '天蓝' },
            { hex: '#005544', name: 'Phthalo Green', nameCN: '酞青绿' },
            { hex: '#2E7D32', name: 'Permanent Green', nameCN: '永固绿' },
            { hex: '#7CB342', name: 'May Green', nameCN: '五月绿' },
            { hex: '#A8A86A', name: 'Green Earth', nameCN: '绿土' },
            { hex: '#9E4F2A', name: 'Burnt Sienna', nameCN: '熟赭' },
            { hex: '#4A2E1F', name: 'Sepia Brown', nameCN: '深褐' },
            { hex: '#6B7280', name: 'Neutral Grey', nameCN: '中性灰' }
        ]
    },
    // 日本吴竹透明水彩 16色（参考 kuretake.com 官方色卡）
    kuretakeGansai: {
        name: "吴竹 Gansai 16色",
        colors: [
            { hex: '#F8E37A', name: 'Pale Yellow', nameCN: '淡黄' },
            { hex: '#F2C53A', name: 'Yellow', nameCN: '中黄' },
            { hex: '#EE8A2A', name: 'Orange', nameCN: '橙色' },
            { hex: '#D63A2C', name: 'Scarlet', nameCN: '朱红' },
            { hex: '#A91E48', name: 'Carmine', nameCN: '胭脂红' },
            { hex: '#7E3990', name: 'Violet', nameCN: '紫色' },
            { hex: '#4A2870', name: 'Purple', nameCN: '深紫' },
            { hex: '#1B2A4A', name: 'Indigo', nameCN: '靛蓝' },
            { hex: '#1F4E9C', name: 'Blue', nameCN: '蓝色' },
            { hex: '#3A8FCC', name: 'Light Blue', nameCN: '浅蓝' },
            { hex: '#2BA8B8', name: 'Turquoise', nameCN: '绿松石' },
            { hex: '#0A7A5A', name: 'Viridian', nameCN: '翠绿' },
            { hex: '#3A8A3D', name: 'Green', nameCN: '绿色' },
            { hex: '#7CA64A', name: 'Sap Green', nameCN: '树绿' },
            { hex: '#7A4A2A', name: 'Brown', nameCN: '棕色' },
            { hex: '#6E7B82', name: 'Gray', nameCN: '灰色' }
        ]
    },
    // 伦勃朗 Rembrandt 油画 16色
    rembrandtOil: {
        name: "伦勃朗 Rembrandt 油画 16色",
        colors: [
            { hex: '#F5F0DC', name: 'Titanium White', nameCN: '钛白' },
            { hex: '#F2E04A', name: 'Permanent Lemon Yellow', nameCN: '永固柠檬黄' },
            { hex: '#F2A82A', name: 'Permanent Yellow Medium', nameCN: '永固中黄' },
            { hex: '#E66020', name: 'Permanent Orange', nameCN: '永固橙' },
            { hex: '#D44530', name: 'Permanent Red Light', nameCN: '永固浅红' },
            { hex: '#9C2542', name: 'Alizarin Crimson', nameCN: '茜素深红' },
            { hex: '#7A2A6E', name: 'Permanent Red Violet', nameCN: '永固红紫' },
            { hex: '#1F3A7A', name: 'Ultramarine Deep', nameCN: '深群青' },
            { hex: '#1A5276', name: 'Prussian Blue', nameCN: '普鲁士蓝' },
            { hex: '#0E8060', name: 'Viridian', nameCN: '翠绿' },
            { hex: '#C18E45', name: 'Yellow Ochre', nameCN: '黄赭石' },
            { hex: '#B57A35', name: 'Raw Sienna', nameCN: '生赭' },
            { hex: '#7B3A1E', name: 'Burnt Sienna', nameCN: '熟赭' },
            { hex: '#4A2C17', name: 'Raw Umber', nameCN: '生褐' },
            { hex: '#3D2817', name: 'Burnt Umber', nameCN: '熟褐' },
            { hex: '#1C1C1C', name: 'Ivory Black', nameCN: '象牙黑' }
        ]
    },
    // 温莎牛顿 Winsor & Newton Designers Gouache 24色
    wnGouache: {
        name: "温莎牛顿 Designers Gouache Mix",
        colors: [
            // 粉红 / 玫瑰红系
            { hex: '#F2607D', name: 'Permanent Rose',       nameCN: '永固玫瑰红' },
            { hex: '#F4364C', name: 'Primary Red',          nameCN: '原色红' },
            { hex: '#D02670', name: 'Magenta',              nameCN: '品红' },
            { hex: '#E8341C', name: 'Flame Red',            nameCN: '火焰红' },
            // 紫色系
            { hex: '#C084C8', name: 'Light Purple',         nameCN: '浅紫' },
            { hex: '#7B4FA6', name: 'Brilliant Violet',     nameCN: '亮紫罗兰' },
            { hex: '#6B2D6B', name: 'Perylene Violet',      nameCN: '苝紫' },
            // 黄色系
            { hex: '#F5D98B', name: 'Naples Yellow',        nameCN: '那不勒斯黄' },
            { hex: '#F0A020', name: 'Marigold Yellow',      nameCN: '万寿菊黄' },
            // 棕色系
            { hex: '#9B3A2A', name: 'Venetian Red',         nameCN: '威尼斯红' },
            { hex: '#C8922A', name: 'Gold Ochre',           nameCN: '金赭' },
            { hex: '#C47A2A', name: 'Raw Sienna',           nameCN: '生赭' },
            { hex: '#7A5C3A', name: 'Raw Umber',            nameCN: '生棕土' },
            { hex: '#4A2E1A', name: 'Sepia',                nameCN: '墨褐' },  
            // 冷色系
            { hex: '#1B4F9C', name: 'Primary Blue',  nameCN: '原色蓝' },
            { hex: '#2E86C1', name: 'Cerulean Blue', nameCN: '天蓝' },
            { hex: '#005544', name: 'Winsor Green',  nameCN: '温莎绿' },
            // 中性色
            { hex: '#8C8C8C', name: 'Neutral Grey',         nameCN: '中性灰' },
            { hex: '#F5F5F0', name: 'Zinc White',           nameCN: '锌白' },
            { hex: '#1C1C1A', name: 'Ivory Black',          nameCN: '象牙黑' }
        ]
    }
};