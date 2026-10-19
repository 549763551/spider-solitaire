/*!
 * Spider Solitaire — tiny WebAudio sound effects (no assets, no dependencies)
 * MIT License
 */
(function (root) {
  'use strict';

  var ctx = null;
  var enabled = true;

  function audio() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        var Ctor = root.AudioContext || root.webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (err) {
      return null;
    }
  }

  function tone(opts) {
    var ac = audio();
    if (!ac) return;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    var now = ac.currentTime + (opts.delay || 0);
    var dur = opts.duration || 0.09;
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), now + dur);
    var peak = opts.gain == null ? 0.05 : opts.gain;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function sweep(notes, opts) {
    var base = opts || {};
    notes.forEach(function (freq, i) {
      tone({
        freq: freq,
        duration: base.duration || 0.12,
        delay: i * (base.gap || 0.06),
        type: base.type || 'triangle',
        gain: base.gain || 0.045
      });
    });
  }

  var SFX = {
    setEnabled: function (value) {
      enabled = !!value;
      if (!enabled && ctx && ctx.state === 'running') ctx.suspend();
      if (enabled && ctx && ctx.state === 'suspended') ctx.resume();
    },
    isEnabled: function () { return enabled; },

    play: function (name) {
      if (!enabled) return;
      switch (name) {
        case 'pick':
          tone({ freq: 620, duration: 0.06, type: 'sine', gain: 0.035 });
          break;
        case 'place':
          tone({ freq: 190, to: 130, duration: 0.11, type: 'sine', gain: 0.06 });
          break;
        case 'flip':
          tone({ freq: 880, to: 1180, duration: 0.07, type: 'triangle', gain: 0.028 });
          break;
        case 'deal':
          sweep([392, 494, 587], { gap: 0.05, duration: 0.09, gain: 0.03 });
          break;
        case 'complete':
          sweep([523, 659, 784, 1046], { gap: 0.075, duration: 0.16, type: 'sine', gain: 0.05 });
          break;
        case 'win':
          sweep([523, 659, 784, 1046, 1318, 1568], { gap: 0.11, duration: 0.32, type: 'triangle', gain: 0.05 });
          break;
        case 'error':
          tone({ freq: 150, to: 110, duration: 0.16, type: 'sawtooth', gain: 0.028 });
          break;
        case 'undo':
          tone({ freq: 420, to: 300, duration: 0.12, type: 'triangle', gain: 0.035 });
          break;
        case 'hint':
          tone({ freq: 1046, duration: 0.09, type: 'sine', gain: 0.03 });
          tone({ freq: 1318, duration: 0.12, type: 'sine', gain: 0.025, delay: 0.08 });
          break;
      }
    }
  };

  root.SFX = SFX;
})(typeof window !== 'undefined' ? window : globalThis);
