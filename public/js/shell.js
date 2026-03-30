/**
 * Shell — App framework for Container UI.
 * Manages connections, app lifecycle, and delegates layout to tiling.js.
 */
const shell = (function () {
  // ── State ──────────────────────────────────────────
  let currentConn = null;
  let currentPath = '/home/adom';
  let savedConnections = JSON.parse(localStorage.getItem('cui-connections') || '[]');
  let poolStatus = {};
  let tabCounter = 0;
  let registeredApps = {};  // appId -> { label, icon, factory, singleton }

  const LOCAL_CONN = { local: true };

  // ── API helpers ────────────────────────────────────
  const API_BASE = (() => {
    const loc = window.location;
    return loc.origin + loc.pathname.replace(/\/[^/]*$/, '');
  })();

  async function apiFetch(endpoint, body) {
    const res = await fetch(API_BASE + '/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function apiGet(endpoint) {
    const res = await fetch(API_BASE + '/api/' + endpoint);
    return res.json();
  }

  // ── Utilities ──────────────────────────────────────
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => el.className = 'toast', 2500);
  }

  function promptDialog(title, defaultValue) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'prompt-overlay';
      overlay.innerHTML = `<div class="prompt-box">
        <h3>${title}</h3>
        <input id="promptInput" value="${esc(defaultValue || '')}" autofocus>
        <div class="actions">
          <button class="btn secondary" id="promptCancel">Cancel</button>
          <button class="btn" id="promptOk">OK</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#promptInput');
      input.focus();
      input.select();
      const close = val => { overlay.remove(); resolve(val); };
      overlay.querySelector('#promptCancel').onclick = () => close(null);
      overlay.querySelector('#promptOk').onclick = () => close(input.value.trim());
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') close(input.value.trim());
        if (e.key === 'Escape') close(null);
      });
      overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    });
  }

  function confirmDialog(title, message) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'prompt-overlay';
      overlay.innerHTML = `<div class="prompt-box">
        <h3>${title}</h3>
        <p style="margin:8px 0 16px;color:var(--subtext0);line-height:1.4">${message}</p>
        <div class="actions">
          <button class="btn secondary" id="confirmCancel">Cancel</button>
          <button class="btn" id="confirmOk" style="background:var(--red)">Overwrite</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const close = val => { overlay.remove(); resolve(val); };
      overlay.querySelector('#confirmCancel').onclick = () => close(false);
      overlay.querySelector('#confirmOk').onclick = () => close(true);
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      });
      overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    });
  }

  // ── Connection Management ──────────────────────────
  function getPoolState(conn) {
    if (!conn) return 'disconnected';
    if (conn.local) return currentConn && currentConn.local ? 'connected' : 'disconnected';
    const key = `${conn.username || 'adom'}@${conn.host}:${conn.port || 2222}`;
    return poolStatus[key] || 'disconnected';
  }

  function setPoolDot(conn, state) {
    if (!conn || conn.local) { renderConnections(); return; }
    const key = `${conn.username || 'adom'}@${conn.host}:${conn.port || 2222}`;
    poolStatus[key] = state;
    renderConnections();
  }

  function renderConnections() {
    // Connections are now shown via tab right-click menu
  }

  async function pollPoolStatus() {
    try {
      poolStatus = await apiGet('pool-status');
      renderConnections();
    } catch (e) {}
  }

  async function connectLocal() {
    currentConn = { ...LOCAL_CONN };
    currentPath = '/home/adom';
    renderConnections();
    try {
      const res = await apiFetch('connect', { connection: currentConn });
      if (res.error) throw new Error(res.error);
      toast(`Connected: ${res.user}@${res.hostname} (local)`);
      renderConnections();
      bus.emit('conn:change', { connection: currentConn });
      ensureApp('explorer');
    } catch (err) {
      toast('Local connection failed: ' + err.message, true);
    }
  }

  async function loadConnection(i) {
    const c = savedConnections[i];
    currentConn = { host: c.host, port: c.port, username: c.username };
    currentPath = '/home/adom';
    setPoolDot(currentConn, 'connecting');
    try {
      const res = await apiFetch('connect', { connection: currentConn });
      if (res.error) throw new Error(res.error);
      setPoolDot(currentConn, 'connected');
      toast(`Connected: ${res.user}@${res.hostname}`);
      bus.emit('conn:change', { connection: currentConn });
      ensureApp('explorer');
    } catch (err) {
      setPoolDot(currentConn, 'disconnected');
      toast('Connection failed: ' + err.message, true);
    }
  }

  async function connectAndSave() {
    const host = document.getElementById('hostInput').value.trim();
    const port = parseInt(document.getElementById('portInput').value) || 2222;
    const username = document.getElementById('userInput').value.trim();
    if (!host || !username) { toast('Host and username required', true); return; }

    const conn = { host, port, username };
    currentConn = conn;
    currentPath = '/home/adom';
    setPoolDot(conn, 'connecting');

    try {
      const res = await apiFetch('connect', { connection: conn });
      if (res.error) throw new Error(res.error);

      const exists = savedConnections.find(c => c.host === conn.host && c.username === conn.username && c.port === conn.port);
      if (!exists) {
        const label = conn.username.replace(/-/g, '/');
        savedConnections.push({ ...conn, label });
        localStorage.setItem('cui-connections', JSON.stringify(savedConnections));
      }

      setPoolDot(conn, 'connected');
      hideAddForm();
      toast(`Connected: ${res.user}@${res.hostname}`);
      bus.emit('conn:change', { connection: currentConn });
      ensureApp('explorer');
    } catch (err) {
      setPoolDot(conn, 'disconnected');
      toast('Connection failed: ' + err.message, true);
    }
  }

  function removeConnection(i) {
    savedConnections.splice(i, 1);
    localStorage.setItem('cui-connections', JSON.stringify(savedConnections));
    renderConnections();
  }

  function showAddForm() { document.getElementById('addFormOverlay').classList.add('open'); setTimeout(() => document.getElementById('userInput').focus(), 50); }
  function hideAddForm() { document.getElementById('addFormOverlay').classList.remove('open'); }

  // ── App Registration ───────────────────────────────
  function registerApp(appId, { label, icon, factory, singleton = false }) {
    registeredApps[appId] = { label, icon, factory, singleton };
  }

  // ── Helper: get all tabs across all panes ─────────
  function getAllTabs() {
    const leaves = tiling.getAllLeaves();
    const all = [];
    for (const leaf of leaves) {
      for (const tab of leaf.tabs) all.push(tab);
    }
    return all;
  }

  // ── Layout helpers (find panes by role) ───────────
  function getExplorerPane() {
    const allTabs = getAllTabs();
    const explorerTab = allTabs.find(t => t.appId === 'explorer');
    return explorerTab ? tiling.findTabPane(explorerTab.id) : null;
  }

  function getRightPane() {
    const allTabs = getAllTabs();
    const explorerPane = getExplorerPane();
    const explorerPaneId = explorerPane ? explorerPane.id : null;
    for (const t of allTabs) {
      if (t.appId === 'previewer' || t.appId === 'editor') {
        const pane = tiling.findTabPane(t.id);
        if (pane && pane.id !== explorerPaneId) return pane;
      }
    }
    return null;
  }

  function createTab(appId, params) {
    const appDef = registeredApps[appId];
    if (!appDef) return null;
    const id = 'tab-' + (++tabCounter);
    return { id, appId, title: params.title || appDef.label, icon: params.icon || appDef.icon, factory: appDef.factory, params };
  }

  // ── Tab Management (delegated to tiling) ──────────
  function openApp(appId, params = {}) {
    const appDef = registeredApps[appId];
    if (!appDef) return;

    const allTabs = getAllTabs();

    // For singleton apps, switch to existing tab if open
    if (appDef.singleton) {
      const existing = allTabs.find(t => t.appId === appId);
      if (existing) {
        const pane = tiling.findTabPane(existing.id);
        if (pane) {
          tiling.activateTab(pane.id, existing.id);
          if (existing.instance && existing.instance.onParams) {
            existing.instance.onParams(params);
          }
      
          return existing;
        }
      }
    }

    // Check if an identical tab exists (same app + same file path)
    if (params.path) {
      const existing = allTabs.find(t => t.appId === appId && t.params && t.params.path === params.path);
      if (existing) {
        const pane = tiling.findTabPane(existing.id);
        if (pane) {
          tiling.activateTab(pane.id, existing.id);
          if (existing.instance && existing.instance.onParams) {
            existing.instance.onParams(params);
          }
      
          return existing;
        }
      }
    }

    const id = 'tab-' + (++tabCounter);
    const tabData = {
      id,
      appId,
      title: params.title || appDef.label,
      icon: params.icon || appDef.icon,
      factory: appDef.factory,
      params,
    };

    tiling.addTab(null, tabData);


    // After tiling creates the instance, update title from instance
    const result = tiling.findTab(id);
    if (result && result.tab.instance) {
      const inst = result.tab.instance;
      if (inst.getTitle) result.tab.title = params.title || inst.getTitle();
      if (inst.getIcon) result.tab.icon = params.icon || inst.getIcon();
      tiling.render();
    }

    return result ? result.tab : tabData;
  }

  function ensureApp(appId, params = {}) {
    const allTabs = getAllTabs();
    const existing = allTabs.find(t => t.appId === appId);
    if (existing) {
      const pane = tiling.findTabPane(existing.id);
      if (pane) tiling.activateTab(pane.id, existing.id);
  
      return existing;
    }
    return openApp(appId, params);
  }

  function closeTab(tabId) {
    const pane = tiling.findTabPane(tabId);
    if (pane) {
      tiling.removeTab(pane.id, tabId);
  
    }
  }

  function activateTab(tabId) {
    const pane = tiling.findTabPane(tabId);
    if (pane) {
      tiling.activateTab(pane.id, tabId);
  
    }
  }

  function updateTabTitle(tabId, title, icon) {
    const result = tiling.findTab(tabId);
    if (!result) return;
    if (title) result.tab.title = title;
    if (icon) result.tab.icon = icon;
    tiling.render();
  }

  function getTabByInstance(instance) {
    const allTabs = getAllTabs();
    return allTabs.find(t => t.instance === instance);
  }

  // ── Split Tab (within tiling) ─────────────────────
  function splitTab(tabId) {
    const pane = tiling.findTabPane(tabId);
    if (!pane) return;

    const tabIdx = pane.tabs.findIndex(t => t.id === tabId);
    if (tabIdx === -1) return;
    const tab = pane.tabs[tabIdx];

    // Remove from current pane
    pane.tabs.splice(tabIdx, 1);
    if (pane.activeTabId === tabId) {
      pane.activeTabId = pane.tabs.length > 0 ? pane.tabs[Math.min(tabIdx, pane.tabs.length - 1)].id : null;
    }

    // Split the pane and put the tab in the new half
    const newPane = tiling.splitPane(pane.id, 'h', tab);

    // If the source pane is now empty and not the only pane, clean it up
    if (pane.tabs.length === 0 && tiling.root.type === 'split') {
      tiling.removePane(pane.id);
    } else {
      tiling.render();
    }

  }

  // ── Context Menu ───────────────────────────────────
  function showCtxMenu(e, items) {
    e.preventDefault();
    const menu = document.getElementById('ctxMenu');
    let html = '';
    for (const item of items) {
      if (item === 'sep') {
        html += '<div class="ctx-sep"></div>';
      } else {
        const cls = item.danger ? 'ctx-item danger' : 'ctx-item';
        html += `<div class="${cls}" onclick="(${item.action})()">
          <span class="ctx-icon">${item.icon || ''}</span>${esc(item.label)}
          ${item.key ? `<span class="ctx-key">${item.key}</span>` : ''}
        </div>`;
      }
    }
    menu.innerHTML = html;
    menu.classList.add('open');
    const mx = Math.min(e.clientX, window.innerWidth - 200);
    const my = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10);
    menu.style.left = mx + 'px';
    menu.style.top = my + 'px';
  }

  function hideCtxMenu() { document.getElementById('ctxMenu').classList.remove('open'); }

  // ── Tab Context Menu (connection picker) ──────────
  function showTabCtxMenu(e, tab) {
    e.preventDefault();
    const items = [];

    // Connection picker
    const isLocalActive = currentConn && currentConn.local === true;
    items.push({
      icon: isLocalActive ? '&#9679;' : '&#9675;',
      label: 'Local',
      action: `function(){shell.hideCtxMenu();shell.connectLocal()}`
    });

    savedConnections.forEach((c, i) => {
      const isActive = currentConn && !currentConn.local && currentConn.host === c.host && currentConn.username === c.username;
      items.push({
        icon: isActive ? '&#9679;' : '&#9675;',
        label: esc(c.label || c.username),
        action: `function(){shell.hideCtxMenu();shell.loadConnection(${i})}`
      });
    });

    items.push('sep');
    items.push({ icon: '+', label: 'Add Connection...', action: `function(){shell.hideCtxMenu();shell.showAddForm()}` });

    showCtxMenu(e, items);
  }

  // ── Init ───────────────────────────────────────────
  function init() {
    // Initialize tiling layout
    tiling.init(document.getElementById('tilingRoot'));

    renderConnections();


    // Close context menu on click
    document.addEventListener('click', hideCtxMenu);

    // Auto-add discovered containers
    apiGet('discovered').then(list => {
      for (const c of list) {
        const exists = savedConnections.find(s => s.host === c.host && s.username === c.username && s.port === c.port);
        if (!exists) {
          savedConnections.push({ host: c.host, port: c.port, username: c.username, label: c.name || c.username });
          localStorage.setItem('cui-connections', JSON.stringify(savedConnections));
        }
      }
      renderConnections();
    }).catch(() => {});

    // Poll connection status
    setInterval(pollPoolStatus, 3000);

    // ── Layout-aware event handlers ──────────────────

    // Single-click preview: reuse singleton preview tab in right pane
    bus.on('file:preview', ({ path, name, connection }) => {
      const params = { path, name, connection: connection || currentConn, title: name || path.split('/').pop() };
      const allTabs = getAllTabs();

      // Reuse existing preview tab
      const existing = allTabs.find(t => t.appId === 'previewer');
      if (existing) {
        if (existing.instance && existing.instance.onParams) existing.instance.onParams(params);
        existing.title = params.title;
        const pane = tiling.findTabPane(existing.id);
        if (pane) tiling.activateTab(pane.id, existing.id);
        return;
      }

      // Create new preview tab in right pane
      const tabData = createTab('previewer', params);
      if (!tabData) return;
      const rightPane = getRightPane();
      if (rightPane) {
        tiling.addTab(rightPane.id, tabData);
      } else {
        const explorerPane = getExplorerPane();
        if (explorerPane) {
          tiling.splitPane(explorerPane.id, 'h', tabData);
        } else {
          tiling.addTab(null, tabData);
        }
      }
    });

    // Double-click edit: open editor in right pane, close preview
    bus.on('file:edit', ({ path, name, connection }) => {
      const params = { path, name, connection: connection || currentConn, title: name || path.split('/').pop() };
      const allTabs = getAllTabs();

      // If file already open in editor, switch to it
      const existingEditor = allTabs.find(t => t.appId === 'editor' && t.params && t.params.path === path);
      if (existingEditor) {
        const pane = tiling.findTabPane(existingEditor.id);
        if (pane) tiling.activateTab(pane.id, existingEditor.id);
        return;
      }

      const tabData = createTab('editor', params);
      if (!tabData) return;

      const rightPane = getRightPane();
      if (rightPane) {
        // Add editor first, then close preview (so pane stays alive)
        tiling.addTab(rightPane.id, tabData);
        const previewTab = rightPane.tabs.find(t => t.appId === 'previewer');
        if (previewTab) tiling.removeTab(rightPane.id, previewTab.id);
      } else {
        const explorerPane = getExplorerPane();
        if (explorerPane) {
          tiling.splitPane(explorerPane.id, 'h', tabData);
        } else {
          tiling.addTab(null, tabData);
        }
      }
    });

    // Open terminal below explorer
    bus.on('term:openHere', ({ path, connection }) => {
      const tabData = createTab('terminal', { connection: connection || currentConn, cwd: path, title: 'Terminal' });
      if (!tabData) return;

      // If a terminal pane already exists, add tab there
      const allTabs = getAllTabs();
      const existingTerm = allTabs.find(t => t.appId === 'terminal');
      if (existingTerm) {
        const pane = tiling.findTabPane(existingTerm.id);
        if (pane) { tiling.addTab(pane.id, tabData); return; }
      }

      // Split explorer pane below
      const explorerPane = getExplorerPane();
      if (explorerPane) {
        tiling.splitPane(explorerPane.id, 'v', tabData);
      } else {
        tiling.addTab(null, tabData);
      }
    });

    // Handle URL params for standalone app mode (split view)
    const urlParams = new URLSearchParams(window.location.search);
    const appParam = urlParams.get('app');
    const connParam = urlParams.get('conn');
    const pathParam = urlParams.get('path');

    if (connParam) {
      try {
        currentConn = JSON.parse(connParam);
        renderConnections();
        bus.emit('conn:change', { connection: currentConn });
      } catch (e) {}
    }

    if (appParam && registeredApps[appParam]) {
      const params = {};
      if (pathParam) params.path = pathParam;
      if (currentConn) params.connection = currentConn;
      openApp(appParam, params);
    } else {
      // Default: auto-connect local and open explorer
      connectLocal();
    }

    // Global keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideCtxMenu();
    });
  }

  // ── Public API ─────────────────────────────────────
  return {
    init,
    // Connection
    connectLocal,
    loadConnection,
    connectAndSave,
    removeConnection,
    showAddForm,
    hideAddForm,
    // Apps
    registerApp,
    openApp,
    ensureApp,
    closeTab,
    activateTab,
    updateTabTitle,
    getTabByInstance,
    splitTab,
    // Context menu
    showCtxMenu,
    hideCtxMenu,
    showTabCtxMenu,
    // Utilities
    apiFetch,
    apiGet,
    esc,
    toast,
    promptDialog,
    confirmDialog,
    // Getters
    get conn() { return currentConn; },
    set conn(v) { currentConn = v; },
    get path() { return currentPath; },
    set path(v) { currentPath = v; },
    get apiBase() { return API_BASE; },
    get savedConnections() { return savedConnections; },
  };
})();
