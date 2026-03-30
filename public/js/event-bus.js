/**
 * EventBus — Inter-app communication within the same webview
 * and across webviews via BroadcastChannel.
 *
 * Events:
 *   file:select    { path, name, type, connection }   — file clicked in explorer
 *   file:open      { path, name, type, connection }   — file should open (previewer/editor)
 *   file:edit      { path, name, connection }          — open file in editor
 *   file:preview   { path, name, connection }          — open file in previewer
 *   dir:change     { path, connection }                — directory navigated
 *   conn:change    { connection }                      — active connection changed
 *   conn:status    { connection, status }              — connection status update
 *   app:open       { appId, params }                   — request to open an app
 *   app:split      { appId, params }                   — request to split app to new webview
 *   term:cd        { path, connection }                — terminal should cd to path
 */
class EventBus {
  constructor() {
    this._listeners = {};
    this._channel = null;
    try {
      this._channel = new BroadcastChannel('container-ui');
      this._channel.onmessage = (e) => {
        if (e.data && e.data._event) {
          this._dispatch(e.data._event, e.data._payload, true);
        }
      };
    } catch (err) {
      // BroadcastChannel not available — cross-tab sync disabled
    }
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const list = this._listeners[event];
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit(event, payload, { broadcast = false } = {}) {
    this._dispatch(event, payload, false);
    if (broadcast && this._channel) {
      this._channel.postMessage({ _event: event, _payload: payload });
    }
  }

  _dispatch(event, payload, fromRemote) {
    const list = this._listeners[event];
    if (!list) return;
    for (const cb of list) {
      try { cb(payload, { fromRemote }); } catch (err) { console.error(`EventBus [${event}]:`, err); }
    }
  }
}

// Singleton
window.bus = new EventBus();
