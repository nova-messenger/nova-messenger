// notifications.js - Push Notifications, Vibration & Native Alert Engine for NOVA
class NotificationManager {
  constructor() {
    this.swRegistration = null;
    this.vibrationInterval = null;
    this.hasPermission = false;
    this._initialized = false;
    // Do NOT call init() here — DOM may not be ready yet.
    // init() is called by app.js after authentication.
  }

  async init() {
    if (this._initialized) return; // idempotent
    this._initialized = true;

    // 1. Check & Register Service Worker
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.ready;
        console.log('[PWA] Service Worker pronto!');
      } catch (err) {
        console.warn('[PWA] Service Worker non disponibile:', err);
      }
    }

    // 2. Check Notification Permission
    if ('Notification' in window) {
      this.hasPermission = Notification.permission === 'granted';
    }
  }

  showPermissionBanner() {
    const banner = document.getElementById('notify-permission-banner');
    if (banner) banner.classList.remove('hidden');
  }

  async requestPermission() {
    if (!('Notification' in window)) {
      alert('Il tuo browser non supporta le notifiche native.');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      this.hasPermission = permission === 'granted';
      const banner = document.getElementById('notify-permission-banner');
      if (banner) banner.classList.add('hidden');

      if (this.hasPermission) {
        this.vibrate([100, 50, 100]);
        this.showInAppToast('✦ Notifiche Attivate', 'Riceverai notifiche istantanee per messaggi e chiamate!', null);
      }
      return this.hasPermission;
    } catch (err) {
      console.error('Errore richiesta permessi notifiche:', err);
      return false;
    }
  }

  // Physical phone vibration with fallback
  vibrate(pattern) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        console.warn('Vibration not supported/allowed by policy');
      }
    }
  }

  // 1. Sent Message Feedback (Haptic Pop)
  notifySent() {
    window.soundEngine.playSent();
    this.vibrate(40); // 40ms subtle haptic tick
  }

  // 2. Incoming Message Notification (Chime + Vibration + System Notification + Heads-Up Toast)
  notifyMessage(senderName, text, avatarUrl, conversationId) {
    // Sound & Phone Vibration
    window.soundEngine.playReceived();
    this.vibrate([200, 100, 200]);

    const isAppHidden = document.hidden || (window.app && window.app.activeConversationId !== conversationId);

    // In-App Heads-up floating toast if user is inside app but in another conversation
    if (window.app && window.app.activeConversationId !== conversationId) {
      this.showInAppToast(senderName, text, avatarUrl, () => {
        if (window.app) window.app.selectConversation(conversationId);
      });
    }

    // Native OS / Mobile Push Notification if tab is in background or permission granted
    if (this.hasPermission && isAppHidden) {
      try {
        const title = `${senderName} • NOVA`;
        const options = {
          body: text || 'Nuovo messaggio multimediale',
          icon: avatarUrl || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='25' fill='%2310b981'/><text x='50' y='65' font-size='48' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='900'>✦</text></svg>",
          badge: avatarUrl,
          vibrate: [200, 100, 200],
          tag: `conv_${conversationId}`,
          renotify: true,
          data: { conversationId }
        };

        if (this.swRegistration && this.swRegistration.showNotification) {
          this.swRegistration.showNotification(title, options);
        } else {
          const n = new Notification(title, options);
          n.onclick = () => {
            window.focus();
            if (window.app) window.app.selectConversation(conversationId);
            n.close();
          };
        }
      } catch (err) {
        console.warn('Could not display native notification:', err);
      }
    }
  }

  // 3. Incoming Call Ringing (Continuous Phone Vibration + Continuous Audio + High Priority Notification)
  notifyIncomingCall(callerName, callType, avatarUrl, conversationId) {
    const callLabel = callType === 'video' ? 'Videochiamata' : 'Chiamata vocale';

    // Start phone ringtone
    window.soundEngine.startRingtone();

    // Start phone physical continuous vibration loop
    this.vibrate([1000, 500, 1000, 500, 1000, 500]);
    if (this.vibrationInterval) clearInterval(this.vibrationInterval);
    this.vibrationInterval = setInterval(() => {
      this.vibrate([1000, 500, 1000, 500, 1000, 500]);
    }, 4500);

    // Show In-App Heads-up call alert
    this.showInAppToast(`📞 ${callLabel} in arrivo...`, `${callerName} ti sta chiamando!`, avatarUrl, null, true);

    // High Priority Native System Notification (Stays open until answered)
    if (this.hasPermission) {
      try {
        const title = `📞 ${callLabel} in arrivo da ${callerName}`;
        const options = {
          body: 'Tocca per aprire NOVA e rispondere subito',
          icon: avatarUrl || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='25' fill='%2310b981'/><text x='50' y='65' font-size='48' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='900'>✦</text></svg>",
          tag: 'incoming_call',
          requireInteraction: true,
          vibrate: [1000, 500, 1000, 500, 1000, 500],
          data: { conversationId }
        };

        if (this.swRegistration && this.swRegistration.showNotification) {
          this.swRegistration.showNotification(title, options);
        } else {
          const n = new Notification(title, options);
          n.onclick = () => {
            window.focus();
            n.close();
          };
        }
      } catch (err) {
        console.warn('Native call notification error:', err);
      }
    }
  }

  // Stop Ringing and Vibration
  stopCallAlerts() {
    window.soundEngine.stopRingtone();
    window.soundEngine.stopRingback();
    this.vibrate(0); // Cancel vibration
    if (this.vibrationInterval) {
      clearInterval(this.vibrationInterval);
      this.vibrationInterval = null;
    }
  }

  // 4. In-App Floating Heads-Up Toast
  showInAppToast(title, body, avatarUrl = null, onClick = null, isCall = false) {
    const container = document.getElementById('heads-up-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `heads-up-toast ${isCall ? 'toast-call' : ''}`;
    toast.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; width:100%;">
        <img src="${avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=N'}" class="toast-avatar" alt="Avatar">
        <div class="toast-meta">
          <span class="toast-title">${title}</span>
          <span class="toast-body">${body}</span>
        </div>
        <button class="toast-close-btn">✕</button>
      </div>
    `;

    if (onClick) {
      toast.style.cursor = 'pointer';
      toast.addEventListener('click', (e) => {
        if (!e.target.classList.contains('toast-close-btn')) {
          onClick();
          toast.remove();
        }
      });
    }

    toast.querySelector('.toast-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toast.remove();
    });

    container.appendChild(toast);

    // Auto dismiss after 5 seconds if not call
    if (!isCall) {
      setTimeout(() => {
        if (toast.parentNode) {
          toast.style.animation = 'slideUp 0.25s forwards';
          setTimeout(() => toast.remove(), 250);
        }
      }, 5000);
    }
  }
}

window.notificationManager = new NotificationManager();
