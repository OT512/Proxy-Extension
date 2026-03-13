// JP Proxy - Background Service Worker

// Version information
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const GITHUB_REPO = 'OT512/Proxy-Extension';
const VERSION_CHECK_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/manifest.json`;
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

// Memory cache for sync return in onAuthRequired
let cachedConfig = null;

// Pre-compiled regex for URL rule parsing
const RE_URL_RULE = /\|https?:\/\/([^\/\|]+)/;

// PAC script cache
let cachedPacScript = null;
let cachedPacRuleHash = null;

// Default config factory
function createDefaultConfig() {
    return {
        enabled: false,
        servers: [],
        activeServerId: null,
        proxyMode: 'rules',
        rules: [],
        lastUpdate: null,
        ruleSources: []
    };
}

// Shallow-safe deep clone (config objects contain no special types)
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Unified storage wrapper
const Storage = {
    async getConfig() {
        const result = await chrome.storage.local.get(['config']);
        return result.config || createDefaultConfig();
    },
    async setConfig(config) {
        cachedConfig = config;
        return chrome.storage.local.set({ config });
    },
    // Get cached config or load from storage — single source of truth
    async resolve() {
        if (cachedConfig) return cachedConfig;
        cachedConfig = await Storage.getConfig();
        return cachedConfig;
    }
};

const RULES_URL = 'https://cdn.jsdelivr.net/gh/boy86001/SmartProxy-Tools@main/gfwlist.txt';

// 初始化
chrome.runtime.onInstalled.addListener((details) => {
    console.log('onInstalled triggered, reason:', details.reason);

    Storage.getConfig().then(existingConfig => {
        const isFirstInstall = !existingConfig.servers?.length;
        console.log('Storage config exists:', !isFirstInstall);
        if (isFirstInstall) {
            console.log('First install: creating default config...');
            const config = createDefaultConfig();
            Storage.setConfig(config).then(() => {
                console.log('First install: default config saved.');
                updateProxy(config);
            });
        } else {
            console.log('Config already exists, skipping initialization');
        }
    });
});

// Fetch GFWList rules and save to storage. Retries once after 60s on failure.
async function doFetchAndSave() {
    console.log('Fetching rules from:', RULES_URL);
    const attempt = async () => {
        const cfg = await Storage.resolve();
        const headers = getProxyFetchHeaders(cfg);

        const response = await fetch(RULES_URL, { headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rules = parseRules(await response.text());
        console.log('Fetched rules:', rules.length);

        // Re-resolve config after fetch (may have changed) and save rules
        const config = await Storage.resolve();
        config.ruleSources = [{
            id: 'gfwlist', name: 'GFWList', ruleType: 'proxy',
            enabled: true, rules, lastUpdate: new Date().toISOString()
        }];
        config.lastUpdate = new Date().toISOString();
        config.proxyMode = 'rules';
        await Storage.setConfig(config);
        console.log('Rules saved, switching to rules mode...');
        updateProxy(config);
    };

    try {
        await attempt();
    } catch (error) {
        console.error('Rules fetch failed, retrying in 60s:', error);
        setTimeout(async () => {
            try { await attempt(); }
            catch (e) { console.error('Retry failed:', e); }
        }, 60000);
    }
}

// Listen for config changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.config) {
        cachedConfig = changes.config.newValue;
        updateProxy(cachedConfig);
    }
});


// 获取当前活跃服务器
function getActiveServer(config) {
    return config.servers?.find(s => s.id === config.activeServerId) || config.servers?.[0] || null;
}

// 构造 Basic 认证头，无用户名时返回 null
function buildAuthHeader(server) {
    if (!server?.username) return null;
    return `Basic ${btoa(`${server.username}:${server.password || ''}`)}`;
}

// 为 fetch 请求附加代理认证头（SW fetch 绕过 chrome.proxy，需手动附加）
function getProxyFetchHeaders(config) {
    const server = getActiveServer(config);
    const auth = buildAuthHeader(server);
    return auth ? { 'Proxy-Authorization': auth } : {};
}

// Helper: set proxy for both regular and incognito
// incognito_persistent requires user to have enabled extension in incognito mode
function setProxyConfig(value, callback) {
    chrome.proxy.settings.set({ value, scope: 'regular_only' }, () => {
        // Try to set incognito scope - silently ignore if not permitted
        chrome.proxy.settings.set({ value, scope: 'incognito_persistent' }, () => {
            if (chrome.runtime.lastError) {
                // User hasn't enabled extension in incognito mode - that's ok
                console.log('Incognito proxy not set (not enabled in incognito):', chrome.runtime.lastError.message);
            }
            if (callback) callback();
        });
    });
}

// 更新代理设置
function updateProxy(config) {
    console.log('[PROXY] updateProxy called, mode:', config.proxyMode, 'enabled:', config.enabled, 'port:', config.servers?.[0]?.port);

    // Always update badge based on enabled state
    updateBadge(config.enabled);

    if (!config.enabled || config.servers.length === 0) {
        setProxyConfig({ mode: 'direct' }, () => {
            console.log('Proxy disabled');
        });
        return;
    }

    const server = getActiveServer(config);
    if (!server) {
        console.error('No active server');
        return;
    }

    const scheme = server.type === 'socks5' ? 'socks5' : server.type;

    if (config.proxyMode === 'all') {
        const proxyConfig = {
            mode: 'fixed_servers',
            rules: {
                singleProxy: {
                    scheme: scheme,
                    host: server.host,
                    port: server.port
                },
                bypassList: [
                    'localhost', '127.0.0.1', '::1', '<local>',
                    '192.168.*', '10.*', '172.16.*',
                    // Common CN domains - always direct, no need to proxy
                    '*.baidu.com', '*.qq.com', '*.weixin.qq.com', '*.taobao.com',
                    '*.tmall.com', '*.jd.com', '*.alipay.com', '*.aliyun.com',
                    '*.tencent.com', '*.163.com', '*.126.com', '*.sina.com.cn',
                    '*.weibo.com', '*.zhihu.com', '*.bilibili.com', '*.iqiyi.com',
                    '*.youku.com', '*.douyin.com', '*.toutiao.com', '*.bytedance.com'
                ]
            }
        };
        setProxyConfig(proxyConfig, () => {
            console.log('Proxy mode: all ->', server.host + ':' + server.port);
        });
    } else if (config.proxyMode === 'bypass') {
        setProxyConfig({ mode: 'direct' }, () => {
            console.log('Proxy mode: bypass (direct)');
        });
    } else if (config.proxyMode === 'rules') {
        const pacScript = generatePacScript(config, server);
        console.log('PAC script length:', pacScript.length);
        setProxyConfig({
                mode: 'pac_script',
                pacScript: { data: pacScript }
            }, () => {
            console.log('Proxy mode: rules (PAC)');
        });
    }
}

// Generate PAC script with caching
function generatePacScript(config, server) {
    // Build a simple hash of rules to detect changes
    const ruleHash = (config.ruleSources?.map(s => s.lastUpdate).join(',') || '') +
        server.host + ':' + server.port + ':' + server.type;

    // Return cached version if available and unchanged
    if (cachedPacScript && cachedPacRuleHash === ruleHash) {
        console.log('Using cached PAC script');
        return cachedPacScript;
    }

    console.log('Generating new PAC script...');

    let proxyRules = [];
    let directRules = [];

    if (config.ruleSources) {
        config.ruleSources.forEach(source => {
            if (source.enabled && source.rules) {
                if (source.ruleType === 'direct') {
                    directRules = directRules.concat(source.rules);
                } else {
                    proxyRules = proxyRules.concat(source.rules);
                }
            }
        });
    }

    if (config.rules && config.rules.length > 0) {
        proxyRules = proxyRules.concat(config.rules);
    }

    console.log('Total proxyRules:', proxyRules.length);
    console.log('Total directRules:', directRules.length);

    // Build proxyMap: normalise every rule down to its root domain (eTLD+1 approximation).
    // Storing "google.com" covers "mail.google.com", "www.google.com" etc.
    // Lookup becomes a single O(1) hash check instead of a split+loop.
    // Convert a domain to ASCII-safe Punycode — PAC only accepts ASCII
    function toASCIIDomain(domain) {
        try {
            return new URL('https://' + domain).hostname;
        } catch (e) {
            return null;
        }
    }

    const proxyMap = {};
    for (const rule of proxyRules) {
        let domain = null;
        if (rule.startsWith('||'))      domain = rule.substring(2).toLowerCase();
        else if (rule.startsWith('*.')) domain = rule.substring(2).toLowerCase();
        else if (rule.includes('.') && !rule.startsWith('|') && !rule.startsWith('/') && !rule.startsWith('@'))
            domain = rule.toLowerCase();
        if (!domain) continue;

        // Encode to ASCII/Punycode — PAC only accepts ASCII
        domain = toASCIIDomain(domain);
        if (!domain) continue;

        // Strip to root domain (last two labels) for O(1) lookup
        const parts = domain.split('.');
        const root = parts.length > 2 ? parts.slice(-2).join('.') : domain;
        proxyMap[root] = true;
        if (domain !== root) proxyMap[domain] = true;
    }

    const proxyStr = server.type === 'socks5'
        ? `SOCKS5 ${server.host}:${server.port}`
        : `${server.type.toUpperCase()} ${server.host}:${server.port}`;

    // Generate optimized PAC script — O(1) lookup via precomputed root-domain map
    const script = `
var proxyMap = ${JSON.stringify(proxyMap)};
var proxyStr = '${proxyStr}';

function FindProxyForURL(url, host) {
    // Exclude browser extension URLs
    if (url.startsWith('chrome-extension://') ||
        url.startsWith('ms-browser-extension://') ||
        url.startsWith('edge-extension://')) {
        return 'DIRECT';
    }

    host = host.toLowerCase();

    // Local addresses - always direct
    if (host === 'localhost' || host === '127.0.0.1' ||
        host.startsWith('192.168.') || host.startsWith('10.') ||
        host.startsWith('172.16.')) {
        return 'DIRECT';
    }

    // O(1) lookup: check root domain (last two labels), then full host
    var lastDot = host.lastIndexOf('.', host.lastIndexOf('.') - 1);
    var root = lastDot >= 0 ? host.substring(lastDot + 1) : host;

    // Common CN domains - always direct for performance
    var cnRoots = {
        'baidu.com':1,'qq.com':1,'taobao.com':1,'tmall.com':1,'jd.com':1,
        'alipay.com':1,'aliyun.com':1,'tencent.com':1,'163.com':1,'126.com':1,
        'sina.com.cn':1,'weibo.com':1,'zhihu.com':1,'bilibili.com':1,
        'iqiyi.com':1,'youku.com':1,'douyin.com':1,'toutiao.com':1,'bytedance.com':1
    };
    if (cnRoots[root] || cnRoots[host]) return 'DIRECT';

    if (proxyMap[root] || proxyMap[host]) return proxyStr;

    return 'DIRECT';
}
`;

    // Cache the result
    cachedPacScript = script;
    cachedPacRuleHash = ruleHash;

    return script;
}

// Update toolbar icon based on enabled state
function updateBadge(enabled) {
    // Clear badge (no status indicator)
    chrome.action.setBadgeText({ text: '' });

    // Switch icon based on enabled state
    // - on: enabled state (green/active look)
    // - off: disabled state (gray/inactive look)
    const iconPath = enabled ? {
        16: 'icons/icon16-on.png',
        48: 'icons/icon48-on.png',
        128: 'icons/icon128-on.png'
    } : {
        16: 'icons/icon16-off.png',
        48: 'icons/icon48-off.png',
        128: 'icons/icon128-off.png'
    };
    chrome.action.setIcon({ path: iconPath });
}

// Handle proxy auth - must be synchronous in MV3 (asyncBlocking not supported)
// cachedConfig is pre-populated by initConfig() on SW startup
console.log('[AUTH] onAuthRequired listener registered');
chrome.webRequest.onAuthRequired.addListener(
    (details) => {
        if (!details.isProxy) return { cancel: false };
        const server = cachedConfig && getActiveServer(cachedConfig);
        if (server?.username) {
            return { authCredentials: { username: server.username, password: server.password || '' } };
        }
        return { cancel: false };
    },
    { urls: ['<all_urls>'] },
    ['blocking']
);

// Note: onBeforeSendHeaders with blocking mode requires webRequestBlocking permission
// which is not available in MV3 for normal extensions.
// The onAuthRequired listener with webRequestAuthProvider is the only option.
// Browser proxy auth cache is handled by the browser, not the extension.

// ─── Proxy status monitoring via real traffic ────────────────────────────────
// Active test can't verify credentials over HTTPS proxy (SW fetch bypasses chrome.proxy).
// Instead, monitor real browser requests to infer auth status:
//   onAuthRequired  → 407 received → auth-fail (wrong password)
//   onCompleted     → request succeeded through proxy → success
//   onErrorOccurred → proxy-related error → fail
//
// Status is stored in chrome.storage.session so popup can read it across open/close.

const PROXY_STATUS_KEY = 'proxyStatus';
let proxyStatusDebounce = null;

async function setProxyStatus(status, latency) {
    clearTimeout(proxyStatusDebounce);
    proxyStatusDebounce = setTimeout(async () => {
        const server = cachedConfig && getActiveServer(cachedConfig);
        if (!server || !cachedConfig?.enabled) return;
        const statusObj = { status, serverId: server.id, latency: latency || null, ts: Date.now() };
        await chrome.storage.session.set({ [PROXY_STATUS_KEY]: statusObj });
        console.log('[STATUS]', status, latency ? latency + 'ms' : '');
        // Notify popup if open (ignore error if popup is closed)
        chrome.runtime.sendMessage({ action: 'proxyStatusChanged', ...statusObj }).catch(() => {});
    }, 400);
}

// Track request start times for latency calculation: requestId → timeStamp (ms)
const requestStartTimes = new Map();

// Record request start time
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (!cachedConfig?.enabled) return;
        requestStartTimes.set(details.requestId, details.timeStamp);
        // Prevent unbounded growth — keep map lean
        if (requestStartTimes.size > 500) {
            const oldest = requestStartTimes.keys().next().value;
            requestStartTimes.delete(oldest);
        }
    },
    { urls: ['<all_urls>'] }
);

// 407 → auth-fail
chrome.webRequest.onAuthRequired.addListener(
    (details) => {
        if (!details.isProxy) return;
        requestStartTimes.delete(details.requestId);
        setProxyStatus('auth-fail', null);
    },
    { urls: ['<all_urls>'] }
);

// Successful request through proxy → success + latency
chrome.webRequest.onCompleted.addListener(
    (details) => {
        if (!cachedConfig?.enabled) return;
        if (details.fromCache) return;
        if (details.statusCode === 407) {
            requestStartTimes.delete(details.requestId);
            setProxyStatus('auth-fail', null);
            return;
        }
        const start = requestStartTimes.get(details.requestId);
        requestStartTimes.delete(details.requestId);
        const latency = start ? Math.round(details.timeStamp - start) : null;
        setProxyStatus('success', latency);
    },
    { urls: ['<all_urls>'] }
);

// Proxy error → fail
chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        if (!cachedConfig?.enabled) return;
        requestStartTimes.delete(details.requestId);
        const e = details.error || '';
        if (e.includes('ERR_PROXY') || e.includes('ERR_TUNNEL') || e.includes('ERR_EMPTY_RESPONSE')) {
            setProxyStatus('fail', null);
        }
    },
    { urls: ['<all_urls>'] }
);

// Base64 decode using native API
function base64Decode(str) {
    try {
        return atob(str.replace(/\s/g, ''));
    } catch (e) {
        console.error('Base64 decode error:', e);
        return null;
    }
}

// 解析规则文件
function parseRules(text) {
    let content = text.trim();

    try {
        const cleanContent = content.replace(/\s/g, '');
        if (/^[A-Za-z0-9+/=]+$/.test(cleanContent) && cleanContent.length > 100) {
            const decoded = base64Decode(cleanContent);
            if (decoded) content = decoded;
        }
    } catch (e) { }

    const lines = content.split('\n');
    const rules = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#') || trimmed.startsWith('[')) {
            continue;
        }
        if (trimmed.startsWith('||')) {
            rules.push(trimmed);
        } else if (trimmed.startsWith('|')) {
            const match = trimmed.match(RE_URL_RULE);
            if (match) rules.push('||' + match[1]);
        } else if (trimmed.startsWith('.')) {
            rules.push('*' + trimmed);
        } else if (trimmed.startsWith('@')) {
            continue;
        } else if (trimmed.includes('.') && !trimmed.startsWith('/')) {
            rules.push(trimmed);
        }
    }

    return rules;
}

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message.action);

    if (message.action === 'fetchRules') {
        console.log('Fetching URL:', message.url);

        // SW fetch() bypasses chrome.proxy, must add Proxy-Authorization manually
        const fetchHeaders = getProxyFetchHeaders(cachedConfig || {});
        fetch(message.url, { headers: fetchHeaders })
            .then(r => {
                console.log('Fetch response status:', r.status);
                if (!r.ok) {
                    throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                }
                return r.text();
            })
            .then(text => {
                console.log('Fetched text length:', text.length);
                const rules = parseRules(text);
                console.log('Parsed rules count:', rules.length);
                sendResponse({ success: true, count: rules.length, rules: rules });
            })
            .catch(error => {
                console.error('Fetch error:', error.name, error.message);
                sendResponse({ success: false, error: error.message || 'Unknown error' });
            });

        return true; // Keep channel open for async response
    }

    if (message.action === 'importRules') {
        try {
            const rules = parseRules(message.content);
            sendResponse({ success: true, count: rules.length, rules: rules });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // 测试服务器连接
    if (message.action === 'testServer') {
        testServerConnection(message.server)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ status: 'fail', error: error.message }));
        return true;
    }

    // 一键导入默认 GFWList
    if (message.action === 'importDefaultGFWList') {
        (async () => {
            try {
                await doFetchAndSave();
                const result = await chrome.storage.local.get(['config']);
                const rules = result.config?.ruleSources?.[0]?.rules || [];
                sendResponse({ success: true, count: rules.length });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.action === 'checkUpdate') {
        checkForUpdates().then(() => {
            chrome.storage.local.get(['updateAvailable'], (result) => {
                sendResponse(result.updateAvailable || null);
            });
        });
        return true;
    }

    if (message.action === 'getVersion') {
        sendResponse({ version: EXTENSION_VERSION, githubRepo: GITHUB_REPO });
        return false;
    }

    return false;
});

// Test server connection using SW fetch() with explicit Proxy-Authorization header.
// SW fetch() bypasses chrome.proxy so we must add auth manually.
// We connect directly to the proxy server's HTTPS endpoint:
//   - Network error / timeout → server unreachable (fail/timeout)
//   - Any HTTP response → server reachable; we treat all non-network-errors as success
//     because HTTPS proxies don't serve regular HTTP responses to the proxy port
async function testServerConnection(server) {
    console.log('[TEST] Testing server:', server.host + ':' + server.port);
    const startTime = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const authHeader = buildAuthHeader(server);
    const headers = authHeader ? { 'Proxy-Authorization': authHeader } : {};

    try {
        // Fetch the proxy server's HTTPS endpoint directly.
        // The server will respond (possibly with 400/407/502) — any response means reachable.
        const res = await fetch(`https://${server.host}:${server.port}/`, {
            method: 'HEAD',
            headers,
            signal: controller.signal
        });
        clearTimeout(timer);
        const latency = Date.now() - startTime;
        console.log('[TEST] HTTP status:', res.status, 'latency:', latency + 'ms');

        // 407 with correct credentials would be odd, but treat as auth-fail
        if (res.status === 407) {
            return { status: 'auth-fail', latency };
        }
        return { status: 'success', latency };

    } catch (e) {
        clearTimeout(timer);
        const latency = Date.now() - startTime;

        if (e.name === 'AbortError') {
            console.log('[TEST] Timeout after', latency + 'ms');
            return { status: 'timeout', latency: null };
        }

        // "Failed to fetch" / TypeError — often means the proxy server responded
        // with something non-HTTP (e.g. TLS handshake succeeded but no valid HTTP
        // response). If latency is reasonable, the server is reachable.
        if (latency > 50 && latency < 9000) {
            console.log('[TEST] Fetch error but server responded in', latency + 'ms:', e.message);
            return { status: 'success', latency };
        }

        console.log('[TEST] Server unreachable:', e.message);
        return { status: 'fail', latency: null };
    }
}


// Initialize on Service Worker wake-up
// Store as a promise so onAuthRequired can await it if cache is not ready
let initConfigPromise = null;

function initConfig() {
    initConfigPromise = Storage.getConfig().then(config => {
        cachedConfig = config;
        updateProxy(cachedConfig);
        return cachedConfig;
    });
    return initConfigPromise;
}

// SW startup: read config from storage ASAP and restore proxy settings.
// We intentionally do NOT set 'direct' first — that creates a race-window where
// requests slip through without proxy. Instead we restore the correct settings
// as fast as possible. The only downside is a brief moment with stale proxy
// settings, which is better than a brief moment with no proxy at all.
initConfig();

// Check for updates on startup and periodically
// Only check if 24 hours have passed since last check
async function shouldCheckUpdate() {
    const result = await chrome.storage.local.get(['lastUpdateCheck']);
    const lastCheck = result.lastUpdateCheck;
    if (!lastCheck) return true;

    const hoursSinceLastCheck = (Date.now() - new Date(lastCheck).getTime()) / (1000 * 60 * 60);
    return hoursSinceLastCheck >= 24;
}

// Initial check on startup (with 24h throttle)
shouldCheckUpdate().then(shouldCheck => {
    if (shouldCheck) {
        checkForUpdates();
    } else {
        console.log('Skipping update check, checked within 24 hours');
    }
});

// Use chrome.alarms instead of setInterval - alarms survive SW sleep
chrome.alarms.create('updateCheck', { periodInMinutes: 60 });
chrome.alarms.create('keepAlive', { periodInMinutes: 0.33 }); // ~20s, keep SW alive
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'keepAlive') {
        // Ping to prevent SW from sleeping — ensures onAuthRequired stays registered
        if (!cachedConfig) await Storage.getConfig();
        return;
    }
    if (alarm.name === 'updateCheck' && await shouldCheckUpdate()) {
        checkForUpdates();
    }
});

// Check for new version on GitHub
async function checkForUpdates() {
    try {
        await chrome.storage.local.set({ lastUpdateCheck: new Date().toISOString() });

        const cfg = await Storage.resolve();
        const headers = getProxyFetchHeaders(cfg);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        let response;
        try {
            response = await fetch(VERSION_CHECK_URL, {
                cache: 'no-cache',
                signal: controller.signal,
                headers
            });
        } catch {
            // Network error or timeout - silently skip, no console error
            clearTimeout(timeout);
            console.log('Update server unreachable, skipping update check');
            return;
        }
        clearTimeout(timeout);

        if (!response.ok) {
            console.log('Update server not reachable, skipping update check');
            return;
        }

        const manifest = await response.json();
        const latestVersion = manifest.version;

        console.log('Current version:', EXTENSION_VERSION, 'Latest:', latestVersion);

        if (compareVersions(latestVersion, EXTENSION_VERSION) > 0) {
            console.log('New version available:', latestVersion);
            chrome.storage.local.set({
                updateAvailable: {
                    currentVersion: EXTENSION_VERSION,
                    latestVersion: latestVersion,
                    downloadUrl: RELEASES_URL,
                    checkedAt: new Date().toISOString()
                }
            });
            showUpdateNotification(latestVersion);
        } else {
            chrome.storage.local.remove(['updateAvailable']);
        }
    } catch (error) {
        console.log('Update check skipped:', error.message);
    }
}

// Compare version strings (returns >0 if a > b, <0 if a < b, 0 if equal)
function compareVersions(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const partA = partsA[i] || 0;
        const partB = partsB[i] || 0;
        if (partA > partB) return 1;
        if (partA < partB) return -1;
    }
    return 0;
}

// Open release page when update notification is clicked (registered once at top level)
chrome.notifications.onClicked.addListener(() => {
    chrome.tabs.create({ url: RELEASES_URL });
});

// Show update notification
function showUpdateNotification(version) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'OT512 Proxy 更新可用',
        message: `新版本 ${version} 已发布，点击下载`,
        priority: 2,
        requireInteraction: true
    });
}


