// api.js - REST API Client for NOVA Messenger
const API_BASE = '/api';

const api = {
  getToken() {
    return localStorage.getItem('nova_token') || localStorage.getItem('aether_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('nova_token', token);
    } else {
      localStorage.removeItem('nova_token');
      localStorage.removeItem('aether_token');
    }
  },

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 && !endpoint.startsWith('/auth/login')) {
          this.setToken(null);
          window.dispatchEvent(new CustomEvent('auth:expired'));
        }
        throw new Error(data.error || data.message || `Errore di rete (${res.status})`);
      }
      return data;
    } catch (err) {
      console.error(`API Error on [${endpoint}]:`, err.message);
      throw err;
    }
  },

  // Auth Endpoints
  register(email, password, username, fullName) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, fullName })
    });
  },

  verify(email, code) {
    return this.request('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code })
    });
  },

  resendCode(email) {
    return this.request('/auth/resend-code', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  },

  login(login, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    });
  },

  getMe() {
    return this.request('/auth/me');
  },

  logout() {
    return this.request('/auth/logout', { method: 'POST' })
      .finally(() => this.setToken(null));
  },

  // Users & Search
  searchUsers(query) {
    return this.request(`/users/search?q=${encodeURIComponent(query)}`);
  },

  updateProfile(data) {
    return this.request('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // Conversations & Management
  getConversations() {
    return this.request('/conversations');
  },

  createConversation(data) {
    return this.request('/conversations', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  deleteConversation(conversationId) {
    return this.request(`/conversations/${conversationId}`, {
      method: 'DELETE'
    });
  },

  getMessages(conversationId) {
    return this.request(`/conversations/${conversationId}/messages`);
  },

  sendMessage(conversationId, data) {
    return this.request(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // 360° Message Actions: Edit, Pin, Star, Translate, Forward, Delete
  editMessage(messageId, content) {
    return this.request(`/messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    });
  },

  pinMessage(messageId) {
    return this.request(`/messages/${messageId}/pin`, {
      method: 'POST'
    });
  },

  starMessage(messageId) {
    return this.request(`/messages/${messageId}/star`, {
      method: 'POST'
    });
  },

  translateMessage(messageId) {
    return this.request(`/messages/${messageId}/translate`, {
      method: 'POST'
    });
  },

  forwardMessage(messageId, targetConversationIds) {
    return this.request('/messages/forward', {
      method: 'POST',
      body: JSON.stringify({ messageId, targetConversationIds })
    });
  },

  deleteMessage(messageId) {
    return this.request(`/messages/${messageId}`, {
      method: 'DELETE'
    });
  },

  toggleReaction(messageId, emoji) {
    return this.request(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji })
    });
  },

  getStarredMessages() {
    return this.request('/starred');
  },

  // To-Do List (Cose da Fare & Note)
  getTodos() {
    return this.request('/todos');
  },

  createTodo(title, priority = 'normal') {
    return this.request('/todos', {
      method: 'POST',
      body: JSON.stringify({ title, priority })
    });
  },

  updateTodo(todoId, data) {
    return this.request(`/todos/${todoId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  deleteTodo(todoId) {
    return this.request(`/todos/${todoId}`, {
      method: 'DELETE'
    });
  },

  // Linked Devices (Dispositivi Collegati)
  getLinkedDevices() {
    return this.request('/devices');
  },

  disconnectDevice(deviceId) {
    return this.request(`/devices/${deviceId}`, {
      method: 'DELETE'
    });
  },

  // Communities
  getCommunities() {
    return this.request('/communities');
  },

  createCommunity(name, description = '', iconUrl = '') {
    return this.request('/communities', {
      method: 'POST',
      body: JSON.stringify({ name, description, iconUrl })
    });
  },

  // Stories (24h Status)
  getStories() {
    return this.request('/stories');
  },

  createStory(data) {
    return this.request('/stories', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Media Upload
  uploadMedia(dataUri, filename, fileType) {
    return this.request('/upload', {
      method: 'POST',
      body: JSON.stringify({ data: dataUri, filename, fileType })
    });
  },

  // Calls
  getCallsHistory() {
    return this.request('/calls/history');
  },

  // Dev OTP convenience
  getLatestDevOtp() {
    return this.request('/dev/latest-otp');
  }
};

window.api = api;
