(function () {
    'use strict';

    const PLAYER_URL = chrome.runtime.getURL('player.html');
    let isFetchingPlayer = false;

    // ─── Хранилище (chrome.storage.local) ────────────────────────────────────
    const Store = {
        async get(key, fallback) {
            return new Promise(resolve => {
                chrome.storage.local.get([key], result => {
                    resolve(result[key] !== undefined ? result[key] : fallback);
                });
            });
        },
        set(key, value) {
            return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
        }
    };

    // ─── Профиль пользователя с сайта ────────────────────────────────────────
    function getPepeLandUserProfile() {
        const userAvatarImg = document.querySelector('header img, nav img');
        let userName = null;
        const ignored = ['Главная', 'О сервере', 'Правила', 'Вики', 'PPL FM',
            '0 токенов', '0', 'Личный кабинет', 'Аккаунт', 'Выйти из аккаунта', 'Вход'];

        for (let el of document.querySelectorAll('header span, header div, header p')) {
            const text = el.textContent.trim();
            if (text && text.length >= 2 && text.length <= 25 && !ignored.includes(text)) {
                userName = text;
                break;
            }
        }
        return {
            isLoggedIn: !!userAvatarImg,
            name: userName || 'Гость PepeLand',
            avatar: userAvatarImg ? userAvatarImg.src : null
        };
    }

    // ─── Вкладка PPL FM в шапке сайта ────────────────────────────────────────
    function injectPplFmTab() {
        if (document.getElementById('ppl-fm-tab')) return;
        const links = document.querySelectorAll('header a');
        let wikiLink = null;
        for (let link of links) {
            const text = link.textContent.trim();
            const href = link.getAttribute('href') || '';
            if (text === 'Вики' || href.includes('/wiki')) { wikiLink = link; break; }
        }
        if (!wikiLink) return;

        const tab = document.createElement('a');
        tab.id = 'ppl-fm-tab';
        tab.className = wikiLink.className || 'group flex h-full items-center px-1.5 cursor-pointer';
        tab.href = '#ppl-fm';
        tab.innerHTML = `<div class="flex rounded-lg transition group-hover:bg-white/10 px-2.5 py-2 text-sm font-medium text-zinc-300 hover:text-white">PPL FM</div>`;
        wikiLink.insertAdjacentElement('afterend', tab);
        tab.addEventListener('click', e => { e.preventDefault(); window.location.hash = 'ppl-fm'; checkRoute(); });
    }

    function updateHeaderTabs() {
        const tab = document.getElementById('ppl-fm-tab');
        if (!tab) return;
        const inner = tab.querySelector('div');
        if (!inner) return;
        if (window.location.hash === '#ppl-fm') {
            inner.classList.remove('text-zinc-300', 'text-white');
            inner.classList.add('text-teal-400');
            document.querySelectorAll('header a').forEach(link => {
                if (link !== tab) link.querySelectorAll('*').forEach(el => {
                    el.classList.remove('text-teal-400', 'text-emerald-400');
                });
            });
        } else {
            inner.classList.remove('text-teal-400');
            inner.classList.add('text-zinc-300');
        }
    }

    // ─── Показ / скрытие плеера ───────────────────────────────────────────────
    async function showPlayer() {
        const main = document.querySelector('main') || document.querySelector('#__next');
        if (!main) return;

        let root = document.getElementById('ppl-fm-player-root');

        if (!root && !isFetchingPlayer) {
            isFetchingPlayer = true;
            try {
                const html = await (await fetch(PLAYER_URL)).text();
                root = document.getElementById('ppl-fm-player-root');
                if (!root) {
                    root = document.createElement('div');
                    root.id = 'ppl-fm-player-root';
                    root.style.cssText = 'width:100%;display:flex;flex-direction:column;flex:1;min-height:80vh;';
                    root.innerHTML = html;
                    main.appendChild(root);
                    await initPlayerEvents(root);
                }
            } catch (e) {
                console.error('PPL FM: не удалось загрузить плеер', e);
            } finally {
                isFetchingPlayer = false;
            }
        } else if (root && root.parentElement !== main) {
            main.appendChild(root);
        }

        if (root) root.style.display = 'flex';
        Array.from(main.children).forEach(c => { if (c.id !== 'ppl-fm-player-root') c.style.display = 'none'; });
    }

    function hidePlayer() {
        const root = document.getElementById('ppl-fm-player-root');
        if (root) root.style.display = 'none';
        const main = document.querySelector('main') || document.querySelector('#__next');
        if (main) Array.from(main.children).forEach(c => { if (c.id !== 'ppl-fm-player-root' && c.style.display === 'none') c.style.display = ''; });
    }

    function checkRoute() {
        if (window.location.hash === '#ppl-fm') showPlayer(); else hidePlayer();
        updateHeaderTabs();
    }

    // ─── Инициализация событий плеера ────────────────────────────────────────
    async function initPlayerEvents(el) {
        if (!el) return;

        // --- Вкладки внутри плеера ---
        const tabs = el.querySelectorAll('.ppl-tab-btn');
        tabs.forEach(btn => {
            btn.onclick = () => {
                const name = btn.getAttribute('data-tab');
                el.querySelectorAll('.ppl-tab-content').forEach(t => t.style.display = 'none');
                tabs.forEach(b => { b.style.backgroundColor = 'transparent'; b.style.color = '#a1a1aa'; });
                const target = el.querySelector('#tab-' + name);
                if (target) target.style.display = name === 'player' ? 'grid' : 'block';
                btn.style.backgroundColor = '#14b8a6';
                btn.style.color = '#09090b';
                if (name === 'news') loadNews(el);
                if (name === 'profile') loadProfileData(el);
                if (name === 'admin') initAdminPanel(el);
            };
        });

        // --- Play / Pause ---
        const playBtn = el.querySelector('#playBtn');
        const audio = el.querySelector('#audioStream');
        const playIcon = el.querySelector('#playIcon');
        const pauseIcon = el.querySelector('#pauseIcon');
        const equalizer = el.querySelector('#equalizer');
        const statusText = el.querySelector('#status-text');
        const volSlider = el.querySelector('#volumeSlider');
        const volLabel = el.querySelector('#volumeLabel');

        // Загружаем сохранённые настройки эфира
        const streamCfg = await Store.get('ppl_stream', {
            url: 'https://your-radio-stream-url.com/stream',
            bitrate: '128 kbps',
            format: 'Stereo / Live',
            freq: '104.7 FM',
            online: true
        });

        // Применяем настройки в UI
        const freqEl = el.querySelector('#stream-freq');
        const bitrateEl = el.querySelector('#stream-bitrate');
        const formatEl = el.querySelector('#info-format');
        const bitrateInfoEl = el.querySelector('#info-bitrate');
        const statusDot = el.querySelector('#stream-status-dot');
        const statusBadge = el.querySelector('#stream-status-badge');
        const streamOnlineEl = el.querySelector('#info-status');

        if (freqEl) freqEl.textContent = `${streamCfg.freq} · ${streamCfg.bitrate}`;
        if (bitrateEl) bitrateEl.textContent = streamCfg.bitrate;
        if (formatEl) formatEl.textContent = streamCfg.format;
        if (bitrateInfoEl) bitrateInfoEl.textContent = streamCfg.bitrate;
        if (streamOnlineEl) streamOnlineEl.textContent = streamCfg.online ? 'Вещание идет' : 'Офлайн';
        if (statusDot) statusDot.style.backgroundColor = streamCfg.online ? '#ef4444' : '#71717a';
        if (statusBadge) statusBadge.style.color = streamCfg.online ? '#f87171' : '#71717a';

        // Громкость
        const savedVol = await Store.get('ppl_volume', 80);
        if (volSlider) {
            volSlider.value = savedVol;
            if (audio) audio.volume = savedVol / 100;
            if (volLabel) volLabel.textContent = savedVol + '%';
            volSlider.oninput = () => {
                const v = parseInt(volSlider.value);
                if (audio) audio.volume = v / 100;
                if (volLabel) volLabel.textContent = v + '%';
                Store.set('ppl_volume', v);
            };
        }

        // Обновляем src аудио из настроек
        if (audio) {
            const src = el.querySelector('#audioStream source');
            if (src) src.src = streamCfg.url;
        }

        if (playBtn && !playBtn.dataset.init) {
            playBtn.dataset.init = 'true';
            let isPlaying = false;

            function updateState() {
                playIcon.style.display = isPlaying ? 'none' : 'block';
                pauseIcon.style.display = isPlaying ? 'block' : 'none';
                if (equalizer) equalizer.style.opacity = isPlaying ? '1' : '0.4';
            }

            playBtn.onclick = () => {
                if (!streamCfg.online) {
                    if (statusText) statusText.textContent = 'Эфир сейчас недоступен';
                    return;
                }
                if (!isPlaying) {
                    audio.load();
                    audio.play()
                        .then(() => { isPlaying = true; updateState(); if (statusText) statusText.textContent = 'Эфир воспроизводится'; })
                        .catch(() => { isPlaying = true; updateState(); if (statusText) statusText.textContent = 'Эфир воспроизводится (Демо)'; });
                } else {
                    audio.pause();
                    isPlaying = false;
                    updateState();
                    if (statusText) statusText.textContent = 'Прямой эфир радиостанции PepeLand';
                }
            };
        }
    }

    // ─── Профиль ──────────────────────────────────────────────────────────────
    function loadProfileData(el) {
        if (!el) return;
        const user = getPepeLandUserProfile();
        const nameEl = el.querySelector('#profile-name');
        const statusEl = el.querySelector('#profile-status');
        const avatarImg = el.querySelector('#profile-avatar-img');
        const logoFallback = el.querySelector('#profile-logo-fallback');
        const actionsEl = el.querySelector('#profile-actions');

        if (logoFallback) logoFallback.src = chrome.runtime.getURL('ppl-only-logo-dark.png');
        if (nameEl) nameEl.textContent = user.name;

        if (user.isLoggedIn) {
            if (statusEl) statusEl.textContent = 'Сессия активна · Подключено к PepeLand';
            if (user.avatar && avatarImg && logoFallback) {
                avatarImg.src = user.avatar;
                avatarImg.style.display = 'block';
                logoFallback.style.display = 'none';
            }
            if (actionsEl) actionsEl.innerHTML = `<span style="font-size:12px;color:#2dd4bf;background:rgba(20,184,166,0.1);padding:8px 16px;border-radius:10px;border:1px solid rgba(20,184,166,0.2);font-weight:600;">✓ Аккаунт верифицирован</span>`;
        } else {
            if (statusEl) statusEl.textContent = 'Войдите на сайте PepeLand, чтобы синхронизировать профиль';
            if (actionsEl) actionsEl.innerHTML = `<a href="https://pepeland.net/auth" target="_blank" style="display:inline-block;background:#14b8a6;color:#09090b;font-weight:700;padding:10px 24px;border-radius:12px;font-size:14px;text-decoration:none;">Войти на сайт</a>`;
        }
    }

    // ─── Лента новостей ───────────────────────────────────────────────────────
    async function loadNews(el) {
        if (!el) return;
        const container = el.querySelector('#news-container');
        if (!container) return;
        try {
            // Сначала пробуем сохранённые в storage новости (добавленные через админку)
            const stored = await Store.get('ppl_news', null);
            const news = stored || await (await fetch(chrome.runtime.getURL('news.json'))).json();
            renderNews(container, news);
        } catch (e) {
            container.innerHTML = `<p style="font-size:14px;color:#71717a;">Не удалось загрузить ленту.</p>`;
        }
    }

    function renderNews(container, news) {
        if (!news || !news.length) {
            container.innerHTML = `<p style="font-size:14px;color:#71717a;text-align:center;padding:32px 0;">Нет выпусков.</p>`;
            return;
        }
        container.innerHTML = news.map(item => `
            <div style="padding:20px;border-radius:16px;background:rgba(24,24,27,0.7);border:1px solid rgba(255,255,255,0.1);display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#71717a;font-family:monospace;">
                    <span>${item.date}</span>
                    <span style="background:rgba(20,184,166,0.1);color:#2dd4bf;padding:2px 8px;border-radius:4px;border:1px solid rgba(20,184,166,0.2);">Подкаст</span>
                </div>
                <h3 style="font-weight:700;font-size:18px;color:#fff;margin:0;">${item.title}</h3>
                <p style="font-size:14px;color:#a1a1aa;margin:0;">${item.description}</p>
                <a href="${item.audioUrl}" target="_blank" style="margin-top:8px;display:inline-flex;align-items:center;gap:8px;color:#2dd4bf;text-decoration:none;font-size:14px;font-weight:600;">▶ Слушать выпуск</a>
            </div>
        `).join('');
    }

    // ─── Админ-панель ─────────────────────────────────────────────────────────
    async function initAdminPanel(el) {
        const panel = el.querySelector('#admin-panel');
        if (!panel || panel.dataset.init) return;
        panel.dataset.init = 'true';

        // Загружаем текущие данные
        const streamCfg = await Store.get('ppl_stream', {
            url: 'https://your-radio-stream-url.com/stream',
            bitrate: '128 kbps',
            format: 'Stereo / Live',
            freq: '104.7 FM',
            online: true
        });
        const defaultNews = await (await fetch(chrome.runtime.getURL('news.json'))).json().catch(() => []);
        let news = await Store.get('ppl_news', defaultNews);

        // ── Вкладки внутри панели ──
        const adminTabBtns = panel.querySelectorAll('.admin-tab-btn');
        const adminTabContents = panel.querySelectorAll('.admin-tab-content');

        function switchAdminTab(name) {
            adminTabContents.forEach(t => t.style.display = 'none');
            adminTabBtns.forEach(b => {
                b.style.background = 'transparent';
                b.style.color = '#a1a1aa';
            });
            const target = panel.querySelector('#admin-tab-' + name);
            if (target) target.style.display = 'block';
            const activeBtn = panel.querySelector(`.admin-tab-btn[data-admin-tab="${name}"]`);
            if (activeBtn) { activeBtn.style.background = '#14b8a6'; activeBtn.style.color = '#09090b'; }
        }

        adminTabBtns.forEach(btn => {
            btn.onclick = () => switchAdminTab(btn.getAttribute('data-admin-tab'));
        });
        switchAdminTab('stream');

        // ── Flash-уведомление ──
        const flash = panel.querySelector('#admin-flash');
        function showFlash(msg, ok = true) {
            if (!flash) return;
            flash.textContent = msg;
            flash.style.display = 'block';
            flash.style.background = ok ? 'rgba(20,184,166,0.15)' : 'rgba(239,68,68,0.15)';
            flash.style.color = ok ? '#2dd4bf' : '#f87171';
            flash.style.border = ok ? '1px solid rgba(20,184,166,0.3)' : '1px solid rgba(239,68,68,0.3)';
            setTimeout(() => { flash.style.display = 'none'; }, 2500);
        }

        // ══ STREAM TAB ══
        const urlInput = panel.querySelector('#admin-stream-url');
        const freqInput = panel.querySelector('#admin-stream-freq');
        const bitrateInput = panel.querySelector('#admin-stream-bitrate');
        const formatInput = panel.querySelector('#admin-stream-format');
        const onlineToggle = panel.querySelector('#admin-stream-online');
        const saveStreamBtn = panel.querySelector('#admin-save-stream');

        if (urlInput) urlInput.value = streamCfg.url;
        if (freqInput) freqInput.value = streamCfg.freq;
        if (bitrateInput) bitrateInput.value = streamCfg.bitrate;
        if (formatInput) formatInput.value = streamCfg.format;

        function updateOnlineBtn(val) {
            if (!onlineToggle) return;
            onlineToggle.textContent = val ? '🟢 Онлайн' : '🔴 Офлайн';
            onlineToggle.style.background = val ? 'rgba(20,184,166,0.15)' : 'rgba(239,68,68,0.15)';
            onlineToggle.style.color = val ? '#2dd4bf' : '#f87171';
            onlineToggle.dataset.online = val ? '1' : '0';
        }
        updateOnlineBtn(streamCfg.online);

        if (onlineToggle) onlineToggle.onclick = () => updateOnlineBtn(onlineToggle.dataset.online !== '1');

        if (saveStreamBtn) saveStreamBtn.onclick = async () => {
            const newCfg = {
                url: urlInput ? urlInput.value.trim() : streamCfg.url,
                freq: freqInput ? freqInput.value.trim() : streamCfg.freq,
                bitrate: bitrateInput ? bitrateInput.value.trim() : streamCfg.bitrate,
                format: formatInput ? formatInput.value.trim() : streamCfg.format,
                online: onlineToggle ? onlineToggle.dataset.online === '1' : streamCfg.online,
            };
            await Store.set('ppl_stream', newCfg);

            // Обновляем UI плеера без перезагрузки
            const root = el;
            const freqEl = root.querySelector('#stream-freq');
            const statusDot = root.querySelector('#stream-status-dot');
            const streamOnlineEl = root.querySelector('#info-status');
            const bitrateInfoEl = root.querySelector('#info-bitrate');
            const formatInfoEl = root.querySelector('#info-format');
            const audioSrc = root.querySelector('#audioStream source');

            if (freqEl) freqEl.textContent = `${newCfg.freq} · ${newCfg.bitrate}`;
            if (statusDot) statusDot.style.backgroundColor = newCfg.online ? '#ef4444' : '#71717a';
            if (streamOnlineEl) streamOnlineEl.textContent = newCfg.online ? 'Вещание идет' : 'Офлайн';
            if (bitrateInfoEl) bitrateInfoEl.textContent = newCfg.bitrate;
            if (formatInfoEl) formatInfoEl.textContent = newCfg.format;
            if (audioSrc) audioSrc.src = newCfg.url;

            showFlash('Настройки эфира сохранены ✓');
        };

        // ══ PODCASTS TAB ══
        const podTitle = panel.querySelector('#admin-pod-title');
        const podDesc = panel.querySelector('#admin-pod-desc');
        const podUrl = panel.querySelector('#admin-pod-url');
        const podDate = panel.querySelector('#admin-pod-date');
        const addPodBtn = panel.querySelector('#admin-add-pod');
        const podList = panel.querySelector('#admin-pod-list');

        if (podDate) podDate.value = new Date().toISOString().slice(0, 10);

        function renderAdminPodList() {
            if (!podList) return;
            if (!news.length) { podList.innerHTML = `<p style="color:#71717a;font-size:13px;">Нет выпусков.</p>`; return; }
            podList.innerHTML = news.map((item, i) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);margin-bottom:8px;">
                    <div>
                        <div style="font-size:14px;font-weight:700;color:#fff;">${item.title}</div>
                        <div style="font-size:12px;color:#71717a;font-family:monospace;margin-top:2px;">${item.date}</div>
                    </div>
                    <button data-idx="${i}" class="admin-del-pod" style="padding:5px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;background:rgba(239,68,68,0.12);color:#f87171;">Удалить</button>
                </div>
            `).join('');
            podList.querySelectorAll('.admin-del-pod').forEach(btn => {
                btn.onclick = async () => {
                    const idx = parseInt(btn.dataset.idx);
                    news.splice(idx, 1);
                    await Store.set('ppl_news', news);
                    renderAdminPodList();
                    showFlash('Выпуск удалён');
                };
            });
        }
        renderAdminPodList();

        if (addPodBtn) addPodBtn.onclick = async () => {
            const title = podTitle ? podTitle.value.trim() : '';
            if (!title) { showFlash('Введите название выпуска', false); return; }
            const item = {
                id: Date.now(),
                title,
                description: podDesc ? podDesc.value.trim() : '',
                audioUrl: podUrl ? podUrl.value.trim() : '',
                date: podDate ? podDate.value : new Date().toISOString().slice(0, 10),
            };
            news.unshift(item);
            await Store.set('ppl_news', news);
            renderAdminPodList();
            if (podTitle) podTitle.value = '';
            if (podDesc) podDesc.value = '';
            if (podUrl) podUrl.value = '';
            showFlash('Подкаст добавлен ✓');
        };

        // ══ STATS TAB ══
        const vol = await Store.get('ppl_volume', 80);
        const statsEl = panel.querySelector('#admin-stats');
        if (statsEl) statsEl.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                ${[
                    ['Подкастов в ленте', news.length],
                    ['Громкость', vol + '%'],
                    ['Статус эфира', streamCfg.online ? '🟢 Онлайн' : '🔴 Офлайн'],
                    ['Версия расширения', '1.3'],
                ].map(([label, val]) => `
                    <div style="padding:16px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);">
                        <div style="font-size:12px;color:#71717a;margin-bottom:6px;">${label}</div>
                        <div style="font-size:20px;font-weight:800;color:#fff;">${val}</div>
                    </div>
                `).join('')}
            </div>
        `;

        // Кнопка сброса
        const resetBtn = panel.querySelector('#admin-reset');
        if (resetBtn) resetBtn.onclick = async () => {
            if (!confirm('Сбросить все настройки PPL FM?')) return;
            await Promise.all(['ppl_stream', 'ppl_news', 'ppl_volume'].map(k => Store.set(k, null)));
            showFlash('Настройки сброшены. Перезагрузите страницу.');
        };
    }

    // ─── Роутинг ──────────────────────────────────────────────────────────────
    window.addEventListener('hashchange', checkRoute);
    window.addEventListener('popstate', checkRoute);
    document.addEventListener('click', () => setTimeout(checkRoute, 100));

    const observer = new MutationObserver(() => { injectPplFmTab(); checkRoute(); });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => { injectPplFmTab(); checkRoute(); }, 200);
})();