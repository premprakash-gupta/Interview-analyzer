import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Question } from '../models/questions.const';

export interface RoundResult {
  question: string;
  transcript: string;
  score: any;
  duration: number;
}

@Injectable({
  providedIn: 'root'
})
export class SessionService {
  isActive = false;
  interviewType: string | null = null;
  currentQuestionIndex = 0;
  questions: Question[] = [];
  startTime: number | null = null;
  totalElapsedSeconds = 0;
  private timerInterval: any = null;

  private timerSubject = new BehaviorSubject<string>('00:00');
  timer$ = this.timerSubject.asObservable();

  // Current round data (resets per question)
  roundData = {
    totalBlinks: 0,
    expressionScores: [] as number[],
    totalWords: 0,
    totalHesitations: 0,
    headStabilityFrames: { stable: 0, unstable: 0 },
    volumeSamples: [] as number[],
    elapsedSeconds: 0
  };

  // Final session data
  allRoundResults: RoundResult[] = [];

  constructor() { }

  startSession(interviewType: string, questions: Question[]) {
    this.isActive = true;
    this.interviewType = interviewType;
    this.questions = questions;
    this.currentQuestionIndex = 0;
    this.startTime = Date.now();
    this.totalElapsedSeconds = 0;
    this.allRoundResults = [];
    this.resetRoundData();

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.totalElapsedSeconds++;
      this.roundData.elapsedSeconds++;
      this.updateTimerDisplay();
    }, 1000);
  }

  resetRoundData() {
    this.roundData = {
      totalBlinks: 0,
      expressionScores: [],
      totalWords: 0,
      totalHesitations: 0,
      headStabilityFrames: { stable: 0, unstable: 0 },
      volumeSamples: [],
      elapsedSeconds: 0
    };
  }

  stopSession() {
    this.isActive = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private updateTimerDisplay() {
    const minutes = Math.floor(this.totalElapsedSeconds / 60);
    const seconds = this.totalElapsedSeconds % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    this.timerSubject.next(timeStr);
  }

  saveRound(transcript: string) {
    const score = this.calculateRoundScore();
    this.allRoundResults.push({
      question: this.questions[this.currentQuestionIndex].text,
      transcript: transcript,
      score: score,
      duration: this.roundData.elapsedSeconds
    });
  }

  nextQuestion() {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.currentQuestionIndex++;
      this.resetRoundData();
      return true;
    }
    return false;
  }

  skipQuestion() {
    this.allRoundResults.push({
      question: this.questions[this.currentQuestionIndex].text,
      transcript: '',
      score: null,
      duration: 0
    });
    return this.nextQuestion();
  }

  getCurrentQuestion() {
    return this.questions[this.currentQuestionIndex];
  }

  recordMetrics(visualData: any, vocalData: any, fluencyData: any) {
    if (!this.isActive) return;

    if (visualData.faceDetected) {
      if (visualData.expression && visualData.expression.score !== undefined) {
        this.roundData.expressionScores.push(visualData.expression.score);
      }
      if (visualData.ocular && visualData.ocular.blinkCount > this.roundData.totalBlinks) {
        this.roundData.totalBlinks = visualData.ocular.blinkCount;
      }
      if (visualData.pose && visualData.pose.isStable !== undefined) {
        if (visualData.pose.isStable) {
          this.roundData.headStabilityFrames.stable++;
        } else {
          this.roundData.headStabilityFrames.unstable++;
        }
      }
    }
    if (vocalData && vocalData.volume !== undefined) {
      this.roundData.volumeSamples.push(vocalData.volume);
    }
    if (fluencyData) {
      this.roundData.totalWords = fluencyData.wordCount;
      this.roundData.totalHesitations = fluencyData.hesitations;
    }
  }

  calculateRoundScore() {
    // Prevent wild fluctuations in the first 2 seconds of a round
    if (this.roundData.elapsedSeconds < 2) {
      return {
        final: 75,
        breakdown: { ocular: 75, pose: 75, vocal: 75, fluency: 75, expression: 75 },
        stats: { timeSeconds: this.roundData.elapsedSeconds, blinkRate: '0.0', wpm: 0, stabilityPercent: '100.0', avgVolume: 0 }
      };
    }

    const timeInMinutes = Math.max(0.05, this.roundData.elapsedSeconds / 60); // Min 3 seconds for math stability
    let expressionScore = 75;
    if (this.roundData.expressionScores.length > 0) {
      expressionScore = (this.roundData.expressionScores.reduce((a, b) => a + b, 0) / this.roundData.expressionScores.length) * 100;
    }
    const blinkRate = this.roundData.totalBlinks / timeInMinutes;
    let ocularScore = blinkRate > 25 ? 60 : (blinkRate > 20 ? 70 : (blinkRate > 15 ? 80 : (blinkRate > 8 ? 90 : 100)));
    const totalPoseFrames = this.roundData.headStabilityFrames.stable + this.roundData.headStabilityFrames.unstable;
    const stabilityPercentage = totalPoseFrames > 0 ? (this.roundData.headStabilityFrames.stable / totalPoseFrames) * 100 : 75;
    const poseScore = stabilityPercentage > 70 ? 100 : stabilityPercentage;
    let vocalScore = 0;
    if (this.roundData.volumeSamples.length > 0) {
      const avgVolume = this.roundData.volumeSamples.reduce((a, b) => a + b, 0) / this.roundData.volumeSamples.length;
      vocalScore = (avgVolume > 15 && avgVolume < 80) ? 100 : 50;
    }
    const wpm = this.roundData.totalWords / timeInMinutes;
    const hesitationRate = this.roundData.totalHesitations / timeInMinutes;
    let fluencyScore = (wpm >= 120 && wpm <= 160 && hesitationRate < 3) ? 100 : (wpm > 0 && wpm < 100 ? 60 : (wpm > 180 ? 70 : 50));
    const finalScore = (ocularScore * 0.20) + (poseScore * 0.15) + (vocalScore * 0.25) + (fluencyScore * 0.20) + (expressionScore * 0.20);
    return {
      final: Math.round(finalScore),
      breakdown: { ocular: Math.round(ocularScore), pose: Math.round(poseScore), vocal: Math.round(vocalScore), fluency: Math.round(fluencyScore), expression: Math.round(expressionScore) },
      stats: { timeSeconds: this.roundData.elapsedSeconds, blinkRate: blinkRate.toFixed(1), wpm: Math.round(wpm), stabilityPercent: stabilityPercentage.toFixed(1), avgVolume: this.roundData.volumeSamples.length > 0 ? Math.round(this.roundData.volumeSamples.reduce((a, b) => a + b, 0) / this.roundData.volumeSamples.length) : 0 }
    };
  }

  getSessionSummary() {
    const validRounds = this.allRoundResults.filter(r => r.score !== null);
    const count = validRounds.length;

    const avgFinal = count > 0 ? Math.round(validRounds.reduce((acc, r) => acc + r.score.final, 0) / count) : 0;

    const averageBreakdown = {
      expression: count > 0 ? Math.round(validRounds.reduce((acc, r) => acc + r.score.breakdown.expression, 0) / count) : 0,
      ocular: count > 0 ? Math.round(validRounds.reduce((acc, r) => acc + r.score.breakdown.ocular, 0) / count) : 0,
      pose: count > 0 ? Math.round(validRounds.reduce((acc, r) => acc + r.score.breakdown.pose, 0) / count) : 0,
      vocal: count > 0 ? Math.round(validRounds.reduce((acc, r) => acc + r.score.breakdown.vocal, 0) / count) : 0,
      fluency: count > 0 ? Math.round(validRounds.reduce((acc, r) => acc + r.score.breakdown.fluency, 0) / count) : 0,
    };

    const averageStats = {
      blinkRate: count > 0 ? (validRounds.reduce((acc, r) => acc + parseFloat(r.score.stats.blinkRate), 0) / count).toFixed(1) : '0.0',
      wpm: count > 0 ? Math.round(validRounds.reduce((acc, r) => acc + r.score.stats.wpm, 0) / count) : 0,
      stabilityPercent: count > 0 ? (validRounds.reduce((acc, r) => acc + parseFloat(r.score.stats.stabilityPercent), 0) / count).toFixed(1) : '0.0',
      avgVolume: count > 0 ? Math.round(validRounds.reduce((acc, r) => acc + r.score.stats.avgVolume, 0) / count) : 0,
    };

    return {
      interviewType: this.interviewType,
      totalTime: this.totalElapsedSeconds,
      questionsCompleted: count,
      averageScore: avgFinal,
      averageBreakdown,
      averageStats,
      rounds: this.allRoundResults
    };
  }
}
