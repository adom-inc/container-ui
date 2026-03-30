/**
 * Editor App — Simple text editor with line numbers, save support, and status bar.
 * Opens when a text file is double-clicked in explorer or "Edit" is clicked in previewer.
 */
(function () {
  class EditorApp {
    constructor(container, params) {
      this.container = container;
      this.filePath = params.path || null;
      this.connection = params.connection || shell.conn;
      this.fileName = params.name || (this.filePath ? this.filePath.split('/').pop() : 'untitled');
      this.originalContent = '';
      this.modified = false;
      this.cursorLine = 1;
      this.cursorCol = 1;

      this._render();
      this._bindEvents();

      if (this.filePath) {
        this.loadFile(this.filePath, this.connection);
      }
    }

    getTitle() { return this.fileName; }
    getIcon() { return '&#9998;'; }

    onParams(params) {
      if (params.path && params.path !== this.filePath) {
        this.filePath = params.path;
        this.fileName = params.name || params.path.split('/').pop();
        this.connection = params.connection || shell.conn;
        this.loadFile(this.filePath, this.connection);
      }
    }

    _render() {
      this.container.innerHTML = `
        <div class="editor-container">
          <div class="editor-toolbar">
            <span class="editor-filename" id="ed-filename">${shell.esc(this.fileName)}</span>
            <span class="editor-status" id="ed-status"></span>
            <button class="btn" id="ed-saveBtn" style="font-size:11px;padding:3px 10px;">Save</button>
          </div>
          <div class="editor-body">
            <pre class="editor-line-nums" id="ed-lineNums">1</pre>
            <textarea class="editor-textarea" id="ed-textarea" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></textarea>
          </div>
          <div class="editor-footer">
            <span id="ed-cursor">Ln 1, Col 1</span>
            <span id="ed-fileInfo"></span>
            <span id="ed-modIndicator"></span>
          </div>
        </div>`;
    }

    _bindEvents() {
      const textarea = this.container.querySelector('#ed-textarea');
      const lineNums = this.container.querySelector('#ed-lineNums');
      const saveBtn = this.container.querySelector('#ed-saveBtn');

      // Sync line numbers with textarea scroll
      textarea.addEventListener('scroll', () => {
        lineNums.scrollTop = textarea.scrollTop;
      });

      // Update line numbers on input
      textarea.addEventListener('input', () => {
        this._updateLineNumbers();
        this._setModified(textarea.value !== this.originalContent);
      });

      // Track cursor position
      textarea.addEventListener('keyup', () => this._updateCursor());
      textarea.addEventListener('click', () => this._updateCursor());

      // Tab key inserts spaces
      textarea.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
          textarea.selectionStart = textarea.selectionEnd = start + 2;
          textarea.dispatchEvent(new Event('input'));
        }
        // Ctrl+S = save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          this.save();
        }
      });

      saveBtn.addEventListener('click', () => this.save());
    }

    _updateLineNumbers() {
      const textarea = this.container.querySelector('#ed-textarea');
      const lineNums = this.container.querySelector('#ed-lineNums');
      const lines = textarea.value.split('\n');
      lineNums.textContent = lines.map((_, i) => i + 1).join('\n');
    }

    _updateCursor() {
      const textarea = this.container.querySelector('#ed-textarea');
      const cursorEl = this.container.querySelector('#ed-cursor');
      const pos = textarea.selectionStart;
      const text = textarea.value.substring(0, pos);
      const lines = text.split('\n');
      this.cursorLine = lines.length;
      this.cursorCol = lines[lines.length - 1].length + 1;
      cursorEl.textContent = `Ln ${this.cursorLine}, Col ${this.cursorCol}`;
    }

    _setModified(modified) {
      this.modified = modified;
      const indicator = this.container.querySelector('#ed-modIndicator');
      indicator.textContent = modified ? 'Modified' : '';
      indicator.className = modified ? 'editor-modified' : '';

      // Update tab title
      const tab = shell.getTabByInstance(this);
      if (tab) {
        const title = modified ? '\u2022 ' + this.fileName : this.fileName;
        shell.updateTabTitle(tab.id, title);
      }
    }

    async loadFile(filePath, connection) {
      this.filePath = filePath;
      this.connection = connection || shell.conn;
      this.fileName = filePath.split('/').pop();

      const textarea = this.container.querySelector('#ed-textarea');
      const filenameEl = this.container.querySelector('#ed-filename');
      const statusEl = this.container.querySelector('#ed-status');
      const fileInfoEl = this.container.querySelector('#ed-fileInfo');

      filenameEl.textContent = this.fileName;
      statusEl.textContent = 'Loading...';
      textarea.value = '';
      textarea.disabled = true;

      try {
        const res = await shell.apiFetch('read', { connection: this.connection, filePath });
        if (res.error) throw new Error(res.error);

        if (res.binary) {
          statusEl.textContent = 'Cannot edit binary files';
          textarea.value = '';
          textarea.disabled = true;
          return;
        }

        if (res.truncated) {
          statusEl.textContent = res.message;
          textarea.value = '';
          textarea.disabled = true;
          return;
        }

        this.originalContent = res.content || '';
        textarea.value = this.originalContent;
        textarea.disabled = false;
        statusEl.textContent = '';
        fileInfoEl.textContent = `${res.mime || ''} \u2022 ${this._formatSize(res.size)}`;

        this._updateLineNumbers();
        this._setModified(false);

        const tab = shell.getTabByInstance(this);
        if (tab) shell.updateTabTitle(tab.id, this.fileName);
      } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        textarea.disabled = true;
      }
    }

    async save() {
      if (!this.filePath || !this.connection) {
        shell.toast('No file to save', true);
        return;
      }

      const textarea = this.container.querySelector('#ed-textarea');
      const statusEl = this.container.querySelector('#ed-status');
      statusEl.textContent = 'Saving...';

      try {
        const res = await shell.apiFetch('write', {
          connection: this.connection,
          filePath: this.filePath,
          content: textarea.value
        });
        if (res.error) throw new Error(res.error);

        this.originalContent = textarea.value;
        this._setModified(false);
        statusEl.textContent = 'Saved';
        setTimeout(() => { if (statusEl.textContent === 'Saved') statusEl.textContent = ''; }, 2000);
        shell.toast(`Saved ${this.fileName}`);
      } catch (err) {
        statusEl.textContent = 'Save failed';
        shell.toast('Save failed: ' + err.message, true);
      }
    }

    _formatSize(bytes) {
      if (!bytes) return '';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    activate() {
      // Focus textarea when tab is activated
      setTimeout(() => {
        const textarea = this.container.querySelector('#ed-textarea');
        if (textarea && !textarea.disabled) textarea.focus();
      }, 50);
    }

    deactivate() {}

    destroy() {
      if (this.modified) {
        // Content is lost — could prompt in future
      }
    }
  }

  shell.registerApp('editor', {
    label: 'Text Editor',
    icon: '&#9998;',
    factory: (container, params) => new EditorApp(container, params),
    singleton: false  // Allow multiple editor tabs
  });
})();
