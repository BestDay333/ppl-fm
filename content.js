(function() {
    const PAGES_URL = chrome.runtime.getURL('player.html');
    let isFetchingPlayer = false;

    function getPepeLandUserProfile() {
        const userAvatarImg = document.querySelector('header img, nav img');
        let userName = null;

        const potentialTexts = document.querySelectorAll('header span, header div, header p');
        for (let el of potentialTexts) {
            const text = el.textContent.trim();
            if (text && text.length >= 2 && text.length <= 25) {
                if (!['Главная', 'О сервере', 'Правила', 'Вики', 'PPL FM', '0 токенов', '0', 'Личный кабинет', 'Аккаунт', 'Выйти из аккаунта', 'Вход'].includes(text)) {
                    userName = text;
                    break;
                }
            }
        }

        const avatarSrc = userAvatarImg ? userAvatarImg.src : null;
        const isAuth = !!userAvatarImg;

        return {
            isLoggedIn: isAuth,
            name: userName || 'BestDay_',
            avatar: avatarSrc
        };
    }

    function injectPplFmTab() {
        if (document.getElementById('ppl-fm-tab')) return;

        const links = document.querySelectorAll('header a');
        let wikiLink = null;

        for (let link of links) {
            const text = link.textContent.trim();
            const href = link.getAttribute('href') || '';
            if (text === 'Вики' || href.includes('/wiki')) {
                wikiLink = link;
                break;
            }
        }

        if (!wikiLink) return;

        const pplFmWrapper = document.createElement('a');
        pplFmWrapper.id = 'ppl-fm-tab';
        pplFmWrapper.className = wikiLink.className || "group flex h-full items-center px-1.5 cursor-pointer";
        pplFmWrapper.href = "#ppl-fm";

        pplFmWrapper.innerHTML = `
            <div class="flex rounded-lg transition group-hover:bg-white/10 px-2.5 py-2 text-sm font-medium text-zinc-300 hover:text-white">
                PPL FM
            </div>
        `;

        wikiLink.insertAdjacentElement('afterend', pplFmWrapper);

        pplFmWrapper.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.hash = 'ppl-fm';
            checkRoute();
        });
    }

    function updateHeaderTabs() {
        const pplFmTab = document.getElementById('ppl-fm-tab');
        if (!pplFmTab) return;

        const inner = pplFmTab.querySelector('div');
        if (!inner) return;

        const allHeaderLinks = document.querySelectorAll('header a');

        if (window.location.hash === '#ppl-fm') {
            // PPL FM горит зелёным
            inner.classList.remove('text-zinc-300', 'text-white');
            inner.classList.add('text-teal-400');

            // Принудительно убираем зелёный цвет с остальных кнопок шапки
            allHeaderLinks.forEach(link => {
                if (link !== pplFmTab) {
                    link.classList.remove('text-teal-400', 'text-emerald-400');
                    link.querySelectorAll('*').forEach(el => {
                        el.classList.remove('text-teal-400', 'text-emerald-400');
                        if (el.classList.contains('text-teal-400')) {
                            el.classList.replace('text-teal-400', 'text-zinc-300');
                        }
                    });
                }
            });
        } else {
            inner.classList.remove('text-teal-400');
            inner.classList.add('text-zinc-300');
        }
    }

    async function showPlayer() {
        const mainContainer = document.querySelector('main') || document.querySelector('#__next');
        if (!mainContainer) return;

        let playerRoot = document.getElementById('ppl-fm-player-root');

        if (!playerRoot && !isFetchingPlayer) {
            isFetchingPlayer = true;
            try {
                const res = await fetch(PAGES_URL);
                const html = await res.text();

                playerRoot = document.getElementById('ppl-fm-player-root');
                if (!playerRoot) {
                    playerRoot = document.createElement('div');
                    playerRoot.id = 'ppl-fm-player-root';
                    playerRoot.style.cssText = 'width: 100%; display: flex; flex-direction: column; flex: 1; min-height: 80vh;';
                    playerRoot.innerHTML = html;
                    mainContainer.appendChild(playerRoot);
                    initPlayerEvents(playerRoot);
                }
            } catch (e) {
                console.error('Не удалось загрузить плеер PPL FM:', e);
            } finally {
                isFetchingPlayer = false;
            }
        } else if (playerRoot && playerRoot.parentElement !== mainContainer) {
            mainContainer.appendChild(playerRoot);
        }

        if (playerRoot) {
            playerRoot.style.display = 'flex';
        }

        Array.from(mainContainer.children).forEach(child => {
            if (child.id !== 'ppl-fm-player-root') {
                child.style.display = 'none';
            }
        });
    }

    function hidePlayer() {
        const playerRoot = document.getElementById('ppl-fm-player-root');
        if (playerRoot) {
            playerRoot.style.display = 'none';
        }

        const mainContainer = document.querySelector('main') || document.querySelector('#__next');
        if (mainContainer) {
            Array.from(mainContainer.children).forEach(child => {
                if (child.id !== 'ppl-fm-player-root') {
                    if (child.style.display === 'none') {
                        child.style.display = '';
                    }
                }
            });
        }
    }

    function checkRoute() {
        if (window.location.hash === '#ppl-fm') {
            showPlayer();
        } else {
            hidePlayer();
        }
        updateHeaderTabs();
    }

    function initPlayerEvents(playerElement) {
        if (!playerElement) return;
        const buttons = playerElement.querySelectorAll('.ppl-tab-btn');
        buttons.forEach(btn => {
            btn.onclick = () => {
                const tabName = btn.getAttribute('data-tab');
                
                playerElement.querySelectorAll('.ppl-tab-content').forEach(el => el.style.display = 'none');
                buttons.forEach(b => {
                    b.style.backgroundColor = 'transparent';
                    b.style.color = '#a1a1aa';
                });

                const targetTab = playerElement.querySelector('#tab-' + tabName);
                if (targetTab) {
                    targetTab.style.display = tabName === 'player' ? 'grid' : 'block';
                }
                
                btn.style.backgroundColor = '#14b8a6';
                btn.style.color = '#09090b';

                if (tabName === 'news') loadNews(playerElement);
                if (tabName === 'profile') loadProfileData(playerElement);
            };
        });

        const playBtn = playerElement.querySelector('#playBtn');
        const audioStream = playerElement.querySelector('#audioStream');
        const playIcon = playerElement.querySelector('#playIcon');
        const pauseIcon = playerElement.querySelector('#pauseIcon');
        const equalizer = playerElement.querySelector('#equalizer');
        const statusText = playerElement.querySelector('#status-text');

        if (playBtn && !playBtn.dataset.init) {
            playBtn.dataset.init = "true";
            let isPlaying = false;

            playBtn.onclick = () => {
                if (!isPlaying) {
                    audioStream.play().then(() => {
                        isPlaying = true;
                        updateState();
                    }).catch(() => {
                        isPlaying = true;
                        updateState();
                        if (statusText) statusText.textContent = "Эфир воспроизводится (Демо)";
                    });
                } else {
                    audioStream.pause();
                    isPlaying = false;
                    updateState();
                    if (statusText) statusText.textContent = "Прямой эфир радиостанции PepeLand";
                }
            };

            function updateState() {
                if (isPlaying) {
                    playIcon.style.display = 'none';
                    pauseIcon.style.display = 'block';
                    equalizer.style.opacity = '1';
                } else {
                    playIcon.style.display = 'block';
                    pauseIcon.style.display = 'none';
                    equalizer.style.opacity = '0.4';
                }
            }
        }
    }

    function loadProfileData(playerElement) {
        if (!playerElement) return;
        const user = getPepeLandUserProfile();
        
        const nameEl = playerElement.querySelector('#profile-name');
        const statusEl = playerElement.querySelector('#profile-status');
        const avatarImg = playerElement.querySelector('#profile-avatar-img');
        const logoFallback = playerElement.querySelector('#profile-logo-fallback');
        const actionsEl = playerElement.querySelector('#profile-actions');

        if (logoFallback) {
            logoFallback.src = chrome.runtime.getURL('ppl-only-logo-dark.png');
        }

        if (nameEl) nameEl.textContent = user.name;
        
        if (user.isLoggedIn) {
            if (statusEl) statusEl.textContent = "Сессия активна · Подключено к PepeLand";
            if (user.avatar && avatarImg && logoFallback) {
                avatarImg.src = user.avatar;
                avatarImg.style.display = 'block';
                logoFallback.style.display = 'none';
            }
            if (actionsEl) {
                actionsEl.innerHTML = `<span style="font-size: 12px; color: #2dd4bf; background-color: rgba(20, 184, 166, 0.1); padding: 8px 16px; border-radius: 10px; border: 1px solid rgba(20, 184, 166, 0.2); font-weight: 600;">✓ Аккаунт верифицирован</span>`;
            }
        } else {
            if (statusEl) statusEl.textContent = "Войдите на сайте PepeLand, чтобы синхронизировать профиль";
            if (actionsEl) {
                actionsEl.innerHTML = `<a href="https://pepeland.net/auth" target="_blank" style="display: inline-block; background-color: #14b8a6; color: #09090b; font-weight: 700; padding: 10px 24px; border-radius: 12px; font-size: 14px; text-decoration: none;">Войти на сайт</a>`;
            }
        }
    }

    async function loadNews(playerElement) {
        if (!playerElement) return;
        const container = playerElement.querySelector('#news-container');
        if (!container) return;
        try {
            const res = await fetch(chrome.runtime.getURL('news.json'));
            const news = await res.json();
            container.innerHTML = news.map(item => `
                <div style="padding: 20px; border-radius: 16px; background-color: rgba(24, 24, 27, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #71717a; font-family: monospace;">
                        <span>${item.date}</span>
                        <span style="background-color: rgba(20, 184, 166, 0.1); color: #2dd4bf; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(20, 184, 166, 0.2);">Подкаст</span>
                    </div>
                    <h3 style="font-weight: 700; font-size: 18px; color: #ffffff; margin: 0;">${item.title}</h3>
                    <p style="font-size: 14px; color: #a1a1aa; margin: 0;">${item.description}</p>
                    <a href="${item.audioUrl}" target="_blank" style="margin-top: 8px; display: inline-flex; align-items: center; gap: 8px; color: #2dd4bf; text-decoration: none; font-size: 14px; font-weight: 600;">
                        ▶ Слушать выпуск
                    </a>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = `<p style="font-size: 14px; color: #71717a;">Не удалось загрузить ленту новостей.</p>`;
        }
    }

    window.addEventListener('hashchange', checkRoute);
    window.addEventListener('popstate', checkRoute);
    document.addEventListener('click', () => setTimeout(checkRoute, 100));

    const observer = new MutationObserver(() => {
        injectPplFmTab();
        checkRoute();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        injectPplFmTab();
        checkRoute();
    }, 200);
})();