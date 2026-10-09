/* Native Graph renderer adapter. Obsidian does not publish a graph-rendering API.
 * Only this module may depend on undocumented renderer properties.
 * Each binding retains/restores its own renderer methods.
 */
'use strict';

function rendererFromLeaf(leaf) {
  const type = leaf?.view?.getViewType?.();
  if (!['graph', 'localgraph'].includes(type)) return null;
  const view = leaf.view;
  const candidates = [view.renderer, view.graph?.renderer, view.graphRenderer,
    view.visualization?.renderer, view.renderer?.renderer];
  for (const r of candidates) {
    if (r && r.containerEl?.nodeType===1 && Array.isArray(r.links) &&
        r.nodeLookup && typeof r.nodeLookup === 'object' &&
        typeof r.scale === 'number' && typeof r.panX === 'number' &&
        typeof r.panY === 'number' && typeof r.onNodeClick === 'function' &&
        typeof r.changed === 'function') return r;
  }
  return null;
}

class NativeGraphAdapter {
  constructor(renderer) {
    this.renderer = renderer;
    this.originalClick = renderer.onNodeClick;
    this.originalGetHighlight = renderer.getHighlightNode;
    this.installed = false;
    this.patchedClick = null;this.patchedGetHighlight = null;
  }
  mount(onNodeClicked, currentLock) {
    if (this.installed) return;
    const r = this.renderer;
    const original = this.originalClick;
    this.patchedClick = function(event, id, type) {
      if (onNodeClicked(event, id, type)) return;
      return original.call(r, event, id, type);
    };
    r.onNodeClick = this.patchedClick;
    const getOld = this.originalGetHighlight;
    this.patchedGetHighlight = function() {
      const node = currentLock();
      if (node) return node;
      return typeof getOld === 'function' ? getOld.call(r) : (r.highlightNode || null);
    };
    r.getHighlightNode = this.patchedGetHighlight;
    this.installed = true;
  }
  unmount() {
    if (!this.installed) return;
    const r = this.renderer;
    if (r.onNodeClick === this.patchedClick) r.onNodeClick = this.originalClick;
    if (r.getHighlightNode === this.patchedGetHighlight) {
      if (this.originalGetHighlight === undefined) delete r.getHighlightNode;
      else r.getHighlightNode = this.originalGetHighlight;
    }
    this.installed = false;
    this.repaint();
  }
  getNativeHoveredNode() { return this.renderer.highlightNode || null; }
  getNode(id) { return this.renderer.nodeLookup?.[id] || null; }
  getLinks() { return this.renderer.links || []; }
  getContainer() { return this.renderer.containerEl; }
  repaint() { try { this.renderer.changed(); } catch (_) {} }
  screenPosition(node) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
    const r = this.renderer;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    return { x: (node.x * r.scale + r.panX) / dpr,
      y: (node.y * r.scale + r.panY) / dpr };
  }
  getNodeRadius(node) {
    const r = this.renderer;
    return Math.max(5, Math.min(30,
      (Math.sqrt(Math.max(1, node?.weight || 1)) * Math.max(1, r.nodeScale || 1)
        * Math.max(0.1, r.scale)) / Math.max(1, window.devicePixelRatio || 1)));
  }
  isNearNode(x, y, radiusExtra = 9) {
    for (const node of Object.values(this.renderer.nodeLookup || {})) {
      const p = this.screenPosition(node);
      if (!p) continue;
      if (Math.hypot(p.x-x, p.y-y) <= this.getNodeRadius(node)+radiusExtra) return true;
    }
    return false;
  }
}