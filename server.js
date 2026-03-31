const express = require('express');
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const os = require('os');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Local filesystem helpers ──────────────────────────
function isLocal(conn) { return conn && conn.local === true; }

function localExec(cmd) {
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 10000, shell: '/bin/bash' });
    return { stdout, stderr: '' };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// SSH key for authentication
const PRIVATE_KEY = fs.existsSync('/home/adom/.ssh/id_ed25519')
  ? fs.readFileSync('/home/adom/.ssh/id_ed25519')
  : null;

// Known containers cache
const knownContainers = new Map();

// Discover containers from Carbon API
async function discoverContainers() {
  try {
    const apiKey = fs.readFileSync('/var/run/adom/api-key', 'utf8').trim();
    const proxyUri = process.env.VSCODE_PROXY_URI || '';
    const slugMatch = proxyUri.match(/-([^.]+)\.adom\.cloud/);
    if (!slugMatch) return;

    const res = await fetch('https://carbon.adom.inc/containers/' + slugMatch[1], {
      headers: { 'X-Api-Key': apiKey }
    });
    // Container info available for future use but not added to the list
    // since we already have local filesystem access
  } catch (e) {
    console.error('Discovery error:', e.message);
  }
}

// ── SSH Connection Pool ───────────────────────────────
const pool = new Map();
const POOL_TTL = 120000;

function poolKey(connOpts) {
  return `${connOpts.username || 'adom'}@${connOpts.host}:${connOpts.port || 2222}`;
}

function getPooled(connOpts) {
  const key = poolKey(connOpts);
  const entry = pool.get(key);
  if (entry && entry.conn && entry.conn._sock && !entry.conn._sock.destroyed) {
    entry.lastUsed = Date.now();
    return entry;
  }
  if (entry) {
    try { entry.conn.end(); } catch (e) {}
    pool.delete(key);
  }
  return null;
}

function getOrCreateConn(connOpts) {
  const key = poolKey(connOpts);
  const existing = getPooled(connOpts);
  if (existing) return Promise.resolve(existing.conn);

  const pending = pool.get(key);
  if (pending && pending.connecting) return pending.connecting;

  const p = new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => { conn.end(); reject(new Error('SSH timeout')); }, 10000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      pool.set(key, { conn, sftp: null, lastUsed: Date.now(), connecting: null });
      resolve(conn);
    });
    conn.on('error', err => {
      clearTimeout(timeout);
      pool.delete(key);
      reject(err);
    });
    conn.on('close', () => { pool.delete(key); });

    const opts = {
      host: connOpts.host,
      port: connOpts.port || 2222,
      username: connOpts.username || 'adom',
      readyTimeout: 10000,
      keepaliveInterval: 15000,
    };
    if (connOpts.password) opts.password = connOpts.password;
    else if (PRIVATE_KEY) opts.privateKey = PRIVATE_KEY;
    conn.connect(opts);
  });

  pool.set(key, { conn: null, sftp: null, lastUsed: Date.now(), connecting: p });
  return p;
}

function getOrCreateSftp(connOpts) {
  const key = poolKey(connOpts);
  const entry = getPooled(connOpts);
  if (entry && entry.sftp) return Promise.resolve({ sftp: entry.sftp, conn: entry.conn });

  return getOrCreateConn(connOpts).then(conn => {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err);
        const e = pool.get(key);
        if (e) e.sftp = sftp;
        resolve({ sftp, conn });
      });
    });
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (entry.conn && now - entry.lastUsed > POOL_TTL) {
      try { entry.conn.end(); } catch (e) {}
      pool.delete(key);
    }
  }
}, 30000);

function sshExec(connOpts, command) {
  return getOrCreateConn(connOpts).then(conn => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Exec timeout')), 15000);
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(timeout); return reject(err); }
        let stdout = '', stderr = '';
        stream.on('data', d => stdout += d);
        stream.stderr.on('data', d => stderr += d);
        stream.on('close', () => {
          clearTimeout(timeout);
          resolve({ stdout, stderr });
        });
      });
    });
  });
}

// SFTP helpers
function sftpWriteFile(sftp, remotePath, buffer) {
  return new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream(remotePath);
    ws.on('close', resolve);
    ws.on('error', reject);
    ws.end(buffer);
  });
}

function sftpReadFile(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const rs = sftp.createReadStream(remotePath);
    rs.on('data', c => chunks.push(c));
    rs.on('end', () => resolve(Buffer.concat(chunks)));
    rs.on('error', reject);
  });
}

function sftpMkdir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, err => {
      if (err && err.code !== 4) reject(err);
      else resolve();
    });
  });
}

// ── API Endpoints ─────────────────────────────────────

// List files
app.post('/api/ls', async (req, res) => {
  const { connection, dirPath = '/home/adom' } = req.body;
  if (!connection) return res.status(400).json({ error: 'connection required' });

  try {
    const cmd = `find ${JSON.stringify(dirPath)} -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%T@\\t%M\\t%u\\t%f\\n' 2>/dev/null | sort -t$'\\t' -k6`;
    const { stdout } = isLocal(connection) ? localExec(cmd) : await sshExec(connection, cmd);

    const entries = [];
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [type, size, mtime, perms, owner, name] = line.split('\t');
      entries.push({
        name,
        type: type === 'd' ? 'directory' : type === 'l' ? 'symlink' : 'file',
        size: parseInt(size) || 0,
        mtime: parseFloat(mtime) || 0,
        permissions: perms,
        owner
      });
    }

    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: dirPath, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Text file extensions — used as primary detection, `file` command as fallback
const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'md', 'mdx', 'rst', 'tex',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts',
  'py', 'pyw', 'pyi', 'rb', 'php', 'lua', 'perl', 'pl', 'pm', 'r', 'jl',
  'rs', 'go', 'java', 'kt', 'kts', 'scala', 'dart', 'swift', 'cs', 'fs', 'vb',
  'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hxx', 'm', 'mm',
  'zig', 'nim', 'v', 'odin', 'asm', 's', 'wat',
  'html', 'htm', 'xhtml', 'xml', 'xsl', 'xsd', 'svg',
  'css', 'scss', 'sass', 'less', 'styl',
  'json', 'jsonc', 'json5', 'geojson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'proto',
  'vue', 'svelte', 'astro',
  'tf', 'hcl', 'nix',
  'csv', 'tsv',
  'env', 'gitignore', 'editorconfig', 'dockerignore', 'npmrc', 'nvmrc',
  'makefile', 'dockerfile', 'cmake', 'gemfile', 'rakefile',
  'lock', 'pid', 'service', 'timer', 'socket', 'mount',
  'patch', 'diff',
]);

const MIME_MAP = {
  js: 'application/javascript', mjs: 'application/javascript', cjs: 'application/javascript',
  jsx: 'text/jsx', ts: 'text/typescript', tsx: 'text/tsx',
  json: 'application/json', jsonc: 'application/json', json5: 'application/json',
  html: 'text/html', htm: 'text/html', xml: 'text/xml', svg: 'image/svg+xml',
  css: 'text/css', scss: 'text/x-scss', less: 'text/x-less',
  md: 'text/markdown', txt: 'text/plain', log: 'text/plain',
  py: 'text/x-python', rb: 'text/x-ruby', php: 'text/x-php',
  rs: 'text/x-rust', go: 'text/x-go', java: 'text/x-java',
  c: 'text/x-c', cpp: 'text/x-c++', h: 'text/x-c',
  sh: 'text/x-shellscript', bash: 'text/x-shellscript',
  yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/x-toml',
  csv: 'text/csv', tsv: 'text/tab-separated-values',
};

function getFileExt(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  // Handle special filenames
  if (basename === 'dockerfile' || basename === 'makefile' || basename === 'gemfile' || basename === 'rakefile') return basename;
  if (basename.startsWith('.')) return basename.slice(1); // .gitignore -> gitignore
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(dot + 1) : '';
}

function isTextByExtension(filePath) {
  const ext = getFileExt(filePath);
  return TEXT_EXTENSIONS.has(ext);
}

function getMimeByExtension(filePath) {
  const ext = getFileExt(filePath);
  return MIME_MAP[ext] || (TEXT_EXTENSIONS.has(ext) ? 'text/plain' : '');
}

// Read file
app.post('/api/read', async (req, res) => {
  const { connection, filePath } = req.body;
  if (!connection || !filePath) return res.status(400).json({ error: 'connection and filePath required' });

  try {
    const run = isLocal(connection) ? localExec : (cmd) => sshExec(connection, cmd);

    const { stdout: sizeOut } = await run(`stat -c '%s' ${JSON.stringify(filePath)} 2>/dev/null`);
    const fileSize = parseInt(sizeOut.trim()) || 0;
    const MAX_SIZE = 512 * 1024;

    if (fileSize > MAX_SIZE) {
      return res.json({ content: null, truncated: true, size: fileSize, message: `File too large (${(fileSize / 1024).toFixed(1)}KB). Max ${MAX_SIZE / 1024}KB.` });
    }

    // Detect text vs binary: prefer extension-based detection, fall back to `file` command
    let mime = getMimeByExtension(filePath);
    let textFile = isTextByExtension(filePath);

    if (!textFile) {
      // Try `file` command as fallback
      const { stdout: mimeOut } = await run(`file -b --mime-type ${JSON.stringify(filePath)} 2>/dev/null`);
      mime = mimeOut.trim() || mime;
      textFile = mime.startsWith('text/') || mime === 'application/json' || mime === 'application/javascript' || mime === 'application/xml' || mime === 'application/x-empty' || mime === 'inode/x-empty';
    }

    // If still unknown, try reading first bytes to check for binary content
    if (!textFile && !mime) {
      const { stdout: headOut } = await run(`head -c 512 ${JSON.stringify(filePath)} 2>/dev/null | LC_ALL=C tr -d '[:print:][:space:]' | wc -c`);
      const nonPrintable = parseInt(headOut.trim()) || 0;
      textFile = nonPrintable < 5; // mostly printable = treat as text
      if (textFile) mime = 'text/plain';
    }

    if (!textFile) {
      return res.json({ content: null, binary: true, mime, size: fileSize });
    }

    const { stdout } = await run(`cat ${JSON.stringify(filePath)} 2>/dev/null`);
    res.json({ content: stdout, size: fileSize, mime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write file (new endpoint for editor)
app.post('/api/write', async (req, res) => {
  const { connection, filePath, content } = req.body;
  if (!connection || !filePath) return res.status(400).json({ error: 'connection and filePath required' });
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });

  try {
    if (isLocal(connection)) {
      fs.writeFileSync(filePath, content, 'utf8');
      res.json({ ok: true, size: Buffer.byteLength(content, 'utf8') });
    } else {
      const { sftp } = await getOrCreateSftp(connection);
      const buf = Buffer.from(content, 'utf8');
      await sftpWriteFile(sftp, filePath, buf);
      res.json({ ok: true, size: buf.length });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test connection
app.post('/api/connect', async (req, res) => {
  const { connection } = req.body;
  if (!connection) return res.status(400).json({ error: 'connection required' });

  try {
    if (isLocal(connection)) {
      res.json({ ok: true, user: os.userInfo().username, hostname: os.hostname(), arch: os.arch() });
      return;
    }
    const { stdout } = await sshExec(connection, 'whoami && hostname && uname -m');
    const [user, hostname, arch] = stdout.trim().split('\n');
    res.json({ ok: true, user, hostname, arch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stat
app.post('/api/stat', async (req, res) => {
  const { connection, targetPath } = req.body;
  if (!connection || !targetPath) return res.status(400).json({ error: 'connection and targetPath required' });

  try {
    const run = isLocal(connection) ? localExec : (cmd) => sshExec(connection, cmd);
    const { stdout } = await run(`stat -c '%F|%s|%Y|%A|%U|%G' ${JSON.stringify(targetPath)} 2>/dev/null`);
    const [type, size, mtime, perms, owner, group] = stdout.trim().split('|');
    res.json({ type, size: parseInt(size), mtime: parseInt(mtime), permissions: perms, owner, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search
app.post('/api/search', async (req, res) => {
  const { connection, searchPath = '/home/adom', pattern } = req.body;
  if (!connection || !pattern) return res.status(400).json({ error: 'connection and pattern required' });

  try {
    const cmd = `find ${JSON.stringify(searchPath)} -maxdepth 5 -name ${JSON.stringify('*' + pattern + '*')} -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -50`;
    const run = isLocal(connection) ? localExec : (c) => sshExec(connection, c);
    const { stdout } = await run(cmd);
    const results = stdout.trim().split('\n').filter(Boolean).map(p => ({
      path: p,
      name: path.basename(p),
      dir: path.dirname(p)
    }));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download file
app.post('/api/download', async (req, res) => {
  const { connection, filePath } = req.body;
  if (!connection || !filePath) return res.status(400).json({ error: 'connection and filePath required' });

  try {
    const filename = path.basename(filePath);
    if (isLocal(connection)) {
      const data = fs.readFileSync(filePath);
      return res.json({ filename, data: data.toString('base64'), size: data.length });
    }
    const { sftp } = await getOrCreateSftp(connection);
    const data = await sftpReadFile(sftp, filePath);
    res.json({ filename, data: data.toString('base64'), size: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload files
app.post('/api/upload', async (req, res) => {
  const { connection, destDir, files } = req.body;
  if (!connection || !destDir || !files) return res.status(400).json({ error: 'connection, destDir, and files required' });

  try {
    if (isLocal(connection)) {
      const results = [];
      for (const file of files) {
        const localPath = path.join(destDir, file.path);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        const buf = Buffer.from(file.data, 'base64');
        fs.writeFileSync(localPath, buf);
        results.push({ path: localPath, size: buf.length });
      }
      return res.json({ ok: true, uploaded: results });
    }

    const { sftp } = await getOrCreateSftp(connection);
    const created = new Set();
    const results = [];

    for (const file of files) {
      const remotePath = path.posix.join(destDir, file.path);
      const dir = path.posix.dirname(remotePath);

      if (!created.has(dir)) {
        const parts = dir.split('/').filter(Boolean);
        let acc = '';
        for (const p of parts) {
          acc += '/' + p;
          if (!created.has(acc)) {
            try { await sftpMkdir(sftp, acc); } catch (e) {}
            created.add(acc);
          }
        }
      }

      const buf = Buffer.from(file.data, 'base64');
      await sftpWriteFile(sftp, remotePath, buf);
      results.push({ path: remotePath, size: buf.length });
    }

    res.json({ ok: true, uploaded: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download folder
app.post('/api/download-folder', async (req, res) => {
  const { connection, folderPath } = req.body;
  if (!connection || !folderPath) return res.status(400).json({ error: 'connection and folderPath required' });

  try {
    const dirName = path.basename(folderPath);
    const parentDir = path.dirname(folderPath);
    const cmd = `cd ${JSON.stringify(parentDir)} && tar cf - ${JSON.stringify(dirName)} 2>/dev/null | base64 -w 0`;
    const run = isLocal(connection) ? localExec : (c) => sshExec(connection, c);
    const { stdout } = await run(cmd);
    res.json({ filename: dirName + '.tar', data: stdout.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Split view — open app in a new Hydrogen Web View tab
app.post('/api/split-view', async (req, res) => {
  const { appUrl = '' } = req.body;
  try {
    const apiKey = fs.readFileSync('/var/run/adom/api-key', 'utf8').trim();
    const proxyUri = process.env.VSCODE_PROXY_URI || '';
    const slugMatch = proxyUri.match(/-([^.]+)\.adom\.cloud/);
    if (!slugMatch) return res.status(500).json({ error: 'Cannot detect container' });

    const infoRes = await fetch('https://carbon.adom.inc/containers/' + slugMatch[1], { headers: { 'X-Api-Key': apiKey } });
    const info = await infoRes.json();
    const owner = info.repository?.owner?.name;
    const repo = info.repository?.name;
    if (!owner || !repo) return res.status(500).json({ error: 'Cannot detect repo' });

    const base = `https://hydrogen.adom.inc/api/workspaces/editor/${owner}/${repo}/current`;
    const feUrl = proxyUri.replace('{{port}}', String(PORT)) + (appUrl || '');

    const layoutRes = await fetch(base, { headers: { 'X-Api-Key': apiKey } });
    const layout = await layoutRes.json();

    function findLeaf(node) {
      if (node.type === 'leaf') return node;
      return findLeaf(node.second) || findLeaf(node.first);
    }
    const leaf = findLeaf(layout.root);

    const splitRes = await fetch(base + '/splits', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        panelId: leaf.id,
        direction: 'vertical',
        panelType: 'adom/a1b2c3d4-0031-4000-a000-000000000031',
        displayName: 'Container UI',
        displayIcon: 'mdi:application-brackets',
        initialState: { url: feUrl, headerHidden: true }
      })
    });
    const result = await splitRes.json();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create file
app.post('/api/create-file', async (req, res) => {
  const { connection, dirPath, name } = req.body;
  if (!connection || !dirPath || !name) return res.status(400).json({ error: 'connection, dirPath, name required' });
  try {
    const fullPath = path.posix.join(dirPath, name);
    const cmd = `touch ${JSON.stringify(fullPath)}`;
    if (isLocal(connection)) localExec(cmd);
    else await sshExec(connection, cmd);
    res.json({ ok: true, path: fullPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create folder
app.post('/api/create-folder', async (req, res) => {
  const { connection, dirPath, name } = req.body;
  if (!connection || !dirPath || !name) return res.status(400).json({ error: 'connection, dirPath, name required' });
  try {
    const fullPath = path.posix.join(dirPath, name);
    const cmd = `mkdir -p ${JSON.stringify(fullPath)}`;
    if (isLocal(connection)) localExec(cmd);
    else await sshExec(connection, cmd);
    res.json({ ok: true, path: fullPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete
app.post('/api/delete', async (req, res) => {
  const { connection, targetPath, type } = req.body;
  if (!connection || !targetPath) return res.status(400).json({ error: 'connection, targetPath required' });
  try {
    const cmd = type === 'directory'
      ? `rm -rf ${JSON.stringify(targetPath)}`
      : `rm -f ${JSON.stringify(targetPath)}`;
    if (isLocal(connection)) localExec(cmd);
    else await sshExec(connection, cmd);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rename
app.post('/api/rename', async (req, res) => {
  const { connection, oldPath, newName } = req.body;
  if (!connection || !oldPath || !newName) return res.status(400).json({ error: 'connection, oldPath, newName required' });
  try {
    const dir = path.dirname(oldPath);
    const newPath = path.posix.join(dir, newName);
    const cmd = `mv ${JSON.stringify(oldPath)} ${JSON.stringify(newPath)}`;
    if (isLocal(connection)) localExec(cmd);
    else await sshExec(connection, cmd);
    res.json({ ok: true, path: newPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Copy
app.post('/api/copy', async (req, res) => {
  const { connection, srcPath, destDir, type } = req.body;
  if (!connection || !srcPath || !destDir) return res.status(400).json({ error: 'connection, srcPath, destDir required' });
  try {
    const filename = path.basename(srcPath);
    let destPath = path.posix.join(destDir, filename);
    const checkCmd = `test -e ${JSON.stringify(destPath)} && echo EXISTS || echo OK`;
    const checkResult = isLocal(connection) ? localExec(checkCmd) : await sshExec(connection, checkCmd);
    if ((checkResult.stdout || '').trim() === 'EXISTS') {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      destPath = path.posix.join(destDir, `${base} (copy)${ext}`);
    }
    const flag = type === 'directory' ? '-r' : '';
    const cmd = `cp ${flag} ${JSON.stringify(srcPath)} ${JSON.stringify(destPath)}`;
    if (isLocal(connection)) localExec(cmd);
    else await sshExec(connection, cmd);
    res.json({ ok: true, path: destPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Move
app.post('/api/move', async (req, res) => {
  const { connection, srcPath, destDir } = req.body;
  if (!connection || !srcPath || !destDir) return res.status(400).json({ error: 'connection, srcPath, destDir required' });

  try {
    const filename = path.basename(srcPath);
    const destPath = path.posix.join(destDir, filename);
    if (srcPath === destPath) return res.json({ ok: true, moved: destPath });

    const cmd = `mv ${JSON.stringify(srcPath)} ${JSON.stringify(destPath)}`;
    if (isLocal(connection)) localExec(cmd);
    else await sshExec(connection, cmd);
    res.json({ ok: true, moved: destPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transfer between connections
app.post('/api/transfer', async (req, res) => {
  const { source, dest } = req.body;
  if (!source || !dest) return res.status(400).json({ error: 'source and dest required' });

  try {
    const filename = path.basename(source.path);
    const destPath = path.posix.join(dest.dir, filename);

    if (source.type === 'directory') {
      const tarCmd = `cd ${JSON.stringify(path.dirname(source.path))} && tar cf - ${JSON.stringify(filename)} 2>/dev/null | base64 -w 0`;
      const srcRun = isLocal(source.connection) ? localExec : (c) => sshExec(source.connection, c);
      const { stdout: tarData } = await srcRun(tarCmd);

      if (!tarData.trim()) return res.status(500).json({ error: 'Failed to read source directory' });

      const untarCmd = `cd ${JSON.stringify(dest.dir)} && echo ${JSON.stringify(tarData.trim())} | base64 -d | tar xf - 2>/dev/null`;
      const dstRun = isLocal(dest.connection) ? localExec : (c) => sshExec(dest.connection, c);
      await dstRun(untarCmd);

      res.json({ ok: true, transferred: destPath, type: 'directory' });
    } else {
      let data;
      if (isLocal(source.connection)) {
        data = fs.readFileSync(source.path);
      } else {
        const { sftp: srcSftp } = await getOrCreateSftp(source.connection);
        data = await sftpReadFile(srcSftp, source.path);
      }

      if (isLocal(dest.connection)) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, data);
      } else {
        const { sftp: dstSftp } = await getOrCreateSftp(dest.connection);
        await sftpWriteFile(dstSftp, destPath, data);
      }

      res.json({ ok: true, transferred: destPath, type: 'file', size: data.length });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pool status
app.get('/api/discovered', (req, res) => {
  const list = [];
  for (const [key, c] of knownContainers) {
    list.push({ name: c.name, host: c.host, port: c.port, username: c.username, image: c.image, hostname: c.hostname });
  }
  res.json(list);
});

app.get('/api/pool-status', (req, res) => {
  const status = {};
  for (const [key, entry] of pool) {
    if (entry.connecting) {
      status[key] = 'connecting';
    } else if (entry.conn && entry.conn._sock && !entry.conn._sock.destroyed) {
      status[key] = 'connected';
    } else {
      status[key] = 'disconnected';
    }
  }
  res.json(status);
});

// ── WebSocket Terminal ────────────────────────────────

const PORT = 8850;
const server = http.createServer(app);
const wssTerminal = new WebSocketServer({ noServer: true });
const wssWatch = new WebSocketServer({ noServer: true });

// Try to load node-pty for local PTY support
let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.log('node-pty not available, local terminal will use basic spawn');
}

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.endsWith('/ws/terminal')) {
    wssTerminal.handleUpgrade(request, socket, head, ws => {
      wssTerminal.emit('connection', ws, request);
    });
  } else if (url.pathname.endsWith('/ws/watch')) {
    wssWatch.handleUpgrade(request, socket, head, ws => {
      wssWatch.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ── File Watcher WebSocket ────────────────────────────
const activeWatchers = new Map(); // watchId -> { watcher, clients: Set<ws>, path, type }

function getWatchKey(watchPath, connKey) {
  return `${connKey || 'local'}:${watchPath}`;
}

wssWatch.on('connection', (ws) => {
  const myWatches = new Set(); // keys this client is watching

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.action === 'watch') {
      const watchPath = msg.path;
      const conn = msg.connection;
      const isLocalConn = !conn || isLocal(conn);
      const connKey = isLocalConn ? 'local' : `${conn.username}@${conn.host}:${conn.port}`;
      const key = getWatchKey(watchPath, connKey);

      if (activeWatchers.has(key)) {
        // Add client to existing watcher
        activeWatchers.get(key).clients.add(ws);
        myWatches.add(key);
        return;
      }

      if (isLocalConn) {
        // Local fs.watch
        try {
          let debounce = null;
          const watcher = fs.watch(watchPath, { recursive: false }, (eventType, filename) => {
            // Debounce: collapse rapid events into one notification
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
              debounce = null;
              const entry = activeWatchers.get(key);
              if (!entry) return;
              const payload = JSON.stringify({ type: 'change', path: watchPath, event: eventType, filename });
              for (const client of entry.clients) {
                if (client.readyState === 1) client.send(payload);
              }
            }, 300);
          });
          activeWatchers.set(key, { watcher, clients: new Set([ws]), path: watchPath, type: 'local' });
          myWatches.add(key);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: 'Watch failed: ' + e.message }));
        }
      } else {
        // SSH: poll every 3 seconds
        let lastHash = '';
        const poll = setInterval(async () => {
          const entry = activeWatchers.get(key);
          if (!entry || entry.clients.size === 0) { clearInterval(poll); activeWatchers.delete(key); return; }
          try {
            const { stdout } = await sshExec(conn, `ls -la --time-style=+%s ${JSON.stringify(watchPath)} 2>/dev/null | md5sum`);
            const hash = stdout.trim();
            if (lastHash && hash !== lastHash) {
              const payload = JSON.stringify({ type: 'change', path: watchPath, event: 'change', filename: null });
              for (const client of entry.clients) {
                if (client.readyState === 1) client.send(payload);
              }
            }
            lastHash = hash;
          } catch (e) {}
        }, 3000);
        activeWatchers.set(key, { watcher: { close: () => clearInterval(poll) }, clients: new Set([ws]), path: watchPath, type: 'ssh' });
        myWatches.add(key);
      }
    }

    if (msg.action === 'unwatch') {
      const watchPath = msg.path;
      const conn = msg.connection;
      const isLocalConn = !conn || isLocal(conn);
      const connKey = isLocalConn ? 'local' : `${conn.username}@${conn.host}:${conn.port}`;
      const key = getWatchKey(watchPath, connKey);
      unwatchKey(key, ws);
      myWatches.delete(key);
    }
  });

  ws.on('close', () => {
    for (const key of myWatches) {
      unwatchKey(key, ws);
    }
  });
});

function unwatchKey(key, ws) {
  const entry = activeWatchers.get(key);
  if (!entry) return;
  entry.clients.delete(ws);
  if (entry.clients.size === 0) {
    try { entry.watcher.close(); } catch (e) {}
    activeWatchers.delete(key);
  }
}

wssTerminal.on('connection', (ws) => {
  let proc = null;
  let sshConn = null;
  let sshStream = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'start') {
      const conn = msg.connection;
      const cols = msg.cols || 80;
      const rows = msg.rows || 24;

      if (isLocal(conn)) {
        // Local terminal
        if (pty) {
          proc = pty.spawn('bash', [], {
            name: 'xterm-256color',
            cols, rows,
            cwd: '/home/adom',
            env: { ...process.env, TERM: 'xterm-256color' }
          });
          proc.onData(data => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data }));
          });
          proc.onExit(() => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit' }));
          });
        } else {
          // Fallback: basic spawn without PTY
          proc = spawn('bash', ['-i'], {
            cwd: '/home/adom',
            env: { ...process.env, TERM: 'xterm-256color' },
            stdio: ['pipe', 'pipe', 'pipe']
          });
          proc.stdout.on('data', data => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
          });
          proc.stderr.on('data', data => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
          });
          proc.on('close', () => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit' }));
          });
        }
      } else {
        // SSH terminal
        getOrCreateConn(conn).then(sshClient => {
          sshConn = sshClient;
          sshClient.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
              return;
            }
            sshStream = stream;
            stream.on('data', data => {
              if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
            });
            stream.on('close', () => {
              if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit' }));
            });
          });
        }).catch(err => {
          ws.send(JSON.stringify({ type: 'error', message: 'SSH connection failed: ' + err.message }));
        });
      }
    }

    if (msg.type === 'input') {
      if (proc) {
        if (pty && proc.write) {
          proc.write(msg.data);
        } else if (proc.stdin) {
          proc.stdin.write(msg.data);
        }
      }
      if (sshStream) {
        sshStream.write(msg.data);
      }
    }

    if (msg.type === 'resize') {
      const { cols, rows } = msg;
      if (proc) {
        if (pty && proc.resize) proc.resize(cols, rows);
      }
      if (sshStream) {
        sshStream.setWindow(rows, cols, 0, 0);
      }
    }
  });

  ws.on('close', () => {
    if (proc) {
      try {
        if (proc.kill) proc.kill();
        else if (proc.pid) process.kill(proc.pid);
      } catch (e) {}
    }
    if (sshStream) {
      try { sshStream.close(); } catch (e) {}
    }
    // Note: we don't close sshConn because it's pooled
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Container UI server on port ${PORT}`);
  discoverContainers();
});
