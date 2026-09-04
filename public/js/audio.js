// audio.js - Web Audio API Procedural Sound Engine for Aether
// Generates notification sounds and ringtones procedurally without external files!

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.ringtoneInterval = null;
    this.isRinging = false;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Soft "pop" sound when message is sent
  playSent() {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Elegant "chime" sound when message is received
  playReceived() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.setValueAtTime(880, now + 0.1); // A5

      osc2.frequency.setValueAtTime(1174.66, now); // D6
      osc2.frequency.setValueAtTime(1760, now + 0.1); // A6

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.4);
      osc2.stop(now + 0.4);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Realistic phone ringtone for incoming calls (harmonic dual-tone modulated)
  startRingtone() {
    if (this.isRinging) return;
    this.init();
    if (!this.ctx) return;
    this.isRinging = true;

    const playBeep = () => {
      if (!this.isRinging || !this.ctx) return;
      const now = this.ctx.currentTime;

      // European/Standard Ring: 440Hz + 480Hz
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.frequency.value = 440;
      osc2.frequency.value = 480;

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.setValueAtTime(0.3, now + 1.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.3);
      osc2.stop(now + 1.3);
    };

    playBeep();
    this.ringtoneInterval = setInterval(() => {
      if (!this.isRinging) return;
      playBeep();
    }, 2800);
  }

  stopRingtone() {
    this.isRinging = false;
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }

  // Ringback tone for outgoing calls
  startRingback() {
    if (this.isRinging) return;
    this.init();
    if (!this.ctx) return;
    this.isRinging = true;

    const playBeep = () => {
      if (!this.isRinging || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = 425;
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.setValueAtTime(0.15, now + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 1.0);
    };

    playBeep();
    this.ringtoneInterval = setInterval(() => {
      if (!this.isRinging) return;
      playBeep();
    }, 3000);
  }

  stopRingback() {
    this.stopRingtone();
  }

  // Call End sound
  playCallEnd() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(330, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn('Call end sound error:', e);
    }
  }
}

window.soundEngine = new SoundEngine();
