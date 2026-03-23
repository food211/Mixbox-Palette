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
            { hex: '#F5F5F0', name: 'Chinese White', nameCN: '中国白' }
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
            { hex: '#ffffff', name: 'White', nameCN: '纯白' },
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
    }
};
