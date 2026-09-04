// webrtc.js - WebRTC Audio & Video Calling Manager for Aether
class CallManager {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.currentCall = null; // { callId, targetUserId, callerId, callType, caller, conversationId, startTime }
    this.callDurationTimer = null;
    this.durationSeconds = 0;
    this.isMuted = false;
    this.isVideoDisabled = false;

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.initSocketListeners();
  }

  initSocketListeners() {
    const sm = window.socketManager;

    // Incoming Call
    sm.on('call:incoming', (data) => {
      this.handleIncomingCall(data);
    });

    // Call Accepted by remote user
    sm.on('call:accepted', async (data) => {
      window.soundEngine.stopRingback();
      console.log('[WebRTC] Call accepted by remote user!');
      await this.createAndSendOffer(data.receiverId);
    });

    // Call Rejected
    sm.on('call:rejected', (data) => {
      window.soundEngine.stopRingback();
      window.soundEngine.playCallEnd();
      alert(data.reason || 'Chiamata rifiutata o non raggiungibile.');
      this.cleanupCallUI();
    });

    // Remote Offer received
    sm.on('call:offer', async (data) => {
      await this.handleRemoteOffer(data.fromUserId, data.sdp);
    });

    // Remote Answer received
    sm.on('call:answer', async (data) => {
      await this.handleRemoteAnswer(data.sdp);
    });

    // Remote ICE Candidate received
    sm.on('call:ice_candidate', async (data) => {
      await this.handleRemoteIceCandidate(data.candidate);
    });

    // Call Ended by remote
    sm.on('call:ended', (data) => {
      console.log('[WebRTC] Call ended by other party.');
      window.soundEngine.stopRingback();
      window.soundEngine.stopRingtone();
      window.soundEngine.playCallEnd();
      this.cleanupCallUI();
    });
  }

  // Start outgoing call
  async startCall(targetUserId, callType = 'video', conversationId = null, targetUser = null) {
    if (this.currentCall) return;

    try {
      this.currentCall = {
        targetUserId,
        callType,
        conversationId,
        targetUser,
        isOutgoing: true
      };

      // Show call screen with ringing state
      this.showCallModal(true, targetUser, callType);
      window.soundEngine.startRingback();

      // Acquire local media
      await this.setupLocalMedia(callType);

      // Send initiate message
      window.socketManager.send({
        type: 'call:initiate',
        targetUserId,
        callType,
        conversationId
      });
    } catch (err) {
      console.error('[WebRTC] Could not start call:', err);
      alert('Impossibile accedere al microfono o alla telecamera: ' + err.message);
      this.cleanupCallUI();
    }
  }

  // Handle incoming call
  handleIncomingCall(data) {
    if (this.currentCall) {
      // Busy: reject incoming
      window.socketManager.send({
        type: 'call:reject',
        callId: data.callId,
        callerId: data.caller.id,
        reason: 'Utente occupato in un\'altra chiamata.'
      });
      return;
    }

    this.currentCall = {
      callId: data.callId,
      callerId: data.caller.id,
      callType: data.callType,
      caller: data.caller,
      conversationId: data.conversationId,
      isOutgoing: false
    };

    // Ringing sound, physical vibration and high-priority notification!
    if (window.notificationManager) {
      window.notificationManager.notifyIncomingCall(
        data.caller.fullName || data.caller.username,
        data.callType,
        data.caller.avatarUrl,
        data.conversationId
      );
    } else {
      window.soundEngine.startRingtone();
    }

    // Show incoming call notification modal
    this.showIncomingDialog(data.caller, data.callType);
  }

  // Accept incoming call
  async acceptCall(withVideo = true) {
    if (window.notificationManager) window.notificationManager.stopCallAlerts();
    else window.soundEngine.stopRingtone();

    const incomingModal = document.getElementById('incoming-call-modal');
    if (incomingModal) incomingModal.classList.add('hidden');

    try {
      const callType = withVideo ? 'video' : 'audio';
      this.currentCall.callType = callType;

      this.showCallModal(false, this.currentCall.caller, callType);
      await this.setupLocalMedia(callType);

      window.socketManager.send({
        type: 'call:accept',
        callId: this.currentCall.callId,
        callerId: this.currentCall.callerId
      });
    } catch (err) {
      console.error('[WebRTC] Accept call failed:', err);
      this.rejectCall('Errore accesso periferiche audio/video.');
    }
  }

  // Reject incoming call
  rejectCall(reason = 'Chiamata rifiutata.') {
    if (window.notificationManager) window.notificationManager.stopCallAlerts();
    else window.soundEngine.stopRingtone();
    const incomingModal = document.getElementById('incoming-call-modal');
    if (incomingModal) incomingModal.classList.add('hidden');

    if (this.currentCall) {
      window.socketManager.send({
        type: 'call:reject',
        callId: this.currentCall.callId,
        callerId: this.currentCall.callerId,
        reason
      });
      this.currentCall = null;
    }
  }

  // Setup local audio / video media
  async setupLocalMedia(callType) {
    const constraints = {
      audio: true,
      video: callType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

    const localVideoEl = document.getElementById('local-video');
    if (localVideoEl) {
      localVideoEl.srcObject = this.localStream;
      localVideoEl.muted = true;
    }

    this.setupPeerConnection();
  }

  setupPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle remote tracks
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Received remote stream track:', event.track.kind);
      this.remoteStream = event.streams[0];
      const remoteVideoEl = document.getElementById('remote-video');
      if (remoteVideoEl) {
        remoteVideoEl.srcObject = this.remoteStream;
      }
      this.startDurationCounter();
      const statusText = document.getElementById('call-status-text');
      if (statusText) statusText.textContent = 'In chiamata';
    };

    // Handle ICE Candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const targetUserId = this.currentCall.isOutgoing 
          ? this.currentCall.targetUserId 
          : this.currentCall.callerId;

        window.socketManager.send({
          type: 'call:ice_candidate',
          targetUserId,
          candidate: event.candidate
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'disconnected' || 
          this.peerConnection.connectionState === 'failed' ||
          this.peerConnection.connectionState === 'closed') {
        this.endCall();
      }
    };
  }

  async createAndSendOffer(targetUserId) {
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      window.socketManager.send({
        type: 'call:offer',
        targetUserId,
        sdp: offer
      });
    } catch (err) {
      console.error('[WebRTC] Create offer error:', err);
    }
  }

  async handleRemoteOffer(fromUserId, sdp) {
    try {
      if (!this.peerConnection) {
        this.setupPeerConnection();
      }
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      window.socketManager.send({
        type: 'call:answer',
        targetUserId: fromUserId,
        sdp: answer
      });
    } catch (err) {
      console.error('[WebRTC] Handle offer error:', err);
    }
  }

  async handleRemoteAnswer(sdp) {
    try {
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    } catch (err) {
      console.error('[WebRTC] Handle answer error:', err);
    }
  }

  async handleRemoteIceCandidate(candidate) {
    try {
      if (this.peerConnection && candidate) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error('[WebRTC] Add ICE candidate error:', err);
    }
  }

  // End Call
  endCall() {
    window.soundEngine.stopRingback();
    window.soundEngine.stopRingtone();
    window.soundEngine.playCallEnd();

    if (this.currentCall) {
      const targetUserId = this.currentCall.isOutgoing 
        ? this.currentCall.targetUserId 
        : this.currentCall.callerId;

      window.socketManager.send({
        type: 'call:end',
        targetUserId,
        callId: this.currentCall.callId,
        duration: this.durationSeconds
      });
    }

    this.cleanupCallUI();
  }

  cleanupCallUI() {
    if (window.notificationManager) window.notificationManager.stopCallAlerts();
    if (this.callDurationTimer) {
      clearInterval(this.callDurationTimer);
      this.callDurationTimer = null;
    }
    this.durationSeconds = 0;

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.currentCall = null;
    this.isMuted = false;
    this.isVideoDisabled = false;

    const modal = document.getElementById('active-call-modal');
    if (modal) modal.classList.add('hidden');
    const incomingModal = document.getElementById('incoming-call-modal');
    if (incomingModal) incomingModal.classList.add('hidden');

    const remoteVideoEl = document.getElementById('remote-video');
    if (remoteVideoEl) remoteVideoEl.srcObject = null;
    const localVideoEl = document.getElementById('local-video');
    if (localVideoEl) localVideoEl.srcObject = null;
  }

  toggleAudio() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    const btn = document.getElementById('btn-call-mute');
    if (btn) {
      btn.classList.toggle('active-control', this.isMuted);
      btn.title = this.isMuted ? 'Riattiva microfono' : 'Disattiva microfono';
    }
  }

  toggleVideo() {
    if (!this.localStream) return;
    this.isVideoDisabled = !this.isVideoDisabled;
    this.localStream.getVideoTracks().forEach(track => {
      track.enabled = !this.isVideoDisabled;
    });

    const btn = document.getElementById('btn-call-video');
    if (btn) {
      btn.classList.toggle('active-control', this.isVideoDisabled);
      btn.title = this.isVideoDisabled ? 'Attiva telecamera' : 'Disattiva telecamera';
    }
  }

  startDurationCounter() {
    if (this.callDurationTimer) clearInterval(this.callDurationTimer);
    this.durationSeconds = 0;
    const timerEl = document.getElementById('call-duration-text');
    this.callDurationTimer = setInterval(() => {
      this.durationSeconds++;
      const mins = String(Math.floor(this.durationSeconds / 60)).padStart(2, '0');
      const secs = String(this.durationSeconds % 60).padStart(2, '0');
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  showIncomingDialog(caller, callType) {
    const modal = document.getElementById('incoming-call-modal');
    if (!modal) return;

    document.getElementById('incoming-caller-name').textContent = caller.fullName || caller.username;
    document.getElementById('incoming-caller-avatar').src = caller.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=U';
    document.getElementById('incoming-call-type').textContent = callType === 'video' ? 'Videochiamata in arrivo...' : 'Chiamata vocale in arrivo...';

    modal.classList.remove('hidden');
  }

  showCallModal(isOutgoing, person, callType) {
    const modal = document.getElementById('active-call-modal');
    if (!modal) return;

    const name = person ? (person.fullName || person.username || person.name) : 'Utente';
    const avatar = person ? (person.avatarUrl || person.iconUrl) : '';

    document.getElementById('call-peer-name').textContent = name;
    document.getElementById('call-status-text').textContent = isOutgoing ? 'Chiamata in corso...' : 'Connessione...';
    document.getElementById('call-duration-text').textContent = '00:00';
    document.getElementById('call-peer-avatar').src = avatar || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(name);

    const remoteVideo = document.getElementById('remote-video');
    const localVideoWrap = document.getElementById('local-video-wrap');

    if (callType === 'audio') {
      remoteVideo.classList.add('hidden');
      localVideoWrap.classList.add('hidden');
      document.getElementById('call-avatar-wrap').classList.remove('hidden');
    } else {
      remoteVideo.classList.remove('hidden');
      localVideoWrap.classList.remove('hidden');
      document.getElementById('call-avatar-wrap').classList.add('hidden');
    }

    modal.classList.remove('hidden');
  }
}

window.callManager = new CallManager();
