import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SpeechService {
  private recognition: any = null;
  private wordCount = 0;
  private lastWordCount = 0;
  private startTime: number | null = null;
  private silentGaps = 0;
  private lastSpeechTime = Date.now();
  private isRunning = false;
  private currentTranscript = '';
  private interimTranscript = '';

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
      this.interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          const words = transcript.trim().split(/\s+/).filter((w: string) => w.length > 0);
          this.wordCount += words.length;
          this.currentTranscript += transcript + ' ';
          this.lastSpeechTime = Date.now();
        } else {
          this.interimTranscript += transcript;
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
      if (this.isRunning) {
        this.restart();
      }
    };
  }

  start() {
    if (!this.recognition) return;
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
    try { this.recognition.stop(); } catch (err) { }
    setTimeout(() => {
      if (this.isRunning) {
        try { this.recognition.start(); } catch (err) { }
      }
    }, 100);
  }

  stop() {
    this.isRunning = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch (err) { }
    }
  }

  getLiveTranscript() {
    return (this.currentTranscript + ' ' + this.interimTranscript).trim();
  }

  popTranscript() {
    const t = this.currentTranscript.trim();
    this.currentTranscript = '';
    this.interimTranscript = '';
    return t;
  }

  getFluencyMetrics() {
    const now = Date.now();
    const elapsedMinutes = (this.startTime ? (now - this.startTime) : 0) / 60000;
    if (now - this.lastSpeechTime > 3000) {
      // Logic for hesitations could be more complex, keeping it simple
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
    this.currentTranscript = '';
    this.lastSpeechTime = Date.now();
    this.startTime = Date.now();
  }
}