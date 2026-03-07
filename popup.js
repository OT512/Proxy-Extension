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

            function cleanup(result) {
                dialog.classList.remove('show');
                cancelBtn.removeEventListener('click', () => cleanup(false));
                okBtn.removeEventListener('click', () => cleanup(true));
                resolve(result);
            }

            cancelBtn.addEventListener('click', () => cleanup(false));
            okBtn.addEventListener('click', () => cleanup(true));
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

    function getDefaultConfig() {
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

    function saveConfig() {
        chrome.storage.local.set({ config });
    }

    function updateUI() {
        updateStatus(config.enabled);
        enableToggleHeader.checked = config.enabled;
        modeOptions.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.mode === config.proxyMode);
        });
        renderServerList();
        renderCurrentServer();
        updateRulesInfo();
        renderRuleSources();

        // Hide loading overlay after UI is ready
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }

    function updateStatus(enabled) {
        // Status is now shown via the toggle switch in header
        // No separate status dot/text needed
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
        updateStatus(config.enabled);
        saveConfig();
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

    // 服务器状态缓存
    const serverStatusCache = {};

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
                    <div class="server-detail">${server.type.toUpperCase()} - ${server.host}</div>
                    <div class="test-progress"></div>
                </div>
                <div class="server-actions">
                    <button class="btn-icon test" data-id="${server.id}" title="测试连接">⚡</button>
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

        // 绑定测试按钮事件（使用事件委托）
        serverList.querySelectorAll('.btn-icon.test').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const serverId = parseInt(btn.dataset.id);
                const server = config.servers.find(s => s.id === serverId);
                const item = btn.closest('.server-item');
                if (server && item) {
                    await testServer(server, item);
                }
            });
        });
    }

    // 测试服务器连接
    async function testServer(server, item) {
        const testBtn = item.querySelector('.btn-icon.test');
        const testResult = item.querySelector('.test-result');
        const testProgress = item.querySelector('.test-progress');

        // 检查是否是当前服务器行（没有测试按钮）
        const isCurrentServerRow = !testBtn;

        // 重置状态
        item.classList.remove('test-success', 'test-fail');
        item.classList.add('testing');
        if (testResult) testResult.style.display = 'none';
        if (testBtn) {
            testBtn.disabled = true;
            testBtn.textContent = '...';
        }

        const startTime = Date.now();
        let testSuccess = false;
        let testLatency = null;
        let testError = null;

        try {
            // 发送测试请求到 background
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { action: 'testServer', server: server },
                    (res) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(res);
                        }
                    }
                );
            });

            testLatency = Date.now() - startTime;

            if (response && response.success) {
                testSuccess = true;
                serverStatusCache[server.id] = { status: 'success', latency: testLatency };
            } else {
                throw new Error(response?.error || '连接失败');
            }
        } catch (error) {
            testSuccess = false;
            testError = error.message;
            serverStatusCache[server.id] = { status: 'fail', latency: null };
        }

        // 等待进度条动画完成（2秒）再显示结果
        const elapsed = Date.now() - startTime;
        const animationDuration = 2000;
        const remainingTime = Math.max(0, animationDuration - elapsed);

        await new Promise(resolve => setTimeout(resolve, remainingTime));

        // 显示结果
        item.classList.remove('testing');

        if (testSuccess) {
            item.classList.add('test-success');
            if (testResult) {
                testResult.textContent = `${testLatency}ms`;
                testResult.className = 'test-result success';
                testResult.style.display = 'inline';
            }
            showToast(`${server.name} 连接成功 (${testLatency}ms)`, 'success');
        } else {
            item.classList.add('test-fail');
            if (testResult) {
                testResult.textContent = '失败';
                testResult.className = 'test-result fail';
                testResult.style.display = 'inline';
            }
            showToast(`${server.name} 连接失败: ${testError}`, 'error');
        }

        // 恢复按钮状态
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.textContent = '⚡';
        }
    }

    // 渲染当前服务器
    function renderCurrentServer() {
        const server = config.servers.find(s => s.id === config.activeServerId);
        if (server) {
            const status = serverStatusCache[server.id] || { status: 'unknown', latency: null };
            const latencyText = status.latency ? `${status.latency}ms` : '';

            currentServerDiv.innerHTML = `
                <div class="server-item active" style="cursor: pointer; position: relative;">
                    <div class="server-info">
                        <div class="server-name">${server.name}</div>
                        <div class="test-progress"></div>
                    </div>
                    <div class="server-actions">
                        <span class="test-result" style="display: ${latencyText ? 'inline' : 'none'};">${latencyText}</span>
                    </div>
                </div>
            `;

            // 点击当前服务器行时重新测试连接
            currentServerDiv.querySelector('.server-item').addEventListener('click', async () => {
                const item = currentServerDiv.querySelector('.server-item');
                await testServer(server, item);
            });
        }
    }

    // 打开添加服务器弹窗
    addServerBtn.addEventListener('click', () => {
        editingServerId = null;
        modalTitle.textContent = '添加服务器';
        clearServerForm();
        serverModal.classList.add('show');
    });

    // 打开编辑服务器弹窗
    function openEditServer(server) {
        editingServerId = server.id;
        modalTitle.textContent = '编辑服务器';
        document.getElementById('serverName').value = server.name;
        document.getElementById('serverType').value = server.type;
        document.getElementById('serverHost').value = server.host;
        document.getElementById('serverUsername').value = server.username || '';
        document.getElementById('serverPassword').value = server.password || '';
        serverModal.classList.add('show');
    }

    closeModal.addEventListener('click', () => serverModal.classList.remove('show'));

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
        document.getElementById('serverUsername').value = '';
        document.getElementById('serverPassword').value = '';
    }

    // 保存服务器
    saveServerBtn.addEventListener('click', () => {
        const name = document.getElementById('serverName').value.trim();
        const type = document.getElementById('serverType').value;
        const host = document.getElementById('serverHost').value.trim();
        const username = document.getElementById('serverUsername').value.trim();
        const password = document.getElementById('serverPassword').value;

        if (!name || !host) {
            showToast('请填写服务器名称和地址', 'error');
            return;
        }

        if (editingServerId) {
            const server = config.servers.find(s => s.id === editingServerId);
            if (server) {
                server.name = name;
                server.type = type;
                server.host = host;
                server.username = username;
                server.password = password;
                // Port is managed automatically (443/8443 switching)
            }
        } else {
            const newId = Math.max(...config.servers.map(s => s.id), 0) + 1;
            // Default port is 443, will be switched automatically when credentials change
            config.servers.push({ id: newId, name, type, host, port: 443, username, password });
            config.activeServerId = newId;
        }

        saveConfig();
        serverModal.classList.remove('show');
        renderServerList();
        renderCurrentServer();
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
    }

    closeRuleSourceModal.addEventListener('click', () => ruleSourceModal.classList.remove('show'));

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
                // 直接从粘贴的内容解析
                rules = parseRules(content);
                console.log('Parsed from content:', rules.length);
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

    // 解析规则文件（支持 Base64 编码）
    function parseRules(text) {
        let content = text.trim();

        // 尝试 Base64 解码
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

    // Base64 解码
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
            return null;
        }
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

    // Version check and update notification
    const versionInfo = document.getElementById('versionInfo');
    const updateNotice = document.getElementById('updateNotice');

    // Get version from background
    chrome.runtime.sendMessage({ action: 'getVersion' }, (response) => {
        if (response && response.version) {
            versionInfo.textContent = `OT512 Proxy v${response.version}`;
        }
    });

    // Check for update availability
    chrome.storage.local.get(['updateAvailable'], (result) => {
        if (result.updateAvailable) {
            showUpdateNotice(result.updateAvailable);
        }
    });

    // Listen for storage changes (update notification)
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.updateAvailable) {
            if (changes.updateAvailable.newValue) {
                showUpdateNotice(changes.updateAvailable.newValue);
            } else {
                updateNotice.style.display = 'none';
            }
        }
    });

    function showUpdateNotice(updateInfo) {
        updateNotice.style.display = 'inline';
        updateNotice.textContent = `🔄 v${updateInfo.latestVersion}`;
        updateNotice.title = `点击下载新版本 v${updateInfo.latestVersion}`;

        updateNotice.onclick = () => {
            chrome.tabs.create({ url: `https://github.com/boy86001/OT512-Proxy-Extension/releases` });
        };
    }
});
