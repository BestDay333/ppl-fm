(function() {
    let playerElement = null;

    // Ссылка на твой хостинг в Cloudflare Pages (куда падает код из GitHub)
    const PAGES_URL = 'https://ppl-fm.pages.dev/player.html';

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
        });

        links.forEach(link => {
            if (link !== pplFmWrapper) {
                link.addEventListener('click', () => {
                    if (window.location.hash === '#ppl-fm') {
                        window.location.hash = '';
                    }
                });
            }
        });
    }

    function handleRouting() {
        const pplFmTab = document.getElementById('ppl-fm-tab');
        if (window.location.hash === '#ppl-fm') {
            showPlayer();
            if (pplFmTab) setActiveTab(pplFmTab);
        } else {
            hidePlayer();
        }
    }

    function setActiveTab(activeTab) {
        document.querySelectorAll('header nav a div, header a div').forEach(div => {
            div.classList.remove('text-teal-400');
            div.classList.add('text-zinc-300');
        });
        const inner = activeTab.querySelector('div');
        if (inner) {
            inner.classList.remove('text-zinc-300');
            inner.classList.add('text-teal-400');
        }
    }

    async function showPlayer() {
        const mainContainer = document.querySelector('main') || document.querySelector('#__next');
        if (!mainContainer) return;

        // Скрываем стандартный контент сайта (чтобы не ломать React)
        Array.from(mainContainer.children).forEach(child => {
            if (child.id !== 'ppl-fm-player-root') {
                child.style.display = 'none';
            }
        });

        try {
            // Подтягиваем свежий плеер из Cloudflare Pages (автоматически из GitHub)
            const res = await fetch(PAGES_URL);
            const html = await res.text();

            if (!playerElement) {
                playerElement = document.createElement('div');
                playerElement.id = 'ppl-fm-player-root';
                playerElement.style.cssText = 'width: 100%; display: flex; flex-direction: column; flex: 1;';
                mainContainer.appendChild(playerElement);
            }

            playerElement.innerHTML = html;
            playerElement.style.display = 'flex';
            initPlayerLogic();
        } catch (e) {
            console.error('Не удалось загрузить плеер с Cloudflare Pages:', e);
        }
    }

    function hidePlayer() {
        if (playerElement) {
            playerElement.style.display = 'none';
        }
        
        const mainContainer = document.querySelector('main') || document.querySelector('#__next');
        if (mainContainer) {
            Array.from(mainContainer.children).forEach(child => {
                if (child.id !== 'ppl-fm-player-root') {
                    child.style.display = '';
                }
            });
        }

        document.querySelectorAll('header nav a div, header a div').forEach(div => {
            if (div.textContent.trim() === 'PPL FM') {
                div.classList.remove('text-teal-400');
                div.classList.add('text-zinc-300');
            }
        });
    }

    function initPlayerLogic() {
        const playBtn = document.getElementById('playBtn');
        const audioStream = document.getElementById('audioStream');
        const playIcon = document.getElementById('playIcon');
        const pauseIcon = document.getElementById('pauseIcon');
        const equalizer = document.getElementById('equalizer');
        const statusText = document.getElementById('status-text');

        if (!playBtn) return;

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
                if (playIcon) playIcon.classList.add('hidden');
                if (pauseIcon) pauseIcon.classList.remove('hidden');
                if (equalizer) {
                    equalizer.classList.remove('opacity-40');
                    Array.from(equalizer.children).forEach(bar => {
                        bar.style.animation = 'pulse 0.8s infinite alternate';
                    });
                }
            } else {
                if (playIcon) playIcon.classList.remove('hidden');
                if (pauseIcon) pauseIcon.classList.add('hidden');
                if (equalizer) {
                    equalizer.classList.add('opacity-40');
                    Array.from(equalizer.children).forEach(bar => {
                        bar.style.animation = 'none';
                        bar.style.height = '12px';
                    });
                }
            }
        }
    }

    window.addEventListener('hashchange', handleRouting);

    const observer = new MutationObserver(() => {
        injectPplFmTab();
        if (window.location.hash === '#ppl-fm') {
            const pplFmTab = document.getElementById('ppl-fm-tab');
            if (pplFmTab) setActiveTab(pplFmTab);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        injectPplFmTab();
        handleRouting();
    }, 300);
})();