// 颜料预设
const palettePresets = {
    // 温莎牛顿 Cotman 16 色
    winsorNewtonCotman: {
        name: "温莎牛顿 Cotman 16色",
        colors: [
            { hex: '#F5E84C', name: 'Lemon Yellow', nameCN: '柠檬黄' },
            { hex: '#F0D635', name: 'Cadmium Yellow Pale Hue', nameCN: '镉黄浅' },
            { hex: '#ED7F3D', name: 'Cadmium Orange Hue', nameCN: '镉橙' },
            { hex: '#E85D5D', name: 'Cadmium Red Pale Hue', nameCN: '镉红浅' },
            { hex: '#7A1818', name: 'Alizarin Crimson Hue', nameCN: '茜素深红' },
            { hex: '#6B2A7C', name: 'Purple Lake', nameCN: '紫湖' },
            { hex: '#1C3575', name: 'Ultramarine', nameCN: '群青' },
            { hex: '#1A8FCC', name: 'Cerulean Blue Hue', nameCN: '天蓝' },
            { hex: '#0A7A5A', name: 'Viridian Hue', nameCN: '翠绿' },
            { hex: '#456B0E', name: 'Sap Green', nameCN: '树汁绿' },
            { hex: '#C49665', name: 'Yellow Ochre', nameCN: '黄赭' },
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
    // 施美尔 Schmincke Horadam 16色
    schminckeHoradam: {
        name: "施美尔 Horadam 16色",
        colors: [
            { hex: '#FFEB3B', name: 'Lemon Yellow', nameCN: '柠檬黄' },
            { hex: '#FFC107', name: 'Indian Yellow', nameCN: '印度黄' },
            { hex: '#FF5722', name: 'Vermilion', nameCN: '朱红' },
            { hex: '#E91E63', name: 'Ruby Red', nameCN: '宝石红' },
            { hex: '#9C27B0', name: 'Magenta', nameCN: '洋红' },
            { hex: '#673AB7', name: 'Mauve', nameCN: '淡紫' },
            { hex: '#3F51B5', name: 'Ultramarine Finest', nameCN: '特级群青' },
            { hex: '#2196F3', name: 'Prussian Blue', nameCN: '普鲁士蓝' },
            { hex: '#03A9F4', name: 'Cerulean Blue', nameCN: '天蓝' },
            { hex: '#009688', name: 'Phthalo Green', nameCN: '酞青绿' },
            { hex: '#4CAF50', name: 'Permanent Green', nameCN: '永固绿' },
            { hex: '#8BC34A', name: 'May Green', nameCN: '五月绿' },
            { hex: '#CDDC39', name: 'Green Earth', nameCN: '绿土' },
            { hex: '#A1887F', name: 'Burnt Sienna', nameCN: '熟赭' },
            { hex: '#795548', name: 'Sepia Brown', nameCN: '深褐' },
            { hex: '#607D8B', name: 'Neutral Grey', nameCN: '中性灰' }
        ]
    },
    // 日本吴竹透明水彩 16色
    kuretakeGansai: {
        name: "吴竹 Gansai 16色",
        colors: [
            { hex: '#FFEB3B', name: 'Pale Yellow', nameCN: '淡黄' },
            { hex: '#FFC107', name: 'Yellow', nameCN: '中黄' },
            { hex: '#FF9800', name: 'Orange', nameCN: '橙色' },
            { hex: '#F44336', name: 'Scarlet', nameCN: '朱红' },
            { hex: '#E91E63', name: 'Carmine', nameCN: '胭脂红' },
            { hex: '#9C27B0', name: 'Violet', nameCN: '紫色' },
            { hex: '#673AB7', name: 'Purple', nameCN: '深紫' },
            { hex: '#3F51B5', name: 'Indigo', nameCN: '靛蓝' },
            { hex: '#2196F3', name: 'Blue', nameCN: '蓝色' },
            { hex: '#03A9F4', name: 'Light Blue', nameCN: '浅蓝' },
            { hex: '#00BCD4', name: 'Turquoise', nameCN: '绿松石' },
            { hex: '#009688', name: 'Viridian', nameCN: '翠绿' },
            { hex: '#4CAF50', name: 'Green', nameCN: '绿色' },
            { hex: '#8BC34A', name: 'Sap Green', nameCN: '树绿' },
            { hex: '#795548', name: 'Brown', nameCN: '棕色' },
            { hex: '#607D8B', name: 'Gray', nameCN: '灰色' }
        ]
    },
    // 伦勃朗 Rembrandt 油画 16色
    rembrandtOil: {
        name: "伦勃朗 Rembrandt 油画 16色",
        colors: [
            { hex: '#F5F0DC', name: 'Titanium White', nameCN: '钛白' },
            { hex: '#F2E04A', name: 'Permanent Lemon Yellow', nameCN: '永固柠檬黄' },
            { hex: '#E8B84B', name: 'Permanent Yellow Medium', nameCN: '永固中黄' },
            { hex: '#D4702A', name: 'Permanent Orange', nameCN: '永固橙' },
            { hex: '#C0392B', name: 'Permanent Red Light', nameCN: '永固浅红' },
            { hex: '#8B1A1A', name: 'Alizarin Crimson', nameCN: '茜素深红' },
            { hex: '#6D2B8A', name: 'Permanent Red Violet', nameCN: '永固红紫' },
            { hex: '#1F3A7A', name: 'Ultramarine Deep', nameCN: '深群青' },
            { hex: '#1A5276', name: 'Prussian Blue', nameCN: '普鲁士蓝' },
            { hex: '#1A6B4A', name: 'Viridian', nameCN: '翠绿' },
            { hex: '#C8A84B', name: 'Yellow Ochre', nameCN: '黄赭石' },
            { hex: '#A0522D', name: 'Raw Sienna', nameCN: '生赭' },
            { hex: '#7B3A1E', name: 'Burnt Sienna', nameCN: '熟赭' },
            { hex: '#4A2C17', name: 'Raw Umber', nameCN: '生褐' },
            { hex: '#2C1A0E', name: 'Burnt Umber', nameCN: '熟褐' },
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
            { hex: '#C2185B', name: 'Magenta',              nameCN: '品红' },
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
            { hex: '#1A6B4A', name: 'Winsor Green',  nameCN: '温莎绿' },
            // 中性色
            { hex: '#8C8C8C', name: 'Neutral Grey',         nameCN: '中性灰' },
            { hex: '#F5F5F0', name: 'Zinc White',           nameCN: '锌白' },
            { hex: '#1C1C1A', name: 'Ivory Black',          nameCN: '象牙黑' }
        ]
    }
};