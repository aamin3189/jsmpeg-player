class VideoStream extends VideoRTC {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
    this.playerId = this.id;
    this.wsURL = this.getAttribute('src');
    console.log('connectedCallback', `player${this.playerId}`, this.wsURL);
    this.oninit();
  }

  set divMode(value) {
    var event = new CustomEvent('video-mode-go2rtc', {
      detail: { elementId: this.playerId, mode: value },
    });
    document.dispatchEvent(event);
    this.querySelector('.mode').innerText = value;
    this.querySelector('.status').innerText = '';
  }

  set divError(value) {
    const state = this.querySelector('.mode').innerText;
    if (state !== 'loading') return;
    this.querySelector('.mode').innerText = 'error';
  }

  oninit() {
    console.debug('stream.oninit');
    super.oninit();
    this.streamCountArray = [];
    this.streamStrengthStatus = 'no';
    this.innerHTML = `
      <style>
      video-stream {
        position: relative;
      }
      .info {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        padding: 12px;
        color: white;
        display: flex;
        justify-content: space-between;
        pointer-events: none;
      }
      video {
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      </style>
      <div class="info">
        <div class="status"></div>
        <div class="mode"></div>
      </div>
    `;
    this.streamCountCalcSeconds = 1;
    this.streamCountStartTime = new Date().getTime();
    this.streamDataCount = 0;
    const info = this.querySelector('.info');
    this.insertBefore(this.video, info);

    // Hide video controls
    this.video.controls = false;
    this.video.setAttribute('controls', 'false');
    this.video.style.pointerEvents = 'none';

    // Programmatically play the video
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.play();
  }

  onconnect() {
    const result = super.onconnect();
    if (result) this.divMode = 'loading';
    return result;
  }

  ondisconnect() {
    super.ondisconnect();
  }

  onopen() {
    console.debug('stream.onopen');
    const result = super.onopen();
    this.onmessage['stream'] = (msg) => {
      switch (msg.type) {
        case 'error':
          this.divError = msg.value;
          let details = null;
          if (msg.value && msg.value.indexOf('webrtc/offer: streams: codecs not matched') >= 0) {
            details = {
              msg: msg.value,
              wsURL: this.wsURL,
              elementId: this.playerId,
              tryWith: 'mse',
              errorSourceId: 1000,
            };
            console.log('mse : =============', msg.value);
            var event = new CustomEvent('video-error-go2rtc', { detail: details });
            document.dispatchEvent(event);
          } else {
            details = {
              msg: msg.value,
              wsURL: this.wsURL,
              elementId: this.playerId,
              tryWith: 'next',
              errorSourceId: msg.errorSourceId,
            };
            var event = new CustomEvent('video-error-go2rtc', { detail: details });
            document.dispatchEvent(event);
          }
          break;
        case 'mse':
        case 'hls':
        case 'mp4':
        case 'mjpeg':
          this.divMode = msg.type.toUpperCase();
          break;
        case 'count':
          this.doCount();
          break;
      }
    };
    return result;
  }

  doCount() {
    const now = new Date().getTime();
    const timeEnd = this.streamCountStartTime + this.streamCountCalcSeconds * 1000;
    if (now < timeEnd) {
      this.streamDataCount++;
    } else {
      this.streamCountStartTime = new Date().getTime();
      this.streamCountArray.push(this.streamDataCount);
      let max = 5;
      if (this.streamCountArray && this.streamCountArray.length) {
        max = this.streamCountArray.reduce((a, b) => Math.max(a, b), -Infinity);
      }

      const low = max / 4;
      const medium = max / 2;
      const high = low + medium;
      let status = this.streamStrengthStatus;
      if (this.streamDataCount === 0) {
        status = 'no';
      } else if (this.streamDataCount < low) {
        status = 'low';
      } else if (this.streamDataCount < medium) {
        status = 'medium';
      } else if (this.streamDataCount < high) {
        status = 'high';
      } else if (this.streamDataCount > high) {
        status = 'full';
      }
      if (status !== this.streamStrengthStatus) {
        this.streamStrengthStatus = status;
        var event = new CustomEvent('stream-strength-status', {
          detail: { msg: status, elementId: this.playerId },
        });
        document.dispatchEvent(event);
      }
      this.streamDataCount = 0;
    }
  }

  onclose() {
    console.debug('stream.onclose');
    return super.onclose();
  }

  onpcvideo(ev) {
    console.debug('stream.onpcvideo');
    super.onpcvideo(ev);
    if (this.pcState !== WebSocket.CLOSED) {
      this.divMode = 'RTC';
    }
  }
}

customElements.define('video-stream', VideoStream);
