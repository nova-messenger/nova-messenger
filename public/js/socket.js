// socket.js - Realtime WebSocket Manager for Aether
class SocketManager {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectTimer = null;
    this.isConnected = false;
    this.isAuthenticated = false;
  }

  connect() {
    const token = window.api.getToken();
    if (!token) return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('[WS] Connected to Aether server, sending auth handshake...');
        this.send({ type: 'auth', token });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[WS] Error parsing message:', err);
        }
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.isAuthenticated = false;
        console.warn('[WS] Disconnected, attempting reconnect in 3s...');
        this.emitLocal('connection:changed', { connected: false });
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Socket error');
      };
    } catch (err) {
      console.error('[WS] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      const token = window.api.getToken();
      if (token) this.connect();
    }, 3000);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isAuthenticated = false;
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[WS] Cannot send, socket not open:', data.type);
    }
  }

  handleMessage(data) {
    const type = data.type;
    if (type === 'auth:success') {
      this.isAuthenticated = true;
      console.log('[WS] Handshake successful, authenticated as:', data.user.username);
      this.emitLocal('connection:changed', { connected: true, user: data.user });
    }

    // Trigger local listeners
    this.emitLocal(type, data);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emitLocal(event, payload) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(payload);
        } catch (e) {
          console.error(`[WS] Error in listener for ${event}:`, e);
        }
      }
    }
  }
}

window.socketManager = new SocketManager();
