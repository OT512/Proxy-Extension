// JP Proxy - Background Service Worker

// 内存缓存，避免 onAuthRequired 异步读取超时
let cachedConfig = null;

const DEFAULT_CONFIG = {
    enabled: false,
    servers: [{
        id: 1,
        name: 'Proxy Server',
        type: 'https',
        host: 'your-proxy-domain.com',
        port: 443,
        username: 'YOUR_USERNAME',
        password: 'YOUR_PASSWORD'
    }],
    activeServerId: 1,
    proxyMode: 'rules',
    rules: [],
    lastUpdate: null,
    ruleSources: []
};

const RULES_URL = 'https://cdn.jsdelivr.net/gh/boy86001/SmartProxy-Tools@main/gfwlist.txt';

// 初始化
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['config'], (result) => {
        if (!result.config) {
            const config = { ...DEFAULT_CONFIG };
            // 首次安装：先开启全局代理以便下载规则
            config.enabled = true;
            config.proxyMode = 'all';
            chrome.storage.local.set({ config }, () => {
                console.log('First install: enabling global proxy to fetch rules...');
                updateProxy(config);
                // 延迟下载规则（等待代理生效）
                setTimeout(() => fetchAndSaveRules(), 1000);
            });
        } else {
            // 检查是否需要更新规则
            if (!result.config.ruleSources || result.config.ruleSources.length === 0) {
                // 如果已有配置但没有规则，先开启全局代理
                const config = result.config;
                config.enabled = true;
                config.proxyMode = 'all';
                chrome.storage.local.set({ config }, () => {
                    updateProxy(config);
                    setTimeout(() => fetchAndSaveRules(), 1000);
                });
            }
        }
    });
});

// 自动下载并保存规则
async function fetchAndSaveRules() {
    console.log('Auto-fetching rules from:', RULES_URL);
    try {
        const response = await fetch(RULES_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        const rules = parseRules(text);
        console.log('Auto-fetched rules:', rules.length);

        chrome.storage.local.get(['config'], (result) => {
            const config = result.config || DEFAULT_CONFIG;
            config.ruleSources = [{
                id: 'gfwlist',
                name: 'GFWList',
                ruleType: 'proxy',
                enabled: true,
                rules: rules,
                lastUpdate: new Date().toISOString()
            }];
            config.lastUpdate = new Date().toISOString();
            // 规则下载完成后切换到智能模式
            config.proxyMode = 'rules';
            chrome.storage.local.set({ config }, () => {
                console.log('Rules saved, switching to rules mode...');
                updateProxy(config);
            });
        });
    } catch (error) {
        console.error('Auto-fetch rules failed:', error);
        // Retry after 60 seconds, then switch to rules mode if still fails
        setTimeout(async () => {
            try {
                const response = await fetch(RULES_URL);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const text = await response.text();
                const rules = parseRules(text);

                chrome.storage.local.get(['config'], (result) => {
                    const config = result.config || DEFAULT_CONFIG;
                    config.ruleSources = [{
                        id: 'gfwlist',
                        name: 'GFWList',
                        ruleType: 'proxy',
                        enabled: true,
                        rules: rules,
                        lastUpdate: new Date().toISOString()
                    }];
                    config.proxyMode = 'rules';
                    chrome.storage.local.set({ config }, () => updateProxy(config));
                });
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

// 监听配置变化
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.config) {
        cachedConfig = changes.config.newValue; // 同步更新内存缓存
        updateProxy(cachedConfig);
    }
});

// 获取当前服务器
function getActiveServer(config) {
    return config.servers.find(s => s.id === config.activeServerId) || config.servers[0];
}

// 更新代理设置
function updateProxy(config) {
    console.log('updateProxy called, mode:', config.proxyMode, 'enabled:', config.enabled);

    if (!config.enabled || config.servers.length === 0) {
        chrome.proxy.settings.set({
            value: { mode: 'direct' },
            scope: 'regular'
        }, () => {
            console.log('Proxy disabled');
            updateBadge(false);
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
        chrome.proxy.settings.set({ value: proxyConfig, scope: 'regular' }, () => {
            console.log('Proxy mode: all ->', server.host + ':' + server.port);
            updateBadge(true);
        });
    } else if (config.proxyMode === 'bypass') {
        chrome.proxy.settings.set({
            value: { mode: 'direct' },
            scope: 'regular'
        }, () => {
            console.log('Proxy mode: bypass (direct)');
            updateBadge(true);
        });
    } else if (config.proxyMode === 'rules') {
        const pacScript = generatePacScript(config, server);
        console.log('PAC script length:', pacScript.length);
        chrome.proxy.settings.set({
            value: {
                mode: 'pac_script',
                pacScript: { data: pacScript }
            },
            scope: 'regular'
        }, () => {
            console.log('Proxy mode: rules (PAC)');
            updateBadge(true);
        });
    }
}

// 生成 PAC 脚本（简化版本 - 使用正则表达式）
function generatePacScript(config, server) {
    let proxyRules = [];
    let directRules = [];

    console.log('generatePacScript called');

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

    // 构建域名后缀数组
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

    // 生成简化的 PAC 脚本
    return `
var proxyDomains = ${JSON.stringify(proxyDomains)};
var proxyStr = '${proxyStr}';

function FindProxyForURL(url, host) {
    host = host.toLowerCase();
    
    // Local addresses - direct connection
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.16.')) {
        return 'DIRECT';
    }
    
    // Check domain suffix match
    for (var i = 0; i < proxyDomains.length; i++) {
        var domain = proxyDomains[i];
        if (host === domain || host.endsWith('.' + domain)) {
            return proxyStr;
        }
    }
    
    return 'DIRECT';
}
`;
}

// 更新徽章
function updateBadge(enabled) {
    if (enabled) {
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    } else {
        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#9E9E9E' });
    }
}

// Handle proxy auth - 使用内存缓存同步返回，避免异步超时
chrome.webRequest.onAuthRequired.addListener(
    (details) => {
        if (cachedConfig && cachedConfig.servers) {
            const server = cachedConfig.servers.find(s => s.id === cachedConfig.activeServerId) || cachedConfig.servers[0];
            if (server && server.username) {
                return {
                    authCredentials: {
                        username: server.username,
                        password: server.password || ''
                    }
                };
            }
        }
        return { cancel: false };
    },
    { urls: ['<all_urls>'] },
    ['blocking']
);

// Base64 解码函数
function base64Decode(str) {
    try {
        const cleanStr = str.replace(/\s/g, '');
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let result = [];
        let i = 0;

        while (i < cleanStr.length) {
            const c1 = chars.indexOf(cleanStr[i++]);
            const c2 = chars.indexOf(cleanStr[i++]);
            const c3 = chars.indexOf(cleanStr[i++]);
            const c4 = chars.indexOf(cleanStr[i++]);

            const bits = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;

            result.push((bits >> 16) & 0xFF);
            if (c3 !== 64) result.push((bits >> 8) & 0xFF);
            if (c4 !== 64) result.push(bits & 0xFF);
        }

        return new TextDecoder().decode(new Uint8Array(result));
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
            const match = trimmed.match(/\|https?:\/\/([^\/\|]+)/);
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

        // Try fetch without CORS mode (Service Worker can bypass CORS)
        fetch(message.url)
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

    return false;
});

// 启动时立即初始化（Service Worker 唤醒时）
function initConfig() {
    chrome.storage.local.get(['config'], (result) => {
        cachedConfig = result.config || DEFAULT_CONFIG;
        updateProxy(cachedConfig);
    });
}

// 立即执行初始化
initConfig();

// 监听 Service Worker 启动
chrome.runtime.onStartup.addListener(() => {
    initConfig();
});
