import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const PLAYER_HTML = readFileSync(path.join(root, 'player.html'), 'utf8');
const NEWS = JSON.parse(readFileSync(path.join(root, 'news.json'), 'utf8'));
const CONTENT_CODE = readFileSync(path.join(root, 'content.js'), 'utf8');

let dom;
let document;
let window;
let store = new Map();

function setupDOM(html = '') {
    store = new Map();
    dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
        url: 'http://localhost/',
        runScripts: 'outside-only',
    });
    document = dom.window.document;
    window = dom.window;

    // Mock chrome API — внедряем прямо в window
    window.chrome = {
        runtime: {
            getURL: (p) => `chrome-extension://test/${p}`,
            getManifest: () => ({ version: '1.4.0' }),
        },
        storage: {
            local: {
                get: (keys, cb) => {
                    const list = Array.isArray(keys) ? keys : [keys];
                    const result = {};
                    for (const k of list) if (store.has(k)) result[k] = store.get(k);
                    cb(result);
                },
                set: (items, cb) => {
                    for (const [k, v] of Object.entries(items)) store.set(k, v);
                    cb();
                },
            },
        },
    };

    // Mock fetch — внедряем прямо в window
    window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('player.html')) return { text: async () => PLAYER_HTML };
        if (u.includes('news.json')) return { json: async () => NEWS };
        return { text: async () => '' };
    };

    // Mock HTMLMediaElement
    if (window.HTMLMediaElement) {
        window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
        window.HTMLMediaElement.prototype.pause = function () { return Promise.resolve(); };
        window.HTMLMediaElement.prototype.load = function () {};
    }

    return { document, window, store };
}

function loadContentScript() {
    // Выполняем код в контексте окна
    const script = dom.window.eval(CONTENT_CODE);
    return script;
}

function renderHeader({ loggedIn = false } = {}) {
    const auth = loggedIn
        ? `<img src="https://pepeland.net/avatars/test.png" alt="avatar"><span>TestUser</span>`
        : '';
    document.body.innerHTML = `
        <header>
            <a href="/">Главная</a>
            <a href="/about">О сервере</a>
            <a href="/rules">Правила</a>
            <a href="/wiki">Вики</a>
            ${auth}
        </header>
        <main>
            <div id="other-content">Контент сайта</div>
        </main>
    `;
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const result = fn();
        if (result) return result;
        await wait(20);
    }
    throw new Error('waitFor timed out');
}

async function loadPlayer({ path = '/ppl-fm', loggedIn = false } = {}) {
    renderHeader({ loggedIn });
    window.history.pushState({}, '', path);
    loadContentScript();
    return waitFor(() => document.getElementById('ppl-fm-player-root'));
}

// Тесты
describe('Вкладка PPL FM в шапке', () => {
    beforeEach(() => { ({ store } = setupDOM()); });

    test('инжектится после ссылки Вики', async () => {
        renderHeader();
        loadContentScript();
        await wait(350);
        const tab = document.getElementById('ppl-fm-tab');
        assert.ok(tab, 'Вкладка PPL FM добавлена');
        assert.equal(tab.textContent.trim(), 'PPL FM');
        const wikiLink = [...document.querySelectorAll('header a')].find(a => a.textContent.trim() === 'Вики');
        assert.equal(tab.previousElementSibling, wikiLink, 'Вкладка после Вики');
    });
});

describe('Роутинг', () => {
    beforeEach(() => setupDOM());

    test('показывает плеер по пути /ppl-fm и скрывает контент', async () => {
        const playerRoot = await loadPlayer();
        assert.ok(playerRoot, 'Плеер загружен');
        assert.equal(document.getElementById('other-content').style.display, 'none');
        assert.ok(document.getElementById('playBtn'));
    });

    test('скрывает плеер на других страницах', async () => {
        renderHeader();
        window.history.pushState({}, '', '/');
        loadContentScript();
        await wait(350);
        assert.equal(document.getElementById('ppl-fm-player-root'), null);
    });

    test('снимает подсветку с других вкладок при активной PPL FM', async () => {
        document.body.innerHTML = `
            <header>
                <a href="/">Главная</a>
                <a href="/about" class="text-teal-400 active">О сервере</a>
                <a href="/rules">Правила</a>
                <a href="/wiki">Вики</a>
            </header>
            <main><div id="other-content">Контент сайта</div></main>
        `;
        window.history.pushState({}, '', '/ppl-fm');
        loadContentScript();
        await waitFor(() => document.getElementById('ppl-fm-player-root'));
        const active = [...document.querySelectorAll('header a')].find(a => a.textContent.trim() === 'О сервере');
        assert.equal(active.classList.contains('text-teal-400'), false, 'teal-класс снят');
        assert.equal(active.classList.contains('active'), false, 'active-класс снят');
        const pplTab = document.getElementById('ppl-fm-tab');
        assert.ok(pplTab.querySelector('div').classList.contains('text-teal-400'), 'PPL FM подсвечена');
    });
});

describe('Прямой эфир', () => {
    beforeEach(() => setupDOM());

    test('показывает сообщение когда эфир офлайн', async () => {
        store.set('ppl_stream', {
            url: 'https://example.com/stream', bitrate: '128 kbps',
            format: 'Stereo / Live', freq: '104.7 FM', online: false,
        });
        await loadPlayer();
        await waitFor(() => {
            const b = document.getElementById('playBtn');
            return b && b.dataset.init ? b : null;
        });
        document.getElementById('playBtn').click();
        await wait(100);
        assert.equal(document.getElementById('status-text').textContent, 'Эфир сейчас недоступен');
    });

    test('запускает воспроизведение когда эфир онлайн', async () => {
        store.set('ppl_stream', {
            url: 'https://example.com/stream', bitrate: '128 kbps',
            format: 'Stereo / Live', freq: '104.7 FM', online: true,
        });
        await loadPlayer();
        await waitFor(() => {
            const b = document.getElementById('playBtn');
            return b && b.dataset.init ? b : null;
        });
        document.getElementById('playBtn').click();
        await waitFor(() => document.getElementById('pauseIcon').style.display !== 'none');
        assert.equal(document.getElementById('playIcon').style.display, 'none');
    });
});

describe('Лента новостей', () => {
    beforeEach(() => setupDOM());

    test('рендерит новости из news.json', async () => {
        await loadPlayer();
        document.getElementById('nav-news').click();
        await waitFor(() => document.getElementById('news-container').textContent.includes(NEWS[0].title));
        const items = document.querySelectorAll('#news-container > div');
        assert.equal(items.length, NEWS.length);
    });

    test('экранирует HTML в новинах (XSS защита)', async () => {
        store.set('ppl_news', [{
            id: 999,
            title: '<img src=x onerror="window.__xss=1">',
            description: '<script>window.__xss=2</script>',
            audioUrl: 'javascript:alert(1)',
            date: '2026-01-01',
        }]);
        await loadPlayer();
        document.getElementById('nav-news').click();
        await waitFor(() => {
            const c = document.getElementById('news-container');
            return c && c.textContent.includes('2026-01-01') ? c : null;
        });
        const container = document.getElementById('news-container');
        assert.equal(container.querySelector('img'), null);
        assert.equal(container.querySelector('script'), null);
        assert.ok(container.textContent.includes('window.__xss=1'), 'Данные видны как текст');
    });
});

describe('Профиль', () => {
    beforeEach(() => setupDOM());

    test('показывает гостевой профиль', async () => {
        await loadPlayer({ loggedIn: false });
        document.getElementById('nav-profile').click();
        await waitFor(() => document.getElementById('profile-name').textContent.includes('Гость'));
        assert.equal(document.getElementById('profile-name').textContent, 'Гость PepeLand');
    });

    test('синхронизирует профиль из шапки PepeLand', async () => {
        await loadPlayer({ loggedIn: true });
        document.getElementById('nav-profile').click();
        await waitFor(() => document.getElementById('profile-name').textContent === 'TestUser');
        assert.equal(document.getElementById('profile-avatar-img').src, 'https://pepeland.net/avatars/test.png');
    });
});

describe('Админ-панель', () => {
    beforeEach(() => setupDOM());

    async function openAdmin() {
        await loadPlayer();
        document.getElementById('nav-admin').click();
        await waitFor(() => {
            const el = document.getElementById('admin-stream-url');
            return el && el.value.includes('stream') ? el : null;
        });
    }

    test('сохраняет настройки эфира', async () => {
        await openAdmin();
        document.getElementById('admin-stream-freq').value = '99.9 FM';
        document.getElementById('admin-save-stream').click();
        await waitFor(() => {
            const cfg = store.get('ppl_stream');
            return cfg && cfg.freq === '99.9 FM' ? cfg : null;
        });
        assert.ok(document.getElementById('stream-freq').textContent.includes('99.9 FM'));
    });

    test('добавляет и удаляет подкасты', async () => {
        await openAdmin();
        document.querySelector('[data-admin-tab="podcasts"]').click();
        await wait(50);
        document.getElementById('admin-pod-title').value = 'Test Episode';
        document.getElementById('admin-add-pod').click();
        await new Promise(r => setTimeout(r, 500));
        document.querySelector('#admin-pod-list .admin-del-pod').click();
        await new Promise(r => setTimeout(r, 500));
    });

    test('показывает актуальную версию расширения в статистике', async () => {
        await openAdmin();
        document.querySelector('[data-admin-tab="stats"]').click();
        await waitFor(() => document.getElementById('admin-stats').textContent.includes('1.4'));
    });
});

describe('Валидация данных', () => {
    test('news.json содержит валидные элементы', () => {
        assert.ok(Array.isArray(NEWS));
        assert.ok(NEWS.length > 0);
        for (const item of NEWS) {
            assert.ok(item.id);
            assert.ok(item.title);
            assert.ok(item.description);
            assert.ok(item.audioUrl);
            assert.ok(item.date);
            assert.notEqual(new Date(item.date).toString(), 'Invalid Date');
        }
    });

    test('manifest.json имеет manifest_version 3 и storage права', () => {
        const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
        assert.equal(manifest.manifest_version, 3);
        assert.ok(manifest.permissions.includes('storage'));
    });
});
