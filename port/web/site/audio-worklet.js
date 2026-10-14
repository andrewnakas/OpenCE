/*
AUDIO-WORKLET.JS

Plays the game's sound: the mixer (port/linux/src/dsound_sdl.c, through
port/web/src/web_sdl.c) writes interleaved stereo float frames at 48 kHz
into a ring in the WebAssembly memory, which is a SharedArrayBuffer, and
this processor reads them at the audio context's rate.
*/

'use strict';

class HaloAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { buffer, ring, ringFrames, write, read, underruns, rate, record } = options.processorOptions;
    // ?record=SECONDS (checks): what is played goes back to the page as well
    this.record = record ? new Float32Array(Math.round(record * sampleRate) * 2) : null;
    this.recorded = 0;
    this.ring = new Float32Array(buffer, ring, ringFrames * 2);
    this.words = new Int32Array(buffer);
    this.ringMask = ringFrames - 1;
    this.writeIndex = write >> 2;
    this.readIndex = read >> 2;
    this.underrunIndex = underruns >> 2;
    // source frames per output frame
    this.step = rate / sampleRate;
    this.position = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.volume !== undefined) this.volume = event.data.volume;
    };
    this.volume = 1;
    // After running dry the ring must refill this far before playing again, so a late mixer
    // gives one short soft gap instead of a click every few milliseconds.
    this.resumeFrames = 2048;
    this.starved = true;
    this.lastLeft = 0;
    this.lastRight = 0;
    this.fadeIn = false;
  }

  keep(left, right, frames) {
    if (!this.record || this.recorded * 2 >= this.record.length) return;
    for (let i = 0; i < frames && this.recorded * 2 < this.record.length; i++, this.recorded++) {
      this.record[this.recorded * 2] = left[i];
      this.record[this.recorded * 2 + 1] = right[i];
    }
    if (this.recorded * 2 >= this.record.length) this.port.postMessage({ recording: this.record, rate: sampleRate });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || output[0];
    const frames = left.length;
    const write = Atomics.load(this.words, this.writeIndex);
    let read = Atomics.load(this.words, this.readIndex);
    const needed = Math.ceil(this.position + frames * this.step);
    const queued = write - read;

    if (queued < needed || (this.starved && queued < this.resumeFrames)) {
      // not enough: fade the last sample out (no click), then wait for the ring to refill
      for (let i = 0; i < frames; i++) {
        const fade = 1 - (i + 1) / frames;
        left[i] = this.lastLeft * fade;
        if (right !== left) right[i] = this.lastRight * fade;
      }
      this.lastLeft = 0;
      this.lastRight = 0;
      this.keep(left, right, frames);
      if (!this.starved) Atomics.add(this.words, this.underrunIndex, 1);
      this.starved = true;
      return true;
    }
    if (this.starved) {
      this.starved = false;
      this.fadeIn = true;
    }
    const ring = this.ring;
    const mask = this.ringMask;
    const volume = this.volume;
    if (this.step === 1) {
      for (let i = 0; i < frames; i++) {
        const slot = ((read + i) & mask) * 2;
        left[i] = ring[slot] * volume;
        right[i] = ring[slot + 1] * volume;
      }
      read += frames;
    } else {
      // linear interpolation when the device does not run at 48 kHz
      let position = this.position;
      for (let i = 0; i < frames; i++) {
        const whole = Math.floor(position);
        const fraction = position - whole;
        const a = ((read + whole) & mask) * 2;
        const b = ((read + whole + 1) & mask) * 2;
        left[i] = (ring[a] + (ring[b] - ring[a]) * fraction) * volume;
        right[i] = (ring[a + 1] + (ring[b + 1] - ring[a + 1]) * fraction) * volume;
        position += this.step;
      }
      const consumed = Math.floor(position);
      read += consumed;
      this.position = position - consumed;
    }
    if (this.fadeIn) {
      this.fadeIn = false;
      for (let i = 0; i < frames; i++) {
        const fade = (i + 1) / frames;
        left[i] *= fade;
        if (right !== left) right[i] *= fade;
      }
    }
    this.keep(left, right, frames);
    this.lastLeft = left[frames - 1];
    this.lastRight = right[frames - 1];
    Atomics.store(this.words, this.readIndex, read);
    return true;
  }
}

registerProcessor('halo-audio', HaloAudioProcessor);
