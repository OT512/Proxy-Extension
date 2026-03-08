// JP Proxy - Background Service Worker

// Version information
const EXTENSION_VERSION = '1.0.2';
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

// Unified storage wrapper
const Storage = {
    async getConfig() {
        const result = await chrome.storage.local.get(['config']);
        return result.config || createDefaultConfig();
    },
    async setConfig(config) {
        cachedConfig = config;
        return chrome.storage.local.set({ config });
    }
};

const RULES_URL = 'https://cdn.jsdelivr.net/gh/boy86001/SmartProxy-Tools@main/gfwlist.txt';

// 初始化
chrome.runtime.onInstalled.addListener((details) => {
    console.log('onInstalled triggered, reason:', details.reason);

    chrome.storage.local.get(['config'], (result) => {
        console.log('Storage config exists:', !!result.config);
        console.log('Storage config:', JSON.stringify(result.config, null, 2));

        if (!result.config) {
            // 首次安装：创建默认配置，不自动下载规则
            // 用户需要先添加服务器，然后手动导入规则
            console.log('Creating default config...');
            const config = createDefaultConfig();
            config.enabled = false;
            config.proxyMode = 'rules';
            chrome.storage.local.set({ config }, () => {
                console.log('First install: created default config, waiting for user to add server...');
                updateProxy(config);
            });
        } else {
            console.log('Config already exists, skipping initialization');
        }
    });
});

// Auto-fetch and save rules
async function fetchAndSaveRules() {
    console.log('Auto-fetching rules from:', RULES_URL);
    try {
        await doFetchAndSave();
    } catch (error) {
        console.error('Auto-fetch rules failed, retrying in 60s:', error);
        setTimeout(async () => {
            try {
                await doFetchAndSave();
            } catch (retryError) {
                console.error('Retry failed, switching to rules mode:', retryError);
                chrome.storage.local.get(['config'], (result) => {
                    const config = result.config;
                    if (config && config.proxyMode === 'all') {
                        config.proxyMode = 'rules';
                        chrome.storage.local.set({ config }, () => updateProxy(config));
                    }
                });
            }
        }, 60000);
    }
}

// Internal function to fetch and save rules
async function doFetchAndSave() {
    // SW fetch() bypasses chrome.proxy settings, manually add Proxy-Authorization
    // to prevent browser from showing auth dialog when in global proxy mode
    const cfg = cachedConfig || await Storage.getConfig();
    const srv = cfg?.servers?.find(s => s.id === cfg.activeServerId) || cfg?.servers?.[0];

    const headers = {};
    if (srv?.username) {
        headers['Proxy-Authorization'] = `Basic ${btoa(`${srv.username}:${srv.password || ''}`)}`;
        console.log('doFetchAndSave: adding Proxy-Authorization for user:', srv.username);
    }

    const response = await fetch(RULES_URL, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const rules = parseRules(text);
    console.log('Fetched rules:', rules.length);

    return new Promise((resolve) => {
        chrome.storage.local.get(['config'], (result) => {
            const config = result.config || createDefaultConfig();
            config.ruleSources = [{
                id: 'gfwlist',
                name: 'GFWList',
                ruleType: 'proxy',
                enabled: true,
                rules: rules,
                lastUpdate: new Date().toISOString()
            }];
            config.lastUpdate = new Date().toISOString();
            config.proxyMode = 'rules';
            chrome.storage.local.set({ config }, () => {
                console.log('Rules saved, switching to rules mode...');
                updateProxy(config);
                resolve();
            });
        });
    });
}

// Listen for config changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.config) {
        const newConfig = changes.config.newValue;
        const oldConfig = changes.config.oldValue;

        cachedConfig = newConfig; // Sync memory cache first

        // Check if credentials changed
        if (oldConfig) {
            const newServer = newConfig.servers.find(s => s.id === newConfig.activeServerId);
            const oldServer = oldConfig.servers.find(s => s.id === oldConfig.activeServerId);

            if (newServer && oldServer && (
                newServer.username !== oldServer.username ||
                newServer.password !== oldServer.password
            )) {
                console.log('Credential changed:', oldServer.username, '->', newServer.username);
                // Credentials changed, force re-authentication
                forceReauth(newConfig);
                return;
            }
        }

        // Normal config change, just update proxy
        updateProxy(newConfig);
    }
});

// Force re-authentication by switching port to bypass browser auth cache
// Browser caches auth credentials by (host:port, realm), changing port forces new auth
const PORT_PRIMARY = 443;
const PORT_BACKUP = 8443;

function forceReauth(config) {
    console.log('forceReauth: switching port to bypass browser auth cache...');

    // Deep clone to avoid mutating cachedConfig or the caller's object
    const newConfig = JSON.parse(JSON.stringify(config));
    const server = newConfig.servers.find(s => s.id === newConfig.activeServerId) || newConfig.servers[0];
    if (!server) {
        console.error('No active server for forceReauth');
        updateProxy(config);
        return;
    }

    // Determine current port and switch to the other one
    const currentPort = server.port;
    const newPort = currentPort === PORT_PRIMARY ? PORT_BACKUP : PORT_PRIMARY;

    console.log('Switching port:', currentPort, '->', newPort);

    // Update server port on cloned config
    server.port = newPort;

    // Clear PAC cache since port changed
    cachedPacScript = null;
    cachedPacRuleHash = null;

    // First set direct mode to clear proxy state
    chrome.proxy.settings.set({
        value: { mode: 'direct' },
        scope: 'regular_only'
    }, () => {
        // Save cloned config with new port
        chrome.storage.local.set({ config: newConfig }, () => {
            console.log('Config saved with new port:', newPort);
            updateProxy(newConfig);
        });
    });
}

// Timestamp for PAC script cache busting
let authRefreshTimestamp = Date.now();

// 获取当前服务器
function getActiveServer(config) {
    return config.servers.find(s => s.id === config.activeServerId) || config.servers[0];
}

// 更新代理设置
function updateProxy(config) {
    console.log('[PROXY] updateProxy called, mode:', config.proxyMode, 'enabled:', config.enabled, 'port:', config.servers?.[0]?.port);

    // Always update badge based on enabled state
    updateBadge(config.enabled);

    if (!config.enabled || config.servers.length === 0) {
        chrome.proxy.settings.set({
            value: { mode: 'direct' },
            scope: 'regular_only'
        }, () => {
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
                bypassList: ['localhost', '127.0.0.1', '192.168.*', '10.*', '172.16.*', '::1', '<local>']
            }
        };
        chrome.proxy.settings.set({ value: proxyConfig, scope: 'regular_only' }, () => {
            console.log('Proxy mode: all ->', server.host + ':' + server.port);
        });
    } else if (config.proxyMode === 'bypass') {
        chrome.proxy.settings.set({
            value: { mode: 'direct' },
            scope: 'regular_only'
        }, () => {
            console.log('Proxy mode: bypass (direct)');
        });
    } else if (config.proxyMode === 'rules') {
        const pacScript = generatePacScript(config, server);
        console.log('PAC script length:', pacScript.length);
        chrome.proxy.settings.set({
            value: {
                mode: 'pac_script',
                pacScript: { data: pacScript }
            },
            scope: 'regular_only'
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

    // Build domain array
    const proxyDomains = [];
    for (const rule of proxyRules) {
        if (rule.startsWith('||')) {
            proxyDomains.push(rule.substring(2).toLowerCase());
        } else if (rule.startsWith('*.')) {
            proxyDomains.push(rule.substring(2).toLowerCase());
        } else if (rule.includes('.') && !rule.startsWith('|') && !rule.startsWith('/') && !rule.startsWith('@')) {
            proxyDomains.push(rule.toLowerCase());
        }
    }

    const proxyStr = server.type === 'socks5'
        ? `SOCKS5 ${server.host}:${server.port}`
        : `${server.type.toUpperCase()} ${server.host}:${server.port}`;

    // Generate optimized PAC script with hash-based domain lookup
    const script = `
// Timestamp: ${authRefreshTimestamp}
var proxyMap = ${JSON.stringify(Object.fromEntries(proxyDomains.map(d => [d, true])))};
var proxyStr = '${proxyStr}';

function FindProxyForURL(url, host) {
    // Exclude browser extension URLs
    if (url.startsWith('chrome-extension://') || 
        url.startsWith('ms-browser-extension://') ||
        url.startsWith('edge-extension://')) {
        return 'DIRECT';
    }

    host = host.toLowerCase();
    
    // Local direct
    if (host === 'localhost' || host === '127.0.0.1' ||
        host.startsWith('192.168.') || host.startsWith('10.') || 
        host.startsWith('172.16.')) {
        return 'DIRECT';
    }
    
    // Check host itself and each parent domain (O(domain levels) instead of O(n))
    var parts = host.split('.');
    for (var i = 0; i < parts.length - 1; i++) {
        var candidate = parts.slice(i).join('.');
        if (proxyMap[candidate]) return proxyStr;
    }
    
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
        console.log('[AUTH] onAuthRequired triggered, isProxy:', details.isProxy, 'cachedConfig:', !!cachedConfig);

        if (cachedConfig?.servers) {
            const server = cachedConfig.servers.find(s => s.id === cachedConfig.activeServerId)
                || cachedConfig.servers[0];
            if (server?.username) {
                console.log('[AUTH] Providing credentials for user:', server.username, 'port:', server.port);
                return {
                    authCredentials: {
                        username: server.username,
                        password: server.password || ''
                    }
                };
            }
            console.log('[AUTH] Server found but no username');
        } else {
            console.log('[AUTH] No cachedConfig or no servers');
        }

        console.log('[AUTH] No credentials provided');
        return { cancel: false };
    },
    { urls: ['<all_urls>'] },
    ['blocking']
);

// Note: onBeforeSendHeaders with blocking mode requires webRequestBlocking permission
// which is not available in MV3 for normal extensions.
// The onAuthRequired listener with webRequestAuthProvider is the only option.
// Browser proxy auth cache is handled by the browser, not the extension.

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
        const fetchHeaders = {};
        const activeSrv = cachedConfig?.servers?.find(s => s.id === cachedConfig.activeServerId)
            || cachedConfig?.servers?.[0];
        if (activeSrv?.username) {
            fetchHeaders['Proxy-Authorization'] = `Basic ${btoa(`${activeSrv.username}:${activeSrv.password || ''}`)}`;
        }

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
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    return false;
});

// Test server connection - test direct TCP connection to proxy server
// Note: Service Worker fetch() does NOT use chrome.proxy.settings
// So we test by measuring TCP connection time to the proxy server itself
async function testServerConnection(server) {
    console.log('Testing server:', server.host + ':' + server.port);

    const startTime = Date.now();

    try {
        // Test TCP connection to proxy server using WebSocket handshake
        // This measures the time to establish a connection to the server
        // For HTTPS proxies, the server will return 400 (doesn't understand WebSocket)
        // but that means the TCP connection was established successfully
        const testUrl = `wss://${server.host}:${server.port}/`;

        const result = await new Promise((resolve) => {
            const ws = new WebSocket(testUrl);
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ws.close();
                    resolve({ success: false, error: 'Timeout' });
                }
            }, 10000);

            ws.onopen = () => {
                // Should not happen for proxy servers, but if it does, success
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    ws.close();
                    resolve({ success: true });
                }
            };

            ws.onerror = () => {
                // For HTTPS proxies, this is expected - server doesn't speak WebSocket
                // But we got a response, which means TCP connection was established
                // Suppress the error by not logging it
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    // This is actually success for proxy servers
                    resolve({ success: true });
                }
            };

            ws.onclose = (event) => {
                // Server closed connection - this is expected for proxy servers
                // 400 = server doesn't understand WebSocket protocol (but is reachable)
                // 403 = forbidden (but server is reachable)
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    // Any close means we connected and got a response
                    resolve({ success: true });
                }
            };
        });

        const latency = Date.now() - startTime;

        if (result.success) {
            console.log('Server test success, latency:', latency + 'ms');
            return { success: true, latency };
        } else {
            return result;
        }

    } catch (error) {
        const latency = Date.now() - startTime;

        // DNS resolution failed - invalid hostname
        if (error.message && (
            error.message.includes('ENOTFOUND') ||
            error.message.includes('DNS') ||
            error.message.includes('name resolution')
        )) {
            return { success: false, error: 'DNS解析失败' };
        }

        // Connection refused - server not listening
        if (error.message && (
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('refused')
        )) {
            return { success: false, error: '连接被拒绝' };
        }

        // Timeout
        if (error.message === 'Timeout') {
            return { success: false, error: '连接超时' };
        }

        // For other errors, if we got some response, consider it success
        if (latency < 5000 && latency > 50) {
            return { success: true, latency };
        }

        return { success: false, error: error.message || 'Connection failed' };
    }
}

// Initialize on Service Worker wake-up
// Store as a promise so onAuthRequired can await it if cache is not ready
let initConfigPromise = null;

function initConfig() {
    initConfigPromise = new Promise((resolve) => {
        chrome.storage.local.get(['config'], (result) => {
            cachedConfig = result.config || createDefaultConfig();
            updateProxy(cachedConfig);
            resolve(cachedConfig);
        });
    });
    return initConfigPromise;
}

// Immediately set direct mode on SW startup to prevent browser from using stale
// proxy settings before SW is ready, which would trigger auth dialog on new tabs
chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular_only' }, () => {
    initConfig(); // Then restore correct proxy settings from storage
});

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
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'updateCheck' && await shouldCheckUpdate()) {
        checkForUpdates();
    }
});

// Check for new version on GitHub
async function checkForUpdates() {
    try {
        await chrome.storage.local.set({ lastUpdateCheck: new Date().toISOString() });

        const cfg = cachedConfig || await Storage.getConfig();
        const srv = cfg?.servers?.find(s => s.id === cfg.activeServerId) || cfg?.servers?.[0];
        const headers = {};
        if (srv?.username) {
            headers['Proxy-Authorization'] = `Basic ${btoa(`${srv.username}:${srv.password || ''}`)}`;
        }

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

// Listen for checkUpdate message from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'checkUpdate') {
        checkForUpdates().then(() => {
            chrome.storage.local.get(['updateAvailable'], (result) => {
                sendResponse(result.updateAvailable || null);
            });
        });
        return true;
    }

    if (message.action === 'getVersion') {
        sendResponse({
            version: EXTENSION_VERSION,
            githubRepo: GITHUB_REPO
        });
        return false;
    }

    return false;
});
