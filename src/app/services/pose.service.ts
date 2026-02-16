import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class PoseService {
  private stabilityHistory: any[] = [];
  private maxHistory = 30;

  constructor() { }

  calculateStability(landmarks: any[]) {
    const nose = landmarks[1];
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];

    const distL = Math.abs(nose.x - leftEye.x);
    const distR = Math.abs(nose.x - rightEye.x);
    const yaw = (distL / distR) - 1;

    const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

    const currentPos = { yaw, roll };
    this.stabilityHistory.push(currentPos);
    if (this.stabilityHistory.length > this.maxHistory) {
      this.stabilityHistory.shift();
    }

    return {
      yaw: Math.abs(yaw).toFixed(2),
      roll: Math.round(roll * (180 / Math.PI)),
      isStable: Math.abs(yaw) < 0.3 && Math.abs(roll) < 0.2
    };
  }

  update(landmarks: any[]) {
    return this.calculateStability(landmarks);
  }

  reset() {
    this.stabilityHistory = [];
  }
}
