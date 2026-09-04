// memes.js - Built-in Meme Generator & Selector for Aether
class MemeManager {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.currentImage = null;
    this.templates = [
      {
        id: 'drake',
        name: 'Drake Approves',
        color1: '#f87171',
        color2: '#34d399',
        drawBase: (ctx, w, h) => {
          // Top panel (No)
          ctx.fillStyle = '#fee2e2';
          ctx.fillRect(0, 0, w, h / 2);
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 36px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('✋ 😒 NON QUESTO', w / 4, h / 4);

          // Divider
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();

          // Bottom panel (Yes)
          ctx.fillStyle = '#dcfce7';
          ctx.fillRect(0, h / 2, w, h / 2);
          ctx.fillStyle = '#10b981';
          ctx.font = 'bold 36px sans-serif';
          ctx.fillText('👉 😎 QUESTO DECISAMENTE', w / 4, (h * 3) / 4);
        }
      },
      {
        id: 'distracted',
        name: 'Distracted Boyfriend',
        drawBase: (ctx, w, h) => {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#f59e0b';
          ctx.font = 'bold 32px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('👀 La Nuova App (Aether)', w * 0.25, h * 0.4);
          ctx.fillStyle = '#38bdf8';
          ctx.fillText('🧍‍♂️ Tu', w * 0.5, h * 0.5);
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('🙎‍♀️ WhatsApp', w * 0.8, h * 0.6);
        }
      },
      {
        id: 'two_buttons',
        name: 'Two Buttons Panic',
        drawBase: (ctx, w, h) => {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, w, h);
          // Button 1
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.roundRect(w * 0.1, h * 0.2, w * 0.35, h * 0.3, 16);
          ctx.fill();
          // Button 2
          ctx.fillStyle = '#3b82f6';
          ctx.beginPath();
          ctx.roundRect(w * 0.55, h * 0.2, w * 0.35, h * 0.3, 16);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 24px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Opzione A', w * 0.27, h * 0.35);
          ctx.fillText('Opzione B', w * 0.72, h * 0.35);
          ctx.font = 'italic 20px sans-serif';
          ctx.fillText('😰 Quale scegliere?!', w * 0.5, h * 0.8);
        }
      },
      {
        id: 'galaxy_brain',
        name: 'Expanding Brain',
        drawBase: (ctx, w, h) => {
          ctx.fillStyle = '#090d16';
          ctx.fillRect(0, 0, w, h);
          const tiers = ['🧠 Cervello Normale', '⚡ Cervello Luminoso', '🌌 Cervello Cosmico', '✨ Aether User'];
          const colors = ['#64748b', '#38bdf8', '#a855f7', '#f43f5e'];
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = colors[i];
            ctx.font = 'bold 22px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(tiers[i], 30, (h / 4) * i + 40);
            ctx.strokeStyle = '#334155';
            ctx.beginPath();
            ctx.moveTo(0, (h / 4) * (i + 1));
            ctx.lineTo(w, (h / 4) * (i + 1));
            ctx.stroke();
          }
        }
      }
    ];
    this.selectedTemplate = this.templates[0];
  }

  init() {
    this.canvas = document.getElementById('meme-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
    }
  }

  renderMeme(topText = '', bottomText = '') {
    if (!this.canvas || !this.ctx) this.init();
    if (!this.canvas || !this.ctx) return;

    const w = 600;
    const h = 500;
    this.canvas.width = w;
    this.canvas.height = h;

    // Draw base template or user uploaded image
    if (this.currentImage) {
      this.ctx.drawImage(this.currentImage, 0, 0, w, h);
    } else if (this.selectedTemplate && this.selectedTemplate.drawBase) {
      this.selectedTemplate.drawBase(this.ctx, w, h);
    }

    // Render Text with Impact Style
    this.drawMemeText(topText.toUpperCase(), w / 2, 50, true);
    this.drawMemeText(bottomText.toUpperCase(), w / 2, h - 30, false);
  }

  drawMemeText(text, x, y, isTop) {
    if (!text) return;
    const ctx = this.ctx;
    ctx.font = '900 38px Impact, Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = isTop ? 'top' : 'bottom';

    // Black outline
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 2;
    ctx.strokeText(text, x, y);

    // White fill
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
  }

  setTemplate(templateId) {
    this.currentImage = null;
    this.selectedTemplate = this.templates.find(t => t.id === templateId) || this.templates[0];
    const topText = document.getElementById('meme-top-text')?.value || '';
    const bottomText = document.getElementById('meme-bottom-text')?.value || '';
    this.renderMeme(topText, bottomText);
  }

  setImage(imageElement) {
    this.currentImage = imageElement;
    this.selectedTemplate = null;
    const topText = document.getElementById('meme-top-text')?.value || '';
    const bottomText = document.getElementById('meme-bottom-text')?.value || '';
    this.renderMeme(topText, bottomText);
  }

  getDataUrl() {
    if (!this.canvas) return null;
    return this.canvas.toDataURL('image/jpeg', 0.9);
  }
}

window.memeManager = new MemeManager();
