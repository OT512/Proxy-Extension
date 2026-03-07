// OT512 Proxy - Popup Script

document.addEventListener('DOMContentLoaded', () => {
    // 元素引用
    const enableToggle = document.getElementById('enableToggle');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
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
        enableToggle.checked = config.enabled;
        modeOptions.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.mode === config.proxyMode);
        });
        renderServerList();
        renderCurrentServer();
        updateRulesInfo();
        renderRuleSources();
    }

    function updateStatus(enabled) {
        if (enabled) {
            statusDot.classList.add('active');
            statusText.textContent = '已连接';
        } else {
            statusDot.classList.remove('active');
            statusText.textContent = '已断开';
        }
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
    enableToggle.addEventListener('change', () => {
        config.enabled = enableToggle.checked;
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

    // 渲染服务器列表
    function renderServerList() {
        serverList.innerHTML = '';
        config.servers.forEach(server => {
            const item = document.createElement('div');
            item.className = 'server-item' + (server.id === config.activeServerId ? ' active' : '');
            item.innerHTML = `
                <div class="radio"></div>
                <div class="server-info">
                    <div class="server-name">${server.name}</div>
                    <div class="server-detail">${server.type.toUpperCase()} - ${server.host}:${server.port}</div>
                </div>
                <div class="server-actions">
                    <button class="btn-icon edit" data-id="${server.id}">✎</button>
                    <button class="btn-icon delete" data-id="${server.id}">✕</button>
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

            serverList.appendChild(item);
        });
    }

    // 渲染当前服务器
    function renderCurrentServer() {
        const server = config.servers.find(s => s.id === config.activeServerId);
        if (server) {
            currentServerDiv.innerHTML = `
                <div class="server-item active">
                    <div class="server-info">
                        <div class="server-name">${server.name}</div>
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
    });

    // 打开编辑服务器弹窗
    function openEditServer(server) {
        editingServerId = server.id;
        modalTitle.textContent = '编辑服务器';
        document.getElementById('serverName').value = server.name;
        document.getElementById('serverType').value = server.type;
        document.getElementById('serverHost').value = server.host;
        document.getElementById('serverPort').value = server.port;
        document.getElementById('serverUsername').value = server.username || '';
        document.getElementById('serverPassword').value = server.password || '';
        serverModal.classList.add('show');
    }

    closeModal.addEventListener('click', () => serverModal.classList.remove('show'));
    serverModal.addEventListener('click', (e) => {
        if (e.target === serverModal) serverModal.classList.remove('show');
    });

    function clearServerForm() {
        document.getElementById('serverName').value = '';
        document.getElementById('serverType').value = 'https';
        document.getElementById('serverHost').value = '';
        document.getElementById('serverPort').value = '';
        document.getElementById('serverUsername').value = '';
        document.getElementById('serverPassword').value = '';
    }

    // 保存服务器
    saveServerBtn.addEventListener('click', () => {
        const name = document.getElementById('serverName').value.trim();
        const type = document.getElementById('serverType').value;
        const host = document.getElementById('serverHost').value.trim();
        const port = parseInt(document.getElementById('serverPort').value);
        const username = document.getElementById('serverUsername').value.trim();
        const password = document.getElementById('serverPassword').value;

        if (!name || !host || !port) {
            showToast('请填写服务器名称、地址和端口', 'error');
            return;
        }

        if (editingServerId) {
            const server = config.servers.find(s => s.id === editingServerId);
            if (server) {
                server.name = name;
                server.type = type;
                server.host = host;
                server.port = port;
                server.username = username;
                server.password = password;
            }
        } else {
            const newId = Math.max(...config.servers.map(s => s.id), 0) + 1;
            config.servers.push({ id: newId, name, type, host, port, username, password });
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
        document.getElementById('ruleSourceName').value = source.name;
        document.getElementById('ruleSourceType').value = source.ruleType || 'proxy';
        document.getElementById('ruleSourceUrl').value = source.url;
        document.getElementById('ruleSourceDesc').value = source.desc || '';
        importStatus.textContent = source.rules ? `已导入 ${source.rules.length} 条规则` : '';
        importStatus.style.color = '#888';
        ruleSourceModal.classList.add('show');
    }

    closeRuleSourceModal.addEventListener('click', () => ruleSourceModal.classList.remove('show'));

    // Only close modal when mousedown starts on the modal background (not when dragging from inside)
    let mouseDownTarget = null;
    ruleSourceModal.addEventListener('mousedown', (e) => {
        mouseDownTarget = e.target;
    });
    ruleSourceModal.addEventListener('mouseup', (e) => {
        if (mouseDownTarget === ruleSourceModal && e.target === ruleSourceModal) {
            ruleSourceModal.classList.remove('show');
        }
        mouseDownTarget = null;
    });

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
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    if (response && response.success) {
                        console.log('Fetched rules count:', response.count);
                        resolve(response.rules);
                    } else {
                        const errorMsg = response?.error || 'Failed to fetch rules';
                        console.error('Fetch error:', errorMsg);
                        reject(new Error(errorMsg));
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
});