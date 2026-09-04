// app.js - Main Application Controller for NOVA Messenger 360°
class AppController {
  constructor() {
    this.currentUser = null;
    this.activeConversationId = null;
    this.conversations = [];
    this.activeMessages = [];
    this.currentTab = 'chats';
    this.currentChatFilter = 'all';
    this.typingTimeout = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recordTimer = null;
    this.recordSeconds = 0;
    this.replyingToMessage = null;
    this.contextMsg = null;
    this.theme = localStorage.getItem('nova_theme') || 'dark';

    this.init();
  }

  async init() {
    this.applyTheme(this.theme);
    this.bindEvents();
    this.setupSocketHandlers();

    // Check existing auth token
    const token = window.api.getToken();
    if (token) {
      try {
        const res = await window.api.getMe();
        this.onAuthenticated(res.user);
      } catch (err) {
        console.warn('Sessione scaduta o non valida.');
        this.showAuthScreen();
      }
    } else {
      this.showAuthScreen();
    }
  }

  // -------------------------------------------------------------
  // Theme Switching (Giorno ☀️ / Notte 🌙)
  // -------------------------------------------------------------
  applyTheme(theme) {
    this.theme = theme;
    localStorage.setItem('nova_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);

    const label = document.getElementById('current-theme-label');
    const hubBtn = document.getElementById('btn-toggle-theme-hub');
    if (label) label.textContent = theme === 'dark' ? 'Modalità Notte 🌙' : 'Modalità Giorno ☀️';
    if (hubBtn) hubBtn.textContent = theme === 'dark' ? 'Passa a Giorno ☀️' : 'Passa a Notte 🌙';
  }

  toggleTheme() {
    const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
    this.applyTheme(nextTheme);
  }

  // -------------------------------------------------------------
  // Navigation Tabs Switching
  // -------------------------------------------------------------
  switchTab(tabId) {
    this.currentTab = tabId;

    // Update rail buttons
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Toggle sidebar views
    document.getElementById('view-chats').classList.toggle('hidden', tabId !== 'chats');
    document.getElementById('view-updates').classList.toggle('hidden', tabId !== 'updates');
    document.getElementById('view-communities').classList.toggle('hidden', tabId !== 'communities');
    document.getElementById('view-calls').classList.toggle('hidden', tabId !== 'calls');
    document.getElementById('view-you').classList.toggle('hidden', tabId !== 'you');

    // Load tab-specific data
    if (tabId === 'chats') {
      this.loadConversations();
    } else if (tabId === 'updates') {
      window.storyManager.loadStories();
    } else if (tabId === 'communities') {
      this.loadCommunities();
    } else if (tabId === 'calls') {
      this.loadCallsHistory();
    } else if (tabId === 'you') {
      this.loadYouTab();
    }
  }

  // -------------------------------------------------------------
  // Auth Flows
  // -------------------------------------------------------------
  showAuthScreen(view = 'login') {
    document.getElementById('app-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    this.toggleAuthView(view);
  }

  toggleAuthView(view) {
    document.getElementById('auth-login-view').classList.toggle('hidden', view !== 'login');
    document.getElementById('auth-register-view').classList.toggle('hidden', view !== 'register');
    document.getElementById('auth-verify-view').classList.toggle('hidden', view !== 'verify');
  }

  onAuthenticated(user) {
    this.currentUser = user;
    window.currentUser = user;

    // Update UI headers & "Tu" profile card
    const avatar = user.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(user.fullName);
    document.getElementById('hub-my-avatar').src = avatar;
    document.getElementById('hub-my-fullname').textContent = user.fullName;
    document.getElementById('hub-my-username').textContent = '@' + user.username;
    document.getElementById('hub-my-bio').textContent = user.bio || 'Disponibile su NOVA.';

    // Show App Screen
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');

    // Connect WebSocket
    window.socketManager.connect();

    // Init NotificationManager and show permission banner if needed
    if (window.notificationManager) {
      window.notificationManager.init();
      const perm = Notification?.permission;
      if (perm && perm !== 'granted' && perm !== 'denied') {
        setTimeout(() => {
          document.getElementById('notify-permission-banner')?.classList.remove('hidden');
        }, 3000); // ask after 3s — not right at login
      }
    }

    // Default to Chats
    this.switchTab('chats');
  }

  // -------------------------------------------------------------
  // Conversations & Messaging
  // -------------------------------------------------------------
  async loadConversations() {
    try {
      const data = await window.api.getConversations();
      this.conversations = data.conversations || [];
      this.renderConversationList();
    } catch (err) {
      console.error('Error loading conversations:', err);
    }
  }

  renderConversationList(filterQuery = '') {
    const listEl = document.getElementById('conversations-list');
    listEl.innerHTML = '';

    const filtered = this.conversations.filter(c => {
      // Tab filter
      if (this.currentChatFilter === 'groups' && !c.isGroup) return false;
      if (this.currentChatFilter === 'unread') {
        // Mock / condition for unread
      }

      // Search query filter
      if (!filterQuery) return true;
      const q = filterQuery.toLowerCase();
      return (c.name && c.name.toLowerCase().includes(q)) ||
             (c.otherUser && c.otherUser.username.toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-dim);">
          <div style="font-size: 40px; margin-bottom: 12px;">💬</div>
          <p>${filterQuery ? 'Nessuna chat trovata' : 'Nessuna conversazione ancora'}</p>
          <span style="font-size: 12px;">Cerca un contatto con @username per iniziare!</span>
        </div>
      `;
      return;
    }

    filtered.forEach(conv => {
      const item = document.createElement('div');
      item.className = `conversation-item ${conv.id === this.activeConversationId ? 'active' : ''}`;
      item.dataset.id = conv.id;

      const isOnline = conv.otherUser ? conv.otherUser.isOnline : false;
      const timeStr = conv.lastMessage ? this.formatMessageTime(conv.lastMessage.createdAt) : '';
      let snippet = 'Nessun messaggio';
      if (conv.lastMessage) {
        if (conv.lastMessage.mediaType === 'audio') snippet = '🎤 Nota vocale';
        else if (conv.lastMessage.mediaType === 'image') snippet = '📷 Foto';
        else if (conv.lastMessage.mediaType === 'meme') snippet = '🎭 Meme';
        else snippet = conv.lastMessage.content;
      }

      item.innerHTML = `
        <div class="conv-avatar-wrap">
          <img src="${conv.iconUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(conv.name)}" alt="${conv.name}">
          ${!conv.isGroup ? `<span class="status-indicator ${isOnline ? 'online' : 'offline'}"></span>` : ''}
        </div>
        <div class="conv-details">
          <div class="conv-top-row">
            <span class="conv-name">${this.escapeHtml(conv.name)}</span>
            <span class="conv-time">${timeStr}</span>
          </div>
          <div class="conv-bottom-row">
            <span class="conv-snippet" id="snippet-${conv.id}">${this.escapeHtml(snippet)}</span>
            <span class="conv-typing hidden" id="typing-${conv.id}">sta scrivendo...</span>
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        this.selectConversation(conv.id);
      });

      listEl.appendChild(item);
    });
  }

  async selectConversation(convId) {
    this.activeConversationId = convId;
    this.replyingToMessage = null;
    this.cancelReply();

    document.querySelectorAll('.conversation-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === convId);
    });

    document.getElementById('chat-empty-state').classList.add('hidden');
    document.getElementById('chat-active-state').classList.remove('hidden');

    const conv = this.conversations.find(c => c.id === convId);
    if (conv) {
      document.getElementById('chat-header-name').textContent = conv.name;
      document.getElementById('chat-header-avatar').src = conv.iconUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(conv.name);

      const statusEl = document.getElementById('chat-header-status');
      if (conv.isGroup) {
        statusEl.textContent = `${conv.memberCount} partecipanti`;
      } else if (conv.otherUser) {
        statusEl.textContent = conv.otherUser.isOnline ? 'Online' : 'Ultimo accesso recente';
        statusEl.className = `chat-status-text ${conv.otherUser.isOnline ? 'text-online' : ''}`;
      }
    }

    await this.loadMessages(convId);
    document.getElementById('app-main').classList.add('mobile-chat-open');
  }

  async loadMessages(convId) {
    try {
      const data = await window.api.getMessages(convId);
      this.activeMessages = data.messages || [];
      this.renderMessages();
      this.checkPinnedMessages();
      this.scrollToBottom();
    } catch (err) {
      console.error('Error loading messages:', err);
    }
  }

  checkPinnedMessages() {
    const banner = document.getElementById('chat-pinned-banner');
    const pinned = this.activeMessages.filter(m => m.isPinned && !m.isDeleted);
    if (pinned.length > 0) {
      const latestPinned = pinned[pinned.length - 1];
      document.getElementById('pinned-banner-text').textContent = latestPinned.content || `[${latestPinned.mediaType}]`;
      banner.classList.remove('hidden');
      banner.onclick = () => this.scrollToMessage(latestPinned.id);
    } else {
      banner.classList.add('hidden');
    }
  }

  renderMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    if (this.activeMessages.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; margin: auto; color: var(--text-muted);">
          <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: #fbbf24; padding: 8px 16px; border-radius: 8px; font-size: 12px; margin-bottom: 12px; display: inline-block;">
            🔒 I messaggi e le chiamate sono protetti con crittografia end-to-end simulata.
          </div>
          <p>Nessun messaggio. Invia un saluto per iniziare!</p>
        </div>
      `;
      return;
    }

    let lastDate = null;

    this.activeMessages.forEach(msg => {
      const msgDate = new Date(msg.createdAt).toLocaleDateString();
      if (msgDate !== lastDate) {
        const dateDivider = document.createElement('div');
        dateDivider.className = 'date-divider';
        dateDivider.innerHTML = `<span>${this.formatDateDivider(msg.createdAt)}</span>`;
        container.appendChild(dateDivider);
        lastDate = msgDate;
      }

      const isMe = msg.senderId === this.currentUser.id;
      const bubble = document.createElement('div');
      bubble.className = `message-bubble-wrapper ${isMe ? 'outgoing' : 'incoming'}`;
      bubble.dataset.id = msg.id;

      const currentConv = this.conversations.find(c => c.id === this.activeConversationId);
      const isGroup = currentConv && currentConv.isGroup;

      let contentHtml = '';
      if (msg.isDeleted) {
        contentHtml = `<span style="font-style: italic; opacity: 0.7;">🚫 ${this.escapeHtml(msg.content)}</span>`;
      } else {
        if (msg.replyToId) {
          const replied = this.activeMessages.find(m => m.id === msg.replyToId);
          if (replied) {
            contentHtml += `
              <div class="message-reply-quote" style="background: rgba(0,0,0,0.15); border-left: 3px solid #0284c7; padding: 4px 8px; border-radius: 4px; margin-bottom: 6px; font-size: 12px; cursor: pointer;" onclick="window.app.scrollToMessage('${replied.id}')">
                <span style="font-weight:700; color:#0284c7; display:block;">${this.escapeHtml(replied.senderName)}</span>
                <span style="opacity:0.8; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHtml(replied.content || `[${replied.mediaType}]`)}</span>
              </div>
            `;
          }
        }

        if (msg.mediaType === 'image' || msg.mediaType === 'meme') {
          contentHtml += `
            <div style="margin-bottom:6px; border-radius:8px; overflow:hidden; max-width:320px;">
              <img src="${msg.mediaUrl}" alt="Media" onclick="window.app.openLightbox('${msg.mediaUrl}')" style="width:100%; height:auto; display:block; cursor:pointer;">
            </div>
          `;
        } else if (msg.mediaType === 'audio') {
          contentHtml += `
            <div style="display:flex; align-items:center; gap:12px; padding:4px 0; min-width:220px;">
              <button class="voice-play-btn" onclick="window.app.toggleAudioPlay('${msg.id}', '${msg.mediaUrl}')" style="width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center;">▶</button>
              <div style="flex:1; height:20px; background:repeating-linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.3) 3px, transparent 3px, transparent 6px); border-radius:4px;"></div>
              <audio id="audio-${msg.id}" src="${msg.mediaUrl}"></audio>
            </div>
          `;
        }

        if (msg.content) {
          contentHtml += `<div class="message-text" id="text-${msg.id}">${this.formatMessageText(msg.content)}</div>`;
        }

        if (msg.translatedText) {
          contentHtml += `<div style="font-size:13.5px; color:#38bdf8; margin-top:4px; border-top:1px dashed rgba(255,255,255,0.2); padding-top:4px;">${this.escapeHtml(msg.translatedText)}</div>`;
        }
      }

      // Reactions list
      let reactionsHtml = '';
      if (msg.reactions && msg.reactions.length > 0) {
        const emojiCounts = {};
        msg.reactions.forEach(r => {
          emojiCounts[r.emoji] = (emojiCounts[r.emoji] || 0) + 1;
        });
        reactionsHtml = `<div class="message-reactions-badge">`;
        for (const [emoji, count] of Object.entries(emojiCounts)) {
          reactionsHtml += `<span class="reaction-pill" onclick="window.app.toggleReaction('${msg.id}', '${emoji}')">${emoji} ${count > 1 ? count : ''}</span>`;
        }
        reactionsHtml += `</div>`;
      }

      bubble.innerHTML = `
        <div class="message-bubble">
          ${isGroup && !isMe ? `<div class="sender-name">~ ${this.escapeHtml(msg.senderName)}</div>` : ''}
          ${contentHtml}
          <div class="message-meta">
            ${msg.isPinned ? `<span class="message-pin-icon" title="Messaggio fissato">📌</span>` : ''}
            ${msg.isStarred ? `<span class="message-star-icon" title="Messaggio importante">⭐</span>` : ''}
            ${msg.isEdited ? `<span class="message-edited-tag">(modificato)</span>` : ''}
            <span class="message-time">${this.formatTimeOnly(msg.createdAt)}</span>
            ${isMe ? `<span class="message-ticks">✓✓</span>` : ''}
          </div>
          ${reactionsHtml}
          <div class="message-actions-trigger" onclick="window.app.showMessageActions(event, '${msg.id}')">⋮</div>
        </div>
      `;

      container.appendChild(bubble);
    });
  }

  scrollToBottom() {
    const container = document.getElementById('messages-container');
    if (container) container.scrollTop = container.scrollHeight;
  }

  scrollToMessage(msgId) {
    const el = document.querySelector(`.message-bubble-wrapper[data-id="${msgId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.5s';
      el.style.background = 'rgba(16, 185, 129, 0.2)';
      setTimeout(() => { el.style.background = ''; }, 1500);
    }
  }

  // -------------------------------------------------------------
  // Send Messages
  // -------------------------------------------------------------
  async handleSendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text && !this.replyingToMessage) return;

    input.value = '';
    this.adjustInputHeight(input);

    const replyId = this.replyingToMessage ? this.replyingToMessage.id : null;
    this.cancelReply();

    try {
      if (window.notificationManager) window.notificationManager.notifySent();
      else window.soundEngine.playSent();

      await window.api.sendMessage(this.activeConversationId, {
        content: text,
        mediaType: 'text',
        replyToId: replyId
      });
    } catch (err) {
      alert('Impossibile inviare: ' + err.message);
    }
  }

  async sendMediaMessage(mediaType, dataUri, textContent = '') {
    if (!this.activeConversationId) return;

    try {
      const uploadRes = await window.api.uploadMedia(dataUri, `file_${Date.now()}`, mediaType);
      if (window.notificationManager) window.notificationManager.notifySent();
      else window.soundEngine.playSent();

      await window.api.sendMessage(this.activeConversationId, {
        content: textContent,
        mediaType,
        mediaUrl: uploadRes.url,
        replyToId: this.replyingToMessage ? this.replyingToMessage.id : null
      });

      this.cancelReply();
    } catch (err) {
      alert('Errore upload: ' + err.message);
    }
  }

  // -------------------------------------------------------------
  // 360° Message Actions: Edit, Pin, Star, Translate, Forward, Delete
  // -------------------------------------------------------------
  showMessageActions(event, msgId) {
    event.stopPropagation();
    const msg = this.activeMessages.find(m => m.id === msgId);
    if (!msg) return;

    this.contextMsg = msg;
    const isMe = msg.senderId === this.currentUser.id;

    const modal = document.getElementById('message-context-modal');
    document.getElementById('ctx-edit-option').classList.toggle('hidden', !isMe || msg.isDeleted);
    document.getElementById('ctx-delete-option').classList.toggle('hidden', !isMe);

    // Update Star / Pin label
    document.getElementById('ctx-star-option').textContent = msg.isStarred ? '⭐ Rimuovi Stella' : '⭐ Importante (Stella)';
    document.getElementById('ctx-pin-option').textContent = msg.isPinned ? '📌 Rimuovi Pin' : '📌 Fissa in alto';

    const x = Math.min(event.clientX, window.innerWidth - 220);
    const y = Math.min(event.clientY, window.innerHeight - 300);
    modal.style.left = `${x}px`;
    modal.style.top = `${y}px`;
    modal.classList.remove('hidden');
  }

  async handleEditMessage() {
    if (!this.contextMsg) return;
    const currentText = this.contextMsg.content;
    const newText = prompt('Modifica il tuo messaggio:', currentText);
    if (newText === null || newText.trim() === '' || newText === currentText) return;

    try {
      await window.api.editMessage(this.contextMsg.id, newText.trim());
      this.contextMsg.content = newText.trim();
      this.contextMsg.isEdited = true;
      this.renderMessages();
    } catch (err) {
      alert('Errore modifica messaggio: ' + err.message);
    }
  }

  async handlePinMessage() {
    if (!this.contextMsg) return;
    try {
      const res = await window.api.pinMessage(this.contextMsg.id);
      this.contextMsg.isPinned = res.isPinned;
      this.renderMessages();
      this.checkPinnedMessages();
    } catch (err) {
      alert('Errore pin messaggio: ' + err.message);
    }
  }

  async handleStarMessage() {
    if (!this.contextMsg) return;
    try {
      const res = await window.api.starMessage(this.contextMsg.id);
      this.contextMsg.isStarred = res.isStarred;
      this.renderMessages();
      if (this.currentTab === 'you') this.loadStarredMessages();
    } catch (err) {
      alert('Errore stella: ' + err.message);
    }
  }

  async handleTranslateMessage() {
    if (!this.contextMsg) return;
    try {
      const res = await window.api.translateMessage(this.contextMsg.id);
      this.contextMsg.translatedText = res.translated;
      this.renderMessages();
    } catch (err) {
      alert('Errore traduzione: ' + err.message);
    }
  }

  handleCopyMessage() {
    if (!this.contextMsg || !this.contextMsg.content) return;
    navigator.clipboard.writeText(this.contextMsg.content).then(() => {
      alert('Testo copiato negli appunti! 📋');
    });
  }

  handleInfoMessage() {
    if (!this.contextMsg) return;
    const modal = document.getElementById('msg-info-modal');
    document.getElementById('info-sender').textContent = this.contextMsg.senderName;
    document.getElementById('info-sent-time').textContent = new Date(this.contextMsg.createdAt).toLocaleString();
    modal.classList.remove('hidden');
  }

  handleForwardMessage() {
    if (!this.contextMsg) return;
    const modal = document.getElementById('forward-modal');
    const container = document.getElementById('forward-conversations-list');
    container.innerHTML = '';

    this.conversations.forEach(c => {
      const row = document.createElement('label');
      row.style = 'display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); cursor:pointer;';
      row.innerHTML = `
        <input type="checkbox" class="forward-target-check" value="${c.id}" style="width:18px; height:18px;">
        <img src="${c.iconUrl}" style="width:32px; height:32px; border-radius:50%;">
        <span style="font-weight:600; font-size:13.5px;">${this.escapeHtml(c.name)}</span>
      `;
      container.appendChild(row);
    });

    modal.classList.remove('hidden');
  }

  async confirmForward() {
    const selected = Array.from(document.querySelectorAll('.forward-target-check:checked')).map(cb => cb.value);
    if (selected.length === 0) {
      alert('Seleziona almeno una chat!');
      return;
    }

    try {
      await window.api.forwardMessage(this.contextMsg.id, selected);
      document.getElementById('forward-modal').classList.add('hidden');
      alert('Messaggio inoltrato con successo! ↪');
    } catch (err) {
      alert('Errore inoltro: ' + err.message);
    }
  }

  async deleteMessage(msgId) {
    if (!confirm('Vuoi davvero eliminare questo messaggio?')) return;
    try {
      await window.api.deleteMessage(msgId);
    } catch (err) {
      alert('Errore eliminazione: ' + err.message);
    }
  }

  async deleteCurrentConversation() {
    if (!confirm('Vuoi davvero eliminare questa chat? L\'azione non è reversibile.')) return;
    try {
      await window.api.deleteConversation(this.activeConversationId);
      this.activeConversationId = null;
      document.getElementById('chat-active-state').classList.add('hidden');
      document.getElementById('chat-empty-state').classList.remove('hidden');
      await this.loadConversations();
    } catch (err) {
      alert('Errore eliminazione chat: ' + err.message);
    }
  }

  // -------------------------------------------------------------
  // "TU" TAB: To-Do List, Linked Devices, Starred Messages
  // -------------------------------------------------------------
  async loadYouTab() {
    this.loadTodos();
    this.loadStarredMessages();
    this.loadLinkedDevices();
  }

  async loadTodos() {
    try {
      const res = await window.api.getTodos();
      const todos = res.todos || [];
      const container = document.getElementById('todos-container');
      const badge = document.getElementById('todo-counter-badge');

      const pending = todos.filter(t => !t.isCompleted).length;
      if (badge) badge.textContent = `${pending} da fare`;

      container.innerHTML = '';
      if (todos.length === 0) {
        container.innerHTML = '<p style="color:var(--text-dim); font-size:12.5px; padding:8px 0;">Nessuna attività. Scrivi una nota sopra!</p>';
        return;
      }

      todos.forEach(t => {
        const row = document.createElement('div');
        row.className = 'todo-item';
        row.innerHTML = `
          <div class="todo-left">
            <input type="checkbox" class="todo-check" ${t.isCompleted ? 'checked' : ''}>
            <span class="todo-title ${t.isCompleted ? 'completed' : ''}">${this.escapeHtml(t.title)}</span>
          </div>
          <button class="todo-del-btn" title="Elimina">✕</button>
        `;

        row.querySelector('.todo-check').addEventListener('change', async (e) => {
          await window.api.updateTodo(t.id, { isCompleted: e.target.checked });
          this.loadTodos();
        });

        row.querySelector('.todo-del-btn').addEventListener('click', async () => {
          await window.api.deleteTodo(t.id);
          this.loadTodos();
        });

        container.appendChild(row);
      });
    } catch (err) {
      console.error('Error loading todos:', err);
    }
  }

  async loadStarredMessages() {
    try {
      const res = await window.api.getStarredMessages();
      const starred = res.starred || [];
      const container = document.getElementById('starred-messages-container');

      if (starred.length === 0) {
        container.innerHTML = '<p style="color:var(--text-dim); font-size:12.5px;">Nessun messaggio contrassegnato con la stella.</p>';
        return;
      }

      container.innerHTML = '';
      starred.forEach(m => {
        const item = document.createElement('div');
        item.style = 'padding:8px; background:var(--bg-input); border-radius:6px; margin-bottom:6px; cursor:pointer;';
        item.innerHTML = `
          <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-dim); margin-bottom:2px;">
            <span><strong>${this.escapeHtml(m.sender_name)}</strong> in ${this.escapeHtml(m.conversation_name)}</span>
            <span>⭐</span>
          </div>
          <div style="font-size:13px; color:var(--text-main);">${this.escapeHtml(m.content || `[${m.media_type}]`)}</div>
        `;
        item.addEventListener('click', () => {
          this.switchTab('chats');
          this.selectConversation(m.conversation_id);
          setTimeout(() => this.scrollToMessage(m.id), 300);
        });
        container.appendChild(item);
      });
    } catch (err) {
      console.error(err);
    }
  }

  async loadLinkedDevices() {
    try {
      const res = await window.api.getLinkedDevices();
      const devices = res.devices || [];
      const container = document.getElementById('devices-container');
      container.innerHTML = '';

      devices.forEach(d => {
        const item = document.createElement('div');
        item.className = 'device-item';
        item.innerHTML = `
          <div class="device-info">
            <span class="device-browser">
              ${this.escapeHtml(d.browser)} (${this.escapeHtml(d.os)})
              ${d.isCurrent ? '<span class="device-current-tag">Questo dispositivo</span>' : ''}
            </span>
            <span class="device-ip">IP: ${this.escapeHtml(d.ipAddress)} • Ultimo attivo: ${new Date(d.lastActive).toLocaleTimeString()}</span>
          </div>
          ${!d.isCurrent ? `<button class="btn-disconnect">Disconnetti</button>` : ''}
        `;

        const disBtn = item.querySelector('.btn-disconnect');
        if (disBtn) {
          disBtn.addEventListener('click', async () => {
            if (confirm('Vuoi disconnettere questa sessione?')) {
              await window.api.disconnectDevice(d.id);
              this.loadLinkedDevices();
            }
          });
        }

        container.appendChild(item);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // -------------------------------------------------------------
  // Communities Tab
  // -------------------------------------------------------------
  async loadCommunities() {
    try {
      const res = await window.api.getCommunities();
      const list = res.communities || [];
      const container = document.getElementById('communities-list');
      container.innerHTML = '';

      if (list.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:40px 10px; color:var(--text-dim);">
            <div style="font-size:36px; margin-bottom:10px;">🌐</div>
            <p>Nessuna community ancora.</p>
            <span style="font-size:12px;">Crea una community per raggruppare i tuoi gruppi!</span>
          </div>
        `;
        return;
      }

      list.forEach(c => {
        const card = document.createElement('div');
        card.className = 'community-card';
        card.innerHTML = `
          <img src="${c.iconUrl}" alt="${c.name}">
          <div style="flex:1;">
            <span style="font-weight:700; font-size:14.5px; display:block;">${this.escapeHtml(c.name)}</span>
            <span style="font-size:12px; color:var(--text-muted); display:block;">${this.escapeHtml(c.description || 'Community NOVA')}</span>
            <span style="font-size:11px; color:var(--accent);">${c.memberCount} membri</span>
          </div>
        `;
        container.appendChild(card);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // -------------------------------------------------------------
  // Calls History Tab
  // -------------------------------------------------------------
  async loadCallsHistory() {
    try {
      const res = await window.api.getCallsHistory();
      const calls = res.calls || [];
      const container = document.getElementById('calls-history-list');
      container.innerHTML = '';

      if (calls.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:40px 10px; color:var(--text-dim);">
            <div style="font-size:36px; margin-bottom:10px;">📞</div>
            <p>Nessuna chiamata recente.</p>
          </div>
        `;
        return;
      }

      calls.forEach(c => {
        const isIncoming = c.receiver_id === this.currentUser.id;
        const otherName = isIncoming ? c.caller_name : c.receiver_name;
        const otherAvatar = isIncoming ? c.caller_avatar : c.receiver_avatar;

        const item = document.createElement('div');
        item.className = 'call-log-item';
        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:12px;">
            <img src="${otherAvatar || 'https://api.dicebear.com/7.x/initials/svg?seed=U'}" style="width:40px; height:40px; border-radius:50%;">
            <div>
              <span style="font-weight:700; font-size:14px; display:block;">${this.escapeHtml(otherName || 'Utente')}</span>
              <span style="font-size:11.5px; color:${c.status === 'declined' ? 'var(--danger)' : 'var(--text-dim)'};">
                ${c.call_type === 'video' ? '📹' : '📞'} ${c.status === 'declined' ? 'Chiamata persa' : 'Chiamata completata'} • ${this.formatMessageTime(c.created_at)}
              </span>
            </div>
          </div>
          <button class="icon-btn call-back-btn" title="Richiama">📞</button>
        `;

        item.querySelector('.call-back-btn').addEventListener('click', () => {
          const peerId = isIncoming ? c.caller_id : c.receiver_id;
          window.callManager.startCall(peerId, c.call_type || 'video', c.conversation_id);
        });

        container.appendChild(item);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // -------------------------------------------------------------
  // Real-Time Sockets
  // -------------------------------------------------------------
  setupSocketHandlers() {
    const sm = window.socketManager;

    sm.on('message:new', (data) => {
      const msg = data.message;
      if (msg.conversationId === this.activeConversationId) {
        this.activeMessages.push(msg);
        this.renderMessages();
        this.scrollToBottom();
      }

      if (msg.senderId !== this.currentUser.id) {
        if (window.notificationManager) {
          window.notificationManager.notifyMessage(
            msg.senderName,
            msg.content || (msg.mediaType ? `[${msg.mediaType}]` : ''),
            msg.senderAvatar,
            msg.conversationId
          );
        } else {
          window.soundEngine.playReceived();
        }
      }

      this.updateConversationSnippet(msg.conversationId, msg);
    });

    sm.on('message:edited', (data) => {
      const msg = this.activeMessages.find(m => m.id === data.messageId);
      if (msg) {
        msg.content = data.content;
        msg.isEdited = true;
        this.renderMessages();
      }
    });

    sm.on('message:pinned', (data) => {
      const msg = this.activeMessages.find(m => m.id === data.messageId);
      if (msg) {
        msg.isPinned = data.isPinned;
        this.renderMessages();
        this.checkPinnedMessages();
      }
    });

    sm.on('message:deleted', (data) => {
      const msg = this.activeMessages.find(m => m.id === data.messageId);
      if (msg) {
        msg.isDeleted = true;
        msg.content = 'Questo messaggio è stato eliminato';
        this.renderMessages();
      }
    });

    sm.on('conversation:deleted', (data) => {
      if (data.conversationId === this.activeConversationId) {
        this.activeConversationId = null;
        document.getElementById('chat-active-state').classList.add('hidden');
        document.getElementById('chat-empty-state').classList.remove('hidden');
      }
      this.loadConversations();
    });

    sm.on('typing', (data) => {
      if (data.conversationId === this.activeConversationId) {
        const headerStatus = document.getElementById('chat-header-status');
        if (data.isTyping) {
          headerStatus.textContent = `${data.username} sta scrivendo...`;
          headerStatus.classList.add('text-typing');
        } else {
          const conv = this.conversations.find(c => c.id === this.activeConversationId);
          headerStatus.textContent = conv && conv.otherUser && conv.otherUser.isOnline ? 'Online' : '';
          headerStatus.classList.remove('text-typing');
        }
      }
    });

    sm.on('presence', (data) => {
      this.conversations.forEach(c => {
        if (c.otherUser && c.otherUser.id === data.userId) c.otherUser.isOnline = data.isOnline;
      });
      this.renderConversationList();
    });

    sm.on('story:new', () => {
      window.storyManager.loadStories();
    });
  }

  updateConversationSnippet(convId, msg) {
    const conv = this.conversations.find(c => c.id === convId);
    if (conv) {
      conv.lastMessage = msg;
      conv.updatedAt = msg.createdAt;
      this.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      this.renderConversationList();
    } else {
      this.loadConversations();
    }
  }

  // -------------------------------------------------------------
  // DOM Event Bindings
  // -------------------------------------------------------------
  bindEvents() {
    // 1. Navigation Rails
    document.querySelectorAll('.nav-tab-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Theme toggles
    document.getElementById('btn-quick-theme-toggle')?.addEventListener('click', () => this.toggleTheme());
    document.getElementById('btn-toggle-theme-hub')?.addEventListener('click', () => this.toggleTheme());

    // 2. Chat filter pills (Tutte, Non letti, Preferiti, Gruppi)
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentChatFilter = pill.dataset.filter;
        this.renderConversationList();
      });
    });

    // 3. Auth Form Handlers
    document.getElementById('to-register-btn')?.addEventListener('click', () => this.toggleAuthView('register'));
    document.getElementById('to-login-btn')?.addEventListener('click', () => this.toggleAuthView('login'));
    document.getElementById('to-login-from-verify-btn')?.addEventListener('click', () => this.toggleAuthView('login'));

    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('reg-fullname').value;
      const username = document.getElementById('reg-username').value;
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;

      try {
        const res = await window.api.register(email, password, username, fullName);
        document.getElementById('verify-email-display').textContent = email;
        document.getElementById('verify-email-hidden').value = email;

        if (res.devOtp) {
          const banner = document.getElementById('dev-otp-banner');
          banner.classList.remove('hidden');
          document.getElementById('dev-otp-code').textContent = res.devOtp;
        }

        this.toggleAuthView('verify');
      } catch (err) {
        alert(err.message);
      }
    });

    document.getElementById('btn-fill-dev-otp')?.addEventListener('click', () => {
      const code = document.getElementById('dev-otp-code').textContent;
      document.getElementById('verify-code-input').value = code;
    });

    document.getElementById('verify-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('verify-email-hidden').value;
      const code = document.getElementById('verify-code-input').value;

      try {
        const res = await window.api.verify(email, code);
        window.api.setToken(res.token);
        this.onAuthenticated(res.user);
      } catch (err) {
        alert(err.message);
      }
    });

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const login = document.getElementById('login-identifier').value;
      const pass = document.getElementById('login-password').value;

      try {
        const res = await window.api.login(login, pass);
        window.api.setToken(res.token);
        this.onAuthenticated(res.user);
      } catch (err) {
        if (err.message.includes('non ancora verificato')) {
          const email = document.getElementById('login-identifier').value;
          document.getElementById('verify-email-display').textContent = email;
          document.getElementById('verify-email-hidden').value = email;
          this.toggleAuthView('verify');
        } else {
          alert(err.message);
        }
      }
    });

    // Logout
    const handleLogout = async () => {
      if (confirm('Vuoi davvero uscire da NOVA?')) {
        await window.api.logout();
        window.socketManager.disconnect();
        this.currentUser = null;
        this.showAuthScreen('login');
      }
    };
    document.getElementById('btn-logout-you')?.addEventListener('click', handleLogout);

    // 4. Search Contacts Input
    const searchInput = document.getElementById('search-contacts-input');
    let searchDebounce = null;
    searchInput?.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(searchDebounce);
      if (!query) {
        document.getElementById('global-search-results').classList.add('hidden');
        this.renderConversationList();
        return;
      }

      searchDebounce = setTimeout(async () => {
        try {
          const res = await window.api.searchUsers(query);
          this.renderGlobalSearchResults(res.users);
        } catch (err) {
          console.error('Search error:', err);
        }
      }, 250);
    });

    // 5. Message Input & Send
    const msgInput = document.getElementById('message-input');
    msgInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSendMessage();
      }
    });

    msgInput?.addEventListener('input', (e) => {
      this.adjustInputHeight(e.target);
      if (this.activeConversationId) {
        window.socketManager.send({ type: 'typing', conversationId: this.activeConversationId, isTyping: true });
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
          window.socketManager.send({ type: 'typing', conversationId: this.activeConversationId, isTyping: false });
        }, 1500);
      }
    });

    document.getElementById('btn-send-message')?.addEventListener('click', () => this.handleSendMessage());
    document.getElementById('cancel-reply-btn')?.addEventListener('click', () => this.cancelReply());

    // 6. Voice Recording
    document.getElementById('btn-voice-record')?.addEventListener('click', () => this.startVoiceRecording());
    document.getElementById('btn-voice-cancel')?.addEventListener('click', () => this.stopVoiceRecording(false));
    document.getElementById('btn-voice-send')?.addEventListener('click', () => this.stopVoiceRecording(true));

    // 7. Attachments
    const attachBtn = document.getElementById('btn-attach-menu');
    const attachPopover = document.getElementById('attachment-popover');
    attachBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      attachPopover.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
      attachPopover?.classList.add('hidden');
      document.getElementById('message-context-modal')?.classList.add('hidden');
      document.getElementById('chat-header-menu-modal')?.classList.add('hidden');
    });

    const photoInput = document.getElementById('hidden-photo-input');
    document.getElementById('btn-attach-photo')?.addEventListener('click', () => photoInput.click());
    photoInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => this.sendMediaMessage('image', reader.result);
        reader.readAsDataURL(file);
      }
      e.target.value = '';
    });

    // Meme modal
    document.getElementById('btn-attach-meme')?.addEventListener('click', () => {
      document.getElementById('meme-modal').classList.remove('hidden');
      window.memeManager.renderMeme();
    });
    document.getElementById('close-meme-modal')?.addEventListener('click', () => {
      document.getElementById('meme-modal').classList.add('hidden');
    });
    document.getElementById('meme-template-select')?.addEventListener('change', (e) => window.memeManager.setTemplate(e.target.value));
    document.getElementById('meme-top-text')?.addEventListener('input', () => {
      window.memeManager.renderMeme(document.getElementById('meme-top-text').value, document.getElementById('meme-bottom-text').value);
    });
    document.getElementById('meme-bottom-text')?.addEventListener('input', () => {
      window.memeManager.renderMeme(document.getElementById('meme-top-text').value, document.getElementById('meme-bottom-text').value);
    });
    document.getElementById('btn-send-meme-chat')?.addEventListener('click', () => {
      const dataUrl = window.memeManager.getDataUrl();
      if (dataUrl) {
        this.sendMediaMessage('meme', dataUrl);
        document.getElementById('meme-modal').classList.add('hidden');
      }
    });

    // 8. 360° Context Menu Actions
    document.getElementById('ctx-reply-option')?.addEventListener('click', () => {
      if (this.contextMsg) this.setReplyTo(this.contextMsg.id);
    });
    document.getElementById('ctx-edit-option')?.addEventListener('click', () => this.handleEditMessage());
    document.getElementById('ctx-forward-option')?.addEventListener('click', () => this.handleForwardMessage());
    document.getElementById('ctx-copy-option')?.addEventListener('click', () => this.handleCopyMessage());
    document.getElementById('ctx-star-option')?.addEventListener('click', () => this.handleStarMessage());
    document.getElementById('ctx-pin-option')?.addEventListener('click', () => this.handlePinMessage());
    document.getElementById('ctx-translate-option')?.addEventListener('click', () => this.handleTranslateMessage());
    document.getElementById('ctx-info-option')?.addEventListener('click', () => this.handleInfoMessage());
    document.getElementById('ctx-delete-option')?.addEventListener('click', () => {
      if (this.contextMsg) this.deleteMessage(this.contextMsg.id);
    });

    document.querySelectorAll('.ctx-emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.contextMsg) this.toggleReaction(this.contextMsg.id, btn.textContent);
      });
    });

    // Chat Header Menu (Delete chat, etc.)
    document.getElementById('btn-chat-menu-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('chat-header-menu-modal');
      const rect = e.target.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 8}px`;
      menu.style.right = '20px';
      menu.classList.toggle('hidden');
    });
    document.getElementById('menu-delete-conv-option')?.addEventListener('click', () => this.deleteCurrentConversation());

    // Forward Modal Confirm
    document.getElementById('btn-confirm-forward')?.addEventListener('click', () => this.confirmForward());
    document.getElementById('close-forward-modal')?.addEventListener('click', () => {
      document.getElementById('forward-modal').classList.add('hidden');
    });
    document.getElementById('close-msg-info-modal')?.addEventListener('click', () => {
      document.getElementById('msg-info-modal').classList.add('hidden');
    });

    // To-Do Form
    document.getElementById('add-todo-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('todo-input');
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      await window.api.createTodo(title);
      this.loadTodos();
    });

    // Communities
    document.getElementById('btn-open-create-comm')?.addEventListener('click', () => {
      document.getElementById('create-community-modal').classList.remove('hidden');
    });
    document.getElementById('close-community-modal')?.addEventListener('click', () => {
      document.getElementById('create-community-modal').classList.add('hidden');
    });
    document.getElementById('create-community-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('comm-name-input').value.trim();
      const desc = document.getElementById('comm-desc-input').value.trim();
      if (!name) return;
      try {
        await window.api.createCommunity(name, desc);
        document.getElementById('create-community-modal').classList.add('hidden');
        document.getElementById('comm-name-input').value = '';
        document.getElementById('comm-desc-input').value = '';
        this.loadCommunities();
        alert('Community creata con successo con il canale Annunci!');
      } catch (err) {
        alert(err.message);
      }
    });

    // Direct Chat & Group Modals
    document.getElementById('btn-new-chat')?.addEventListener('click', () => {
      document.getElementById('new-chat-modal').classList.remove('hidden');
      document.getElementById('new-chat-search-input').focus();
    });
    document.getElementById('close-new-chat-modal')?.addEventListener('click', () => {
      document.getElementById('new-chat-modal').classList.add('hidden');
    });

    const newChatSearch = document.getElementById('new-chat-search-input');
    newChatSearch?.addEventListener('input', async (e) => {
      const q = e.target.value.trim();
      const container = document.getElementById('new-chat-results');
      if (!q) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:20px;">Cerca per nome, email o @username</p>';
        return;
      }
      const res = await window.api.searchUsers(q);
      container.innerHTML = '';
      if (res.users.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:20px;">Nessun utente trovato</p>';
        return;
      }
      res.users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'user-result-row';
        row.style = 'display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);';
        row.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px;">
            <img src="${u.avatarUrl}" style="width:36px; height:36px; border-radius:50%;">
            <div>
              <span style="font-weight:700; font-size:14px; display:block;">${this.escapeHtml(u.fullName)}</span>
              <span style="font-size:12px; color:var(--text-muted);">@${this.escapeHtml(u.username)}</span>
            </div>
          </div>
          <button class="btn-primary" style="width:auto; padding:6px 12px; margin:0; font-size:12px;">Chatta</button>
        `;
        row.querySelector('button').addEventListener('click', async () => {
          const convRes = await window.api.createConversation({ isGroup: false, recipientId: u.id });
          document.getElementById('new-chat-modal').classList.add('hidden');
          await this.loadConversations();
          this.selectConversation(convRes.conversationId);
        });
        container.appendChild(row);
      });
    });

    document.getElementById('btn-new-group')?.addEventListener('click', () => {
      document.getElementById('new-group-modal').classList.remove('hidden');
    });
    document.getElementById('close-new-group-modal')?.addEventListener('click', () => {
      document.getElementById('new-group-modal').classList.add('hidden');
    });
    document.getElementById('create-group-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const groupName = document.getElementById('group-name-input').value.trim();
      if (!groupName) return;
      const convRes = await window.api.createConversation({ isGroup: true, name: groupName });
      document.getElementById('new-group-modal').classList.add('hidden');
      await this.loadConversations();
      this.selectConversation(convRes.conversationId);
    });

    // Calls
    document.getElementById('btn-header-call')?.addEventListener('click', () => {
      const conv = this.conversations.find(c => c.id === this.activeConversationId);
      if (conv && !conv.isGroup && conv.otherUser) {
        window.callManager.startCall(conv.otherUser.id, 'audio', conv.id, conv.otherUser);
      } else {
        alert('Le chiamate sono disponibili per le chat 1-a-1.');
      }
    });
    document.getElementById('btn-header-video')?.addEventListener('click', () => {
      const conv = this.conversations.find(c => c.id === this.activeConversationId);
      if (conv && !conv.isGroup && conv.otherUser) {
        window.callManager.startCall(conv.otherUser.id, 'video', conv.id, conv.otherUser);
      } else {
        alert('Le videochiamate sono disponibili per le chat 1-a-1.');
      }
    });

    document.getElementById('btn-call-mute')?.addEventListener('click', () => window.callManager.toggleAudio());
    document.getElementById('btn-call-video')?.addEventListener('click', () => window.callManager.toggleVideo());
    document.getElementById('btn-call-end')?.addEventListener('click', () => window.callManager.endCall());

    document.getElementById('btn-incoming-accept-video')?.addEventListener('click', () => window.callManager.acceptCall(true));
    document.getElementById('btn-incoming-accept-audio')?.addEventListener('click', () => window.callManager.acceptCall(false));
    document.getElementById('btn-incoming-reject')?.addEventListener('click', () => window.callManager.rejectCall());

    // Stories
    document.getElementById('btn-create-story-top')?.addEventListener('click', () => {
      document.getElementById('create-story-modal').classList.remove('hidden');
    });
    document.getElementById('close-story-viewer')?.addEventListener('click', () => window.storyManager.closeStoryViewer());
    document.getElementById('story-prev-trigger')?.addEventListener('click', () => window.storyManager.prevStory());
    document.getElementById('story-next-trigger')?.addEventListener('click', () => window.storyManager.nextStory());
    document.getElementById('close-create-story-modal')?.addEventListener('click', () => {
      document.getElementById('create-story-modal').classList.add('hidden');
    });
    document.getElementById('btn-publish-story')?.addEventListener('click', async () => {
      const text = document.getElementById('story-create-text').value.trim();
      const gradient = document.getElementById('story-gradient-picker').value;
      if (!text) return alert('Inserisci un testo!');
      await window.api.createStory({ type: 'text', textContent: text, bgGradient: gradient });
      document.getElementById('create-story-modal').classList.add('hidden');
      document.getElementById('story-create-text').value = '';
      window.storyManager.loadStories();
    });

    // Profile Modal
    const openProfile = () => {
      document.getElementById('profile-modal').classList.remove('hidden');
      document.getElementById('prof-fullname').value = this.currentUser.fullName;
      document.getElementById('prof-bio').value = this.currentUser.bio || '';
      document.getElementById('prof-username').textContent = '@' + this.currentUser.username;
      document.getElementById('prof-email').textContent = this.currentUser.email;
      document.getElementById('prof-avatar-img').src = this.currentUser.avatarUrl;
    };
    document.getElementById('btn-quick-settings')?.addEventListener('click', openProfile);
    document.getElementById('btn-edit-profile-hub')?.addEventListener('click', openProfile);
    document.getElementById('close-profile-modal')?.addEventListener('click', () => {
      document.getElementById('profile-modal').classList.add('hidden');
    });
    document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await window.api.updateProfile({
        fullName: document.getElementById('prof-fullname').value,
        bio: document.getElementById('prof-bio').value
      });
      this.currentUser = res.user;
      window.currentUser = res.user;
      document.getElementById('hub-my-fullname').textContent = res.user.fullName;
      document.getElementById('hub-my-bio').textContent = res.user.bio;
      document.getElementById('profile-modal').classList.add('hidden');
      alert('Profilo aggiornato!');
    });

    // Mobile Back
    document.getElementById('mobile-back-btn')?.addEventListener('click', () => {
      document.getElementById('app-main').classList.remove('mobile-chat-open');
    });

    // ── Notification Permission Banner ───────────────────────────
    document.getElementById('btn-enable-notifications')?.addEventListener('click', () => {
      window.notificationManager?.requestPermission();
      document.getElementById('notify-permission-banner')?.classList.add('hidden');
    });
    document.getElementById('btn-dismiss-notify-banner')?.addEventListener('click', () => {
      document.getElementById('notify-permission-banner')?.classList.add('hidden');
    });

    // ── PWA Install Banner ───────────────────────────────────────
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      document.getElementById('pwa-install-banner')?.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      document.getElementById('pwa-install-banner')?.classList.add('hidden');
    });
    document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        console.log('[PWA] Install outcome:', outcome);
        deferredInstallPrompt = null;
        document.getElementById('pwa-install-banner')?.classList.add('hidden');
      }
    });
    document.getElementById('btn-dismiss-pwa')?.addEventListener('click', () => {
      document.getElementById('pwa-install-banner')?.classList.add('hidden');
    });

    // ── Service Worker: navigate on notification click ───────────
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NAVIGATE_CONVERSATION') {
          const convId = event.data.conversationId;
          if (convId) this.selectConversation(convId);
        }
      });
    }
  }

  renderGlobalSearchResults(users) {
    const resultsContainer = document.getElementById('global-search-results');
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('hidden');

    if (users.length === 0) {
      resultsContainer.innerHTML = `<div style="padding:14px; text-align:center; color:var(--text-dim);">Nessun utente trovato</div>`;
      return;
    }

    users.forEach(u => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div class="user-avatar-wrap">
          <img src="${u.avatarUrl}" alt="${u.fullName}">
          <span class="status-indicator ${u.isOnline ? 'online' : 'offline'}"></span>
        </div>
        <div class="user-info">
          <span class="user-name">${this.escapeHtml(u.fullName)}</span>
          <span class="user-handle">@${this.escapeHtml(u.username)} • ${this.escapeHtml(u.email)}</span>
        </div>
        <button class="btn-chat-action">Chatta</button>
      `;

      item.querySelector('.btn-chat-action').addEventListener('click', async () => {
        resultsContainer.classList.add('hidden');
        document.getElementById('search-contacts-input').value = '';
        const convRes = await window.api.createConversation({ isGroup: false, recipientId: u.id });
        await this.loadConversations();
        this.selectConversation(convRes.conversationId);
      });

      resultsContainer.appendChild(item);
    });
  }

  // Voice recording
  async startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data); };
      this.mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (this.audioChunks.length > 0 && this.recordSeconds >= 1) {
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = () => this.sendMediaMessage('audio', reader.result);
          reader.readAsDataURL(audioBlob);
        }
      };

      this.mediaRecorder.start();
      this.recordSeconds = 0;
      document.getElementById('voice-record-ui').classList.remove('hidden');
      document.getElementById('chat-input-controls').classList.add('hidden');

      this.recordTimer = setInterval(() => {
        this.recordSeconds++;
        const mins = String(Math.floor(this.recordSeconds / 60)).padStart(2, '0');
        const secs = String(this.recordSeconds % 60).padStart(2, '0');
        document.getElementById('voice-timer-text').textContent = `${mins}:${secs}`;
      }, 1000);
    } catch (err) {
      alert('Microfono non accessibile: ' + err.message);
    }
  }

  stopVoiceRecording(send = true) {
    if (this.recordTimer) clearInterval(this.recordTimer);
    document.getElementById('voice-record-ui').classList.add('hidden');
    document.getElementById('chat-input-controls').classList.remove('hidden');
    if (!send) this.audioChunks = [];
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
  }

  toggleAudioPlay(msgId, url) {
    const audio = document.getElementById(`audio-${msgId}`);
    if (!audio) return;
    if (audio.paused) {
      document.querySelectorAll('audio').forEach(a => { if (a !== audio) a.pause(); });
      audio.play();
    } else {
      audio.pause();
    }
  }

  setReplyTo(msgId) {
    const msg = this.activeMessages.find(m => m.id === msgId);
    if (!msg) return;
    this.replyingToMessage = msg;
    document.getElementById('reply-preview-author').textContent = msg.senderName;
    document.getElementById('reply-preview-text').textContent = msg.content || `[${msg.mediaType}]`;
    document.getElementById('reply-preview-bar').classList.remove('hidden');
    document.getElementById('message-input').focus();
  }

  cancelReply() {
    this.replyingToMessage = null;
    document.getElementById('reply-preview-bar').classList.add('hidden');
  }

  async toggleReaction(msgId, emoji) {
    try {
      await window.api.toggleReaction(msgId, emoji);
    } catch (err) {
      console.error(err);
    }
  }

  adjustInputHeight(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  formatMessageText(text) {
    const escaped = this.escapeHtml(text);
    const urlPattern = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    return escaped.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline;">$1</a>');
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  formatTimeOnly(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatMessageTime(ts) {
    const now = new Date();
    const d = new Date(ts);
    if (d.toDateString() === now.toDateString()) return this.formatTimeOnly(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  formatDateDivider(ts) {
    const now = new Date();
    const d = new Date(ts);
    if (d.toDateString() === now.toDateString()) return 'Oggi';
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ieri';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  openLightbox(url) {
    const lb = document.getElementById('lightbox-modal');
    document.getElementById('lightbox-img').src = url;
    lb.classList.remove('hidden');
    lb.onclick = () => lb.classList.add('hidden');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
