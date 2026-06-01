// js/features/dust-particles.js
// Лёгкие летающие частицы акцентного цвета с плавным появлением и щадящей загрузкой

(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let animationTime = 0;
    let isAddingParticles = false;
    let addInterval = null;
    
    // НАСТРОЙКИ (оптимизированы под производительность и внешний вид)
    const TARGET_PARTICLE_COUNT = 70;        // меньше — легче, но достаточно для эффекта
    const PARTICLE_ADD_STEP = 3;              // добавляем по 3 частицы за раз
    const ADD_INTERVAL_MS = 120;              // каждые 120 мс
    
    const BASE_SIZE = 0.8;                    // мельче, чтобы не отвлекать
    const SIZE_VARIATION = 1.2;               // 0.8 .. 2.0 пикселя
    
    const OPACITY_TARGET_MIN = 0.10;          // менее заметные
    const OPACITY_TARGET_MAX = 0.28;
    const FADE_IN_DURATION = 1.5;             // секунды на появление частицы
    
    const ANGULAR_SPEED_MIN = 1.8;             // медленнее, спокойнее
    const ANGULAR_SPEED_MAX = 4.5;
    
    const RADIUS_MIN = 80;
    const RADIUS_MAX = 280;
    
    // Цветовая гамма – акцентный цвет #3D9EB3 с небольшими вариациями яркости
    const ACCENT_BASE = { r: 61, g: 158, b: 179 };
    
    function getAccentColor(variation = 0) {
        // variation: -1 .. 1 (светлее/темнее)
        let factor = 1 + variation * 0.25; // максимум ±25%
        let r = Math.min(255, Math.max(0, ACCENT_BASE.r * factor));
        let g = Math.min(255, Math.max(0, ACCENT_BASE.g * factor));
        let b = Math.min(255, Math.max(0, ACCENT_BASE.b * factor));
        return `rgb(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)})`;
    }
    
    // --- Инициализация canvas ---
    function initCanvas() {
        if (canvas) return; // уже создан
        canvas = document.createElement('canvas');
        canvas.id = 'dust-canvas';
        ctx = canvas.getContext('2d');
        
        Object.assign(canvas.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '9999',
            display: 'block'
        });
        document.body.insertBefore(canvas, document.body.firstChild);
        
        // Убедимся, что контент не перекрывается
        const page = document.querySelector('.page');
        if (page) page.style.position = 'relative';
        
        window.addEventListener('resize', onResize);
        onResize();
        
        startAddingParticles();   // постепенное наполнение
        startAnimation();
    }
    
    function onResize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        // При изменении размера не пересоздаём все частицы грубо,
        // а просто пересчитываем их базовые координаты с сохранением динамики
        for (let p of particles) {
            if (p.baseX > width) p.baseX = width - 20;
            if (p.baseY > height) p.baseY = height - 20;
            p.baseX = Math.min(width + 50, Math.max(-50, p.baseX));
            p.baseY = Math.min(height + 50, Math.max(-50, p.baseY));
        }
    }
    
    // --- Создание одной частицы (с плавным появлением) ---
    function createParticle(x, y) {
        const targetOpacity = OPACITY_TARGET_MIN + Math.random() * (OPACITY_TARGET_MAX - OPACITY_TARGET_MIN);
        // вариация цвета: от -0.6 до +0.4 (чуть больше тёмных, чтобы не слишком ярко)
        const colorVariation = (Math.random() - 0.6) * 1.0;
        const color = getAccentColor(colorVariation);
        
        return {
            baseX: x !== undefined ? x : Math.random() * width,
            baseY: y !== undefined ? y : Math.random() * height,
            angleX: Math.random() * Math.PI * 2,
            angleY: Math.random() * Math.PI * 2,
            speedX: ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN),
            speedY: ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN),
            radiusX: RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN),
            radiusY: RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN),
            size: BASE_SIZE + Math.random() * SIZE_VARIATION,
            targetOpacity: targetOpacity,
            currentOpacity: 0,               // начинаем с нуля
            fadeStartTime: performance.now() / 1000,
            color: color,
            phase: Math.random() * Math.PI * 2
        };
    }
    
    // --- Постепенное добавление частиц ---
    function startAddingParticles() {
        if (addInterval) clearInterval(addInterval);
        isAddingParticles = true;
        let currentCount = particles.length;
        
        addInterval = setInterval(() => {
            if (!isAddingParticles) return;
            if (particles.length >= TARGET_PARTICLE_COUNT) {
                clearInterval(addInterval);
                addInterval = null;
                isAddingParticles = false;
                return;
            }
            const toAdd = Math.min(PARTICLE_ADD_STEP, TARGET_PARTICLE_COUNT - particles.length);
            for (let i = 0; i < toAdd; i++) {
                particles.push(createParticle());
            }
            // Небольшая оптимизация: принудительно не перерисовываем, анимация сама подхватит
        }, ADD_INTERVAL_MS);
    }
    
    // Респавн частицы, если она улетела далеко за край
    function respawnParticle(p, nowSec) {
        // С вероятностью 70% просто телепортируем к противоположному краю
        if (Math.random() < 0.7) {
            p.baseX = (p.baseX < 0) ? width + 20 : (p.baseX > width ? -20 : p.baseX);
            p.baseY = (p.baseY < 0) ? height + 20 : (p.baseY > height ? -20 : p.baseY);
        } else {
            p.baseX = Math.random() * width;
            p.baseY = Math.random() * height;
        }
        // Сбрасываем углы, чтобы движение не было рывком
        p.angleX = Math.random() * Math.PI * 2;
        p.angleY = Math.random() * Math.PI * 2;
        p.phase = Math.random() * Math.PI * 2;
        // Обновляем параметры движения
        p.speedX = ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN);
        p.speedY = ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN);
        p.radiusX = RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN);
        p.radiusY = RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN);
        // Плавное появление заново (если частица давно исчезла)
        p.currentOpacity = 0;
        p.fadeStartTime = nowSec;
        p.targetOpacity = OPACITY_TARGET_MIN + Math.random() * (OPACITY_TARGET_MAX - OPACITY_TARGET_MIN);
        // Немного меняем цвет при респавне (разнообразие)
        const colorVariation = (Math.random() - 0.6) * 1.0;
        p.color = getAccentColor(colorVariation);
    }
    
    // --- Отрисовка с учётом плавного появления и затухания у краёв ---
    function drawParticles(nowSec) {
        if (!ctx || width === 0 || height === 0) return;
        ctx.clearRect(0, 0, width, height);
        
        // Отключаем тени для максимальной производительности
        ctx.shadowBlur = 0;
        
        for (let p of particles) {
            // Вычисляем смещение по круговой траектории
            let offsetX = Math.sin(p.angleX + nowSec * p.speedX) * p.radiusX;
            let offsetY = Math.cos(p.angleY + nowSec * p.speedY + p.phase) * p.radiusY;
            let x = p.baseX + offsetX;
            let y = p.baseY + offsetY;
            
            // Плавное затухание у краёв (чтобы частицы не обрезались резко)
            const fadeZone = 70;
            let edgeFade = 1.0;
            if (x < fadeZone) edgeFade *= x / fadeZone;
            if (x > width - fadeZone) edgeFade *= (width - x) / fadeZone;
            if (y < fadeZone) edgeFade *= y / fadeZone;
            if (y > height - fadeZone) edgeFade *= (height - y) / fadeZone;
            
            // Если частица слишком далеко — респавним
            if (edgeFade <= 0.05 || x < -200 || x > width + 200 || y < -200 || y > height + 200) {
                respawnParticle(p, nowSec);
                // Пересчитываем координаты после респавна
                offsetX = Math.sin(p.angleX + nowSec * p.speedX) * p.radiusX;
                offsetY = Math.cos(p.angleY + nowSec * p.speedY + p.phase) * p.radiusY;
                x = p.baseX + offsetX;
                y = p.baseY + offsetY;
                edgeFade = 1.0;
            }
            
            // Плавное появление (fade-in)
            let fadeProgress = (nowSec - p.fadeStartTime) / FADE_IN_DURATION;
            if (fadeProgress >= 1.0) {
                p.currentOpacity = p.targetOpacity;
            } else {
                p.currentOpacity = p.targetOpacity * fadeProgress;
            }
            
            const finalOpacity = p.currentOpacity * edgeFade;
            if (finalOpacity <= 0.01) continue;
            
            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            // Используем сохранённый цвет частицы (акцентная гамма)
            ctx.fillStyle = p.color.replace('rgb', 'rgba').replace(')', `, ${finalOpacity})`);
            ctx.fill();
        }
    }
    
    // --- Анимация и управление циклом ---
    function animate(nowMs) {
        if (!animationId) return;
        // Используем реальное время для плавности движения и fade-in
        const nowSec = performance.now() / 1000;
        drawParticles(nowSec);
        animationId = requestAnimationFrame(animate);
    }
    
    function startAnimation() {
        if (animationId) cancelAnimationFrame(animationId);
        animationId = requestAnimationFrame(animate);
    }
    
    function stopAnimation() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }
    
    function handleVisibilityChange() {
        if (document.hidden) {
            if (animationId) cancelAnimationFrame(animationId);
            animationId = null;
        } else {
            if (!animationId) startAnimation();
        }
    }
    
    // --- Очистка при выгрузке страницы ---
    window.addEventListener('beforeunload', () => {
        if (addInterval) clearInterval(addInterval);
        if (animationId) cancelAnimationFrame(animationId);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    });
    
    // --- Запуск после загрузки DOM ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCanvas);
    } else {
        initCanvas();
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
})();