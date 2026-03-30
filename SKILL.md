---
name: container-ui
description: Use when the user wants to launch, access, or troubleshoot the Container UI — a web-based file manager, terminal, editor, and previewer for browsing Docker containers and remote hosts via SSH. Covers starting the server, opening it in the Adom workspace, connecting to containers, and common issues.
---

# Container UI

A web-based file manager and development environment running inside Adom Docker containers. Provides a file explorer, text editor, markdown previewer, and terminal — all in a single browser tab.

**Repository:** `adom-inc/container-ui`
**Location in container:** `~/project/container-ui/`
**Port:** `8850` (bound to `0.0.0.0`, proxy-accessible)

## Starting the Server

```bash
cd ~/project/container-ui && npm start
```

The server runs on port **8850**. To run in the background:

```bash
cd ~/project/container-ui && nohup node server.js > /tmp/container-ui.log 2>&1 &
```

Check if it's already running:

```bash
curl -sf http://127.0.0.1:8850/ > /dev/null && echo "running" || echo "not running"
```

## Opening in the Adom Workspace

Container UI is accessible via the Adom proxy at:

```
https://<slug>.adom.cloud/proxy/8850/
```

To open it as a Web View panel in the Adom workspace, use the `adom-workspace-control` skill:

```bash
API_KEY=$(cat /var/run/adom/api-key)
SLUG=$(echo "$VSCODE_PROXY_URI" | sed 's|.*-\([^.]*\)\.adom\.cloud.*|\1|')
CONTAINER_INFO=$(curl -s -H "X-Api-Key: $API_KEY" "https://carbon.adom.inc/containers/$SLUG")
OWNER=$(python3 -c "import sys,json; print(json.load(sys.stdin)['repository']['owner']['name'])" <<< "$CONTAINER_INFO")
REPO=$(python3 -c "import sys,json; print(json.load(sys.stdin)['repository']['name'])" <<< "$CONTAINER_INFO")
BASE="https://hydrogen.adom.inc/api/workspaces/editor/$OWNER/$REPO/current"

# Get layout to find a leaf panel ID
LAYOUT=$(curl -s -H "X-Api-Key: $API_KEY" "$BASE")
LEAF_ID=$(python3 -c "
import sys, json
def find_leaf(node):
    if node['type'] == 'leaf': return node['id']
    return find_leaf(node['first']) or find_leaf(node['second'])
print(find_leaf(json.load(sys.stdin)))
" <<< "$LAYOUT")

# Add a Web View tab
TAB=$(curl -s -X POST \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"panelId\":\"$LEAF_ID\",\"panelType\":\"adom/a1b2c3d4-0031-4000-a000-000000000031\",\"displayName\":\"Container UI\",\"displayIcon\":\"mdi:file-tree\"}" \
  "$BASE/tabs")

# Navigate the Web View to Container UI
TAB_ID=$(python3 -c "import sys,json; print(json.load(sys.stdin)['tabId'])" <<< "$TAB")
PROXY_URL="$VSCODE_PROXY_URI"
CUI_URL="${PROXY_URL//\{\{port\}\}/8850}"

curl -s -X PATCH \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"panelId\":\"$LEAF_ID\",\"action\":\"navigate\",\"url\":\"$CUI_URL\"}" \
  "https://hydrogen.adom.inc/api/panels/webview/$OWNER/$REPO"
```

Or simply split an existing pane:

```bash
# Split the current pane horizontally and add Container UI
curl -s -X POST \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"panelId\":\"$LEAF_ID\",\"direction\":\"horizontal\",\"panelType\":\"adom/a1b2c3d4-0031-4000-a000-000000000031\",\"displayName\":\"Container UI\",\"displayIcon\":\"mdi:file-tree\"}" \
  "$BASE/splits"
```

## Features

### File Explorer
- Browse local and remote filesystems
- Single-click a file to preview, double-click to edit
- Right-click for context menu: rename, delete, copy, paste, move, open terminal here, edit
- Drag-and-drop files between directories
- Lasso selection for multiple files
- Breadcrumb navigation in the toolbar
- Overwrite warnings when renaming/moving to existing names

### Text Editor
- Syntax-highlighted editing for all text file types
- Save with the Save button or keyboard shortcut

### Markdown Previewer
- Live rendered markdown with image support
- Images resolve relative paths via the API (fetched as base64)

### Terminal
- Full xterm.js terminal emulator
- Opens in the directory you right-clicked from ("Open Terminal Here")
- Opens below the file explorer pane

### Tiling Layout
- Binary split tree window manager
- Drag dividers to resize panes
- Preview opens right of explorer, terminal opens below

### Connection Management
- **Toolbar dropdown** in the explorer to switch connections
- **Local mode** for browsing the container's own filesystem
- **SSH connections** to remote containers via key-based auth (`~/.ssh/id_ed25519`)
- Auto-discovers containers via the Carbon API

## Architecture

```
Browser → Express.js (port 8850) → Local filesystem or SSH/SFTP
                                  → WebSocket for terminal I/O (node-pty)
                                  → WebSocket for file watching
```

- **Frontend:** Vanilla JS, no build step. Loaded via `<script>` tags.
- **Backend:** Express.js REST API + two WebSocket servers (terminal, file watcher).
- **SSH:** Connection pool with 2-minute TTL. All file ops proxied over SFTP.

## API Endpoints

All POST with JSON body containing `connection` object + params.

| Endpoint | Description |
|----------|-------------|
| `/api/list` | List directory contents |
| `/api/read` | Read file contents (text) |
| `/api/write` | Write file contents |
| `/api/rename` | Rename or move a file |
| `/api/delete` | Delete file or directory |
| `/api/mkdir` | Create directory |
| `/api/download` | Download file as base64 |
| `/api/upload` | Upload file |
| `/api/move` | Move or copy files |
| `/api/search` | Search files by name |
| `/api/containers` | List discovered containers |

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server and REST API |
| `ws` | WebSocket servers (terminal, file watcher) |
| `ssh2` | SSH/SFTP connections to remote containers |
| `node-pty` | PTY for local terminal emulation |

`node-pty` requires build tools (`build-essential`, `python3` on Debian/Ubuntu). These are pre-installed in Adom containers.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server won't start | Check if port 8850 is already in use: `lsof -i :8850` |
| Can't connect to remote container | Verify SSH key exists: `ls ~/.ssh/id_ed25519` |
| Stale UI after code changes | Bump cache version `?v=N` in `public/index.html` and hard-refresh |
| Terminal not spawning | Check `node-pty` is installed: `ls node_modules/node-pty/build/` |
| WebSocket errors in browser | Ensure proxy supports WebSocket upgrades (Adom proxy does by default) |

## Restarting the Server

Find and kill the existing process, then restart:

```bash
# Find the PID (careful: only match container-ui's server.js)
PID=$(ps aux | grep "[n]ode server.js" | grep container-ui | awk '{print $2}')
[ -n "$PID" ] && kill $PID
cd ~/project/container-ui && nohup node server.js > /tmp/container-ui.log 2>&1 &
```

**WARNING:** Never use `pkill node` or `killall node` — this kills VS Code and the entire container session.
