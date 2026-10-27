import type { Fingerprint } from '@shared/types'

export interface ScriptContext {
  publicIp?: string
}

// The FacetBrowser Engine produces canvas, WebGL, audio, font, GPU, CPU and
// user-agent values in C++. This script only covers what the engine leaves to
// the host: the deviceMemory cap, WebRTC candidate filtering, media device
// counts, battery and geolocation denial.
export function buildFingerprintScript(fp: Fingerprint, ctx: ScriptContext = {}): string {
  const cfg = JSON.stringify({
    deviceMemory: Math.min(8, fp.deviceMemory),
    webrtc: fp.webrtc,
    mediaDevices: fp.mediaDevices,
    batteryMask: fp.batteryMask,
    doNotTrack: fp.doNotTrack,
    geolocationOff: fp.geolocation.mode === 'off',
    publicIp: ctx.publicIp || null,
    seed: fp.seed
  })

  return `(() => {
  if (window.__fb_injected) return;
  try { Object.defineProperty(window, '__fb_injected', { value: true, enumerable: false, configurable: false }); } catch (e) {}
  const C = ${cfg};

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

  const N = Navigator.prototype;
  // Real Chrome never reports more than 8 GB; the engine passes raw memory through.
  defineGetter(N, 'deviceMemory', C.deviceMemory);
  if (C.doNotTrack !== null) defineGetter(N, 'doNotTrack', C.doNotTrack ? '1' : null);

  if (C.batteryMask && N.getBattery) {
    replaceMethod(N, 'getBattery', function () {
      const bm = { charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, onchargingchange: null, onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
      return Promise.resolve(bm);
    });
  }

  if (C.geolocationOff && navigator.geolocation) {
    const deny = (onErr) => { if (typeof onErr === 'function') setTimeout(() => onErr({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 30); };
    replaceMethod(Geolocation.prototype, 'getCurrentPosition', function (orig, args) { deny(args[1]); });
    replaceMethod(Geolocation.prototype, 'watchPosition', function (orig, args) { deny(args[1]); return Math.floor(Math.random() * 10000); });
  }

  if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
    const mk = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const rnd = mk(C.seed);
    const hex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16); return s; };
    const devices = [];
    const mkDev = (kind) => { const d = { deviceId: hex(64), kind, label: '', groupId: hex(64) }; d.toJSON = () => ({ deviceId: d.deviceId, kind: d.kind, label: d.label, groupId: d.groupId }); return d; };
    for (let i = 0; i < C.mediaDevices.audioInputs; i++) devices.push(mkDev('audioinput'));
    for (let i = 0; i < C.mediaDevices.videoInputs; i++) devices.push(mkDev('videoinput'));
    for (let i = 0; i < C.mediaDevices.audioOutputs; i++) devices.push(mkDev('audiooutput'));
    replaceMethod(MediaDevices.prototype, 'enumerateDevices', function () { return Promise.resolve(devices.slice()); });
  }

  if (C.webrtc === 'disabled') {
    for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate']) {
      try { Object.defineProperty(window, k, { value: undefined, writable: true, configurable: true }); } catch (e) {}
    }
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
