# Container UI

A web-based file manager and development environment for Docker containers. Browse files, edit code, preview documents, and run terminals — all from a single browser tab.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **File Explorer** — Browse, rename, move, copy, and delete files with drag-and-drop and lasso selection
- **Text Editor** — Syntax-highlighted code editing with save support
- **Markdown Previewer** — Live preview with image rendering (including relative paths)
- **Terminal** — Full xterm.js terminal with directory-aware launching
- **Tiling Layout** — Binary split tree window manager with draggable dividers
- **SSH Connections** — Connect to remote containers via SSH with key-based auth
- **Local Mode** — Browse and edit the local filesystem directly

## Prerequisites

- **Node.js** >= 18
- **npm**
- (Optional) **SSH key** at `~/.ssh/id_ed25519` for remote container connections

## Installation

```bash
git clone https://github.com/adom-inc/container-ui.git
cd container-ui
npm install
```

> **Note:** The `node-pty` dependency requires build tools. On Debian/Ubuntu:
> ```bash
> sudo apt install -y build-essential python3
> ```
> On macOS, Xcode Command Line Tools are sufficient.

## Usage

```bash
npm start
```

The server starts on **port 3000** by default. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |

### Connecting to Containers

1. Right-click any tab to open the connection picker
2. Choose **Local** to browse the host filesystem
3. Choose a saved connection or click **Add Connection...** to connect via SSH

Connections use SSH key authentication (`~/.ssh/id_ed25519`). The server maintains a connection pool with automatic cleanup.

## Project Structure

```
container-ui/
├── server.js                 # Express + WebSocket server (API, terminal, file watching)
├── package.json
├── public/
│   ├── index.html            # Entry point
│   ├── css/
│   │   └── theme.css         # Adom design system theme
│   └── js/
│       ├── event-bus.js      # EventBus with BroadcastChannel sync
│       ├── tiling.js         # Binary split tree tiling layout manager
│       ├── shell.js          # App shell, routing, connection management
│       └── apps/
│           ├── explorer.js   # File explorer with context menus
│           ├── editor.js     # Text editor with syntax highlighting
│           ├── previewer.js  # Markdown/text/image previewer
│           └── terminal.js   # xterm.js terminal emulator
```

## Architecture

- **Frontend** — Vanilla JS, no build step. Scripts loaded directly via `<script>` tags.
- **Backend** — Express.js serving static files and a REST API. Two WebSocket servers handle terminal I/O and file system watching.
- **Layout** — A binary split tree manages panes. Files open in context: single-click previews to the right of the explorer, double-click opens the editor, terminals open below.
- **Connections** — SSH connections are pooled and reused. The server proxies all file operations (list, read, write, rename, move, delete, download) over SFTP.

## API Endpoints

All API endpoints accept POST with JSON body containing a `connection` object and relevant parameters.

| Endpoint | Description |
|----------|-------------|
| `/api/list` | List directory contents |
| `/api/read` | Read file contents |
| `/api/write` | Write file contents |
| `/api/rename` | Rename/move a file |
| `/api/delete` | Delete a file or directory |
| `/api/mkdir` | Create a directory |
| `/api/download` | Download file as base64 |
| `/api/upload` | Upload a file |
| `/api/move` | Move/copy files |
| `/api/search` | Search files by name |
| `/api/containers` | List discovered containers |

## License

MIT
