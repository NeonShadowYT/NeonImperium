// js/features/performance-test.js – тест производительности со спидометром
(function() {
    // Селектор, куда монтируем
    const SECTION_SELECTOR = '#requirements-section-new';

    // Ключ для хранения результатов в sessionStorage
    const RESULT_KEY = 'perf_test_result';

    // Настройки
    const TEST_DURATION_MS = 2000; // длительность замера

    // ---------- Утилиты ----------
    function createElement(tag, cls, styles = {}, attrs = {}) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        Object.assign(el.style, styles);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    // ---------- Benchmark ----------
    function runBenchmark() {
        return new Promise(resolve => {
            let frameCount = 0;
            let startTime = performance.now();
            let lastFrameTime = startTime;
            let stopped = false;

            function loop() {
                if (stopped) return;
                frameCount++;
                const now = performance.now();
                const elapsed = now - startTime;

                if (elapsed >= TEST_DURATION_MS) {
                    stopped = true;
                    const avgFPS = Math.round((frameCount / elapsed) * 1000);
                    resolve(avgFPS);
                } else {
                    requestAnimationFrame(loop);
                }
            }
            requestAnimationFrame(loop);
        });
    }

    // ---------- Рисование спидометра ----------
    function drawGauge(canvas, fps) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.clientWidth;
        const height = canvas.height = canvas.clientHeight;
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.4;

        ctx.clearRect(0, 0, width, height);

        // Фоновая дуга (серая)
        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
        ctx.lineWidth = 12;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.stroke();

        // Цветная дуга (зависит от fps)
        const maxFps = 144;
        const angle = Math.PI + (Math.PI * Math.min(fps / maxFps, 1));
        const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
        if (fps >= 120) {
            gradient.addColorStop(0, '#00e676');
            gradient.addColorStop(1, '#64ffda');
        } else if (fps >= 60) {
            gradient.addColorStop(0, '#ffeb3b');
            gradient.addColorStop(1, '#fdd835');
        } else if (fps >= 30) {
            gradient.addColorStop(0, '#ff9800');
            gradient.addColorStop(1, '#ffb74d');
        } else {
            gradient.addColorStop(0, '#f44336');
            gradient.addColorStop(1, '#ef5350');
        }

        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI, angle);
        ctx.lineWidth = 12;
        ctx.strokeStyle = gradient;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Текст в центре
        ctx.font = 'bold 48px "Russo One", sans-serif';
        ctx.fillStyle = 'var(--text-primary)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fps, cx, cy - 10);

        ctx.font = '16px "Russo One", sans-serif';
        ctx.fillStyle = 'var(--text-secondary)';
        ctx.fillText('FPS', cx, cy + 30);
    }

    // ---------- Построение UI ----------
    function buildUI(container) {
        // Очищаем секцию
        container.innerHTML = '';

        const cardHTML = `
            <h2 data-lang="requirementsTitle">Тест производительности</h2>
            <p class="text-secondary">Измерьте реальную частоту кадров вашего устройства</p>
            <div class="performance-gauge-wrapper">
                <canvas id="perf-gauge" width="300" height="300"></canvas>
            </div>
            <div class="performance-actions">
                <button id="run-perf-test" class="button"><i class="fas fa-play"></i> Запустить тест</button>
                <span id="perf-result-text" class="text-secondary"></span>
            </div>
            <p class="text-secondary" style="margin-top: 10px; font-size: 12px;">
                Тест длится ${TEST_DURATION_MS/1000} сек. и измеряет средний FPS.
            </p>
        `;
        container.innerHTML = cardHTML;

        const canvas = document.getElementById('perf-gauge');
        const runBtn = document.getElementById('run-perf-test');
        const resultText = document.getElementById('perf-result-text');

        // Показать сохранённый результат, если есть
        const saved = sessionStorage.getItem(RESULT_KEY);
        if (saved) {
            const fps = parseInt(saved, 10);
            drawGauge(canvas, fps);
            resultText.textContent = `Средний FPS: ${fps}`;
            runBtn.innerHTML = '<i class="fas fa-redo"></i> Повторить';
        } else {
            // Отрисовка пустого gauge
            drawGauge(canvas, 0);
        }

        runBtn.addEventListener('click', async () => {
            runBtn.disabled = true;
            runBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Тестируем...';

            try {
                const fps = await runBenchmark();
                sessionStorage.setItem(RESULT_KEY, fps);
                drawGauge(canvas, fps);
                resultText.textContent = `Средний FPS: ${fps}`;
                runBtn.innerHTML = '<i class="fas fa-redo"></i> Повторить';
            } catch (e) {
                resultText.textContent = 'Ошибка теста';
            } finally {
                runBtn.disabled = false;
            }
        });
    }

    // Инициализация при загрузке страницы
    document.addEventListener('DOMContentLoaded', () => {
        const section = document.querySelector(SECTION_SELECTOR);
        if (!section) return;

        buildUI(section);

        // Добавим минимальные стили для центрирования
        const style = document.createElement('style');
        style.textContent = `
            .performance-gauge-wrapper {
                text-align: center;
                margin: 10px 0;
            }
            .performance-actions {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 15px;
                margin-top: 10px;
                flex-wrap: wrap;
            }
            #perf-result-text {
                font-family: 'Russo One', sans-serif;
                font-size: 16px;
                color: var(--accent);
            }
        `;
        document.head.appendChild(style);
    });
})();