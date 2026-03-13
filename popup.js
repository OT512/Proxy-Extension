// OT512 Proxy - Popup Script

document.addEventListener('DOMContentLoaded', () => {
    // 元素引用
    const enableToggleHeader = document.getElementById('enableToggleHeader');
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.panel');
    const modeOptions = document.querySelectorAll('.mode-option');
    const serverList = document.getElementById('serverList');
    const currentServerDiv = document.getElementById('currentServer');
    const addServerBtn = document.getElementById('addServerBtn');
    const serverModal = document.getElementById('serverModal');
    const closeModal = document.getElementById('closeModal');
    const saveServerBtn = document.getElementById('saveServerBtn');
    const modalTitle = document.getElementById('modalTitle');
    const rulesCount = document.getElementById('rulesCount');
    const lastUpdate = document.getElementById('lastUpdate');
    const clearRulesBtn = document.getElementById('clearRulesBtn');
    const ruleSourcesList = document.getElementById('ruleSourcesList');
    const addRuleSourceBtn = document.getElementById('addRuleSourceBtn');
    const ruleSourceModal = document.getElementById('ruleSourceModal');
    const closeRuleSourceModal = document.getElementById('closeRuleSourceModal');
    const saveRuleSourceBtn = document.getElementById('saveRuleSourceBtn');
    const importRuleSourceBtn = document.getElementById('importRuleSourceBtn');
    const importStatus = document.getElementById('importStatus');
    const ruleSourceModalTitle = document.getElementById('ruleSourceModalTitle');

    // 当前配置
    let config = null;
    let editingServerId = null;
    let editingRuleSourceId = null;
    let importedRules = null; // 临时存储导入的规则
    // Toast notification
    function showToast(message, type = 'info') {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = 'toast ' + type;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
    }

    // Custom confirm dialog
    function showConfirm(message) {
        return new Promise((resolve) => {
            let dialog = document.querySelector('.confirm-dialog');
            if (!dialog) {
                dialog = document.createElement('div');
                dialog.className = 'confirm-dialog';
                dialog.innerHTML = `
                    <div class="confirm-content">
                        <p class="confirm-message"></p>
                        <div class="confirm-buttons">
                            <button class="btn-cancel">取消</button>
                            <button class="btn-ok">确定</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(dialog);
            }
            dialog.querySelector('.confirm-message').textContent = message;
            dialog.classList.add('show');

            const cancelBtn = dialog.querySelector('.btn-cancel');
            const okBtn = dialog.querySelector('.btn-ok');

            // Clone and replace buttons to remove any previous listeners
            const newCancel = cancelBtn.cloneNode(true);
            const newOk = okBtn.cloneNode(true);
            cancelBtn.replaceWith(newCancel);
            okBtn.replaceWith(newOk);

            function cleanup(result) {
                dialog.classList.remove('show');
                resolve(result);
            }

            newCancel.addEventListener('click', () => cleanup(false));
            newOk.addEventListener('click', () => cleanup(true));
        });
    }

    // 加载配置
    loadConfig();

    function loadConfig() {
        chrome.storage.local.get(['config'], (result) => {
            config = result.config || getDefaultConfig();
            updateUI();
        });
    }

    // Default config — mirrors createDefaultConfig() in background.js
    const DEFAULT_CONFIG = {
        enabled: false,
        servers: [],
        activeServerId: null,
        proxyMode: 'rules',
        rules: [],
        lastUpdate: null,
        ruleSources: []
    };
    function getDefaultConfig() { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }

    function saveConfig() {
        chrome.storage.local.set({ config });
    }

    function updateUI() {
        enableToggleHeader.checked = config.enabled;
        modeOptions.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.mode === config.proxyMode);
        });
        renderServerList();
        renderCurrentServer();
        updateRulesInfo();
        renderRuleSources();

        // 自动检测当前服务器连接状态
        autoTestCurrentServer();

        // Hide loading overlay after UI is ready
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }

    // 监听 background 推送的实时代理状态（真实流量监控结果）
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'proxyStatusChanged') {
            const server = config?.servers?.find(s => s.id === config.activeServerId);
            if (server && message.serverId === server.id) {
                serverStatusCache[server.id] = { status: message.status, latency: message.latency || null };
                renderCurrentServer();
            }
        }
    });

    let isTesting = false;  // prevent concurrent test requests

    async function testServerConnection(server) {
        if (!server) return;
        if (isTesting) return;  // already testing, ignore
        isTesting = true;

        serverStatusCache[server.id] = { status: 'checking' };
        renderCurrentServer();

        try {
            await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'testServer', server }, (res) => {
                    if (chrome.runtime.lastError || !res) {
                        serverStatusCache[server.id] = { status: 'fail', latency: null };
                    } else if (res.status === 'busy') {
                        // Another test is already running — keep 'checking' state, don't overwrite
                    } else {
                        const statusObj = { status: res.status, latency: res.latency || null };
                        serverStatusCache[server.id] = statusObj;
                    }
                    renderCurrentServer();
                    resolve();
                });
            });
        } finally {
            isTesting = false;
        }
    }

    // 从 session storage 恢复流量监控状态（background 写入，popup 读取展示）
    async function autoTestCurrentServer() {
        const server = config.servers.find(s => s.id === config.activeServerId);
        if (!server) return;
        if (serverStatusCache[server.id]) { renderCurrentServer(); return; }
        try {
            const stored = await chrome.storage.session.get(['proxyStatus']);
            const ps = stored.proxyStatus;
            if (ps && ps.serverId === server.id) {
                serverStatusCache[server.id] = { status: ps.status, latency: ps.latency || null };
                renderCurrentServer();
            }
        } catch (_) {}
    }


    // 标签切换
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            panels.forEach(p => p.classList.remove('active'));
            document.getElementById(tab.dataset.tab + 'Panel').classList.add('active');
        });
    });

    // 启用/禁用代理
    enableToggleHeader.addEventListener('change', () => {
        config.enabled = enableToggleHeader.checked;
        saveConfig();
        // 更新当前服务器状态显示
        renderCurrentServer();
    });

    // 模式选择
    modeOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            modeOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            config.proxyMode = opt.dataset.mode;
            saveConfig();
        });
    });

    // 服务器状态缓存 { status: 'success'|'fail'|'auth-fail'|'checking', latency }
    const serverStatusCache = {};

    // 返回连接状态徽章 HTML
    // 当前服务器条目的自动认证状态（来自真实流量监控，非主动测试）
    function connStatusBadge(serverId) {
        if (!config.enabled) return '<span class="conn-status disconnected">已禁用</span>';
        const s = serverStatusCache[serverId];
        if (!s) return '<span class="conn-status disconnected">未知</span>';
        if (s.status === 'checking') return '<span class="conn-status testing">检测中...</span>';
        if (s.status === 'success') {
            const ping = s.latency ? ` <span class="ping-value">${s.latency}ms</span>` : '';
            return `<span class="conn-status connected">代理正常</span>${ping}`;
        }
        if (s.status === 'auth-fail') return '<span class="conn-status auth-fail">密码错误</span>';
        if (s.status === 'timeout') return '<span class="conn-status disconnected">连接超时</span>';
        if (s.status === 'fail') return '<span class="conn-status disconnected">连接失败</span>';
        return '<span class="conn-status disconnected">未知</span>';
    }

    // 渲染服务器列表
    function renderServerList() {
        serverList.innerHTML = '';
        config.servers.forEach(server => {
            const item = document.createElement('div');
            item.className = 'server-item' + (server.id === config.activeServerId ? ' active' : '');
            item.innerHTML = `
                <div class="radio"></div>
                <div class="server-info">
                    <div class="server-name">${server.name}<span class="test-result" style="display:none;"></span></div>
                    <div class="server-detail">${server.type.toUpperCase()} - ${server.host}:${server.port}</div>
                    <div class="test-progress"></div>
                </div>
                <div class="server-actions">
                    <button class="btn-icon test" data-id="${server.id}" title="检测可达">⚡</button>
                    <button class="btn-icon edit" data-id="${server.id}" title="编辑">✎</button>
                    <button class="btn-icon delete" data-id="${server.id}" title="删除">✕</button>
                </div>
            `;

            item.querySelector('.server-info').addEventListener('click', () => {
                config.activeServerId = server.id;
                saveConfig();
                renderServerList();
                renderCurrentServer();
            });

            item.querySelector('.edit').addEventListener('click', (e) => {
                e.stopPropagation();
                openEditServer(server);
            });

            item.querySelector('.delete').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (config.servers.length > 1) {
                    const confirmed = await showConfirm('确定要删除此服务器吗？');
                    if (confirmed) {
                        config.servers = config.servers.filter(s => s.id !== server.id);
                        if (config.activeServerId === server.id) {
                            config.activeServerId = config.servers[0].id;
                        }
                        saveConfig();
                        renderServerList();
                        renderCurrentServer();
                        showToast('服务器已删除', 'success');
                    }
                } else {
                    showToast('至少保留一个服务器', 'error');
                }
            });

            // 测试按钮点击事件
            item.querySelector('.test').addEventListener('click', async (e) => {
                e.stopPropagation();
                await testServer(server, item);
            });

            serverList.appendChild(item);
        });
    }

    // 测试服务器：统一走 background testServer，根据 authStatus 显示结果
    async function testServer(server, item) {
        const testBtn = item.querySelector('.btn-icon.test');
        const testResult = item.querySelector('.test-result');

        item.classList.remove('test-success', 'test-fail');
        item.classList.add('testing');
        if (testResult) testResult.style.display = 'none';
        if (testBtn) { testBtn.disabled = true; testBtn.textContent = '...'; }

        serverStatusCache[server.id] = { status: 'checking' };
        renderCurrentServer();

        const startTime = Date.now();
        await testServerConnection(server);
        await new Promise(r => setTimeout(r, Math.max(0, 1500 - (Date.now() - startTime))));

        item.classList.remove('testing');
        const cached = serverStatusCache[server.id];

        if (cached.status === 'success') {
            item.classList.add('test-success');
            showToast(`${server.name} 服务器在线${cached.latency ? ' (' + cached.latency + 'ms)' : ''}`, 'success');
            if (testResult) {
                testResult.textContent = cached.latency ? `${cached.latency}ms` : 'OK';
                testResult.className = 'test-result success';
                testResult.style.display = 'inline';
            }
        } else if (cached.status === 'auth-fail') {
            item.classList.add('test-fail');
            showToast(`${server.name} 用户名/密码错误`, 'error');
            if (testResult) { testResult.textContent = '鉴权失败'; testResult.className = 'test-result fail'; testResult.style.display = 'inline'; }
        } else if (cached.status === 'timeout') {
            item.classList.add('test-fail');
            showToast(`${server.name} 连接超时`, 'error');
            if (testResult) { testResult.textContent = '超时'; testResult.className = 'test-result fail'; testResult.style.display = 'inline'; }
        } else {
            item.classList.add('test-fail');
            showToast(`${server.name} 服务器不可达`, 'error');
            if (testResult) { testResult.textContent = '失败'; testResult.className = 'test-result fail'; testResult.style.display = 'inline'; }
        }

        if (testBtn) { testBtn.disabled = false; testBtn.textContent = '⚡'; }
        renderCurrentServer();
    }

    // 渲染当前服务器
    function renderCurrentServer() {
        const server = config.servers.find(s => s.id === config.activeServerId);
        if (server) {
            currentServerDiv.innerHTML = `
                <div class="server-item active" style="position: relative;">
                    <div class="server-info">
                        <div class="server-name">${server.name}${connStatusBadge(server.id)}</div>
                    </div>
                </div>
            `;
        }
    }

    // 打开添加服务器弹窗
    addServerBtn.addEventListener('click', () => {
        editingServerId = null;
        modalTitle.textContent = '添加服务器';
        clearServerForm();
        serverModal.classList.add('show');
        // 撑开背景高度以适应弹窗
        document.body.style.minHeight = '520px';
    });

    // 打开编辑服务器弹窗
    function openEditServer(server) {
        editingServerId = server.id;
        modalTitle.textContent = '编辑服务器';
        document.getElementById('serverName').value = server.name;
        document.getElementById('serverType').value = server.type;
        document.getElementById('serverHost').value = server.host;
        document.getElementById('serverPort').value = server.port || 443;
        document.getElementById('serverUsername').value = server.username || '';
        document.getElementById('serverPassword').value = server.password || '';
        serverModal.classList.add('show');
        // 撑开背景高度以适应弹窗
        document.body.style.minHeight = '520px';
    }

    closeModal.addEventListener('click', () => {
        serverModal.classList.remove('show');
        // 恢复原始高度
        document.body.style.minHeight = '';
    });

    // Prevent clicks on modal background from closing the popup
    serverModal.addEventListener('mousedown', (e) => {
        if (e.target === serverModal) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    serverModal.addEventListener('mouseup', (e) => {
        if (e.target === serverModal) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    serverModal.addEventListener('contextmenu', (e) => {
        if (e.target === serverModal) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    function clearServerForm() {
        document.getElementById('serverName').value = '';
        document.getElementById('serverType').value = 'https';
        document.getElementById('serverHost').value = '';
        document.getElementById('serverPort').value = '443';
        document.getElementById('serverUsername').value = '';
        document.getElementById('serverPassword').value = '';
    }

    // 保存服务器
    saveServerBtn.addEventListener('click', () => {
        const name = document.getElementById('serverName').value.trim();
        const type = document.getElementById('serverType').value;
        const host = document.getElementById('serverHost').value.trim();
        const port = parseInt(document.getElementById('serverPort').value, 10);
        const username = document.getElementById('serverUsername').value.trim();
        const password = document.getElementById('serverPassword').value;

        if (!name || !host) {
            showToast('请填写服务器名称和地址', 'error');
            return;
        }
        if (!port || port < 1 || port > 65535) {
            showToast('请填写有效的端口号（1-65535）', 'error');
            return;
        }

        let credChanged = false;
        if (editingServerId) {
            const server = config.servers.find(s => s.id === editingServerId);
            if (server) {
                credChanged = server.username !== username ||
                              server.password !== password ||
                              server.host !== host ||
                              server.port !== port;
                server.name = name;
                server.type = type;
                server.host = host;
                server.port = port;
                server.username = username;
                server.password = password;
                if (credChanged) delete serverStatusCache[server.id];
            }
        } else {
            credChanged = true;
            const newId = Math.max(...config.servers.map(s => s.id), 0) + 1;
            // Default port is 443, will be switched automatically when credentials change
            config.servers.push({ id: newId, name, type, host, port, username, password });
            config.activeServerId = newId;
        }

        saveConfig();
        serverModal.classList.remove('show');
        // 恢复原始高度
        document.body.style.minHeight = '';
        renderServerList();
        renderCurrentServer();

        // 如果凭据或地址有变化，提示用户重启浏览器以清除代理认证缓存
        if (credChanged) {
            showToast('设置已保存。如代理未立即生效，请重启浏览器', 'info');
        }

        // 保存服务器后立即检测鉴权状态
        const saved = config.servers.find(s => s.id === config.activeServerId);
        if (saved) {
            serverStatusCache[saved.id] = { status: 'checking' };
            renderCurrentServer();
            testServerConnection(saved);
        }
    });

    // 更新规则信息（显示已启用规则源的总规则数）
    function updateRulesInfo() {
        // 计算所有已启用规则源的规则总数
        let totalRules = 0;
        if (config.ruleSources) {
            config.ruleSources.forEach(source => {
                if (source.enabled && source.rules) {
                    totalRules += source.rules.length;
                }
            });
        }

        rulesCount.textContent = totalRules;

        if (config.lastUpdate) {
            const date = new Date(config.lastUpdate);
            lastUpdate.textContent = `更新于: ${date.toLocaleString()}`;
        } else {
            lastUpdate.textContent = '未导入规则';
        }
    }

    // 渲染规则源列表
    function renderRuleSources() {
        ruleSourcesList.innerHTML = '';

        if (!config.ruleSources || config.ruleSources.length === 0) {
            ruleSourcesList.innerHTML = '<div style="text-align:center;color:#666;padding:10px;font-size:12px;">暂无规则源，请添加</div>';
            return;
        }

        config.ruleSources.forEach(source => {
            const item = document.createElement('div');
            item.className = 'rule-source';
            item.dataset.sourceId = source.id;
            item.innerHTML = `
                <label class="toggle-small">
                    <input type="checkbox" class="source-enabled" ${source.enabled ? 'checked' : ''}>
                    <span class="slider-small"></span>
                </label>
                <div class="source-info">
                    <div class="source-name">${source.name}</div>
                    <div class="source-desc">${source.desc || ''} ${source.rules ? `(${source.rules.length}条)` : ''}</div>
                </div>
                <button class="btn-icon update-source" title="更新">↻</button>
                <button class="btn-icon edit-source" title="编辑">✎</button>
                <button class="btn-icon delete delete-source" title="删除">✕</button>
            `;

            item.querySelector('.source-enabled').addEventListener('change', (e) => {
                source.enabled = e.target.checked;
                saveConfig();
                updateRulesInfo();
            });

            item.querySelector('.update-source').addEventListener('click', () => {
                updateRuleSource(source);
            });

            item.querySelector('.edit-source').addEventListener('click', () => {
                openEditRuleSource(source);
            });

            item.querySelector('.delete-source').addEventListener('click', () => {
                config.ruleSources = config.ruleSources.filter(s => s.id !== source.id);
                saveConfig();
                renderRuleSources();
                updateRulesInfo();
            });

            ruleSourcesList.appendChild(item);
        });
    }

    // 更新规则源
    async function updateRuleSource(source) {
        if (!source.url) {
            showToast('规则源URL为空', 'error');
            return;
        }

        try {
            const rules = await fetchRules(source.url);
            source.rules = rules;
            source.lastUpdate = new Date().toISOString();
            config.lastUpdate = new Date().toISOString();
            saveConfig();
            renderRuleSources();
            updateRulesInfo();
            showToast(`成功导入 ${rules.length} 条规则`, 'success');
        } catch (error) {
            showToast('导入失败: ' + error.message, 'error');
        }
    }

    // 打开添加规则源弹窗
    addRuleSourceBtn.addEventListener('click', () => {
        editingRuleSourceId = null;
        importedRules = null;
        ruleSourceModalTitle.textContent = '添加规则源';
        document.getElementById('ruleSourceName').value = '';
        document.getElementById('ruleSourceType').value = 'proxy';
        document.getElementById('ruleSourceUrl').value = '';
        document.getElementById('ruleSourceDesc').value = '';
        importStatus.textContent = '';
        importStatus.style.color = '#888';
        ruleSourceModal.classList.add('show');
        // 撑开背景高度以适应弹窗
        document.body.style.minHeight = '580px';
    });

    // 打开编辑规则源弹窗
    function openEditRuleSource(source) {
        editingRuleSourceId = source.id;
        importedRules = null;
        ruleSourceModalTitle.textContent = '编辑规则源';
        document.getElementById('ruleSourceName').value = source.name || '';
        document.getElementById('ruleSourceType').value = source.ruleType || 'proxy';
        document.getElementById('ruleSourceUrl').value = source.url || '';
        document.getElementById('ruleSourceDesc').value = source.desc || '';
        importStatus.textContent = source.rules ? `已导入 ${source.rules.length} 条规则` : '';
        importStatus.style.color = '#888';
        ruleSourceModal.classList.add('show');
        // 撑开背景高度以适应弹窗
        document.body.style.minHeight = '580px';
    }

    closeRuleSourceModal.addEventListener('click', () => {
        ruleSourceModal.classList.remove('show');
        // 恢复原始高度
        document.body.style.minHeight = '';
    });

    // Prevent clicks on modal background from closing the popup
    ruleSourceModal.addEventListener('mousedown', (e) => {
        if (e.target === ruleSourceModal) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    ruleSourceModal.addEventListener('mouseup', (e) => {
        if (e.target === ruleSourceModal) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    ruleSourceModal.addEventListener('contextmenu', (e) => {
        if (e.target === ruleSourceModal) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // 导入规则
    importRuleSourceBtn.addEventListener('click', async () => {
        const url = document.getElementById('ruleSourceUrl').value.trim();
        const content = document.getElementById('ruleSourceContent').value.trim();

        if (!url && !content) {
            showToast('请输入规则文件URL或粘贴规则内容', 'error');
            return;
        }

        importRuleSourceBtn.disabled = true;
        importRuleSourceBtn.textContent = '导入中...';
        importStatus.textContent = '正在处理...';
        importStatus.style.color = '#888';

        try {
            let rules;
            if (content) {
                // 通过 background 解析（复用 background 的 parseRules 逻辑）
                rules = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ action: 'importRules', content }, (res) => {
                        if (chrome.runtime.lastError || !res?.success) reject(new Error(res?.error || '解析失败'));
                        else resolve(res.rules);
                    });
                });
            } else {
                // 从URL获取
                rules = await fetchRules(url);
            }

            importedRules = rules;
            importStatus.textContent = `成功导入 ${rules.length} 条规则`;
            importStatus.style.color = '#4CAF50';
        } catch (error) {
            importedRules = null;
            importStatus.textContent = '导入失败: ' + error.message;
            importStatus.style.color = '#f44336';
        }

        importRuleSourceBtn.disabled = false;
        importRuleSourceBtn.textContent = '导入';
    });

    // Fetch rules - use background script to avoid CORS issues
    async function fetchRules(url) {
        console.log('Fetching rules from:', url);

        return new Promise((resolve, reject) => {
            // Try via background script first (avoids CORS issues in MV3)
            chrome.runtime.sendMessage(
                { action: 'fetchRules', url: url },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Runtime error:', chrome.runtime.lastError);
                        reject(new Error('扩展服务未响应，请重试'));
                        return;
                    }

                    if (response && response.success) {
                        console.log('Fetched rules count:', response.count);
                        resolve(response.rules);
                    } else {
                        const errorMsg = response?.error || '获取规则失败';
                        console.error('Fetch error:', errorMsg);
                        // 提供更友好的错误提示
                        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
                            reject(new Error('网络无法访问，请确保代理已启用并工作在 [全局] 模式或使用可直连的规则URL'));
                        } else {
                            reject(new Error(errorMsg));
                        }
                    }
                }
            );
        });
    }


    // 保存规则源
    saveRuleSourceBtn.addEventListener('click', () => {
        const name = document.getElementById('ruleSourceName').value.trim();
        const ruleType = document.getElementById('ruleSourceType').value;
        const url = document.getElementById('ruleSourceUrl').value.trim();
        const desc = document.getElementById('ruleSourceDesc').value.trim();

        if (!name) {
            showToast('请填写规则源名称', 'error');
            return;
        }

        if (!importedRules && !editingRuleSourceId) {
            showToast('请先导入规则', 'error');
            return;
        }

        if (!config.ruleSources) {
            config.ruleSources = [];
        }

        if (editingRuleSourceId) {
            const source = config.ruleSources.find(s => s.id === editingRuleSourceId);
            if (source) {
                source.name = name;
                source.ruleType = ruleType;
                source.url = url;
                source.desc = desc;
                if (importedRules) {
                    source.rules = importedRules;
                    source.lastUpdate = new Date().toISOString();
                }
            }
        } else {
            const newId = 'source_' + Date.now();
            config.ruleSources.push({
                id: newId,
                name,
                ruleType,
                url,
                enabled: true,
                desc,
                rules: importedRules,
                lastUpdate: new Date().toISOString()
            });
        }

        config.lastUpdate = new Date().toISOString();
        saveConfig();
        ruleSourceModal.classList.remove('show');
        // 恢复原始高度
        document.body.style.minHeight = '';
        renderRuleSources();
        updateRulesInfo();
    });

    // 清除规则
    clearRulesBtn.addEventListener('click', async () => {
        const confirmed = await showConfirm('确定要清除所有规则吗？');
        if (confirmed) {
            config.ruleSources.forEach(source => {
                source.rules = [];
            });
            config.lastUpdate = null;
            saveConfig();
            updateRulesInfo();
            renderRuleSources();
            showToast('规则已清除', 'success');
        }
    });

    // 导入默认 GFWList
    const importGFWListBtn = document.getElementById('importGFWListBtn');
    if (importGFWListBtn) {
        importGFWListBtn.addEventListener('click', async () => {
            if (!config.enabled) {
                showToast('请先启用代理', 'error');
                return;
            }
            const server = config.servers.find(s => s.id === config.activeServerId);
            if (!server) {
                showToast('请先添加服务器', 'error');
                return;
            }
            const origText = importGFWListBtn.textContent;
            importGFWListBtn.disabled = true;
            importGFWListBtn.textContent = '导入中...';
            showToast('正在下载 GFWList...', 'info');

            chrome.runtime.sendMessage({ action: 'importDefaultGFWList' }, (response) => {
                importGFWListBtn.disabled = false;
                importGFWListBtn.textContent = origText;
                if (chrome.runtime.lastError) {
                    showToast('导入失败: ' + chrome.runtime.lastError.message, 'error');
                    return;
                }
                if (response && response.success) {
                    showToast(`GFWList 导入成功 (${response.count} 条规则)，已切换智能分流`, 'success');
                    // Reload config from storage to reflect changes made by background
                    loadConfig();
                } else {
                    showToast('导入失败: ' + (response?.error || '未知错误'), 'error');
                }
            });
        });
    }

    // Version badge (GitHub style) — version pulled from background
    const versionBadge = document.getElementById('versionBadge');
    const ghBadgeRight = document.getElementById('ghBadgeRight');
    if (versionBadge) {
        // Get version from background (single source of truth: EXTENSION_VERSION)
        chrome.runtime.sendMessage({ action: 'getVersion' }, (res) => {
            if (res?.version && ghBadgeRight) {
                ghBadgeRight.textContent = `v${res.version}`;
            }
        });
        chrome.storage.local.get(['updateAvailable'], (result) => {
            if (result.updateAvailable) versionBadge.classList.add('has-update');
        });
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.updateAvailable) {
                versionBadge.classList.toggle('has-update', !!changes.updateAvailable.newValue);
            }
        });
        versionBadge.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.sendMessage({ action: 'getVersion' }, (res) => {
                const repo = res?.githubRepo;
                if (repo) chrome.tabs.create({ url: `https://github.com/${repo}` });
            });
        });
    }
});
