import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ExpressionService {
  currentMood = "Neutral";
  faceApiReady = false;
  private lastFaceApiTs = 0;
  private minIntervalMs = 200;
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
    const shapes: any = {};
    blendshapes.forEach(item => {
      shapes[item.categoryName] = item.score;
    });

    const smileScore = (shapes['mouthSmileLeft'] + shapes['mouthSmileRight']) / 2;
    const confusionScore = (shapes['browDownLeft'] + shapes['browDownRight']) / 2;
    const anxietyScore = (shapes['mouthPressLeft'] + shapes['mouthPressRight']) / 2;

    const isSmiling = smileScore > 0.4;
    const isConfused = confusionScore > 0.3;
    const isAnxious = anxietyScore > 0.4;

    let numericScore = 0.75;
    if (isSmiling) {
      this.currentMood = "Confident/Positive";
      numericScore = 0.85 + (smileScore * 0.15);
    } else if (isConfused) {
      this.currentMood = "Confused/Thinking";
      numericScore = 0.55 + (confusionScore * 0.15);
    } else if (isAnxious) {
      this.currentMood = "Anxious/Tense";
      numericScore = 0.4 + (anxietyScore * 0.2);
    } else {
      this.currentMood = "Neutral";
      numericScore = 0.75;
    }

    return {
      mood: this.currentMood,
      smileScore: smileScore,
      confusionScore: confusionScore,
      score: numericScore
    };
  }
}
