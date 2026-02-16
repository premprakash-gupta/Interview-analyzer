import { Injectable } from '@angular/core';
import { calculateDistance } from '../utils/math.utils';

@Injectable({
  providedIn: 'root'
})
export class OcularService {
  private blinkCount = 0;
  private lastBlinkTime = 0;
  private wasBlinking = false;

  constructor() { }

  getEyeAspectRatio(landmarks: any[]) {
    const top = landmarks[159];
    const bottom = landmarks[145];
    const left = landmarks[33];
    const right = landmarks[133];

    const vertical = calculateDistance(top, bottom);
    const horizontal = calculateDistance(left, right);

    return vertical / horizontal;
  }

  update(landmarks: any[]) {
    const ear = this.getEyeAspectRatio(landmarks);
    const now = Date.now();

    if (ear < 0.18) {
      this.wasBlinking = true;
    } else if (this.wasBlinking && ear > 0.2) {
      if (now - this.lastBlinkTime > 300) {
        this.blinkCount++;
        this.lastBlinkTime = now;
      }
      this.wasBlinking = false;
    }

    return { blinkCount: this.blinkCount, ear: ear };
  }

  reset() {
    this.blinkCount = 0;
    this.lastBlinkTime = 0;
    this.wasBlinking = false;
  }
}
