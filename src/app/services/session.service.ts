import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SessionService {
  isActive = false;
  interviewType: string | null = null;
  currentQuestionIndex = 0;
  questions: string[] = [];
  startTime: number | null = null;
  totalElapsedSeconds = 0;
  private timerInterval: any = null;

  private timerSubject = new BehaviorSubject<string>('00:00');
  timer$ = this.timerSubject.asObservable();

  sessionData = {
    totalBlinks: 0,
    expressionScores: [] as number[],
    totalWords: 0,
    totalHesitations: 0,
    headStabilityFrames: { stable: 0, unstable: 0 },
    volumeSamples: [] as number[],
    questionMetrics: [] as any[]
  };

  constructor() { }

  startSession(interviewType: string, questions: string[]) {
    this.isActive = true;
    this.interviewType = interviewType;
    this.questions = questions;
    this.currentQuestionIndex = 0;
    this.startTime = Date.now();
    this.totalElapsedSeconds = 0;

    this.sessionData = {
      totalBlinks: 0,
      expressionScores: [],
      totalWords: 0,
      totalHesitations: 0,
      headStabilityFrames: { stable: 0, unstable: 0 },
      volumeSamples: [],
      questionMetrics: []
    };

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.totalElapsedSeconds++;
      this.updateTimerDisplay();
    }, 1000);
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

  nextQuestion() {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.currentQuestionIndex++;
      return true;
    }
    return false;
  }

  skipQuestion() {
    return this.nextQuestion();
  }

  getCurrentQuestion() {
    return this.questions[this.currentQuestionIndex];
  }

  recordMetrics(visualData: any, vocalData: any, fluencyData: any) {
    if (!this.isActive) return;

    if (visualData.faceDetected) {
      if (visualData.expression && visualData.expression.score !== undefined) {
        this.sessionData.expressionScores.push(visualData.expression.score);
      }

      if (visualData.ocular && visualData.ocular.blinkCount > this.sessionData.totalBlinks) {
        this.sessionData.totalBlinks = visualData.ocular.blinkCount;
      }

      if (visualData.pose && visualData.pose.isStable !== undefined) {
        if (visualData.pose.isStable) {
          this.sessionData.headStabilityFrames.stable++;
        } else {
          this.sessionData.headStabilityFrames.unstable++;
        }
      }
    }

    if (vocalData && vocalData.volume !== undefined) {
      this.sessionData.volumeSamples.push(vocalData.volume);
    }

    if (fluencyData) {
      if (fluencyData.wordCount > this.sessionData.totalWords) {
        this.sessionData.totalWords = fluencyData.wordCount;
      }
      if (fluencyData.hesitations > this.sessionData.totalHesitations) {
        this.sessionData.totalHesitations = fluencyData.hesitations;
      }
    }
  }

  calculateFinalScore() {
    if (!this.isActive && this.totalElapsedSeconds === 0) {
      return { final: 0, breakdown: {}, stats: {} };
    }

    const timeInMinutes = this.totalElapsedSeconds / 60 || 0.01;

    let expressionScore = 75;
    if (this.sessionData.expressionScores.length > 0) {
      const avgExpressionScore = this.sessionData.expressionScores.reduce((a, b) => a + b, 0) /
        this.sessionData.expressionScores.length;
      expressionScore = avgExpressionScore * 100;
    }

    const blinkRate = this.sessionData.totalBlinks / timeInMinutes;
    let ocularScore = 0;
    if (blinkRate > 25) ocularScore = 60;
    else if(blinkRate >20) ocularScore = 70;
    else if(blinkRate >15) ocularScore = 80;
    else if(blinkRate >8) ocularScore = 90;
    else ocularScore = 100;

    const totalPoseFrames = this.sessionData.headStabilityFrames.stable +
      this.sessionData.headStabilityFrames.unstable;
    const stabilityPercentage = totalPoseFrames > 0 ?
      (this.sessionData.headStabilityFrames.stable / totalPoseFrames) * 100 : 75;
    const poseScore = stabilityPercentage > 70 ? 100 : stabilityPercentage;

    let vocalScore = 0;
    if (this.sessionData.volumeSamples.length > 0) {
      const avgVolume = this.sessionData.volumeSamples.reduce((a, b) => a + b, 0) /
        this.sessionData.volumeSamples.length;
      vocalScore = (avgVolume > 15 && avgVolume < 80) ? 100 : 50;
    }

    const wpm = this.sessionData.totalWords / timeInMinutes;
    const hesitationRate = this.sessionData.totalHesitations / timeInMinutes;

    let fluencyScore = 0;
    if (wpm >= 120 && wpm <= 160 && hesitationRate < 3) {
      fluencyScore = 100;
    } else if (wpm > 0 && wpm < 100) {
      fluencyScore = 60;
    } else if (wpm > 180) {
      fluencyScore = 70;
    } else {
      fluencyScore = 50;
    }

    const finalScore = (
      (ocularScore * 0.20) +
      (poseScore * 0.15) +
      (vocalScore * 0.25) +
      (fluencyScore * 0.20) +
      (expressionScore * 0.20)
    );

    return {
      final: Math.round(finalScore),
      breakdown: {
        ocular: Math.round(ocularScore),
        pose: Math.round(poseScore),
        vocal: Math.round(vocalScore),
        fluency: Math.round(fluencyScore),
        expression: Math.round(expressionScore)
      },
      stats: {
        timeMinutes: timeInMinutes.toFixed(2),
        blinkRate: blinkRate.toFixed(1),
        wpm: Math.round(wpm),
        stabilityPercent: stabilityPercentage.toFixed(1),
        avgVolume: this.sessionData.volumeSamples.length > 0 ?
          Math.round(this.sessionData.volumeSamples.reduce((a, b) => a + b, 0) /
            this.sessionData.volumeSamples.length) : 0
      }
    };
  }

  getSessionSummary() {
    const score = this.calculateFinalScore();
    return {
      interviewType: this.interviewType,
      totalTime: this.totalElapsedSeconds,
      questionsCompleted: this.currentQuestionIndex + 1,
      score: score,
      rawData: this.sessionData
    };
  }
}
