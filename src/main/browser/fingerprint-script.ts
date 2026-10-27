import type { Fingerprint } from '@shared/types'

export interface ScriptContext {
  publicIp?: string
  // false when Chrome runs with its own UA (profile OS == host OS): the
  // navigator identity is then left untouched so JS, headers and client
  // hints all agree.
  uaOverride?: boolean
  // true when running on the FacetBrowser Engine: canvas/WebGL/audio/fonts/UA
  // are handled in C++, so only WebRTC, media devices, battery and the
  // deviceMemory cap are applied from JS.
  engineMode?: boolean
}

// Builds the JavaScript that is injected into every frame before any page
// script runs. All overrides are seeded so the same profile keeps producing
// the same canvas / audio / rects values across sessions (stable identity),
// while different profiles diverge.
export function buildFingerprintScript(fp: Fingerprint, ctx: ScriptContext = {}): string {
  const cfg = JSON.stringify({
    seed: fp.seed,
    os: fp.os,
    userAgent: fp.userAgent,
    platform: fp.platform,
    vendor: fp.vendor,
    languages: fp.languages,
    hardwareConcurrency: fp.hardwareConcurrency,
    deviceMemory: fp.deviceMemory,
    maxTouchPoints: fp.maxTouchPoints,
    screen: fp.screen,
    webgl: fp.webgl,
    canvas: fp.canvas,
    audio: fp.audio,
    clientRects: fp.clientRects,
    webrtc: fp.webrtc,
    fonts: fp.fonts,
    mediaDevices: fp.mediaDevices,
    doNotTrack: fp.doNotTrack,
    batteryMask: fp.batteryMask,
    geolocationOff: fp.geolocation.mode === 'off',
    publicIp: ctx.publicIp || null,
    uaOverride: ctx.uaOverride !== false && !ctx.engineMode,
    engineMode: !!ctx.engineMode
  })

  return `(() => {
  if (window.__fb_injected) return;
  try { Object.defineProperty(window, '__fb_injected', { value: true, enumerable: false, configurable: false }); } catch (e) {}
  const C = ${cfg};

  // ---- seeded prng -------------------------------------------------------
  const mk = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const rnd = mk(C.seed);
  const noiseTable = new Float64Array(4096);
  for (let i = 0; i < noiseTable.length; i++) noiseTable[i] = rnd();

  // ---- native-looking overrides -----------------------------------------
  const nativeNames = new WeakMap();
  const origToString = Function.prototype.toString;
  const patchedToString = function toString() {
    const n = nativeNames.get(this);
    if (n !== undefined) return 'function ' + n + '() { [native code] }';
    return origToString.call(this);
  };
  nativeNames.set(patchedToString, 'toString');
  Object.defineProperty(Function.prototype, 'toString', { value: patchedToString, writable: true, configurable: true });

  const markNative = (fn, name) => { nativeNames.set(fn, name); return fn; };
  const defineGetter = (obj, prop, value, name) => {
    try {
      const desc = Object.getOwnPropertyDescriptor(obj, prop);
      const getter = markNative(function () { return typeof value === 'function' ? value() : value; }, 'get ' + (name || prop));
      Object.defineProperty(obj, prop, { get: getter, set: desc && desc.set ? desc.set : undefined, enumerable: desc ? desc.enumerable : true, configurable: true });
    } catch (e) {}
  };
  const replaceMethod = (obj, prop, wrapper) => {
    try {
      const orig = obj[prop];
      if (typeof orig !== 'function') return;
      const fn = markNative(function () { return wrapper.call(this, orig, arguments); }, prop);
      Object.defineProperty(obj, prop, { value: fn, writable: true, configurable: true, enumerable: false });
    } catch (e) {}
  };

  // ---- navigator ---------------------------------------------------------
  const N = Navigator.prototype;
  // navigator.webdriver is handled by the launch flag; a JS getter here would
  // only add a detectable prototype change.
  if (C.uaOverride) {
    defineGetter(N, 'userAgent', C.userAgent);
    defineGetter(N, 'appVersion', C.userAgent.replace(/^Mozilla\\//, ''));
    defineGetter(N, 'platform', C.platform);
    defineGetter(N, 'vendor', C.vendor);
    defineGetter(N, 'language', C.languages[0]);
    defineGetter(N, 'languages', () => Object.freeze(C.languages.slice()));
  }
  if (!C.engineMode) defineGetter(N, 'hardwareConcurrency', C.hardwareConcurrency);
  // Real Chrome never reports more than 8 GB; the engine passes raw memory through.
  defineGetter(N, 'deviceMemory', Math.min(8, C.deviceMemory));
  defineGetter(N, 'maxTouchPoints', C.maxTouchPoints);
  if (C.doNotTrack !== null) defineGetter(N, 'doNotTrack', C.doNotTrack ? '1' : null);

  // ---- screen ------------------------------------------------------------
  const S = Screen.prototype;
  if (C.engineMode) { /* engine reports the host screen; keep it */ } else {
  const availH = C.os === 'windows' ? C.screen.height - 40 : C.os === 'macos' ? C.screen.height - 25 : C.screen.height;
  defineGetter(S, 'width', C.screen.width);
  defineGetter(S, 'height', C.screen.height);
  defineGetter(S, 'availWidth', C.screen.width);
  defineGetter(S, 'availHeight', availH);
  defineGetter(S, 'availLeft', 0);
  defineGetter(S, 'availTop', 0);
  defineGetter(S, 'colorDepth', C.screen.colorDepth);
  defineGetter(S, 'pixelDepth', C.screen.colorDepth);
  defineGetter(window, 'devicePixelRatio', C.screen.pixelRatio);
  }

  // ---- battery -----------------------------------------------------------
  if (C.batteryMask && N.getBattery) {
    replaceMethod(N, 'getBattery', function () {
      const bm = { charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, onchargingchange: null, onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
      return Promise.resolve(bm);
    });
  }

  // ---- geolocation -------------------------------------------------------
  if (C.geolocationOff && navigator.geolocation) {
    const deny = (onErr) => { if (typeof onErr === 'function') setTimeout(() => onErr({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 30); };
    replaceMethod(Geolocation.prototype, 'getCurrentPosition', function (orig, args) { deny(args[1]); });
    replaceMethod(Geolocation.prototype, 'watchPosition', function (orig, args) { deny(args[1]); return Math.floor(Math.random() * 10000); });
  }

  // ---- media devices -----------------------------------------------------
  if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
    const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(noiseTable[(i * 7 + n) % noiseTable.length] * 16).toString(16); return s; };
    const mkDev = (kind, i) => {
      const d = { deviceId: hex(64), kind, label: '', groupId: hex(64) };
      d.toJSON = () => ({ deviceId: d.deviceId, kind: d.kind, label: d.label, groupId: d.groupId });
      return d;
    };
    replaceMethod(MediaDevices.prototype, 'enumerateDevices', function () {
      const list = [];
      for (let i = 0; i < C.mediaDevices.audioInputs; i++) list.push(mkDev('audioinput', i));
      for (let i = 0; i < C.mediaDevices.videoInputs; i++) list.push(mkDev('videoinput', i));
      for (let i = 0; i < C.mediaDevices.audioOutputs; i++) list.push(mkDev('audiooutput', i));
      return Promise.resolve(list);
    });
  }

  // ---- WebGL -------------------------------------------------------------
  const patchGl = (proto) => {
    if (!proto) return;
    replaceMethod(proto, 'getParameter', function (orig, args) {
      const p = args[0];
      if (C.webgl.mode !== 'real') {
        if (p === 37445) return C.webgl.vendor;
        if (p === 37446) return C.webgl.renderer;
      }
      return orig.apply(this, args);
    });
    if (C.webgl.mode === 'noise') {
      replaceMethod(proto, 'readPixels', function (orig, args) {
        const r = orig.apply(this, args);
        const px = args[6];
        if (px && px.length) {
          const step = Math.max(1, Math.floor(px.length / 64));
          for (let i = 0; i < px.length; i += step) {
            const n = noiseTable[(i / step) % noiseTable.length];
            if (n < 0.5) px[i] = px[i] ^ 1;
          }
        }
        return r;
      });
    }
  };
  if (!C.engineMode) {
    patchGl(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patchGl(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  }

  // ---- Canvas ------------------------------------------------------------
  if (C.engineMode) { /* canvas handled by the engine */ } else if (C.canvas === 'noise') {
    const perturb = (data) => {
      const len = data.length;
      const step = Math.max(4, Math.floor(len / 512) & ~3);
      for (let i = 0, k = 0; i < len; i += step, k++) {
        const n = noiseTable[k % noiseTable.length];
        if (n < 0.33) data[i] = data[i] ^ 1;
        else if (n < 0.66) data[i + 1] = data[i + 1] ^ 1;
        else data[i + 2] = data[i + 2] ^ 1;
      }
    };
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    replaceMethod(CanvasRenderingContext2D.prototype, 'getImageData', function (orig, args) {
      const img = orig.apply(this, args);
      try { perturb(img.data); } catch (e) {}
      return img;
    });
    const noisyClone = (canvas) => {
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.width || !canvas.height) return canvas;
      const clone = document.createElement('canvas');
      clone.width = canvas.width; clone.height = canvas.height;
      const cctx = clone.getContext('2d');
      const img = origGetImageData.call(ctx, 0, 0, canvas.width, canvas.height);
      perturb(img.data);
      cctx.putImageData(img, 0, 0);
      return clone;
    };
    replaceMethod(HTMLCanvasElement.prototype, 'toDataURL', function (orig, args) {
      try { return orig.apply(noisyClone(this), args); } catch (e) { return orig.apply(this, args); }
    });
    replaceMethod(HTMLCanvasElement.prototype, 'toBlob', function (orig, args) {
      try { return orig.apply(noisyClone(this), args); } catch (e) { return orig.apply(this, args); }
    });
  } else if (C.canvas === 'off') {
    replaceMethod(HTMLCanvasElement.prototype, 'toDataURL', function () { return 'data:,'; });
    replaceMethod(CanvasRenderingContext2D.prototype, 'getImageData', function (orig, args) {
      const img = orig.apply(this, args); img.data.fill(0); return img;
    });
  }

  // ---- Audio -------------------------------------------------------------
  if (!C.engineMode && C.audio === 'noise' && window.AudioBuffer) {
    replaceMethod(AudioBuffer.prototype, 'getChannelData', function (orig, args) {
      const d = orig.apply(this, args);
      if (!d.__fb) {
        try {
          Object.defineProperty(d, '__fb', { value: true, enumerable: false });
          const step = Math.max(1, Math.floor(d.length / 256));
          for (let i = 0, k = 0; i < d.length; i += step, k++) d[i] = d[i] + (noiseTable[k % noiseTable.length] - 0.5) * 1e-6;
        } catch (e) {}
      }
      return d;
    });
    if (window.AnalyserNode) {
      replaceMethod(AnalyserNode.prototype, 'getFloatFrequencyData', function (orig, args) {
        const r = orig.apply(this, args);
        const a = args[0];
        if (a) for (let i = 0; i < a.length; i += 8) a[i] = a[i] + (noiseTable[i % noiseTable.length] - 0.5) * 1e-3;
        return r;
      });
    }
  }

  // ---- Client rects ------------------------------------------------------
  if (!C.engineMode && C.clientRects === 'noise') {
    const jitter = (v, i) => v + (noiseTable[(Math.abs(Math.floor(v * 10)) + i) % noiseTable.length] - 0.5) * 1e-4;
    const wrapRect = (r, i) => {
      if (!r) return r;
      const o = { x: jitter(r.x, i), y: jitter(r.y, i + 1), width: jitter(r.width, i + 2), height: jitter(r.height, i + 3) };
      o.top = o.y; o.left = o.x; o.right = o.x + o.width; o.bottom = o.y + o.height;
      o.toJSON = () => ({ x: o.x, y: o.y, width: o.width, height: o.height, top: o.top, right: o.right, bottom: o.bottom, left: o.left });
      return Object.setPrototypeOf(o, DOMRect.prototype);
    };
    replaceMethod(Element.prototype, 'getBoundingClientRect', function (orig, args) { return wrapRect(orig.apply(this, args), 0); });
    replaceMethod(Element.prototype, 'getClientRects', function (orig, args) {
      const list = orig.apply(this, args);
      const arr = Array.from(list).map((r, i) => wrapRect(r, i));
      arr.item = (i) => arr[i] || null;
      return arr;
    });
  }

  // ---- Fonts -------------------------------------------------------------
  if (!C.engineMode && C.fonts === 'mask' && document.fonts && document.fonts.check) {
    const allow = {
      windows: ['Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Microsoft Sans Serif', 'MS Gothic', 'MV Boli', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Symbol', 'SimSun', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic'],
      macos: ['American Typewriter', 'Andale Mono', 'Arial', 'Arial Black', 'Avenir', 'Avenir Next', 'Baskerville', 'Chalkboard', 'Cochin', 'Comic Sans MS', 'Courier', 'Courier New', 'Didot', 'Futura', 'Geneva', 'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Hoefler Text', 'Impact', 'Lucida Grande', 'Menlo', 'Monaco', 'Optima', 'Palatino', 'Papyrus', 'Skia', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Zapfino'],
      linux: ['DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif', 'Noto Sans', 'Noto Serif', 'Ubuntu', 'Ubuntu Mono', 'Cantarell', 'Droid Sans'],
      android: ['Roboto', 'Noto Sans', 'Noto Serif', 'Droid Sans', 'Droid Sans Mono', 'sans-serif', 'serif', 'monospace']
    }[C.os] || [];
    const allowSet = new Set(allow.map((f) => f.toLowerCase()));
    replaceMethod(FontFaceSet.prototype, 'check', function (orig, args) {
      const font = String(args[0] || '');
      const fam = font.split(/\\d+(?:px|pt|em|%)\\s+/).pop() || '';
      const families = fam.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
      const generic = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
      if (families.length && families.every((f) => !generic.includes(f) && !allowSet.has(f))) return false;
      return orig.apply(this, args);
    });
  }

  // ---- WebRTC ------------------------------------------------------------
  if (C.webrtc === 'disabled') {
    for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate']) {
      try { Object.defineProperty(window, k, { value: undefined, writable: true, configurable: true }); } catch (e) {}
    }
    try { if (navigator.mediaDevices) replaceMethod(MediaDevices.prototype, 'getUserMedia', function () { return Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); }); } catch (e) {}
  } else if (C.webrtc === 'altered' && window.RTCPeerConnection) {
    const isPrivate = (ip) => /^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.|127\\.|169\\.254\\.|fe80:|fc|fd|::1)/i.test(ip) || /\\.local$/i.test(ip);
    const allowed = (cand) => {
      const s = String(cand || '');
      const m = s.match(/candidate:\\S+ \\d+ \\S+ \\d+ (\\S+) \\d+ typ (\\S+)/i);
      if (!m) return true;
      const addr = m[1], typ = m[2];
      if (typ === 'relay') return true;
      if (C.publicIp && addr === C.publicIp) return true;
      if (isPrivate(addr)) return false;
      return !!C.publicIp ? false : typ !== 'srflx';
    };
    const Orig = window.RTCPeerConnection;
    const Patched = function RTCPeerConnection(config, constraints) {
      const pc = new Orig(config, constraints);
      const origAdd = pc.addEventListener.bind(pc);
      pc.addEventListener = function (type, listener, opts) {
        if (type === 'icecandidate' && typeof listener === 'function') {
          const wrapped = function (ev) { if (!ev.candidate || allowed(ev.candidate.candidate)) return listener.call(this, ev); };
          return origAdd(type, wrapped, opts);
        }
        return origAdd(type, listener, opts);
      };
      let handler = null;
      Object.defineProperty(pc, 'onicecandidate', {
        get() { return handler; },
        set(fn) { handler = fn; origAdd('icecandidate', (ev) => { if (fn && (!ev.candidate || allowed(ev.candidate.candidate))) fn.call(pc, ev); }); },
        configurable: true
      });
      return pc;
    };
    Patched.prototype = Orig.prototype;
    for (const k of Object.getOwnPropertyNames(Orig)) { try { if (!(k in Patched)) Patched[k] = Orig[k]; } catch (e) {} }
    markNative(Patched, 'RTCPeerConnection');
    try { Object.defineProperty(window, 'RTCPeerConnection', { value: Patched, writable: true, configurable: true }); } catch (e) {}
    try { Object.defineProperty(window, 'webkitRTCPeerConnection', { value: Patched, writable: true, configurable: true }); } catch (e) {}
  }
})();`
}
