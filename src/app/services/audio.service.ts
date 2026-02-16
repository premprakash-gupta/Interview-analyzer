import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private audioContext: AudioContext;
  private analyser: AnalyserNode;
  private dataArray: Float32Array;
  private isListening = false;

  constructor() {
    this.audioContext = new (window['AudioContext'] || window['webkitAudioContext'])();
    this.analyser = this.audioContext.createAnalyser();
    this.dataArray = new Float32Array(this.analyser.fftSize);
  }

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.analyser);
      this.isListening = true;

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    } catch (err) {
      console.error('Mic access denied:', err);
      throw err;
    }
  }

  getVocalMetrics() {
    if (!this.isListening) return { volume: 0, status: 'Off' };

    this.analyser.getFloatTimeDomainData(this.dataArray as any);

    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i] * this.dataArray[i];
    }
    const rms = Math.sqrt(sum / this.dataArray.length);
    const volume = Math.min(rms * 500, 100);

    return {
      volume: Math.round(volume),
      status: volume > 30 ? 'Speaking' : (volume > 10 ? 'Low' : 'Quiet')
    };
  }

  get volume() {
    return this.audioContext;
  }
}
