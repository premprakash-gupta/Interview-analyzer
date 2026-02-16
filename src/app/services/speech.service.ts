import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SpeechService {
  private recognition: any = null;
  private wordCount = 0;
  private startTime: number | null = null;
  private silentGaps = 0;
  private lastSpeechTime = Date.now();
  private isRunning = false;

  constructor() {
    this.setupRecognition();
  }

  private setupRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('Speech recognition not supported');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const transcript = result[0].transcript.trim();
          if (transcript) {
            const words = transcript.split(/\s+/).filter((w: string) => w.length > 0).length;
            this.wordCount += words;
            this.lastSpeechTime = Date.now();
            console.log(`Speech detected: "${transcript}" (${words} words, total: ${this.wordCount})`);
          }
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        this.restart();
      } else if (event.error === 'aborted' || event.error === 'network') {
        setTimeout(() => this.restart(), 1000);
      }
    };

    this.recognition.onend = () => {
      console.log('Speech recognition ended, restarting...');
      if (this.isRunning) {
        this.restart();
      }
    };
  }

  start() {
    if (!this.recognition) {
      return;
    }

    this.startTime = Date.now();
    this.isRunning = true;

    try {
      this.recognition.start();
    } catch (err) {
      if (err.name === 'InvalidStateError') {
        this.recognition.stop();
        setTimeout(() => this.recognition.start(), 100);
      }
    }
  }

  restart() {
    if (!this.isRunning) return;

    try {
      this.recognition.stop();
    } catch (err) { }

    setTimeout(() => {
      if (this.isRunning) {
        try {
          this.recognition.start();
        } catch (err) {
          console.error('Failed to restart speech recognition:', err);
        }
      }
    }, 100);
  }

  stop() {
    this.isRunning = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (err) { }
    }
  }

  getFluencyMetrics() {
    const now = Date.now();
    const elapsedMinutes = (this.startTime ? (now - this.startTime) : 0) / 60000;

    if (now - this.lastSpeechTime > 3000) {
      this.silentGaps++;
      this.lastSpeechTime = now;
    }

    const wpm = elapsedMinutes > 0 ? (this.wordCount / elapsedMinutes) : 0;

    return {
      wpm: Math.round(wpm),
      hesitations: this.silentGaps,
      wordCount: this.wordCount,
      status: wpm > 160 ? "Too Fast" : (wpm < 100 && wpm > 0 ? "Too Slow" : wpm === 0 ? "Silent" : "Perfect Pace")
    };
  }

  reset() {
    this.wordCount = 0;
    this.silentGaps = 0;
    this.lastSpeechTime = Date.now();
    this.startTime = Date.now();
  }
}
