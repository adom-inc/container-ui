/**
 * Tiling Layout Manager — Binary split tree with drag-to-split, resize, and tab DnD.
 *
 * Layout tree:
 *   Split = { type: 'split', direction: 'h'|'v', ratio: 0.5, first: Node, second: Node, el }
 *   Leaf  = { type: 'leaf', id, tabs: [], activeTabId, el, tabBarEl, panelEl }
 *
 * Drop zones: dragging a tab over a pane shows 5 zones (center + 4 edges).
 *   - center: add tab to that pane
 *   - edge:   split pane, put tab in the new half
 */
const tiling = (function () {

  let root = null;           // root layout node
  let containerEl = null;    // DOM container
  let paneCounter = 0;
  let activePaneId = null;
  let dragTab = null;        // { tabId, sourcePaneId }

  // ── Initialization ──────────────────────────────────
  function init(container) {
    containerEl = container;
    root = createLeaf();
    activePaneId = root.id;
    render();
  }

  // ── Node constructors ───────────────────────────────
  function createLeaf() {
    const id = 'pane-' + (++paneCounter);
    return {
      type: 'leaf',
      id,
      tabs: [],
      activeTabId: null,
    };
  }

  function createSplit(direction, first, second, ratio = 0.5) {
    return {
      type: 'split',
      direction,
      ratio,
      first,
      second,
    };
  }

  // ── Tree operations ─────────────────────────────────
  function findLeaf(id, node = root) {
    if (!node) return null;
    if (node.type === 'leaf') return node.id === id ? node : null;
    return findLeaf(id, node.first) || findLeaf(id, node.second);
  }

  function findParent(targetId, node = root, parent = null) {
    if (!node) return null;
    if (node.type === 'leaf') return node.id === targetId ? parent : null;
    if (node.type === 'split') {
      // Check if either child is the target
      if (node.first.type === 'leaf' && node.first.id === targetId) return node;
      if (node.second.type === 'leaf' && node.second.id === targetId) return node;
      return findParent(targetId, node.first, node) || findParent(targetId, node.second, node);
    }
    return null;
  }

  function getActivePane() {
    return findLeaf(activePaneId) || findFirstLeaf(root);
  }

  function findFirstLeaf(node) {
    if (!node) return null;
    if (node.type === 'leaf') return node;
    return findFirstLeaf(node.first);
  }

  function getAllLeaves(node = root) {
    if (!node) return [];
    if (node.type === 'leaf') return [node];
    return [...getAllLeaves(node.first), ...getAllLeaves(node.second)];
  }

  // ── Split a pane ────────────────────────────────────
  function splitPane(paneId, direction, tabData) {
    const leaf = findLeaf(paneId);
    if (!leaf) return null;

    const newLeaf = createLeaf();
    if (tabData) {
      newLeaf.tabs.push(tabData);
      newLeaf.activeTabId = tabData.id;
    }

    const split = createSplit(direction, leaf, newLeaf);

    // Replace in tree
    if (root === leaf) {
      // Clone leaf properties into a new object since we're replacing root
      const oldLeaf = { ...leaf };
      root = createSplit(direction, oldLeaf, newLeaf);
    } else {
      replaceInParent(leaf, split);
    }

    activePaneId = newLeaf.id;
    render();
    return newLeaf;
  }

  function replaceInParent(target, replacement) {
    function walk(node) {
      if (!node || node.type === 'leaf') return false;
      if (node.first === target) { node.first = replacement; return true; }
      if (node.second === target) { node.second = replacement; return true; }
      return walk(node.first) || walk(node.second);
    }
    walk(root);
  }

  // ── Remove a pane ──────────────────────────────────
  function removePane(paneId) {
    if (root.type === 'leaf') return; // Can't remove the only pane

    function walk(node, parent, side) {
      if (!node) return false;
      if (node.type === 'leaf' && node.id === paneId) {
        if (!parent) return false;
        // Replace parent split with the sibling
        const sibling = side === 'first' ? parent.second : parent.first;
        if (root === parent) {
          root = sibling;
        } else {
          replaceInParent(parent, sibling);
        }
        return true;
      }
      if (node.type === 'split') {
        return walk(node.first, node, 'first') || walk(node.second, node, 'second');
      }
      return false;
    }
    walk(root, null, null);

    // Update active pane
    if (activePaneId === paneId) {
      const first = findFirstLeaf(root);
      activePaneId = first ? first.id : null;
    }
    render();
  }

  // ── Tab operations ──────────────────────────────────
  function addTab(paneId, tabData) {
    const pane = findLeaf(paneId) || getActivePane();
    if (!pane) return;

    // Check if tab already exists in this pane
    const existing = pane.tabs.find(t => t.id === tabData.id);
    if (existing) {
      pane.activeTabId = tabData.id;
      activePaneId = pane.id;
      render();
      return pane;
    }

    pane.tabs.push(tabData);
    pane.activeTabId = tabData.id;
    activePaneId = pane.id;
    render();
    return pane;
  }

  function removeTab(paneId, tabId) {
    const pane = findLeaf(paneId);
    if (!pane) return;

    const idx = pane.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    // Destroy the app instance
    const tab = pane.tabs[idx];
    if (tab.instance && tab.instance.destroy) tab.instance.destroy();

    pane.tabs.splice(idx, 1);

    if (pane.activeTabId === tabId) {
      if (pane.tabs.length > 0) {
        const newIdx = Math.min(idx, pane.tabs.length - 1);
        pane.activeTabId = pane.tabs[newIdx].id;
      } else {
        pane.activeTabId = null;
      }
    }

    // If pane is empty and not the only pane, remove it
    if (pane.tabs.length === 0 && root.type === 'split') {
      removePane(pane.id);
    } else {
      render();
    }
  }

  function activateTab(paneId, tabId) {
    const pane = findLeaf(paneId);
    if (!pane) return;
    pane.activeTabId = tabId;
    activePaneId = paneId;
    render();
  }

  function moveTab(tabId, fromPaneId, toPaneId, position) {
    const fromPane = findLeaf(fromPaneId);
    const toPane = findLeaf(toPaneId);
    if (!fromPane) return;

    const tabIdx = fromPane.tabs.findIndex(t => t.id === tabId);
    if (tabIdx === -1) return;
    const tabData = fromPane.tabs[tabIdx];

    if (position === 'center' || !position) {
      // Move tab to existing pane
      if (fromPaneId === toPaneId) return;
      fromPane.tabs.splice(tabIdx, 1);

      // Update source pane active tab
      if (fromPane.activeTabId === tabId) {
        fromPane.activeTabId = fromPane.tabs.length > 0 ? fromPane.tabs[Math.min(tabIdx, fromPane.tabs.length - 1)].id : null;
      }

      if (toPane) {
        toPane.tabs.push(tabData);
        toPane.activeTabId = tabId;
        activePaneId = toPaneId;
      }

      // Clean up empty source pane
      if (fromPane.tabs.length === 0 && root.type === 'split') {
        removePane(fromPaneId);
        return; // removePane calls render
      }
    } else {
      // Split target pane and put tab in new half
      const dirMap = { left: 'h', right: 'h', top: 'v', bottom: 'v' };
      const direction = dirMap[position] || 'h';

      // Remove from source
      fromPane.tabs.splice(tabIdx, 1);
      if (fromPane.activeTabId === tabId) {
        fromPane.activeTabId = fromPane.tabs.length > 0 ? fromPane.tabs[Math.min(tabIdx, fromPane.tabs.length - 1)].id : null;
      }

      // Clean up empty source pane first
      if (fromPane.tabs.length === 0 && fromPaneId !== toPaneId && root.type === 'split') {
        removePane(fromPaneId);
      }

      // Now split the target
      const targetPane = findLeaf(toPaneId);
      if (!targetPane) { render(); return; }

      const newLeaf = createLeaf();
      newLeaf.tabs.push(tabData);
      newLeaf.activeTabId = tabId;

      const isAfter = position === 'right' || position === 'bottom';
      const first = isAfter ? { ...targetPane } : newLeaf;
      const second = isAfter ? newLeaf : { ...targetPane };
      const split = createSplit(direction, first, second);

      if (root.type === 'leaf' && root.id === targetPane.id) {
        root = split;
      } else {
        replaceInParent(targetPane, split);
      }

      activePaneId = newLeaf.id;
    }

    render();
  }

  // Find which pane a tab is in
  function findTabPane(tabId) {
    const leaves = getAllLeaves();
    for (const leaf of leaves) {
      if (leaf.tabs.some(t => t.id === tabId)) return leaf;
    }
    return null;
  }

  function findTab(tabId) {
    const leaves = getAllLeaves();
    for (const leaf of leaves) {
      const tab = leaf.tabs.find(t => t.id === tabId);
      if (tab) return { tab, pane: leaf };
    }
    return null;
  }

  // ── Rendering ───────────────────────────────────────
  function render() {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    const el = renderNode(root);
    el.style.flex = '1';
    containerEl.appendChild(el);

    // Activate/deactivate app instances
    const leaves = getAllLeaves();
    for (const leaf of leaves) {
      for (const tab of leaf.tabs) {
        const isActive = tab.id === leaf.activeTabId;
        if (tab.containerEl) {
          tab.containerEl.classList.toggle('active', isActive);
        }
        if (isActive && tab.instance && tab.instance.activate) {
          tab.instance.activate();
        }
      }
    }
  }

  function renderNode(node) {
    if (node.type === 'leaf') return renderLeaf(node);
    return renderSplit(node);
  }

  function renderSplit(node) {
    const el = document.createElement('div');
    el.className = 'tiling-split';
    el.style.flexDirection = node.direction === 'h' ? 'row' : 'column';

    const firstEl = renderNode(node.first);
    const secondEl = renderNode(node.second);

    // Set flex based on ratio
    firstEl.style.flex = `${node.ratio} 1 0%`;
    secondEl.style.flex = `${1 - node.ratio} 1 0%`;

    // Resize divider
    const divider = document.createElement('div');
    divider.className = 'tiling-divider ' + (node.direction === 'h' ? 'vertical' : 'horizontal');
    divider.addEventListener('mousedown', e => startResize(e, node, el, firstEl, secondEl));
    divider.addEventListener('dblclick', () => { node.ratio = 0.5; render(); });

    el.appendChild(firstEl);
    el.appendChild(divider);
    el.appendChild(secondEl);

    node.el = el;
    return el;
  }

  function renderLeaf(node) {
    const el = document.createElement('div');
    el.className = 'tiling-pane' + (node.id === activePaneId ? ' active-pane' : '');
    el.dataset.paneId = node.id;

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'tab-bar';

    for (const tab of node.tabs) {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab' + (tab.id === node.activeTabId ? ' active' : '');
      tabEl.draggable = true;
      tabEl.dataset.tabId = tab.id;
      tabEl.dataset.paneId = node.id;

      tabEl.innerHTML = `
        <span class="tab-icon">${tab.icon}</span>
        <span class="tab-label">${shell.esc(tab.title)}</span>
        <span class="tab-close" title="Close">&times;</span>`;

      tabEl.addEventListener('mousedown', () => {
        activePaneId = node.id;
        node.activeTabId = tab.id;
        render();
      });

      tabEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        if (shell.showTabCtxMenu) shell.showTabCtxMenu(e, tab);
      });

      tabEl.querySelector('.tab-close').addEventListener('mousedown', e => {
        e.stopPropagation();
        removeTab(node.id, tab.id);
      });

      // Drag start
      tabEl.addEventListener('dragstart', e => {
        dragTab = { tabId: tab.id, sourcePaneId: node.id };
        e.dataTransfer.setData('text/plain', tab.id);
        e.dataTransfer.effectAllowed = 'move';
        tabEl.classList.add('dragging');
        // Show drop zones after a tick
        requestAnimationFrame(() => showDropZones());
      });

      tabEl.addEventListener('dragend', () => {
        dragTab = null;
        tabEl.classList.remove('dragging');
        hideDropZones();
      });

      // Hovering a file/tab over an inactive tab switches to it
      let hoverTimer = null;
      tabEl.addEventListener('dragover', e => {
        e.preventDefault();
        if (tab.id !== node.activeTabId && !hoverTimer) {
          hoverTimer = setTimeout(() => {
            node.activeTabId = tab.id;
            activePaneId = node.id;
            render();
          }, 400);
        }
      });
      tabEl.addEventListener('dragleave', () => {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      });
      tabEl.addEventListener('drop', () => {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      });

      tabBar.appendChild(tabEl);
    }

    // Tab bar drop (reorder within same pane or add from another)
    tabBar.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    tabBar.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragTab) return;
      hideDropZones();
      moveTab(dragTab.tabId, dragTab.sourcePaneId, node.id, 'center');
      dragTab = null;
    });

    el.appendChild(tabBar);

    // App panel area
    const panelArea = document.createElement('div');
    panelArea.className = 'app-panels';

    for (const tab of node.tabs) {
      if (!tab.containerEl) {
        tab.containerEl = document.createElement('div');
        tab.containerEl.className = 'app-panel';
        tab.containerEl.id = tab.id;
        // Create app instance if not yet created
        if (!tab.instance && tab.factory) {
          tab.instance = tab.factory(tab.containerEl, tab.params || {});
        }
      }
      tab.containerEl.classList.toggle('active', tab.id === node.activeTabId);
      panelArea.appendChild(tab.containerEl);
    }

    // If no tabs, show empty state
    if (node.tabs.length === 0) {
      panelArea.innerHTML = '<div class="empty"><span class="icon">&#128194;</span><p>Drag a tab here or open an app</p></div>';
    }

    el.appendChild(panelArea);

    // Drop zone overlay (hidden by default, shown during drag)
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'tiling-drop-overlay';
    dropOverlay.dataset.paneId = node.id;
    dropOverlay.innerHTML = `
      <div class="drop-zone drop-center" data-zone="center"></div>
      <div class="drop-zone drop-left" data-zone="left"></div>
      <div class="drop-zone drop-right" data-zone="right"></div>
      <div class="drop-zone drop-top" data-zone="top"></div>
      <div class="drop-zone drop-bottom" data-zone="bottom"></div>`;

    dropOverlay.querySelectorAll('.drop-zone').forEach(zone => {
      zone.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drop-hover');
      });
      zone.addEventListener('dragleave', () => {
        zone.classList.remove('drop-hover');
      });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragTab) return;
        hideDropZones();
        const position = zone.dataset.zone;
        moveTab(dragTab.tabId, dragTab.sourcePaneId, node.id, position);
        dragTab = null;
      });
    });

    el.appendChild(dropOverlay);

    node.el = el;
    node.tabBarEl = tabBar;
    node.panelEl = panelArea;
    return el;
  }

  // ── Drop zones ──────────────────────────────────────
  function showDropZones() {
    document.querySelectorAll('.tiling-drop-overlay').forEach(el => {
      el.classList.add('visible');
    });
  }

  function hideDropZones() {
    document.querySelectorAll('.tiling-drop-overlay').forEach(el => {
      el.classList.remove('visible');
      el.querySelectorAll('.drop-hover').forEach(z => z.classList.remove('drop-hover'));
    });
  }

  // ── Resize ──────────────────────────────────────────
  function startResize(e, splitNode, splitEl, firstEl, secondEl) {
    e.preventDefault();
    const isH = splitNode.direction === 'h';
    const startPos = isH ? e.clientX : e.clientY;
    const startRatio = splitNode.ratio;
    const totalSize = isH ? splitEl.offsetWidth : splitEl.offsetHeight;
    const dividerSize = 6; // must match CSS

    document.body.style.cursor = isH ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    // Add resize overlay to prevent iframe interference
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;cursor:' + (isH ? 'col-resize' : 'row-resize');
    document.body.appendChild(overlay);

    function onMove(e) {
      const currentPos = isH ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      const available = totalSize - dividerSize;
      let newRatio = startRatio + delta / available;
      newRatio = Math.max(0.1, Math.min(0.9, newRatio));
      splitNode.ratio = newRatio;
      firstEl.style.flex = `${newRatio} 1 0%`;
      secondEl.style.flex = `${1 - newRatio} 1 0%`;
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      overlay.remove();
      // Trigger resize events for any terminals/editors that need to refit
      window.dispatchEvent(new Event('resize'));
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Public API ──────────────────────────────────────
  return {
    init,
    render,
    addTab,
    removeTab,
    activateTab,
    moveTab,
    splitPane,
    removePane,
    findTab,
    findTabPane,
    getActivePane,
    getAllLeaves,
    findLeaf,
    get activePaneId() { return activePaneId; },
    set activePaneId(v) { activePaneId = v; },
    get root() { return root; },
  };
})();
