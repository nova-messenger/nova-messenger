// stories.js - 24-Hour Stories / Status Manager for Aether
class StoryManager {
  constructor() {
    this.storyGroups = [];
    this.currentGroupIndex = 0;
    this.currentStoryIndex = 0;
    this.timer = null;
    this.storyDuration = 5000; // 5 seconds per story
    this.isPaused = false;
    this.progressStartTime = 0;
    this.remainingTime = 5000;
  }

  async loadStories() {
    try {
      const data = await window.api.getStories();
      this.storyGroups = data.storyGroups || [];
      this.renderStoriesBar();
    } catch (err) {
      console.error('[Stories] Error loading stories:', err);
    }
  }

  renderStoriesBar() {
    const bar = document.getElementById('stories-container');
    if (!bar) return;

    bar.innerHTML = '';

    // "My Status" add button
    const myGroup = this.storyGroups.find(g => g.isCurrentUser);
    const hasMyStory = myGroup && myGroup.stories && myGroup.stories.length > 0;

    const myStoryEl = document.createElement('div');
    myStoryEl.className = 'story-item my-story';
    myStoryEl.innerHTML = `
      <div class="story-avatar-wrap ${hasMyStory ? 'has-story' : ''}">
        <img src="${window.currentUser?.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=Me'}" alt="Mio Stato">
        <div class="story-add-badge">+</div>
      </div>
      <span class="story-label">Il tuo stato</span>
    `;

    myStoryEl.addEventListener('click', () => {
      if (hasMyStory) {
        this.openStoryViewer(this.storyGroups.indexOf(myGroup), 0);
      } else {
        document.getElementById('create-story-modal')?.classList.remove('hidden');
      }
    });

    bar.appendChild(myStoryEl);

    // Contacts' stories
    this.storyGroups.filter(g => !g.isCurrentUser).forEach((group, index) => {
      const groupIdx = this.storyGroups.indexOf(group);
      const item = document.createElement('div');
      item.className = 'story-item';
      item.innerHTML = `
        <div class="story-avatar-wrap has-story">
          <img src="${group.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(group.fullName)}" alt="${group.fullName}">
        </div>
        <span class="story-label">${group.fullName.split(' ')[0]}</span>
      `;
      item.addEventListener('click', () => {
        this.openStoryViewer(groupIdx, 0);
      });
      bar.appendChild(item);
    });
  }

  openStoryViewer(groupIndex, storyIndex = 0) {
    this.currentGroupIndex = groupIndex;
    this.currentStoryIndex = storyIndex;
    const modal = document.getElementById('story-viewer-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    this.showCurrentStory();
  }

  closeStoryViewer() {
    this.clearStoryTimer();
    const modal = document.getElementById('story-viewer-modal');
    if (modal) modal.classList.add('hidden');
  }

  showCurrentStory() {
    this.clearStoryTimer();
    const group = this.storyGroups[this.currentGroupIndex];
    if (!group || !group.stories || group.stories.length === 0) {
      this.closeStoryViewer();
      return;
    }

    const story = group.stories[this.currentStoryIndex];
    if (!story) {
      // Advance to next contact's story or close
      if (this.currentGroupIndex + 1 < this.storyGroups.length) {
        this.currentGroupIndex++;
        this.currentStoryIndex = 0;
        this.showCurrentStory();
      } else {
        this.closeStoryViewer();
      }
      return;
    }

    // Set User Info
    document.getElementById('story-user-avatar').src = group.avatarUrl;
    document.getElementById('story-user-name').textContent = group.fullName;
    document.getElementById('story-user-time').textContent = this.formatTimeAgo(story.createdAt);

    // Build Progress Bars
    const progressContainer = document.getElementById('story-progress-bars');
    progressContainer.innerHTML = '';
    group.stories.forEach((_, idx) => {
      const bar = document.createElement('div');
      bar.className = 'story-progress-bar';
      const fill = document.createElement('div');
      fill.className = 'story-progress-fill';
      if (idx < this.currentStoryIndex) {
        fill.style.width = '100%';
      } else if (idx === this.currentStoryIndex) {
        fill.style.width = '0%';
        fill.id = 'active-story-fill';
      } else {
        fill.style.width = '0%';
      }
      bar.appendChild(fill);
      progressContainer.appendChild(bar);
    });

    // Content Display
    const textWrap = document.getElementById('story-content-text');
    const imgWrap = document.getElementById('story-content-image');
    const imgTag = document.getElementById('story-img-tag');
    const captionTag = document.getElementById('story-caption-tag');

    if (story.type === 'text') {
      imgWrap.classList.add('hidden');
      textWrap.classList.remove('hidden');
      textWrap.style.background = story.bgGradient || 'linear-gradient(135deg, #4f46e5, #06b6d4)';
      textWrap.textContent = story.textContent;
    } else {
      textWrap.classList.add('hidden');
      imgWrap.classList.remove('hidden');
      imgTag.src = story.mediaUrl;
      captionTag.textContent = story.textContent || '';
      captionTag.style.display = story.textContent ? 'block' : 'none';
    }

    // Start Timer
    this.remainingTime = this.storyDuration;
    this.startStoryTimer();
  }

  startStoryTimer() {
    this.clearStoryTimer();
    this.progressStartTime = Date.now();
    const fillEl = document.getElementById('active-story-fill');

    if (fillEl) {
      fillEl.style.transition = `width ${this.remainingTime}ms linear`;
      // Trigger reflow
      void fillEl.offsetWidth;
      fillEl.style.width = '100%';
    }

    this.timer = setTimeout(() => {
      this.nextStory();
    }, this.remainingTime);
  }

  pauseStory() {
    if (this.isPaused) return;
    this.isPaused = true;
    const elapsed = Date.now() - this.progressStartTime;
    this.remainingTime = Math.max(0, this.remainingTime - elapsed);
    if (this.timer) clearTimeout(this.timer);

    const fillEl = document.getElementById('active-story-fill');
    if (fillEl) {
      const computed = window.getComputedStyle(fillEl);
      fillEl.style.width = computed.width;
      fillEl.style.transition = 'none';
    }
  }

  resumeStory() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.startStoryTimer();
  }

  nextStory() {
    const group = this.storyGroups[this.currentGroupIndex];
    if (group && this.currentStoryIndex + 1 < group.stories.length) {
      this.currentStoryIndex++;
      this.showCurrentStory();
    } else if (this.currentGroupIndex + 1 < this.storyGroups.length) {
      this.currentGroupIndex++;
      this.currentStoryIndex = 0;
      this.showCurrentStory();
    } else {
      this.closeStoryViewer();
    }
  }

  prevStory() {
    if (this.currentStoryIndex > 0) {
      this.currentStoryIndex--;
      this.showCurrentStory();
    } else if (this.currentGroupIndex > 0) {
      this.currentGroupIndex--;
      const prevGroup = this.storyGroups[this.currentGroupIndex];
      this.currentStoryIndex = prevGroup.stories.length - 1;
      this.showCurrentStory();
    }
  }

  clearStoryTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Adesso';
    if (mins < 60) return `${mins}m fa`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h fa`;
    return 'Ieri';
  }

  // Reply to story directly in DM!
  async sendReply(text) {
    const group = this.storyGroups[this.currentGroupIndex];
    if (!group || !text.trim()) return;

    try {
      // Find or create direct conversation with this user
      const convRes = await window.api.createConversation({
        isGroup: false,
        recipientId: group.userId
      });

      const story = group.stories[this.currentStoryIndex];
      const storyQuote = `[Risposta alla storia: ${story.textContent ? `"${story.textContent}"` : 'Foto'}]`;

      await window.api.sendMessage(convRes.conversationId, {
        content: `${storyQuote}\n${text.trim()}`,
        mediaType: 'text'
      });

      this.closeStoryViewer();
      window.app.selectConversation(convRes.conversationId);
    } catch (err) {
      alert('Errore invio risposta: ' + err.message);
    }
  }
}

window.storyManager = new StoryManager();
