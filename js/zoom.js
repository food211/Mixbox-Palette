// ============ 缩放控制 ============
function initZoomControl() {
    const zoomBtn = document.getElementById('zoomBtn');
    const zoomDropdown = document.getElementById('zoomDropdown');
    const container = document.querySelector('.container');

    // 从 localStorage 读取保存的缩放比例
    let currentZoom = parseFloat(localStorage.getItem('mixbox_zoom') || '1.0');

    // 应用初始缩放
    applyZoom(currentZoom);

    // 切换下拉菜单
    zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomDropdown.classList.toggle('show');
    });

    // 选择缩放选项
    document.querySelectorAll('.zoom-option').forEach(option => {
        const zoom = parseFloat(option.getAttribute('data-zoom'));

        // 标记当前选中的选项
        if (Math.abs(zoom - currentZoom) < 0.01) {
            option.classList.add('active');
        }

        option.addEventListener('click', (e) => {
            e.stopPropagation();

            // 移除所有 active 状态
            document.querySelectorAll('.zoom-option').forEach(opt => {
                opt.classList.remove('active');
            });

            // 添加当前选中状态
            option.classList.add('active');

            // 应用缩放
            currentZoom = zoom;
            applyZoom(currentZoom);

            // 保存到 localStorage
            localStorage.setItem('mixbox_zoom', currentZoom.toString());

            // 关闭下拉菜单
            zoomDropdown.classList.remove('show');
        });
    });

    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', () => {
        zoomDropdown.classList.remove('show');
    });

    function applyZoom(zoom) {
        container.style.transform = `scale(${zoom})`;
        container.style.transformOrigin = 'top center';
        zoomBtn.textContent = `${Math.round(zoom * 100)}%`;

        // 调整 body 的 padding，防止缩放后内容被裁剪
        if (zoom < 1) {
            document.body.style.padding = '0 10px 10px';
        } else {
            document.body.style.padding = '0 12px 12px';
        }
    }
}
