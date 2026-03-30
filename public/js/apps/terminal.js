/**
 * Terminal App — Interactive shell via WebSocket + xterm.js.
 * Supports local bash and SSH sessions on remote containers.
 */
(function () {
  class TerminalApp {
    constructor(container, params) {
      this.container = container;
      this.connection = params.connection || shell.conn;
      this.cwd = params.cwd || null;
      this.ws = null;
      this.term = null;
      this.fitAddon = null;
      this.sessionId = null;
      this.connected = false;
      this._cwdSent = false;

      this._render();
      this._initTerminal();
    }

    getTitle() {
      const dir = this.cwd ? this.cwd.split('/').pop() || '/' : '';
      if (this.connection && !this.connection.local) {
        const host = (this.connection.username || 'ssh').split('-')[0];
        return dir ? `Term: ${host} (${dir})` : `Term: ${host}`;
      }
      return dir ? `Terminal (${dir})` : 'Terminal';
    }
    getIcon() { return '&#9000;'; }

    _render() {
      const connLabel = this.connection
        ? (this.connection.local ? 'Local' : `${this.connection.username}@${this.connection.host}`)
        : 'No connection';

      this.container.innerHTML = `
        <div class="terminal-container">
          <div class="terminal-toolbar">
            <span class="terminal-title">${shell.esc(connLabel)}</span>
            <button class="btn secondary" id="term-reconnectBtn" style="font-size:11px;padding:3px 10px;">Reconnect</button>
          </div>
          <div class="terminal-body" id="term-body"></div>
        </div>`;

      this.container.querySelector('#term-reconnectBtn').addEventListener('click', () => {
        this._disconnect();
        this._connect();
      });
    }

    _initTerminal() {
      const termBody = this.container.querySelector('#term-body');

      if (typeof Terminal === 'undefined') {
        termBody.innerHTML = '<div class="empty"><span class="icon">&#9888;</span><p>xterm.js not loaded</p></div>';
        return;
      }

      this.term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'SF Mono', 'Cascadia Code', Consolas, monospace",
        theme: {
          background: '#0d1117',
          foreground: '#e6edf3',
          cursor: '#00e6dc',
          selectionBackground: 'rgba(0, 184, 176, 0.25)',
          black: '#484f58',
          red: '#f85149',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#8C6BF7',
          cyan: '#00b8b0',
          white: '#8b949e',
          brightBlack: '#6e7681',
          brightRed: '#f85149',
          brightGreen: '#3fb950',
          brightYellow: '#d29922',
          brightBlue: '#58a6ff',
          brightMagenta: '#8C6BF7',
          brightCyan: '#00e6dc',
          brightWhite: '#e6edf3'
        }
      });

      if (typeof FitAddon !== 'undefined') {
        this.fitAddon = new FitAddon.FitAddon();
        this.term.loadAddon(this.fitAddon);
      }

      this.term.open(termBody);

      if (this.fitAddon) {
        setTimeout(() => this.fitAddon.fit(), 100);
      }

      // Send user input to WebSocket
      this.term.onData(data => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Handle resize
      this.term.onResize(({ cols, rows }) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      this._resizeObserver = new ResizeObserver(() => {
        if (this.fitAddon) this.fitAddon.fit();
      });
      this._resizeObserver.observe(termBody);

      this._connect();

      // Listen for cd events
      this._unsubCd = bus.on('term:cd', ({ path }) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', data: `cd ${path}\r` }));
        }
      });
    }

    _connect() {
      if (!this.connection) {
        this.term.writeln('\r\n\x1b[33mNo connection selected. Connect to a container first.\x1b[0m');
        return;
      }

      const loc = window.location;
      const wsProtocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const basePath = loc.pathname.replace(/\/[^/]*$/, '');
      const wsUrl = `${wsProtocol}//${loc.host}${basePath}/ws/terminal`;

      this.term.writeln('\r\n\x1b[36mConnecting...\x1b[0m');

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        this.term.writeln(`\r\n\x1b[31mWebSocket error: ${err.message}\x1b[0m`);
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        // Send connection info to start the shell
        this.ws.send(JSON.stringify({
          type: 'start',
          connection: this.connection,
          cols: this.term.cols,
          rows: this.term.rows
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'output') {
            this.term.write(msg.data);
            // cd to initial directory after shell is ready
            if (this.cwd && !this._cwdSent) {
              this._cwdSent = true;
              setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.send(JSON.stringify({ type: 'input', data: `cd ${this.cwd} && clear\r` }));
                }
              }, 150);
            }
          } else if (msg.type === 'error') {
            this.term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
          } else if (msg.type === 'exit') {
            this.term.writeln('\r\n\x1b[33mSession ended.\x1b[0m');
            this.connected = false;
          }
        } catch (e) {
          // Raw data fallback
          this.term.write(event.data);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.term.writeln('\r\n\x1b[33mDisconnected.\x1b[0m');
      };

      this.ws.onerror = () => {
        this.term.writeln('\r\n\x1b[31mConnection error.\x1b[0m');
      };
    }

    _disconnect() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.connected = false;
    }

    activate() {
      if (this.fitAddon) {
        setTimeout(() => this.fitAddon.fit(), 50);
      }
      if (this.term) this.term.focus();
    }

    deactivate() {}

    destroy() {
      this._disconnect();
      if (this._resizeObserver) this._resizeObserver.disconnect();
      if (this._unsubCd) this._unsubCd();
      if (this.term) this.term.dispose();
    }
  }

  shell.registerApp('terminal', {
    label: 'Terminal',
    icon: '&#9000;',
    factory: (container, params) => new TerminalApp(container, params),
    singleton: false  // Allow multiple terminals
  });
})();
