/**
 * VideoRTC v1.6.0 - Video player for go2rtc streaming application.
 *
 * All modern web technologies are supported in almost any browser except Apple Safari.
 *
 * Support:
 * - ECMAScript 2017 (ES8) = ES6 + async
 * - RTCPeerConnection for Safari iOS 11.0+
 * - IntersectionObserver for Safari iOS 12.2+
 *
 * Doesn't support:
 * - MediaSource for Safari iOS
 * - Customized built-in elements (extends HTMLVideoElement) because Safari
 * - Autoplay for WebRTC in Safari
 */
class VideoRTC extends HTMLElement {
  constructor() {
    super();
    // this.playerId = null;
    console.log('constructor', `player${this.playerId}`, this.wsURL);

    this.DISCONNECT_TIMEOUT = 5000;
    this.RECONNECT_TIMEOUT = 30000;
    this.testInterval = null;
    this.CODECS = [
      'avc1.640029', // H.264 high 4.1 (Chromecast 1st and 2nd Gen)
      'avc1.64002A', // H.264 high 4.2 (Chromecast 3rd Gen)
      'avc1.640033', // H.264 high 5.1 (Chromecast with Google TV)
      'hvc1.1.6.L153.B0', // H.265 main 5.1 (Chromecast Ultra)
      'mp4a.40.2', // AAC LC
      'mp4a.40.5', // AAC HE
      'flac', // FLAC (PCM compatible)
      'opus', // OPUS Chrome, Firefox
    ];

    /**
     * [config] Supported modes (webrtc, webrtc/tcp, mse, hls, mp4, mjpeg).
     * @type {string}
     */
    this.mode = 'webrtc,mse,hls,mjpeg';

    /**
     * [config] Run stream when not displayed on the screen. Default `false`.
     * @type {boolean}
     */
    this.background = false;

    /**
     * [config] Run stream only when player in the viewport. Stop when user scroll out player.
     * Value is percentage of visibility from `0` (not visible) to `1` (full visible).
     * Default `0` - disable;
     * @type {number}
     */
    this.visibilityThreshold = 0;

    /**
     * [config] Run stream only when browser page on the screen. Stop when user change browser
     * tab or minimise browser windows.
     * @type {boolean}
     */
    this.visibilityCheck = true;

    /**
     * [config] WebRTC configuration
     * @type {RTCConfiguration}
     */
    this.pcConfig = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      sdpSemantics: 'unified-plan', // important for Chromecast 1
    };

    /**
     * [info] WebSocket connection state. Values: CONNECTING, OPEN, CLOSED
     * @type {number}
     */
    this.wsState = WebSocket.CLOSED;

    /**
     * [info] WebRTC connection state.
     * @type {number}
     */
    this.pcState = WebSocket.CLOSED;

    /**
     * @type {HTMLVideoElement}
     */
    this.video = null;

    /**
     * @type {WebSocket}
     */
    this.ws = null;

    /**
     * @type {string|URL}
     */
    this.wsURL = '';

    /**
     * @type {RTCPeerConnection}
     */
    this.pc = null;

    /**
     * @type {number}
     */
    this.connectTS = 0;

    /**
     * @type {string}
     */
    this.mseCodecs = '';

    /**
     * [internal] Disconnect TimeoutID.
     * @type {number}
     */
    this.disconnectTID = 0;

    /**
     * [internal] Reconnect TimeoutID.
     * @type {number}
     */
    this.reconnectTID = 0;

    /**
     * [internal] Handler for receiving Binary from WebSocket.
     * @type {Function}
     */
    this.ondata = null;

    /**
     * [internal] Handlers list for receiving JSON from WebSocket
     * @type {Object.<string,Function>}}
     */
    this.onmessage = null;

    // Binding the context of handleVisibilityChange to the class instance
    this.handleVisibilityChange =
      this.handleVisibilityChange.bind(this);
  }

  /**
   * Set video source (WebSocket URL). Support relative path.
   * @param {string|URL} value
   */
  set src(value) {
    console.log(' wsURL value : ', value, `player${this.playerId}`);
    if (typeof value !== 'string') value = value.toString();
    if (value.startsWith('http')) {
      value = 'ws' + value.substring(4);
    } else if (value.startsWith('/')) {
      value = 'ws' + location.origin.substring(4) + value;
    }

    this.wsURL = value;
    console.log('this.wsURL', `player${this.playerId}`, this.wsURL);

    this.onconnect();
  }

  /**
   * Play video. Support automute when autoplay blocked.
   * https://developer.chrome.com/blog/autoplay/
   */
  play() {
    // console.log('play');
    this.video.play().catch(() => {
      if (!this.video.muted) {
        this.video.muted = true;
        this.video.play().catch((er) => {
          console.warn(er, `player${this.playerId}`);
        });
      }
    });
  }

  /**
   * Send message to server via WebSocket
   * @param {Object} value
   */
  send(value) {
    if (this.ws) this.ws.send(JSON.stringify(value));
  }

  codecs(type) {
    const test =
      type === 'mse'
        ? (codec) =>
            MediaSource.isTypeSupported(
              `video/mp4; codecs="${codec}"`
            )
        : (codec) =>
            this.video.canPlayType(`video/mp4; codecs="${codec}"`);
    return this.CODECS.filter(test).join();
  }

  /**
   * `CustomElement`. Invoked each time the custom element is appended into a
   * document-connected element.
   */
  connectedCallback() {
    this.playerId = this.getAttribute('id');
  this.wsURL = this.getAttribute('src');
  this.mode = this.getAttribute('mode');
  
    if (this.disconnectTID) {
      clearTimeout(this.disconnectTID);
      this.disconnectTID = 0;
    }

    console.log(
      'connectedCallback',
      `player${this.playerId}`,
      this.wsURL
    );

    // because video autopause on disconnected from DOM
    if (this.video) {
      const seek = this.video.seekable;
      if (seek.length > 0) {
        this.video.currentTime = seek.end(seek.length - 1);
      }
      this.play();
    } else {
      this.oninit();
    }

    this.onconnect();
  }

  /**
   * `CustomElement`. Invoked each time the custom element is disconnected from the
   * document's DOM.
   */
  disconnectedCallback() {
    console.log(
      'dis_connectedCallback called from -- LIFECYCLE --',
      `player${this.playerId}`,
      this.wsURL
    );
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
    this.disconnectAction();
  }

  disconnectAction() {
    console.log(
      'dis_connectAction',
      `player${this.playerId}`,
      this.wsURL
    );
    clearInterval(this.testInterval);
    if (this.background || this.disconnectTID) return;
    if (
      this.wsState === WebSocket.CLOSED &&
      this.pcState === WebSocket.CLOSED
    )
      return;

    this.disconnectTID = setTimeout(() => {
      if (this.reconnectTID) {
        clearTimeout(this.reconnectTID);
        this.reconnectTID = 0;
      }
      this.disconnectTID = 0;
      this.ondisconnect();
    }, this.DISCONNECT_TIMEOUT);
  }

  /**
   * Creates child DOM elements. Called automatically once on `connectedCallback`.
   */
  oninit() {
    console.log('oninit', `player${this.playerId}`, this.wsURL);
    this.video = document.createElement('video');
    this.video.controls = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';

    this.video.style.display = 'block'; // fix bottom margin 4px
    this.video.style.width = '100%';
    this.video.style.height = '100%';
    this.video.muted = true;
    this.video.id = this.id;
    this.video.setAttribute(
      'tagname',
      this.label ? this.label : this.label
    );
    this.video.setAttribute('websocketurl', this.wsURL);

    this.appendChild(this.video);
    const parentElement = this.parentElement;
    if (parentElement && parentElement.id) {
      this.playerId = parentElement.id.split('go2rtc')[1];
    }
    console.log(
      'parentElement.id: ',
      parentElement.id,
      `player${this.playerId}`
    );
    // all Safari lies about supported audio codecs
    const m = window.navigator.userAgent.match(
      /Version\/(\d+).+Safari/
    );
    if (m) {
      // AAC from v13, FLAC from v14, OPUS - unsupported
      const skip =
        m[1] < '13' ? 'mp4a.40.2' : m[1] < '14' ? 'flac' : 'opus';
      this.CODECS.splice(this.CODECS.indexOf(skip));
    }

    if (this.background) return;

    if ('hidden' in document && this.visibilityCheck) {
      document.addEventListener(
        'visibilitychange',
        this.handleVisibilityChange
      );
    }

    if (
      'IntersectionObserver' in window &&
      this.visibilityThreshold
    ) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) {
              this.disconnectAction();
            } else if (this.isConnected) {
              this.connectedCallback();
            }
          });
        },
        { threshold: this.visibilityThreshold }
      );
      observer.observe(this);
    }
    // this.testInterval = setInterval(() => {
    //     this.onmessage["stream"]({ type: 'error', value: 'Test', errorSourceId: 8 });
    // }, 500);
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.disconnectAction();
    } else if (this.isConnected) {
      this.connectedCallback();
    }
  }
  /**
   * Connect to WebSocket. Called automatically on `connectedCallback`.
   * @return {boolean} true if the connection has started.
   */
  onconnect() {
    console.log('onconnect', `player${this.playerId}`, this.wsURL);
    if (!this.isConnected || !this.wsURL || this.ws || this.pc)
      return false;

    // CLOSED or CONNECTING => CONNECTING
    this.wsState = WebSocket.CONNECTING;

    this.connectTS = Date.now();
    console.log(
      'this.wsURL 89',
      `player${this.playerId}`,
      this.wsURL
    );
    this.ws = new WebSocket(this.wsURL);

    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('open', () => this.onopen());
    this.ws.addEventListener('close', () => this.onclose());
    this.ws.addEventListener('message', (msg) =>
      this.onWsMessage(this.wsURL, msg)
    );
    return true;
  }

  ondisconnect() {
    console.log('ondisconnect', `player${this.playerId}`, this.wsURL);
    this.wsState = WebSocket.CLOSED;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.pcState = WebSocket.CLOSED;
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    this.video.src = '';
    this.video.srcObject = null;
  }

  /**
   * @returns {Array.<string>} of modes (mse, webrtc, etc.)
   */
  onopen() {
    console.log('onopen', `player${this.playerId}`, this.wsURL);
    // CONNECTING => OPEN
    this.wsState = WebSocket.OPEN;

    this.ws.addEventListener('message', (ev) => {
      try {
        if (typeof ev.data === 'string') {
          const msg = JSON.parse(ev.data);
          for (const mode in this.onmessage) {
            this.onmessage[mode](msg);
          }
        } else {
          this.ondata(ev.data);
        }
      } catch (err) {
        // console.error('this.ondata error-34: ', err);
        // this.ondisconnect();
        this.onmessage['stream']({
          type: 'error',
          value: 'this.ondata not found',
          errorSourceId: 2,
        });
        // this.doRetry();
      }
    });

    this.ondata = null;
    this.onmessage = {};
    // if (this.video) {
    //     this.video.onplay = () => {
    //         console.log('Video is playing', this.playerId);
    //         // Indicate streaming is happening
    //         this.onmessage["stream"]({ type: 'error', value: 'play', errorSourceId: 9 });
    //     };

    //     this.video.onpause = () => {
    //         console.log('Video is paused', this.playerId);
    //         // Indicate video is paused
    //         this.onmessage["stream"]({ type: 'error', value: 'stop', errorSourceId: 9 });
    //     };

    //     this.video.onended = () => {
    //         console.log('Video has ended', this.playerId);
    //         // Indicate video has ended
    //         this.onmessage["stream"]({ type: 'error', value: 'stop', errorSourceId: 9 });
    //     };

    //     this.video.onstalled = () => {
    //         console.log('Video is stalled or buffering', this.playerId);
    //         // Indicate video is buffering
    //         this.onmessage["stream"]({ type: 'error', value: 'stop', errorSourceId: 9 });
    //     };
    // }
    const modes = [];

    if (this.mode.indexOf('mse') >= 0 && 'MediaSource' in window) {
      // iPhone
      modes.push('mse');
      this.onmse();
    } else if (
      this.mode.indexOf('hls') >= 0 &&
      this.video.canPlayType('application/vnd.apple.mpegurl')
    ) {
      modes.push('hls');
      this.onhls();
    } else if (this.mode.indexOf('mp4') >= 0) {
      modes.push('mp4');
      this.onmp4();
    }

    if (
      this.mode.indexOf('webrtc') >= 0 &&
      'RTCPeerConnection' in window
    ) {
      // macOS Desktop app
      modes.push('webrtc');
      this.onwebrtc();
    }

    if (this.mode.indexOf('mjpeg') >= 0) {
      if (modes.length) {
        this.onmessage['mjpeg'] = (msg) => {
          if (
            msg.type !== 'error' ||
            msg.value.indexOf(modes[0]) !== 0
          )
            return;
          this.onmjpeg();
        };
      } else {
        modes.push('mjpeg');
        this.onmjpeg();
      }
    }

    return modes;
  }

  /**
   * @return {boolean} true if reconnection has started.
   */
  onclose() {
    console.log('onclose', `player${this.playerId}`, this.wsURL);
    if (this.wsState === WebSocket.CLOSED) return false;

    // CONNECTING, OPEN => CONNECTING
    this.wsState = WebSocket.CONNECTING;
    this.ws = null;

    // reconnect no more than once every X seconds
    const delay = Math.max(
      this.RECONNECT_TIMEOUT - (Date.now() - this.connectTS),
      0
    );

    this.reconnectTID = setTimeout(() => {
      this.reconnectTID = 0;
      this.onconnect();
    }, delay);

    return true;
  }

  doRetry() {
    this.disconnectAction();
    setTimeout(() => {
      this.connectedCallback();
    }, 600);
  }
  onWsMessage(url, msg) {
    // console.log(url, `player${this.playerId}`, msg);
    this.onmessage['stream']({ type: 'count' });
    // this.send({type: 'count'});
  }
  onmse() {
    try {
      console.log('onmse', `player${this.playerId}`);
      const ms = new MediaSource();
      ms.addEventListener(
        'sourceopen',
        () => {
          URL.revokeObjectURL(this.video.src);
          this.send({ type: 'mse', value: this.codecs('mse') });
          console.log(
            "this.codecs('mse')",
            `player${this.playerId}`,
            this.codecs('mse'),
            this.wsURL
          );
        },
        { once: true }
      );

      this.video.src = URL.createObjectURL(ms);
      console.log(
        'this.video.src',
        `player${this.playerId}`,
        this.video.src
      );
      this.video.srcObject = null;
      this.play();

      this.mseCodecs = '';

      this.onmessage['mse'] = (msg) => {
        // console.log('msg', msg);
        if (msg.type !== 'mse') return;

        this.mseCodecs = msg.value;

        const sb = ms.addSourceBuffer(msg.value);

        sb.mode = 'segments'; // segments or sequence
        sb.addEventListener('error', (err) => {
          console.error(`err error-34: player${this.playerId}`, err);
          this.onmessage['stream']({
            type: 'error',
            value: 'addSourceBuffer error',
            errorSourceId: 5,
          });
          // this.doRetry();
        });
        sb.addEventListener('updateend', () => {
          if (sb.updating) return;

          try {
            if (bufLen > 0) {
              const data = buf.slice(0, bufLen);
              bufLen = 0;
              sb.appendBuffer(data);
            } else if (sb.buffered && sb.buffered.length) {
              const end =
                sb.buffered.end(sb.buffered.length - 1) - 15;
              const start = sb.buffered.start(0);
              if (end > start) {
                sb.remove(start, end);
                ms.setLiveSeekableRange(end, end + 15);
              }
              // console.debug("VideoRTC.buffered", start, end);
            }
          } catch (e) {
            console.error(
              `updateend error-34: player${this.playerId}`,
              e
            );
            // this.ondisconnect();
            this.onmessage['stream']({
              type: 'error',
              value: 'updateend exception mse',
              errorSourceId: 2,
            });
            // this.doRetry();
          }
        });

        const buf = new Uint8Array(2 * 1024 * 1024);
        let bufLen = 0;

        this.ondata = (data) => {
          if (sb.updating || bufLen > 0) {
            const b = new Uint8Array(data);
            buf.set(b, bufLen);
            bufLen += b.byteLength;
            // console.debug("VideoRTC.buffer", b.byteLength, bufLen);
          } else {
            try {
              sb.appendBuffer(data);
            } catch (e) {
              console.error(
                `ondata error-34: player${this.playerId}`,
                e
              );
              // this.ondisconnect();
              this.onmessage['stream']({
                type: 'error',
                value: 'ondata exception mse',
                errorSourceId: 3,
              });
              // this.doRetry();
            }
          }
        };
      };
    } catch (err) {
      console.error(`player${this.playerId} : err error-34: `, err);
      // this.ondisconnect();
      this.onmessage['stream']({
        type: 'error',
        value: 'onmessage exception mse',
        errorSourceId: 4,
      });
      // this.doRetry();
    }
  }

  onwebrtc() {
    console.log('onwebrtc', `player${this.playerId}`, this.wsURL);
    const pc = new RTCPeerConnection(this.pcConfig);
    console.log(
      'this.pcConfig',
      `player${this.playerId}`,
      this.pcConfig
    );

    /** @type {HTMLVideoElement} */
    const video2 = document.createElement('video');
    video2.addEventListener(
      'loadeddata',
      (ev) => this.onpcvideo(ev),
      { once: true }
    );

    pc.addEventListener('icecandidate', (ev) => {
      if (
        ev.candidate &&
        this.mode.indexOf('webrtc/tcp') >= 0 &&
        ev.candidate.protocol === 'udp'
      )
        return;

      const candidate = ev.candidate
        ? ev.candidate.toJSON().candidate
        : '';
      console.log('ev', `player${this.playerId}`, ev, this.wsURL);
      this.send({ type: 'webrtc/candidate', value: candidate });
    });

    // let previousBytesSent = 0;
    // let previousTimestamp = Date.now();
    // function monitorBitrate() {
    //     pc.getStats(null).then(stats => {
    //         stats.forEach(report => {
    //             if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
    //                 // Calculate the bitrate
    //                 const currentTime = Date.now();
    //                 const bytesSent = report.bytesSent;
    //                 const timestamp = report.timestamp;

    //                 if (previousBytesSent !== 0) {
    //                     // The bitrate is in bits per second (bps)
    //                     const bitrate = 8 * (bytesSent - previousBytesSent) / ((currentTime - previousTimestamp) / 1000);
    //                     console.log(`Current bitrate: ${bitrate} bps`);
    //                 }

    //                 // Update the previous values
    //                 previousBytesSent = bytesSent;
    //                 previousTimestamp = currentTime;
    //             }
    //         });
    //     });
    // }

    // // Start monitoring the bitrate every 2 seconds
    // setInterval(monitorBitrate, 2000);
    pc.addEventListener('track', (ev) => {
      // when stream already init
      if (video2.srcObject !== null) return;

      // when audio track not exist in Chrome
      if (ev.streams.length === 0) return;

      // when audio track not exist in Firefox
      if (ev.streams[0].id[0] === '{') return;

      video2.srcObject = ev.streams[0];
    });

    pc.addEventListener('connectionstatechange', () => {
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'disconnected'
      ) {
        pc.close(); // stop next events

        this.pcState = WebSocket.CLOSED;
        this.pc = null;

        this.onconnect();
      }
    });

    this.onmessage['webrtc'] = (msg) => {
      // console.log('msg', `player${this.playerId}`, msg);
      switch (msg.type) {
        case 'webrtc/candidate':
          if (
            this.mode.indexOf('webrtc/tcp') >= 0 &&
            msg.value.indexOf(' udp ') > 0
          )
            return;

          pc.addIceCandidate({
            candidate: msg.value,
            sdpMid: '0',
          }).catch((er) => {
            console.warn(er, `player${this.playerId}`);
          });
          break;
        case 'webrtc/answer':
          pc.setRemoteDescription({
            type: 'answer',
            sdp: msg.value,
          }).catch((er) => {
            console.warn(er, `player${this.playerId}`);
          });
          break;
        case 'error':
          if (msg.value.indexOf('webrtc/offer') < 0) return;
          // if ( this.wsURL.indexOf('webrtc') >= 0) {
          //     this.video.wsURL = this.wsURL = this.wsURL.replace('webrtc', 'mse');
          //     this.video.pause()
          //     this.video.setAttribute('wsURL', this.wsURL);
          //     this.video.load();
          //     this.video.play();
          //     this.onmse();
          // } else {
          pc.close();
        // }
      }
    };

    // Safari doesn't support "offerToReceiveVideo"
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.createOffer().then((offer) => {
      pc.setLocalDescription(offer).then(() => {
        this.send({ type: 'webrtc/offer', value: offer.sdp });
      });
    });

    this.pcState = WebSocket.CONNECTING;
    this.pc = pc;
  }

  /**
   * @param ev {Event}
   */
  onpcvideo(ev) {
    console.log('onpcvideo', `player${this.playerId}`, this.wsURL);
    if (!this.pc) return;

    /** @type {HTMLVideoElement} */
    const video2 = ev.target;
    const state = this.pc.connectionState;

    // Firefox doesn't support pc.connectionState
    if (state === 'connected' || state === 'connecting' || !state) {
      // Video+Audio > Video, H265 > H264, Video > Audio, WebRTC > MSE
      let rtcPriority = 0,
        msePriority = 0;

      /** @type {MediaStream} */
      const ms = video2.srcObject;
      if (ms.getVideoTracks().length > 0) rtcPriority += 0x220;
      if (ms.getAudioTracks().length > 0) rtcPriority += 0x102;

      if (this.mseCodecs.indexOf('hvc1.') >= 0) msePriority += 0x230;
      if (this.mseCodecs.indexOf('avc1.') >= 0) msePriority += 0x210;
      if (this.mseCodecs.indexOf('mp4a.') >= 0) msePriority += 0x101;

      if (rtcPriority >= msePriority) {
        this.video.srcObject = ms;
        this.play();

        this.pcState = WebSocket.OPEN;

        this.wsState = WebSocket.CLOSED;
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
      } else {
        this.pcState = WebSocket.CLOSED;
        if (this.pc) {
          this.pc.close();
          this.pc = null;
        }
      }
    }

    video2.srcObject = null;
  }

  onmjpeg() {
    console.log('onmjpeg', `player${this.playerId}`, this.wsURL);
    this.ondata = (data) => {
      this.video.controls = false;
      this.video.poster =
        'data:image/jpeg;base64,' + VideoRTC.btoa(data);
    };

    this.send({ type: 'mjpeg' });
  }

  onhls() {
    console.log('onhls', `player${this.playerId}`, onhls, this.wsURL);
    this.onmessage['hls'] = (msg) => {
      if (msg.type !== 'hls') return;

      const url =
        'http' +
        this.wsURL.substring(2, this.wsURL.indexOf('/ws')) +
        '/hls/';
      const playlist = msg.value.replace('hls/', url);
      this.video.src =
        'data:application/vnd.apple.mpegurl;base64,' + btoa(playlist);
      this.play();
    };

    this.send({ type: 'hls', value: this.codecs('hls') });
  }

  onmp4() {
    console.log('onmp4', `player${this.playerId}`, this.wsURL);
    /** @type {HTMLCanvasElement} **/
    const canvas = document.createElement('canvas');
    /** @type {CanvasRenderingContext2D} */
    let context;

    /** @type {HTMLVideoElement} */
    const video2 = document.createElement('video');
    video2.autoplay = true;
    video2.playsInline = true;
    video2.muted = true;

    video2.addEventListener('loadeddata', () => {
      if (!context) {
        canvas.width = video2.videoWidth;
        canvas.height = video2.videoHeight;
        context = canvas.getContext('2d');
      }

      context.drawImage(video2, 0, 0, canvas.width, canvas.height);

      this.video.controls = false;
      this.video.poster = canvas.toDataURL('image/jpeg');
    });

    this.ondata = (data) => {
      video2.src = 'data:video/mp4;base64,' + VideoRTC.btoa(data);
    };

    this.send({ type: 'mp4', value: this.codecs('mp4') });
  }

  static btoa(buffer) {
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    let binary = '';
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}
