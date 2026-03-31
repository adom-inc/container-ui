/**
 * File Explorer App — Browse, search, and manage files in local/remote containers.
 * Ported from the standalone file-explorer project with inter-app integration.
 */
(function () {
  const FILE_ICONS = {
    directory: '&#128194;', symlink: '&#128279;',
    js: '&#127312;', ts: '&#127347;', py: '&#128013;', rs: '&#9881;', go: '&#128029;',
    json: '&#128196;', yaml: '&#128196;', yml: '&#128196;', toml: '&#128196;',
    md: '&#128221;', txt: '&#128221;', log: '&#128221;',
    html: '&#127760;', css: '&#127912;', svg: '&#127912;',
    sh: '&#9000;', bash: '&#9000;', zsh: '&#9000;',
    png: '&#128248;', jpg: '&#128248;', gif: '&#128248;', webp: '&#128248;',
    zip: '&#128230;', gz: '&#128230;', tar: '&#128230;',
    lock: '&#128274;', default: '&#128196;'
  };

  function getIcon(entry) {
    if (entry.type === 'directory') return FILE_ICONS.directory;
    if (entry.type === 'symlink') return FILE_ICONS.symlink;
    const ext = entry.name.split('.').pop().toLowerCase();
    return FILE_ICONS[ext] || FILE_ICONS.default;
  }

  function formatSize(bytes) {
    if (bytes === 0) return '\u2014';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function formatTime(ts) {
    if (!ts) return '\u2014';
    const d = new Date(ts * 1000);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function fileExtension(name) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  const TEXT_EXTS = new Set(['md', 'txt', 'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'html', 'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml', 'svg', 'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'proto', 'makefile', 'dockerfile', 'env', 'gitignore', 'editorconfig', 'ini', 'cfg', 'conf', 'log', 'csv', 'tsv', 'lock', 'vue', 'svelte', 'astro']);
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg', 'tiff', 'tif']);
  const PREVIEW_EXTS = new Set([...TEXT_EXTS, ...IMAGE_EXTS, 'csv', 'tsv']);

  class ExplorerApp {
    constructor(container, params) {
      this.container = container;
      this.sortCol = 'name';
      this.sortAsc = true;
      this.searchMode = false;
      this.dragSource = null;
      this.clipboard = null;
      this.dropCount = 0;
      this._watchWs = null;
      this._watchPath = null;
      this.selected = new Set();   // set of selected file/folder names
      this._lastClickedName = null; // for shift-click range select
      this._renderedNames = [];     // ordered list of names from last render

      this._render();
      this._bindEvents();
      this._connectWatcher();

      // If connection is set, browse
      if (shell.conn) {
        this.browse(shell.path || '/home/adom');
      }
    }

    getTitle() { return 'Explorer'; }
    getIcon() { return '&#128194;'; }

    _render() {
      this.container.innerHTML = `
        <div class="explorer-toolbar">
          <div class="breadcrumb" id="ex-breadcrumb"></div>
          <input id="ex-searchInput" class="toolbar-search" placeholder="Search..." >
          <button class="btn secondary btn-sm" id="ex-searchBtn">Search</button>
          <button class="btn secondary btn-sm" id="ex-refreshBtn" title="Refresh">&#8635;</button>
          <select class="conn-select" id="ex-connSelect"></select>
        </div>
        <div class="file-area" id="ex-fileArea">
          <div class="empty"><span class="icon">&#128268;</span><p>Connect to a container to browse files</p></div>
        </div>`;
      this._updateConnSelect();
    }

    _updateConnSelect() {
      const sel = this.container.querySelector('#ex-connSelect');
      if (!sel) return;
      sel.innerHTML = '';
      const conn = shell.conn;
      // Local option
      const localOpt = document.createElement('option');
      localOpt.value = '__local__';
      localOpt.textContent = 'Local';
      if (conn && conn.local) localOpt.selected = true;
      sel.appendChild(localOpt);
      // Saved connections
      (shell.savedConnections || []).forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = c.label || c.username;
        if (conn && !conn.local && conn.host === c.host && conn.username === c.username) opt.selected = true;
        sel.appendChild(opt);
      });
      // Add connection option
      const addOpt = document.createElement('option');
      addOpt.value = '__add__';
      addOpt.textContent = '+ Add Connection';
      sel.appendChild(addOpt);
    }

    _bindEvents() {
      const searchInput = this.container.querySelector('#ex-searchInput');
      searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.doSearch(); });
      this.container.querySelector('#ex-searchBtn').addEventListener('click', () => this.doSearch());
      this.container.querySelector('#ex-refreshBtn').addEventListener('click', () => { if (shell.path) this.browse(shell.path); });

      // Connection dropdown
      this.container.querySelector('#ex-connSelect').addEventListener('change', e => {
        const val = e.target.value;
        if (val === '__add__') { shell.showAddForm(); this._updateConnSelect(); }
        else if (val === '__local__') shell.connectLocal();
        else shell.loadConnection(parseInt(val));
      });

      // Connection change
      this._unsub = bus.on('conn:change', ({ connection }) => {
        this._updateConnSelect();
        this.browse('/home/adom');
      });

      // Click on empty area to deselect all
      this.container.querySelector('#ex-fileArea').addEventListener('click', (e) => {
        if (!e.target.closest('tr[data-name]') && !e.target.closest('th')) {
          this.selected.clear();
          this._lastClickedName = null;
          this._updateSelectionUI();
        }
      });

      // Context menu on file area
      this.container.querySelector('#ex-fileArea').addEventListener('contextmenu', e => {
        if (!shell.conn) return;
        const row = e.target.closest('.file-list tr[data-name]');
        if (row) {
          this._showCtxMenu(e, row.dataset.name, row.dataset.type);
        } else {
          this._showCtxMenu(e, null, null);
        }
      });

      // Drag-to-select (lasso)
      this._initLassoSelect();

      // Drop zone on file area
      const fileArea = this.container.querySelector('#ex-fileArea');
      fileArea.addEventListener('dragenter', e => {
        e.preventDefault();
        if (!shell.conn) return;
        this.dropCount++;
        fileArea.classList.add('drop-active');
      });
      fileArea.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      fileArea.addEventListener('dragleave', e => {
        this.dropCount--;
        if (this.dropCount <= 0) { this.dropCount = 0; fileArea.classList.remove('drop-active'); }
      });
      fileArea.addEventListener('drop', e => this._onFileAreaDrop(e, fileArea));

      // Keyboard shortcuts
      this._keyHandler = e => this._onKeyDown(e);
    }

    activate() {
      document.addEventListener('keydown', this._keyHandler);
    }

    deactivate() {
      document.removeEventListener('keydown', this._keyHandler);
    }

    destroy() {
      this._destroyed = true;
      this.deactivate();
      if (this._unsub) this._unsub();
      this._stopPolling();
      this._unwatchDir();
      if (this._watchWs) { try { this._watchWs.close(); } catch (e) {} }
    }

    // ── File Watcher ────────────────────────────────
    _connectWatcher() {
      const loc = window.location;
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const base = loc.pathname.replace(/\/[^/]*$/, '');
      const wsUrl = `${proto}//${loc.host}${base}/ws/watch`;

      try {
        this._watchWs = new WebSocket(wsUrl);
      } catch (e) {
        this._startPolling();
        return;
      }

      this._watchWs.onopen = () => {
        // Stop polling if WS connected
        this._stopPolling();
        if (this._watchPath) {
          this._watchWs.send(JSON.stringify({ action: 'watch', path: this._watchPath, connection: shell.conn }));
        }
      };
      this._watchWs.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'change' && msg.path === this._watchPath && !this.searchMode) {
            this._silentRefresh();
          }
        } catch (err) {}
      };
      this._watchWs.onerror = () => {
        // WebSocket failed (e.g. proxy doesn't support it), fall back to polling
        this._startPolling();
      };
      this._watchWs.onclose = () => {
        this._startPolling();
        // Try to reconnect WS after 5s
        setTimeout(() => { if (!this._destroyed) this._connectWatcher(); }, 5000);
      };
    }

    _startPolling() {
      if (this._pollTimer) return;
      this._lastEntryHash = null;
      this._pollTimer = setInterval(() => this._pollCheck(), 2000);
    }

    _stopPolling() {
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    }

    async _pollCheck() {
      if (!shell.conn || !this._watchPath || this.searchMode) return;
      try {
        const res = await shell.apiFetch('ls', { connection: shell.conn, dirPath: this._watchPath });
        if (res.error) return;
        const hash = res.entries.map(e => e.name + e.size + e.mtime).join('|');
        if (this._lastEntryHash !== null && hash !== this._lastEntryHash) {
          this._renderFileList(res.entries);
        }
        this._lastEntryHash = hash;
      } catch (err) {}
    }

    _watchDir(dirPath) {
      if (this._watchPath === dirPath) return;
      this._unwatchDir();
      this._watchPath = dirPath;
      this._lastEntryHash = null;
      if (this._watchWs && this._watchWs.readyState === 1) {
        this._watchWs.send(JSON.stringify({ action: 'watch', path: dirPath, connection: shell.conn }));
      }
      // If not open yet, onopen will send it
    }

    _unwatchDir() {
      if (this._watchPath && this._watchWs && this._watchWs.readyState === 1) {
        this._watchWs.send(JSON.stringify({ action: 'unwatch', path: this._watchPath, connection: shell.conn }));
      }
      this._watchPath = null;
    }

    async _silentRefresh() {
      if (!shell.conn || !this._watchPath) return;
      try {
        const res = await shell.apiFetch('ls', { connection: shell.conn, dirPath: this._watchPath });
        if (res.error) return;
        this._renderFileList(res.entries);
      } catch (err) {}
    }

    // ── Browse ──────────────────────────────────────
    async browse(dirPath) {
      if (!shell.conn) return;
      this.searchMode = false;
      this.selected.clear();
      this._lastClickedName = null;
      shell.path = dirPath;
      this._watchDir(dirPath);
      this._renderBreadcrumb(dirPath);
      this.container.querySelector('#ex-searchInput').value = '';

      const area = this.container.querySelector('#ex-fileArea');
      area.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

      try {
        const res = await shell.apiFetch('ls', { connection: shell.conn, dirPath });
        if (res.error) throw new Error(res.error);
        this._renderFileList(res.entries);
        bus.emit('dir:change', { path: dirPath, connection: shell.conn });
      } catch (err) {
        area.innerHTML = `<div class="empty"><span class="icon">&#9888;</span><p>${shell.esc(err.message)}</p></div>`;
      }
    }

    _renderBreadcrumb(p) {
      const el = this.container.querySelector('#ex-breadcrumb');
      const parts = p.split('/').filter(Boolean);
      let html = `<span class="crumb" data-path="/">/ </span>`;
      let acc = '';
      for (const part of parts) {
        acc += '/' + part;
        html += `<span class="sep">&#9656;</span><span class="crumb" data-path="${acc}">${shell.esc(part)}</span>`;
      }
      el.innerHTML = html;

      // Breadcrumb click
      el.querySelectorAll('.crumb').forEach(crumb => {
        crumb.addEventListener('click', () => this.browse(crumb.dataset.path));
      });
      this._initBreadcrumbDrop(el);
    }

    _initBreadcrumbDrop(el) {
      el.querySelectorAll('.crumb').forEach(crumb => {
        crumb.addEventListener('dragenter', e => { e.preventDefault(); crumb.classList.add('drop-target'); });
        crumb.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        crumb.addEventListener('dragleave', e => { if (!crumb.contains(e.relatedTarget)) crumb.classList.remove('drop-target'); });
        crumb.addEventListener('drop', async e => {
          e.preventDefault(); e.stopPropagation();
          crumb.classList.remove('drop-target');
          if (!this.dragSource) return;
          const source = this.dragSource;
          const destDir = crumb.dataset.path;
          const sourceDir = source.path.replace(/\/[^/]+$/, '');
          if (destDir === sourceDir) { shell.toast('Already in this directory'); return; }
          await this._moveOrTransfer(source, destDir);
        });
      });
    }

    _renderFileList(entries) {
      this._currentEntries = entries;
      const area = this.container.querySelector('#ex-fileArea');
      if (entries.length === 0) {
        area.innerHTML = '<div class="empty"><span class="icon">&#128194;</span><p>Empty directory</p></div>';
        return;
      }

      const sorted = [...entries].sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        let cmp = 0;
        if (this.sortCol === 'name') cmp = a.name.localeCompare(b.name);
        else if (this.sortCol === 'size') cmp = a.size - b.size;
        else if (this.sortCol === 'time') cmp = a.mtime - b.mtime;
        else if (this.sortCol === 'perms') cmp = (a.permissions || '').localeCompare(b.permissions || '');
        return this.sortAsc ? cmp : -cmp;
      });

      if (shell.path !== '/') {
        sorted.unshift({ name: '..', type: 'directory', size: 0, mtime: 0, permissions: '', owner: '' });
      }

      const arrow = this.sortAsc ? ' &#9650;' : ' &#9660;';
      let html = `<div class="file-list"><table>
        <tr>
          <th data-col="name" style="width:50%">Name${this.sortCol === 'name' ? arrow : ''}</th>
          <th data-col="size" style="width:12%;text-align:right">Size${this.sortCol === 'size' ? arrow : ''}</th>
          <th data-col="perms" style="width:14%">Perms${this.sortCol === 'perms' ? arrow : ''}</th>
          <th style="width:10%">Owner</th>
          <th data-col="time" style="width:14%">Modified${this.sortCol === 'time' ? arrow : ''}</th>
        </tr>`;

      this._renderedNames = [];
      for (const entry of sorted) {
        const icon = entry.name === '..' ? '&#11176;' : getIcon(entry);
        const drag = entry.name !== '..' ? `draggable="true"` : '';
        const sel = this.selected.has(entry.name) ? ' selected' : '';
        if (entry.name !== '..') this._renderedNames.push(entry.name);
        html += `<tr ${drag} data-name="${shell.esc(entry.name)}" data-type="${entry.type}" class="${sel}">
          <td><div class="name-cell"><span class="file-icon">${icon}</span><span class="fname">${shell.esc(entry.name)}</span></div></td>
          <td class="size-cell">${entry.type === 'directory' ? '\u2014' : formatSize(entry.size)}</td>
          <td class="perms-cell">${shell.esc(entry.permissions || '')}</td>
          <td class="owner-cell">${shell.esc(entry.owner || '')}</td>
          <td class="time-cell">${entry.mtime ? formatTime(entry.mtime) : '\u2014'}</td>
        </tr>`;
      }
      html += '</table></div>';
      area.innerHTML = html;

      // Sort headers
      area.querySelectorAll('th[data-col]').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.col;
          if (this.sortCol === col) this.sortAsc = !this.sortAsc;
          else { this.sortCol = col; this.sortAsc = true; }
          this.browse(shell.path);
        });
      });

      // Row events
      area.querySelectorAll('.file-list tr[data-name]').forEach(row => {
        row.addEventListener('click', (e) => this._handleClick(row, e));
        row.addEventListener('dblclick', () => this._handleDblClick(row.dataset.name, row.dataset.type));
      });

      this._initDrag();
    }

    _handleClick(row, e) {
      const name = row.dataset.name;
      const type = row.dataset.type;
      if (name === '..') return;

      if (e.ctrlKey || e.metaKey) {
        // Toggle individual selection
        if (this.selected.has(name)) {
          this.selected.delete(name);
        } else {
          this.selected.add(name);
        }
        this._lastClickedName = name;
      } else if (e.shiftKey && this._lastClickedName) {
        // Range select
        const startIdx = this._renderedNames.indexOf(this._lastClickedName);
        const endIdx = this._renderedNames.indexOf(name);
        if (startIdx !== -1 && endIdx !== -1) {
          const lo = Math.min(startIdx, endIdx);
          const hi = Math.max(startIdx, endIdx);
          for (let i = lo; i <= hi; i++) {
            this.selected.add(this._renderedNames[i]);
          }
        }
      } else {
        // Normal click — single select
        this.selected.clear();
        this.selected.add(name);
        this._lastClickedName = name;
      }

      this._updateSelectionUI();

      // Preview the clicked file (single selection only)
      if (this.selected.size === 1 && type !== 'directory') {
        const filePath = shell.path + '/' + name;
        bus.emit('file:select', { path: filePath, name, type, connection: shell.conn });
        const ext = fileExtension(name);
        if (PREVIEW_EXTS.has(ext) || TEXT_EXTS.has(ext)) {
          bus.emit('file:preview', { path: filePath, name, connection: shell.conn });
        }
      }
    }

    _updateSelectionUI() {
      this.container.querySelectorAll('.file-list tr[data-name]').forEach(r => {
        r.classList.toggle('selected', this.selected.has(r.dataset.name));
      });
    }

    _initLassoSelect() {
      const area = this.container.querySelector('#ex-fileArea');
      let lasso = null;
      let startX, startY, areaRect;
      let beforeSelection = new Set();

      area.addEventListener('mousedown', e => {
        // Only start lasso on left click in empty space (not on a row or header)
        if (e.button !== 0) return;
        if (e.target.closest('tr[data-name]') || e.target.closest('th')) return;

        e.preventDefault();
        areaRect = area.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;

        // Save pre-lasso selection for Ctrl+drag append
        beforeSelection = e.ctrlKey || e.metaKey ? new Set(this.selected) : new Set();

        // Prevent text selection during lasso
        document.body.style.userSelect = 'none';
        window.getSelection()?.removeAllRanges();

        // Create lasso element
        lasso = document.createElement('div');
        lasso.className = 'lasso-rect';
        lasso.style.cssText = `position:fixed;border:1px dashed var(--blue);background:rgba(137,180,250,0.08);pointer-events:none;z-index:100;display:none;`;
        document.body.appendChild(lasso);

        const onMove = (e) => {
          e.preventDefault();
          const x1 = Math.min(startX, e.clientX);
          const y1 = Math.min(startY, e.clientY);
          const x2 = Math.max(startX, e.clientX);
          const y2 = Math.max(startY, e.clientY);

          // Only show after 5px of movement
          if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) return;

          lasso.style.display = 'block';
          lasso.style.left = x1 + 'px';
          lasso.style.top = y1 + 'px';
          lasso.style.width = (x2 - x1) + 'px';
          lasso.style.height = (y2 - y1) + 'px';

          // Find rows intersecting the lasso
          const newSelected = new Set(beforeSelection);
          this.container.querySelectorAll('.file-list tr[data-name]').forEach(row => {
            if (row.dataset.name === '..') return;
            const rr = row.getBoundingClientRect();
            if (rr.bottom > y1 && rr.top < y2 && rr.right > x1 && rr.left < x2) {
              newSelected.add(row.dataset.name);
            }
          });
          this.selected = newSelected;
          this._updateSelectionUI();
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.userSelect = '';
          if (lasso) { lasso.remove(); lasso = null; }
          if (this.selected.size > 0) {
            this._lastClickedName = [...this.selected].pop();
          }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    _handleDblClick(name, type) {
      if (name === '..' || type === 'directory') {
        const newPath = name === '..'
          ? shell.path.split('/').slice(0, -1).join('/') || '/'
          : shell.path + '/' + name;
        this.browse(newPath.replace(/\/+/g, '/'));
      } else {
        const filePath = shell.path + '/' + name;
        bus.emit('file:edit', { path: filePath, name, connection: shell.conn });
      }
    }

    // ── Search ──────────────────────────────────────
    async doSearch() {
      const pattern = this.container.querySelector('#ex-searchInput').value.trim();
      if (!pattern || !shell.conn) return;

      this.searchMode = true;
      const area = this.container.querySelector('#ex-fileArea');
      area.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

      try {
        const res = await shell.apiFetch('search', { connection: shell.conn, searchPath: shell.path, pattern });
        if (res.error) throw new Error(res.error);

        if (res.results.length === 0) {
          area.innerHTML = '<div class="empty"><span class="icon">&#128269;</span><p>No results</p></div>';
          return;
        }

        let html = '<div class="search-results">';
        for (const r of res.results) {
          html += `<div class="search-result" data-path="${shell.esc(r.path)}" data-dir="${shell.esc(r.dir)}">
            <span class="icon">&#128196;</span>
            <span class="sr-name">${shell.esc(r.name)}</span>
            <span class="sr-dir">${shell.esc(r.dir)}</span>
          </div>`;
        }
        html += '</div>';
        area.innerHTML = html;

        area.querySelectorAll('.search-result').forEach(el => {
          el.addEventListener('click', () => {
            const dir = el.dataset.dir;
            const fullPath = el.dataset.path;
            this.browse(dir);
            setTimeout(() => bus.emit('file:preview', { path: fullPath, name: fullPath.split('/').pop(), connection: shell.conn }), 500);
          });
        });
      } catch (err) {
        area.innerHTML = `<div class="empty"><span class="icon">&#9888;</span><p>${shell.esc(err.message)}</p></div>`;
      }
    }

    // ── Drag & Drop ─────────────────────────────────
    _initDrag() {
      this.container.querySelectorAll('.file-list tr[draggable="true"]').forEach(row => {
        row.addEventListener('dragstart', e => {
          const name = row.dataset.name;
          const type = row.dataset.type;

          // If dragging a non-selected item, select only it
          if (!this.selected.has(name)) {
            this.selected.clear();
            this.selected.add(name);
            this._updateSelectionUI();
          }

          // Build drag source for multi-select
          if (this.selected.size > 1) {
            const items = [...this.selected].map(n => {
              const r = this.container.querySelector(`.file-list tr[data-name="${CSS.escape(n)}"]`);
              return { connection: shell.conn, path: shell.path + '/' + n, type: r ? r.dataset.type : 'file', name: n };
            });
            this.dragSource = items[0]; // primary for single-drop targets
            this.dragSources = items;
            e.dataTransfer.setData('text/plain', items.map(i => i.name).join(', '));
          } else {
            this.dragSource = { connection: shell.conn, path: shell.path + '/' + name, type, name };
            this.dragSources = [this.dragSource];
            e.dataTransfer.setData('text/plain', name);
          }
          e.dataTransfer.effectAllowed = 'copyMove';

          // Dim all selected rows
          this.container.querySelectorAll('.file-list tr.selected').forEach(r => r.style.opacity = '0.4');
        });
        row.addEventListener('dragend', () => {
          this.container.querySelectorAll('.file-list tr[data-name]').forEach(r => r.style.opacity = '');
          this.dragSource = null;
          this.dragSources = null;
        });
      });

      this.container.querySelectorAll('.file-list tr[data-type="directory"]').forEach(folderRow => {
        folderRow.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); folderRow.classList.add('drop-target'); });
        folderRow.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; });
        folderRow.addEventListener('dragleave', e => { if (!folderRow.contains(e.relatedTarget)) folderRow.classList.remove('drop-target'); });
        folderRow.addEventListener('drop', async e => {
          e.preventDefault(); e.stopPropagation();
          folderRow.classList.remove('drop-target');
          this.dropCount = 0;
          this.container.querySelector('#ex-fileArea').classList.remove('drop-active');

          if (!this.dragSource) return;
          const source = this.dragSource;
          const targetName = folderRow.dataset.name;
          if (targetName === source.name) return;

          const targetDir = targetName === '..'
            ? (shell.path.split('/').slice(0, -1).join('/') || '/')
            : shell.path + '/' + targetName;
          await this._moveOrTransfer(source, targetDir);
        });
      });
    }

    async _onFileAreaDrop(e, fileArea) {
      e.preventDefault();
      this.dropCount = 0;
      fileArea.classList.remove('drop-active');
      if (!shell.conn || !this.dragSource) return;

      const source = this.dragSource;
      const sameConn = JSON.stringify(source.connection) === JSON.stringify(shell.conn);
      const sourceDir = source.path.replace(/\/[^/]+$/, '');
      if (sameConn && shell.path === sourceDir) { shell.toast('Already in this directory'); return; }

      await this._moveOrTransfer(source, shell.path);
    }

    async _moveOrTransfer(source, destDir) {
      const sameConn = JSON.stringify(source.connection) === JSON.stringify(shell.conn);
      const dirName = destDir === '/' ? '/' : destDir.split('/').pop();
      const names = Array.isArray(source.names) ? source.names : [source.name];

      // Check destination for name conflicts
      try {
        const destConn = sameConn ? shell.conn : shell.conn;
        const destList = await shell.apiFetch('ls', { connection: destConn, dirPath: destDir });
        if (!destList.error && destList.entries) {
          const destNames = new Set(destList.entries.map(e => e.name));
          const conflicts = names.filter(n => destNames.has(n));
          if (conflicts.length > 0) {
            const label = conflicts.length === 1
              ? `<strong>${shell.esc(conflicts[0])}</strong> already exists in <strong>${shell.esc(dirName)}/</strong>.`
              : `${conflicts.length} items already exist in <strong>${shell.esc(dirName)}/</strong>:<br>${conflicts.map(n => '&bull; ' + shell.esc(n)).join('<br>')}`;
            const ok = await shell.confirmDialog('Overwrite?', label + ' They will be overwritten.');
            if (!ok) return;
          }
        }
      } catch (err) { /* If listing fails, proceed anyway */ }

      if (sameConn) {
        shell.toast(`Moving ${source.name} \u2192 ${dirName}/`);
        try {
          const res = await shell.apiFetch('move', { connection: shell.conn, srcPath: source.path, destDir });
          if (res.error) throw new Error(res.error);
          shell.toast(`Moved ${source.name} \u2192 ${dirName}/`);
          this.browse(shell.path);
        } catch (err) { shell.toast('Move failed: ' + err.message, true); }
      } else {
        shell.toast(`Transferring ${source.name} \u2192 ${dirName}/`);
        try {
          const res = await shell.apiFetch('transfer', {
            source: { connection: source.connection, path: source.path, type: source.type },
            dest: { connection: shell.conn, dir: destDir }
          });
          if (res.error) throw new Error(res.error);
          shell.toast(`Transferred ${source.name} \u2192 ${dirName}/`);
          this.browse(shell.path);
        } catch (err) { shell.toast('Transfer failed: ' + err.message, true); }
      }
    }

    // ── Context Menu ────────────────────────────────
    _showCtxMenu(e, targetName, targetType) {
      e.preventDefault();
      const self = this;
      const isFile = targetType && targetType !== 'directory' && targetName !== '..';
      const isDir = targetType === 'directory' && targetName !== '..';
      const isEntry = isFile || isDir;

      // If right-clicking a selected item, operate on the whole selection
      // If right-clicking an unselected item, select only it
      if (isEntry && !this.selected.has(targetName)) {
        this.selected.clear();
        this.selected.add(targetName);
        this._updateSelectionUI();
      }

      const multiCount = this.selected.size;
      const isMulti = multiCount > 1;
      const items = [];

      if (isEntry && !isMulti) {
        items.push({ icon: '&#128194;', label: 'Open', action: `function(){shell.hideCtxMenu();document.querySelector('[data-name="${targetName}"]')?.dispatchEvent(new Event('dblclick',{bubbles:true}))}` });
        if (isFile) {
          items.push({ icon: '&#128221;', label: 'Preview', action: `function(){shell.hideCtxMenu();bus.emit('file:preview',{path:'${shell.path}/${targetName}',name:'${targetName}',connection:shell.conn})}` });
          items.push({ icon: '&#9998;', label: 'Edit', action: `function(){shell.hideCtxMenu();bus.emit('file:edit',{path:'${shell.path}/${targetName}',name:'${targetName}',connection:shell.conn})}` });
        }
        items.push('sep');
      }

      if (isEntry) {
        if (isMulti) {
          items.push({ icon: '&#128203;', label: `Copy ${multiCount} items`, action: `function(){shell.hideCtxMenu();bus.emit('_ex:copyMulti',{op:'copy'})}` });
          items.push({ icon: '&#9986;', label: `Cut ${multiCount} items`, action: `function(){shell.hideCtxMenu();bus.emit('_ex:copyMulti',{op:'cut'})}` });
        } else {
          items.push({ icon: '&#128203;', label: 'Copy', key: 'Ctrl+C', action: `function(){shell.hideCtxMenu();bus.emit('_ex:copy',{name:'${targetName}',type:'${targetType}',op:'copy'})}` });
          items.push({ icon: '&#9986;', label: 'Cut', key: 'Ctrl+X', action: `function(){shell.hideCtxMenu();bus.emit('_ex:copy',{name:'${targetName}',type:'${targetType}',op:'cut'})}` });
        }
      }

      if (this.clipboard) {
        if (items.length > 0) items.push('sep');
        const clipLabel = this.clipboardMulti ? `${this.clipboardMulti.length} items` : `"${this.clipboard.name}"`;
        items.push({ icon: '&#128203;', label: `Paste ${clipLabel}`, key: 'Ctrl+V', action: `function(){shell.hideCtxMenu();bus.emit('_ex:paste',{})}` });
      }

      items.push('sep');
      if (isMulti) {
        items.push({ icon: '&#9745;', label: `${multiCount} selected`, action: `function(){shell.hideCtxMenu()}` });
        items.push({ icon: '&#10006;', label: 'Deselect all', action: `function(){shell.hideCtxMenu();bus.emit('_ex:deselect',{})}` });
      }
      items.push({ icon: '&#128196;', label: 'New File', action: `function(){shell.hideCtxMenu();bus.emit('_ex:newFile',{})}` });
      items.push({ icon: '&#128193;', label: 'New Folder', action: `function(){shell.hideCtxMenu();bus.emit('_ex:newFolder',{})}` });

      // Open Terminal Here — for directories use that dir, otherwise current path
      const termPath = isDir ? shell.path + '/' + targetName : shell.path;
      items.push({ icon: '&#9000;', label: 'Open Terminal Here', action: `function(){shell.hideCtxMenu();bus.emit('term:openHere',{path:'${termPath}',connection:shell.conn})}` });

      if (isEntry) {
        items.push('sep');
        if (isMulti) {
          items.push({ icon: '&#128465;', label: `Delete ${multiCount} items`, danger: true, action: `function(){shell.hideCtxMenu();bus.emit('_ex:deleteMulti',{})}` });
        } else {
          items.push({ icon: '&#9998;', label: 'Rename', key: 'F2', action: `function(){shell.hideCtxMenu();bus.emit('_ex:rename',{name:'${targetName}'})}` });
          items.push({ icon: '&#128465;', label: 'Delete', key: 'Del', danger: true, action: `function(){shell.hideCtxMenu();bus.emit('_ex:delete',{name:'${targetName}',type:'${targetType}'})}` });
        }
      }

      // Wire up internal event handlers
      const cleanup = [];
      cleanup.push(bus.on('_ex:copy', ({ name, type, op }) => { this._ctxCopy(name, type, op); cleanAll(); }));
      cleanup.push(bus.on('_ex:copyMulti', ({ op }) => { this._ctxCopyMulti(op); cleanAll(); }));
      cleanup.push(bus.on('_ex:paste', () => { this._ctxPaste(); cleanAll(); }));
      cleanup.push(bus.on('_ex:newFile', () => { this._ctxNewFile(); cleanAll(); }));
      cleanup.push(bus.on('_ex:newFolder', () => { this._ctxNewFolder(); cleanAll(); }));
      cleanup.push(bus.on('_ex:rename', ({ name }) => { this._ctxRename(name); cleanAll(); }));
      cleanup.push(bus.on('_ex:delete', ({ name, type }) => { this._ctxDelete(name, type); cleanAll(); }));
      cleanup.push(bus.on('_ex:deleteMulti', () => { this._ctxDeleteMulti(); cleanAll(); }));
      cleanup.push(bus.on('_ex:deselect', () => { this.selected.clear(); this._updateSelectionUI(); cleanAll(); }));
      function cleanAll() { cleanup.forEach(fn => fn()); }
      setTimeout(cleanAll, 5000); // safety cleanup

      shell.showCtxMenu(e, items);
    }

    _ctxCopy(name, type, op) {
      this.clipboard = { connection: shell.conn, path: shell.path + '/' + name, type, name, op };
      this.clipboardMulti = null;
      shell.toast(op === 'cut' ? `Cut: ${name}` : `Copied: ${name}`);
    }

    _ctxCopyMulti(op) {
      const items = [...this.selected].map(name => {
        const row = this.container.querySelector(`.file-list tr[data-name="${CSS.escape(name)}"]`);
        const type = row ? row.dataset.type : 'file';
        return { connection: shell.conn, path: shell.path + '/' + name, type, name, op };
      });
      this.clipboard = items[0];
      this.clipboardMulti = items;
      shell.toast(op === 'cut' ? `Cut ${items.length} items` : `Copied ${items.length} items`);
    }

    async _ctxPaste() {
      if (!this.clipboard) return;
      const items = this.clipboardMulti || [this.clipboard];
      const count = items.length;
      const label = count > 1 ? `${count} items` : items[0].name;

      // Check for name conflicts in current directory
      const currentNames = new Set((this._currentEntries || []).map(e => e.name));
      const conflicts = items.map(i => i.name).filter(n => currentNames.has(n));
      if (conflicts.length > 0) {
        const msg = conflicts.length === 1
          ? `<strong>${shell.esc(conflicts[0])}</strong> already exists here.`
          : `${conflicts.length} items already exist here:<br>${conflicts.map(n => '&bull; ' + shell.esc(n)).join('<br>')}`;
        const ok = await shell.confirmDialog('Overwrite?', msg + ' They will be overwritten.');
        if (!ok) return;
      }

      for (const item of items) {
        const { connection: srcConn, path: srcPath, type, name, op } = item;
        const sameConn = JSON.stringify(srcConn) === JSON.stringify(shell.conn);
        try {
          if (op === 'cut') {
            if (sameConn) {
              const res = await shell.apiFetch('move', { connection: shell.conn, srcPath, destDir: shell.path });
              if (res.error) throw new Error(res.error);
            } else {
              const res = await shell.apiFetch('transfer', { source: { connection: srcConn, path: srcPath, type }, dest: { connection: shell.conn, dir: shell.path } });
              if (res.error) throw new Error(res.error);
              await shell.apiFetch('delete', { connection: srcConn, targetPath: srcPath, type });
            }
          } else {
            if (sameConn) {
              const res = await shell.apiFetch('copy', { connection: shell.conn, srcPath, destDir: shell.path, type });
              if (res.error) throw new Error(res.error);
            } else {
              const res = await shell.apiFetch('transfer', { source: { connection: srcConn, path: srcPath, type }, dest: { connection: shell.conn, dir: shell.path } });
              if (res.error) throw new Error(res.error);
            }
          }
        } catch (err) { shell.toast(`Failed: ${name} — ${err.message}`, true); }
      }

      shell.toast(items[0].op === 'cut' ? `Moved ${label}` : `Pasted ${label}`);
      if (items[0].op === 'cut') { this.clipboard = null; this.clipboardMulti = null; }
      this.browse(shell.path);
    }

    async _ctxNewFile() {
      const name = await shell.promptDialog('New file name', '');
      if (!name) return;
      const existing = (this._currentEntries || []).find(e => e.name === name);
      if (existing) {
        const kind = existing.type === 'directory' ? 'folder' : 'file';
        const ok = await shell.confirmDialog('Overwrite?', `A ${kind} named <strong>${shell.esc(name)}</strong> already exists. It will be overwritten.`);
        if (!ok) return;
      }
      try {
        const res = await shell.apiFetch('create-file', { connection: shell.conn, dirPath: shell.path, name });
        if (res.error) throw new Error(res.error);
        shell.toast(`Created ${name}`);
        this.browse(shell.path);
      } catch (err) { shell.toast('Failed: ' + err.message, true); }
    }

    async _ctxNewFolder() {
      const name = await shell.promptDialog('New folder name', '');
      if (!name) return;
      const existing = (this._currentEntries || []).find(e => e.name === name);
      if (existing) {
        const kind = existing.type === 'directory' ? 'folder' : 'file';
        const ok = await shell.confirmDialog('Overwrite?', `A ${kind} named <strong>${shell.esc(name)}</strong> already exists. It will be overwritten.`);
        if (!ok) return;
      }
      try {
        const res = await shell.apiFetch('create-folder', { connection: shell.conn, dirPath: shell.path, name });
        if (res.error) throw new Error(res.error);
        shell.toast(`Created ${name}/`);
        this.browse(shell.path);
      } catch (err) { shell.toast('Failed: ' + err.message, true); }
    }

    async _ctxRename(oldName) {
      const newName = await shell.promptDialog('Rename to', oldName);
      if (!newName || newName === oldName) return;
      // Check if a file/folder with the new name already exists
      const existing = (this._currentEntries || []).find(e => e.name === newName);
      if (existing) {
        const kind = existing.type === 'directory' ? 'folder' : 'file';
        const ok = await shell.confirmDialog('Overwrite?', `A ${kind} named <strong>${shell.esc(newName)}</strong> already exists. It will be overwritten.`);
        if (!ok) return;
      }
      try {
        const res = await shell.apiFetch('rename', { connection: shell.conn, oldPath: shell.path + '/' + oldName, newName });
        if (res.error) throw new Error(res.error);
        shell.toast(`Renamed \u2192 ${newName}`);
        this.browse(shell.path);
      } catch (err) { shell.toast('Failed: ' + err.message, true); }
    }

    async _ctxDelete(name, type) {
      const label = type === 'directory' ? `folder "${name}" and all its contents` : `"${name}"`;
      const confirmed = await shell.promptDialog(`Type "yes" to delete ${label}`, '');
      if (confirmed !== 'yes') { shell.toast('Cancelled'); return; }
      try {
        const res = await shell.apiFetch('delete', { connection: shell.conn, targetPath: shell.path + '/' + name, type });
        if (res.error) throw new Error(res.error);
        shell.toast(`Deleted ${name}`);
        this.selected.delete(name);
        this.browse(shell.path);
      } catch (err) { shell.toast('Failed: ' + err.message, true); }
    }

    async _ctxDeleteMulti() {
      const names = [...this.selected];
      const confirmed = await shell.promptDialog(`Type "yes" to delete ${names.length} items`, '');
      if (confirmed !== 'yes') { shell.toast('Cancelled'); return; }
      let deleted = 0;
      for (const name of names) {
        const row = this.container.querySelector(`.file-list tr[data-name="${CSS.escape(name)}"]`);
        const type = row ? row.dataset.type : 'file';
        try {
          const res = await shell.apiFetch('delete', { connection: shell.conn, targetPath: shell.path + '/' + name, type });
          if (res.error) throw new Error(res.error);
          deleted++;
        } catch (err) { shell.toast(`Failed to delete ${name}: ${err.message}`, true); }
      }
      shell.toast(`Deleted ${deleted} items`);
      this.selected.clear();
      this.browse(shell.path);
    }

    // ── Keyboard Shortcuts ──────────────────────────
    _onKeyDown(e) {
      if (e.target.matches('input, textarea')) return;

      if (e.key === 'Backspace') {
        e.preventDefault();
        if (shell.path !== '/') {
          const parent = shell.path.split('/').slice(0, -1).join('/') || '/';
          this.browse(parent);
        }
      }
      if (e.key === 'F2') {
        const sel = this.container.querySelector('.file-list tr.selected');
        if (sel && sel.dataset.name) { e.preventDefault(); this._ctxRename(sel.dataset.name); }
      }
      if (e.key === 'Delete') {
        const sel = this.container.querySelector('.file-list tr.selected');
        if (sel && sel.dataset.name) { e.preventDefault(); this._ctxDelete(sel.dataset.name, sel.dataset.type); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const sel = this.container.querySelector('.file-list tr.selected');
        if (sel && sel.dataset.name) { e.preventDefault(); this._ctxCopy(sel.dataset.name, sel.dataset.type, 'copy'); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        const sel = this.container.querySelector('.file-list tr.selected');
        if (sel && sel.dataset.name) { e.preventDefault(); this._ctxCopy(sel.dataset.name, sel.dataset.type, 'cut'); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (this.clipboard) { e.preventDefault(); this._ctxPaste(); }
      }
    }
  }

  // Register with shell
  shell.registerApp('explorer', {
    label: 'File Explorer',
    icon: '&#128194;',
    factory: (container, params) => new ExplorerApp(container, params),
    singleton: false
  });
})();
