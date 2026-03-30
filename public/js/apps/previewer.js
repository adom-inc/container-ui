/**
 * Previewer App — Rich file previewer with support for images, markdown,
 * code with syntax highlights, SVG, JSON, CSV, HTML, and text fallback.
 */
(function () {

  // ── File type classification ──────────────────────────
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'tif']);
  const SVG_EXT = 'svg';
  const MARKDOWN_EXT = 'md';
  const JSON_EXTS = new Set(['json', 'jsonc', 'json5', 'geojson']);
  const HTML_EXTS = new Set(['html', 'htm', 'xhtml']);
  const CSV_EXTS = new Set(['csv', 'tsv']);
  const YAML_EXTS = new Set(['yaml', 'yml']);

  // Language labels for the meta bar
  const LANG_LABELS = {
    js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX', mjs: 'JavaScript', cjs: 'JavaScript',
    py: 'Python', pyw: 'Python', pyi: 'Python',
    rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala',
    c: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', h: 'C Header', hpp: 'C++ Header',
    cs: 'C#', fs: 'F#', vb: 'Visual Basic',
    rb: 'Ruby', php: 'PHP', lua: 'Lua', perl: 'Perl', pl: 'Perl', pm: 'Perl',
    r: 'R', jl: 'Julia', dart: 'Dart', swift: 'Swift', m: 'Objective-C',
    html: 'HTML', htm: 'HTML', xhtml: 'XHTML', xml: 'XML', xsl: 'XSLT', xsd: 'XML Schema',
    css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less', styl: 'Stylus',
    json: 'JSON', jsonc: 'JSON', json5: 'JSON5', yaml: 'YAML', yml: 'YAML',
    toml: 'TOML', ini: 'INI', cfg: 'Config', conf: 'Config', env: 'Env',
    md: 'Markdown', mdx: 'MDX', rst: 'reStructuredText', tex: 'LaTeX',
    sh: 'Shell', bash: 'Bash', zsh: 'Zsh', fish: 'Fish', ps1: 'PowerShell', bat: 'Batch', cmd: 'Batch',
    sql: 'SQL', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protobuf',
    dockerfile: 'Dockerfile', makefile: 'Makefile', cmake: 'CMake',
    vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
    tf: 'Terraform', hcl: 'HCL', nix: 'Nix',
    zig: 'Zig', nim: 'Nim', v: 'V', odin: 'Odin', asm: 'Assembly', s: 'Assembly',
    wasm: 'WebAssembly', wat: 'WebAssembly Text',
    txt: 'Plain Text', log: 'Log', csv: 'CSV', tsv: 'TSV',
    gitignore: 'gitignore', editorconfig: 'EditorConfig', lock: 'Lock File',
    svg: 'SVG', png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP',
    bmp: 'Bitmap', ico: 'Icon', avif: 'AVIF',
  };

  // Keyword sets for basic syntax highlighting per language family
  const SYNTAX = {
    js: {
      keywords: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|export|default|from|as|async|await|try|catch|finally|throw|yield|this|true|false|null|undefined|void|static|get|set)\b/g,
      strings: /(["'`])(?:(?!\1|\\).|\\.)*?\1/g,
      comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-f]+|0b[01]+|0o[0-7]+)\b/gi,
    },
    py: {
      keywords: /\b(def|class|return|if|elif|else|for|while|break|continue|import|from|as|try|except|finally|raise|with|yield|lambda|pass|del|global|nonlocal|assert|True|False|None|and|or|not|in|is|async|await|self)\b/g,
      strings: /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
      comments: /(#.*$)/gm,
      numbers: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-f]+|0b[01]+|0o[0-7]+)\b/gi,
    },
    rs: {
      keywords: /\b(fn|let|mut|const|if|else|match|for|while|loop|break|continue|return|struct|enum|impl|trait|pub|use|mod|crate|super|self|Self|type|where|as|in|ref|move|async|await|unsafe|static|extern|true|false|Some|None|Ok|Err)\b/g,
      strings: /(r#?"(?:[^"\\]|\\.)*"#?|"(?:[^"\\]|\\.)*"|'[^'\\]'|'\\.')/g,
      comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(\d[\d_]*\.?[\d_]*(?:e[+-]?[\d_]+)?(?:f32|f64|i\d+|u\d+|usize|isize)?|0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+)\b/gi,
    },
    go: {
      keywords: /\b(func|return|if|else|for|range|switch|case|default|break|continue|go|defer|select|chan|map|struct|interface|package|import|var|const|type|true|false|nil|make|len|cap|append|delete|copy|new|panic|recover)\b/g,
      strings: /(`[^`]*`|"(?:[^"\\]|\\.)*"|'[^']*')/g,
      comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-f]+|0b[01]+|0o[0-7]+)\b/gi,
    },
    css: {
      keywords: /(@[a-z-]+|!important)\b/g,
      strings: /(["'])(?:(?!\1|\\).|\\.)*?\1/g,
      comments: /(\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(\d+\.?\d*(%|px|em|rem|vh|vw|pt|cm|mm|in|ex|ch|vmin|vmax|fr|deg|rad|turn|s|ms)?)\b/g,
    },
    html: {
      keywords: null,
      strings: /(["'])(?:(?!\1|\\).|\\.)*?\1/g,
      comments: /(<!--[\s\S]*?-->)/gm,
      numbers: null,
      tags: /(<\/?[a-zA-Z][a-zA-Z0-9-]*|\/?>)/g,
    },
    sh: {
      keywords: /\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|export|local|readonly|declare|set|unset|source|alias|echo|printf|read|test|true|false)\b/g,
      strings: /(["'])(?:(?!\1|\\).|\\.)*?\1/g,
      comments: /(#.*$)/gm,
      numbers: /\b(\d+)\b/g,
    },
    sql: {
      keywords: /\b(SELECT|FROM|WHERE|INSERT|INTO|UPDATE|SET|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|NULL|IS|IN|BETWEEN|LIKE|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|DISTINCT|UNION|ALL|EXISTS|CASE|WHEN|THEN|ELSE|END|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|DEFAULT|AUTO_INCREMENT|CASCADE|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|TRANSACTION|VALUES|COUNT|SUM|AVG|MIN|MAX|TRUE|FALSE)\b/gi,
      strings: /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g,
      comments: /(--.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(\d+\.?\d*)\b/g,
    },
  };

  // Map extensions to syntax families
  const EXT_TO_SYNTAX = {
    js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
    json: 'js', jsonc: 'js', json5: 'js',
    java: 'js', kt: 'js', kts: 'js', scala: 'js', dart: 'js', swift: 'js',
    c: 'js', cpp: 'js', cc: 'js', cxx: 'js', h: 'js', hpp: 'js', cs: 'js',
    vue: 'html', svelte: 'html', astro: 'html',
    py: 'py', pyw: 'py', pyi: 'py', r: 'py', jl: 'py', rb: 'py',
    rs: 'rs', zig: 'rs', nim: 'rs', odin: 'rs',
    go: 'go',
    css: 'css', scss: 'css', less: 'css', sass: 'css', styl: 'css',
    html: 'html', htm: 'html', xhtml: 'html', xml: 'html', xsl: 'html', svg: 'html',
    sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh', ps1: 'sh', bat: 'sh', cmd: 'sh',
    makefile: 'sh', dockerfile: 'sh', env: 'sh', gitignore: 'sh',
    sql: 'sql', graphql: 'sql', gql: 'sql',
    tf: 'js', hcl: 'js', nix: 'js', toml: 'sh', ini: 'sh', cfg: 'sh', conf: 'sh',
    yaml: 'py', yml: 'py',  // yaml comments use #
    lua: 'py', php: 'js', perl: 'py', pl: 'py',
    proto: 'js',
  };

  // ── Syntax highlighter ────────────────────────────────
  function highlightCode(text, ext) {
    const syntaxKey = EXT_TO_SYNTAX[ext];
    const syntax = syntaxKey ? SYNTAX[syntaxKey] : null;
    if (!syntax) return shell.esc(text);

    // Tokenize: extract comments, strings, then highlight keywords/numbers in the rest
    const tokens = [];
    let escaped = shell.esc(text);

    // We'll do a simple pass: first escape HTML, then wrap known patterns.
    // Since the text is already escaped, we need to work with the escaped version carefully.
    // Simpler approach: work on raw text, build spans, then escape non-span parts.

    // Actually let's use a segment-based approach on the raw text
    const segments = [];
    let lastIdx = 0;

    // Collect all spans: comments, strings, then sort by position
    const spans = [];

    if (syntax.comments) {
      const re = new RegExp(syntax.comments.source, syntax.comments.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        spans.push({ start: m.index, end: m.index + m[0].length, cls: 'syn-comment', text: m[0] });
      }
    }
    if (syntax.strings) {
      const re = new RegExp(syntax.strings.source, syntax.strings.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        spans.push({ start: m.index, end: m.index + m[0].length, cls: 'syn-string', text: m[0] });
      }
    }

    // Sort by start, remove overlaps (comments/strings take priority)
    spans.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const s of spans) {
      if (merged.length === 0 || s.start >= merged[merged.length - 1].end) {
        merged.push(s);
      }
    }

    // Build output with gaps for keywords/numbers
    let result = '';
    let pos = 0;
    for (const span of merged) {
      if (span.start > pos) {
        result += highlightPlain(text.slice(pos, span.start), syntax);
      }
      result += `<span class="${span.cls}">${shell.esc(span.text)}</span>`;
      pos = span.end;
    }
    if (pos < text.length) {
      result += highlightPlain(text.slice(pos), syntax);
    }

    return result;
  }

  function highlightPlain(text, syntax) {
    let escaped = shell.esc(text);
    // Keywords
    if (syntax.keywords) {
      const re = new RegExp(syntax.keywords.source, syntax.keywords.flags);
      escaped = escaped.replace(re, '<span class="syn-keyword">$&</span>');
    }
    // Numbers
    if (syntax.numbers) {
      const re = new RegExp(syntax.numbers.source, syntax.numbers.flags);
      escaped = escaped.replace(re, '<span class="syn-number">$&</span>');
    }
    // HTML tags
    if (syntax.tags) {
      const re = new RegExp(syntax.tags.source, syntax.tags.flags);
      escaped = escaped.replace(re, '<span class="syn-tag">$&</span>');
    }
    return escaped;
  }

  // ── Markdown renderer ─────────────────────────────────
  function renderMarkdown(text) {
    // Process in blocks to handle code blocks properly
    const blocks = [];
    let current = '';
    const lines = text.split('\n');
    let inCode = false;
    let codeLang = '';
    let codeContent = '';

    for (const line of lines) {
      if (!inCode && line.startsWith('```')) {
        if (current.trim()) blocks.push({ type: 'text', content: current });
        current = '';
        inCode = true;
        codeLang = line.slice(3).trim();
        codeContent = '';
      } else if (inCode && line.startsWith('```')) {
        blocks.push({ type: 'code', lang: codeLang, content: codeContent });
        inCode = false;
        codeLang = '';
        codeContent = '';
      } else if (inCode) {
        codeContent += (codeContent ? '\n' : '') + line;
      } else {
        current += line + '\n';
      }
    }
    if (inCode) {
      // Unclosed code block
      blocks.push({ type: 'code', lang: codeLang, content: codeContent });
    }
    if (current.trim()) blocks.push({ type: 'text', content: current });

    let html = '';
    for (const block of blocks) {
      if (block.type === 'code') {
        const highlighted = block.lang ? highlightCode(block.content, block.lang) : shell.esc(block.content);
        html += `<pre class="md-codeblock"><code>${highlighted}</code></pre>`;
      } else {
        html += renderMarkdownInline(block.content);
      }
    }
    return html;
  }

  function renderMarkdownInline(text) {
    let html = shell.esc(text);

    // Headings (must be at start of line in escaped text)
    html = html.replace(/^#{4,6}\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Horizontal rules
    html = html.replace(/^(---|\*\*\*|___)$/gm, '<hr>');

    // Images (before links)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px;margin:8px 0">');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Bold + italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Blockquotes (escaped > is &gt;)
    html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
    // Merge adjacent blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // Task lists
    html = html.replace(/^- \[x\]\s+(.+)$/gm, '<li class="task done">&#9745; $1</li>');
    html = html.replace(/^- \[ \]\s+(.+)$/gm, '<li class="task">&#9744; $1</li>');

    // Unordered lists
    html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Ordered lists
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Tables
    html = html.replace(/^(\|.+\|)\n(\|[-|:\s]+\|)\n((?:\|.+\|\n?)+)/gm, (_, header, sep, body) => {
      const ths = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map(row => {
        const tds = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    });

    // Paragraphs: double newlines
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up: remove <p> wrapping around block elements
    const blockTags = ['h1','h2','h3','h4','hr','pre','ul','ol','table','blockquote'];
    for (const tag of blockTags) {
      html = html.replace(new RegExp(`<p>(<${tag}[^>]*>)`, 'g'), '$1');
      html = html.replace(new RegExp(`(</${tag}>)</p>`, 'g'), '$1');
    }
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  // ── CSV/TSV parser ────────────────────────────────────
  function renderCSV(text, separator) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return '<p>Empty file</p>';

    const sep = separator || (text.includes('\t') ? '\t' : ',');
    const rows = lines.map(line => {
      // Simple CSV parse (doesn't handle quoted commas perfectly but good enough for preview)
      const cells = [];
      let current = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && (i === 0 || line[i-1] === sep)) { inQuote = true; continue; }
        if (ch === '"' && inQuote) { inQuote = false; continue; }
        if (ch === sep && !inQuote) { cells.push(current); current = ''; continue; }
        current += ch;
      }
      cells.push(current);
      return cells;
    });

    const maxCols = Math.max(...rows.map(r => r.length));
    let html = '<div class="csv-table-wrap"><table class="csv-table">';

    // First row as header
    if (rows.length > 0) {
      html += '<thead><tr>';
      for (let i = 0; i < maxCols; i++) {
        html += `<th>${shell.esc(rows[0][i] || '')}</th>`;
      }
      html += '</tr></thead>';
    }

    html += '<tbody>';
    for (let r = 1; r < rows.length && r < 500; r++) {
      html += '<tr>';
      for (let i = 0; i < maxCols; i++) {
        html += `<td>${shell.esc(rows[r][i] || '')}</td>`;
      }
      html += '</tr>';
    }
    if (rows.length > 500) {
      html += `<tr><td colspan="${maxCols}" style="text-align:center;color:var(--subtext)">... ${rows.length - 500} more rows</td></tr>`;
    }
    html += '</tbody></table></div>';
    return html;
  }

  // ── JSON formatter ────────────────────────────────────
  function renderJSON(text) {
    try {
      const obj = JSON.parse(text);
      const pretty = JSON.stringify(obj, null, 2);
      return highlightCode(pretty, 'json');
    } catch (e) {
      // Invalid JSON, just show as text with highlighting attempt
      return highlightCode(text, 'json');
    }
  }

  // ── Utilities ─────────────────────────────────────────
  function formatSize(bytes) {
    if (bytes === 0) return '\u2014';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function getExt(filename) {
    // Handle dotfiles and special names
    const lower = filename.toLowerCase();
    if (lower === 'dockerfile' || lower === 'makefile' || lower === 'cmakelists.txt') return lower.replace('.txt', '');
    if (lower === '.gitignore' || lower === '.editorconfig' || lower === '.env') return lower.slice(1);
    const dot = lower.lastIndexOf('.');
    return dot > 0 ? lower.slice(dot + 1) : '';
  }

  function getMimeIcon(mime) {
    if (!mime) return '&#128196;';
    if (mime.startsWith('image/')) return '&#128248;';
    if (mime.startsWith('video/')) return '&#127916;';
    if (mime.startsWith('audio/')) return '&#127925;';
    if (mime.startsWith('application/pdf')) return '&#128213;';
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('compress')) return '&#128230;';
    if (mime.includes('executable') || mime.includes('binary')) return '&#9881;';
    return '&#128196;';
  }

  // ── Previewer App ─────────────────────────────────────
  class PreviewerApp {
    constructor(container, params) {
      this.container = container;
      this.filePath = params.path || null;
      this.connection = params.connection || shell.conn;
      this.fileName = params.name || (this.filePath ? this.filePath.split('/').pop() : '');
      this._watchWs = null;
      this._watchPath = null;

      this._render();
      this._connectWatcher();
      if (this.filePath) {
        this.loadFile(this.filePath, this.connection);
      }
    }

    getTitle() { return this.fileName || 'Preview'; }
    getIcon() { return '&#128065;'; }

    onParams(params) {
      if (params.path) {
        this.filePath = params.path;
        this.fileName = params.name || params.path.split('/').pop();
        this.connection = params.connection || shell.conn;
        this.loadFile(this.filePath, this.connection);
        const tab = shell.getTabByInstance(this);
        if (tab) shell.updateTabTitle(tab.id, this.fileName);
      }
    }

    _render() {
      this.container.innerHTML = `
        <div class="previewer-container">
          <div class="previewer-header">
            <span class="filename" id="pv-filename">${shell.esc(this.fileName)}</span>
            <div class="previewer-actions">
              <button class="btn secondary" id="pv-editBtn" style="font-size:11px;padding:3px 10px;">Edit</button>
            </div>
          </div>
          <div class="previewer-meta" id="pv-meta"></div>
          <div class="previewer-content" id="pv-content">
            <div class="empty"><span class="icon">&#128065;</span><p>Select a file to preview</p></div>
          </div>
        </div>`;

      this.container.querySelector('#pv-editBtn').addEventListener('click', () => {
        if (this.filePath) {
          bus.emit('file:edit', { path: this.filePath, name: this.fileName, connection: this.connection });
        }
      });
    }

    async loadFile(filePath, connection) {
      this.filePath = filePath;
      this.connection = connection || shell.conn;
      this.fileName = filePath.split('/').pop();
      this._watchFile(filePath);

      const nameEl = this.container.querySelector('#pv-filename');
      const metaEl = this.container.querySelector('#pv-meta');
      const contentEl = this.container.querySelector('#pv-content');

      nameEl.textContent = this.fileName;
      metaEl.textContent = 'Loading...';
      contentEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

      const ext = getExt(this.fileName);
      const langLabel = LANG_LABELS[ext] || '';

      try {
        // Images: fetch as base64 via download endpoint
        if (IMAGE_EXTS.has(ext)) {
          await this._loadImage(filePath, ext, metaEl, contentEl, langLabel);
          return;
        }

        // SVG: fetch as text and render inline + show source
        if (ext === SVG_EXT) {
          await this._loadSVG(filePath, metaEl, contentEl);
          return;
        }

        // All other files: try to read as text
        const res = await shell.apiFetch('read', { connection: this.connection, filePath });
        if (res.error) throw new Error(res.error);

        const sizeStr = formatSize(res.size);
        const mimeStr = res.mime || '';

        if (res.truncated) {
          metaEl.innerHTML = `<span>${sizeStr}</span><span>${shell.esc(mimeStr)}</span>`;
          contentEl.innerHTML = `<div class="previewer-binary"><div class="icon">&#128196;</div><div>${shell.esc(res.message)}</div>
            <button class="btn secondary" style="margin-top:12px" onclick="bus.emit('file:edit',{path:'${shell.esc(filePath)}',name:'${shell.esc(this.fileName)}',connection:shell.conn})">Open in Editor</button></div>`;
          this._updateTab();
          return;
        }

        if (res.binary) {
          // Binary file — show metadata
          metaEl.innerHTML = `<span>${sizeStr}</span><span>${shell.esc(mimeStr)}</span>`;
          contentEl.innerHTML = `<div class="previewer-binary">
            <div class="icon">${getMimeIcon(mimeStr)}</div>
            <div style="font-weight:600">${shell.esc(this.fileName)}</div>
            <div style="margin-top:4px">${shell.esc(mimeStr)}</div>
            <div style="margin-top:4px;color:var(--subtext)">${sizeStr}</div>
          </div>`;
          this._updateTab();
          return;
        }

        // Text content — route by extension
        const metaLabel = langLabel || mimeStr;
        metaEl.innerHTML = `<span>${sizeStr}</span>${metaLabel ? `<span>${shell.esc(metaLabel)}</span>` : ''}`;

        if (ext === MARKDOWN_EXT || ext === 'mdx') {
          this._renderMarkdown(contentEl, res.content || '');
        } else if (JSON_EXTS.has(ext)) {
          this._renderCode(contentEl, res.content || '', ext, true);
        } else if (CSV_EXTS.has(ext)) {
          this._renderCSV(contentEl, res.content || '', ext);
        } else if (HTML_EXTS.has(ext)) {
          this._renderHTML(contentEl, res.content || '');
        } else {
          // All text files (code, config, log, unknown) — render as code with line numbers
          this._renderCode(contentEl, res.content || '', ext, false);
        }

        this._updateTab();
      } catch (err) {
        metaEl.textContent = '';
        contentEl.innerHTML = `<div class="previewer-binary"><div class="icon">&#9888;</div><div>${shell.esc(err.message)}</div></div>`;
      }
    }

    async _loadImage(filePath, ext, metaEl, contentEl) {
      const res = await shell.apiFetch('download', { connection: this.connection, filePath });
      if (res.error) throw new Error(res.error);

      const mimeMap = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        ico: 'image/x-icon', avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff'
      };
      const mime = mimeMap[ext] || 'image/png';

      metaEl.innerHTML = `<span>${formatSize(res.size)}</span><span>${shell.esc(LANG_LABELS[ext] || ext.toUpperCase())}</span><span>${this._imageDimLabel()}</span>`;

      contentEl.innerHTML = `
        <div class="previewer-image">
          <img id="pv-img" src="data:${mime};base64,${res.data}" alt="${shell.esc(this.fileName)}">
        </div>`;

      // Update dimensions after load
      const img = contentEl.querySelector('#pv-img');
      img.onload = () => {
        const dimSpan = metaEl.querySelector('.pv-dim');
        if (dimSpan) dimSpan.textContent = `${img.naturalWidth} \u00d7 ${img.naturalHeight}`;
      };
      this._updateTab();
    }

    _imageDimLabel() {
      return '<span class="pv-dim"></span>';
    }

    async _loadSVG(filePath, metaEl, contentEl) {
      const res = await shell.apiFetch('read', { connection: this.connection, filePath });
      if (res.error) throw new Error(res.error);

      metaEl.innerHTML = `<span>${formatSize(res.size)}</span><span>SVG</span>`;

      // Show rendered SVG + source toggle
      contentEl.innerHTML = `
        <div class="previewer-svg-wrap">
          <div class="previewer-svg-toggle">
            <button class="btn secondary pv-svg-btn active" data-mode="render">Rendered</button>
            <button class="btn secondary pv-svg-btn" data-mode="source">Source</button>
          </div>
          <div class="previewer-svg-render" id="pv-svgRender">${res.content || ''}</div>
          <div class="previewer-svg-source" id="pv-svgSource" style="display:none"></div>
        </div>`;

      // Source view
      const sourceEl = contentEl.querySelector('#pv-svgSource');
      const lines = (res.content || '').split('\n');
      const nums = lines.map((_, i) => i + 1).join('\n');
      sourceEl.innerHTML = `<div class="line-numbers"><pre class="line-nums">${nums}</pre><pre class="code">${highlightCode(res.content || '', 'svg')}</pre></div>`;

      // Toggle
      contentEl.querySelectorAll('.pv-svg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          contentEl.querySelectorAll('.pv-svg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const mode = btn.dataset.mode;
          contentEl.querySelector('#pv-svgRender').style.display = mode === 'render' ? '' : 'none';
          contentEl.querySelector('#pv-svgSource').style.display = mode === 'source' ? '' : 'none';
        });
      });
      this._updateTab();
    }

    _renderMarkdown(contentEl, text) {
      contentEl.innerHTML = `<div class="markdown-body">${renderMarkdown(text)}</div>`;
      // Resolve images — load via API and convert to data URIs
      const fileDir = this.filePath ? this.filePath.replace(/\/[^/]+$/, '') : '';
      contentEl.querySelectorAll('.markdown-body img').forEach(img => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return;
        // Resolve relative path against the markdown file's directory
        const imgPath = src.startsWith('/') ? src : fileDir + '/' + src;
        img.style.opacity = '0.3';
        img.removeAttribute('src');
        const ext = (imgPath.split('.').pop() || '').toLowerCase();
        const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', ico:'image/x-icon', avif:'image/avif', svg:'image/svg+xml', tiff:'image/tiff', tif:'image/tiff' };
        const mime = mimeMap[ext] || 'image/png';
        shell.apiFetch('download', { connection: this.connection, filePath: imgPath }).then(res => {
          if (res.error) { img.alt = `[Image not found: ${src}]`; img.style.opacity = '1'; return; }
          img.src = `data:${mime};base64,${res.data}`;
          img.style.opacity = '1';
        }).catch(() => { img.alt = `[Failed to load: ${src}]`; img.style.opacity = '1'; });
      });
    }

    _renderCode(contentEl, text, ext, isJSON) {
      const content = isJSON ? (() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; } })() : text;
      const lines = content.split('\n');
      const nums = lines.map((_, i) => i + 1).join('\n');
      const highlighted = highlightCode(content, ext);
      contentEl.innerHTML = `<div class="line-numbers"><pre class="line-nums">${nums}</pre><pre class="code">${highlighted}</pre></div>`;
    }

    _renderCSV(contentEl, text, ext) {
      const separator = ext === 'tsv' ? '\t' : null;
      contentEl.innerHTML = renderCSV(text, separator);
    }

    _renderHTML(contentEl, text) {
      // Show both rendered preview and source
      contentEl.innerHTML = `
        <div class="previewer-svg-wrap">
          <div class="previewer-svg-toggle">
            <button class="btn secondary pv-svg-btn active" data-mode="render">Preview</button>
            <button class="btn secondary pv-svg-btn" data-mode="source">Source</button>
          </div>
          <div class="previewer-html-render" id="pv-htmlRender"></div>
          <div class="previewer-svg-source" id="pv-htmlSource" style="display:none"></div>
        </div>`;

      // Sandboxed iframe for HTML preview
      const renderEl = contentEl.querySelector('#pv-htmlRender');
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      iframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff;border-radius:4px;';
      iframe.srcdoc = text;
      renderEl.appendChild(iframe);

      // Source view
      const sourceEl = contentEl.querySelector('#pv-htmlSource');
      const lines = text.split('\n');
      const nums = lines.map((_, i) => i + 1).join('\n');
      sourceEl.innerHTML = `<div class="line-numbers"><pre class="line-nums">${nums}</pre><pre class="code">${highlightCode(text, 'html')}</pre></div>`;

      // Toggle
      contentEl.querySelectorAll('.pv-svg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          contentEl.querySelectorAll('.pv-svg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const mode = btn.dataset.mode;
          renderEl.style.display = mode === 'render' ? '' : 'none';
          contentEl.querySelector('#pv-htmlSource').style.display = mode === 'source' ? '' : 'none';
        });
      });
    }

    _updateTab() {
      const tab = shell.getTabByInstance(this);
      if (tab) shell.updateTabTitle(tab.id, this.fileName);
    }

    activate() {}
    deactivate() {}
    destroy() {
      this._stopPolling();
      this._unwatchFile();
      if (this._watchWs) { try { this._watchWs.close(); } catch (e) {} }
    }

    // ── File Watcher ────────────────────────────────
    _connectWatcher() {
      const loc = window.location;
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const base = loc.pathname.replace(/\/[^/]*$/, '');
      try {
        this._watchWs = new WebSocket(`${proto}//${loc.host}${base}/ws/watch`);
      } catch (e) {
        this._startPolling();
        return;
      }
      this._watchWs.onopen = () => {
        this._stopPolling();
        if (this._watchPath) {
          this._watchWs.send(JSON.stringify({ action: 'watch', path: this._watchPath, connection: this.connection }));
        }
      };
      this._watchWs.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'change' && this._watchPath && msg.path === this._watchPath) {
            this.loadFile(this.filePath, this.connection);
          }
        } catch (err) {}
      };
      this._watchWs.onerror = () => { this._startPolling(); };
      this._watchWs.onclose = () => {
        this._startPolling();
        setTimeout(() => { if (this.filePath) this._connectWatcher(); }, 5000);
      };
    }

    _startPolling() {
      if (this._pollTimer) return;
      this._pollTimer = setInterval(() => {
        if (this.filePath && this.connection) {
          this.loadFile(this.filePath, this.connection);
        }
      }, 3000);
    }

    _stopPolling() {
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    }

    _watchFile(filePath) {
      const dir = filePath.replace(/\/[^/]+$/, '') || '/';
      if (this._watchPath === dir) return;
      this._unwatchFile();
      this._watchPath = dir;
      if (this._watchWs && this._watchWs.readyState === 1) {
        this._watchWs.send(JSON.stringify({ action: 'watch', path: dir, connection: this.connection }));
      }
    }

    _unwatchFile() {
      if (this._watchPath && this._watchWs && this._watchWs.readyState === 1) {
        this._watchWs.send(JSON.stringify({ action: 'unwatch', path: this._watchPath, connection: this.connection }));
      }
      this._watchPath = null;
    }
  }

  shell.registerApp('previewer', {
    label: 'Previewer',
    icon: '&#128065;',
    factory: (container, params) => new PreviewerApp(container, params),
    singleton: false
  });
})();
