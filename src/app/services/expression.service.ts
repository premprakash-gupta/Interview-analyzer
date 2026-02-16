import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ExpressionService {
  currentMood = "Neutral";
  faceApiReady = false;
  private lastFaceApiTs = 0;
  private minIntervalMs = 200;
  private smoothedScore = 0.50;
  private lastResult = {
    mood: this.currentMood,
    smileScore: 0,
    confusionScore: 0,
    score: 0.75
  };

  constructor() { }

  async initFaceApi(modelUrl: string) {
    const faceapi = (window as any).faceapi;
    if (!faceapi) {
      console.warn("faceapi not available; expression detection will use blendshapes.");
      return false;
    }

    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
      await faceapi.nets.faceExpressionNet.loadFromUri(modelUrl);
      this.faceApiReady = true;
      return true;
    } catch (err) {
      console.error("Failed to load face-api models:", err);
      return false;
    }
  }

  analyzeFaceApiExpressions(expressions: any) {
    if (!expressions) {
      this.currentMood = "Neutral";
      return {
        mood: this.currentMood,
        smileScore: 0,
        confusionScore: 0,
        score: 0.75
      };
    }

    const scores = { ...expressions };
    let bestLabel = "neutral";
    let bestVal = 0;

    for (const key of Object.keys(scores)) {
      if (scores[key] > bestVal) {
        bestVal = scores[key];
        bestLabel = key;
      }
    }

    let numericScore = 0.75;
    if (bestLabel === "happy") {
      this.currentMood = "Confident/Positive";
      numericScore = 0.9 + (scores.happy * 0.1);
    } else if (bestLabel === "surprised") {
      this.currentMood = "Confused/Thinking";
      numericScore = 0.6 + (scores.surprised * 0.1);
    } else if (bestLabel === "angry" || bestLabel === "sad" || bestLabel === "fearful" || bestLabel === "disgusted") {
      this.currentMood = "Anxious/Tense";
      numericScore = 0.4 + (bestVal * 0.2);
    } else {
      this.currentMood = "Neutral";
      numericScore = 0.75;
    }

    return {
      mood: this.currentMood,
      smileScore: scores.happy || 0,
      confusionScore: scores.surprised || 0,
      score: numericScore,
      dominant: bestLabel
    };
  }

  async analyzeFromVideo(video: HTMLVideoElement) {
    const faceapi = (window as any).faceapi;
    if (!this.faceApiReady || !faceapi || !video) return this.lastResult;

    const now = performance.now();
    if (now - this.lastFaceApiTs < this.minIntervalMs) return this.lastResult;
    this.lastFaceApiTs = now;

    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
      const detections = await faceapi
        .detectAllFaces(video, options)
        .withFaceExpressions();

      if (!detections || detections.length === 0) {
        this.lastResult = {
          mood: "Neutral",
          smileScore: 0,
          confusionScore: 0,
          score: 0.75
        };
        return this.lastResult;
      }

      const expressions = detections[0].expressions;
      this.lastResult = this.analyzeFaceApiExpressions(expressions);
      return this.lastResult;
    } catch (err) {
      console.error("face-api expression detection failed:", err);
      return this.lastResult;
    }
  }

  analyze(blendshapes: any[]) {
    const getS = (name: string) => blendshapes.find(b => b.categoryName === name)?.score || 0;

    // 1. Grouped Markers
    // --- Confidence ---
    const smile = (getS('mouthSmileLeft') + getS('mouthSmileRight')) / 2;

    // --- Tension & Stress ---
    const mouthPucker = getS('mouthPucker'); // Pursing lips in stress
    const jawOpen = getS('jawOpen'); // Dropping jaw in shock
    const mouthPress = (getS('mouthPressLeft') + getS('mouthPressRight')) / 2; // Tense lips

    // --- Focus & Thinking ---
    const browDown = (getS('browDownLeft') + getS('browDownRight')) / 2; // Concentration
    const browInnerUp = getS('browInnerUp'); // Worry or surprise

    // --- Ocular Engagement ---
    const eyesWide = (getS('eyeWideLeft') + getS('eyeWideRight')) / 2; // Shock/Alertness

    // 2. Advanced Dynamic Scoring
    let rawScore = 0.70; // Start at a "Good" baseline

    // POSITIVE: Confidence Bonus
    rawScore += (smile * 0.35);

    // NEGATIVE: Stress Penalties
    rawScore -= (mouthPucker * 0.25);
    rawScore -= (mouthPress * 0.20);
    rawScore -= (browInnerUp * 0.15); // Too much brow movement can indicate panic

    // ATTENTION: Shock / Lack of Focus
    if (eyesWide > 0.4) rawScore -= 0.1; // Sudden shock penalty
    if (jawOpen > 0.3) rawScore -= 0.15; // "Gasping" shock penalty

    rawScore = Math.max(0, Math.min(1, rawScore));

    // 3. Smoothing (EMA)
    const weight = 0.15;
    this.smoothedScore = (this.smoothedScore * (1 - weight)) + (rawScore * weight);

    // 4. Detailed Mood Logic
    if (smile > 0.4) {
      this.currentMood = "Confident & Engaging";
    } else if (eyesWide > 0.5 || jawOpen > 0.4) {
      this.currentMood = "Surprised / Caught Off-guard";
    } else if (browDown > 0.4 || mouthPress > 0.4) {
      this.currentMood = "Deeply Focused / Tense";
    } else if (mouthPucker > 0.3) {
      this.currentMood = "Pensive / Uncertain";
    } else {
      this.currentMood = "Neutral / Professional";
    }

    return {
      mood: this.currentMood,
      score: this.smoothedScore,
      details: {
        smile,
        tension: (mouthPucker + mouthPress) / 2,
        focus: browDown,
        surprise: (eyesWide + jawOpen) / 2
      }
    };
  }
}
