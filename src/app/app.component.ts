import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import * as jsPDF from 'jspdf';
import { interval, Observable, Subscription } from 'rxjs';
import { takeWhile } from 'rxjs/operators';
import { getQuestions, Question } from './models/questions.const';
import { AudioService } from './services/audio.service';
import { ExpressionService } from './services/expression.service';
import { OcularService } from './services/ocular.service';
import { PoseService } from './services/pose.service';
import { SessionService } from './services/session.service';
import { SpeechService } from './services/speech.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('webcam') webcamElement: ElementRef<HTMLVideoElement>;
  @ViewChild('outputCanvas') canvasElement: ElementRef<HTMLCanvasElement>;

  view: 'landing' | 'countdown' | 'session' | 'summary' = 'landing';
  countdownValue = 5;
  selectedInterviewType: string | null = null;
  questionCount = 5;
  modelLoaded = false;
  faceLandmarker: any;
  lastVideoTime = -1;
  timer$: Observable<string>;

  // UI State
  blinkCount = 0;
  earWidth = 0;
  earColor = 'var(--accent-green)';
  finalScore: number | string = '--';
  scoreColor = 'var(--accent-green)';
  liveFeedback = 'Stable and Focused';
  headTilt = 0;
  stabilityColor = 'var(--accent-green)';
  stabilityText = 'Keep head steady';
  vocalBarHeight = 0;
  vocalStatus = 'Quiet';
  wordCount = 0;
  wpm = 0;
  hesitationCount = 0;
  paceStatus = 'Calculating...';

  questions: Question[] = [];
  currentQuestionIndex = 0;
  currentQuestion: Question | null = null;
  questionTimeLeft = 0;
  isReviewing = false;
  editableTranscript = '';
  liveTranscript = '';
  summary: any = null;
  expandedRoundIndex: number | null = null;

  private animationFrameId: number;
  private roundTimerSub: Subscription | null = null;

  constructor(
    private audioService: AudioService,
    private expressionService: ExpressionService,
    private ocularService: OcularService,
    private poseService: PoseService,
    private speechService: SpeechService,
    private sessionService: SessionService
  ) {
    this.timer$ = this.sessionService.timer$;
  }

  async ngOnInit() {
    await this.initializeModel();
  }

  ngOnDestroy() {
    this.stopCamera();
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.roundTimerSub) this.roundTimerSub.unsubscribe();
  }

  async initializeModel() {
    try {
      let attempts = 0;
      while ((!(window as any).FilesetResolver || !(window as any).FaceLandmarker) && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      const FilesetResolver = (window as any).FilesetResolver;
      const FaceLandmarker = (window as any).FaceLandmarker;
      if (!FilesetResolver || !FaceLandmarker) throw new Error("MediaPipe libraries failed to load.");
      const filesetResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm");
      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true
      });
      const FACE_API_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.5.11/model/";
      await this.expressionService.initFaceApi(FACE_API_MODEL_URL);
      this.modelLoaded = true;
    } catch (err) {
      console.error("Failed to initialize models:", err);
    }
  }

  selectInterviewType(type: string) {
    this.selectedInterviewType = type;
  }

  setQuestionCount(count: number) {
    this.questionCount = count;
  }

  async startSession() {
    if (!this.selectedInterviewType) return;
    this.view = 'countdown';
    this.countdownValue = 5;
    setTimeout(async () => {
      try {
        await this.audioService.start();
        this.speechService.start();
        await this.startCamera();
      } catch (err) { console.error(err); }
    }, 100);
    const intervalId = setInterval(() => {
      this.countdownValue--;
      if (this.countdownValue <= 0) {
        clearInterval(intervalId);
        this.proceedToSession();
      }
    }, 1000);
  }

  proceedToSession() {
    this.questions = getQuestions(this.selectedInterviewType!, this.questionCount);
    this.sessionService.startSession(this.selectedInterviewType!, this.questions);
    this.view = 'session';
    this.startRound();
  }

  startRound() {
    this.isReviewing = false;
    this.currentQuestion = this.sessionService.getCurrentQuestion();
    this.currentQuestionIndex = this.sessionService.currentQuestionIndex;
    this.questionTimeLeft = this.currentQuestion.timeLimit;
    this.liveTranscript = '';

    // Reset services for the new round
    this.ocularService.reset();
    this.speechService.reset();
    this.finalScore = 0;

    if (this.roundTimerSub) this.roundTimerSub.unsubscribe();
    this.roundTimerSub = interval(1000).pipe(
      takeWhile(() => this.questionTimeLeft > 0 && !this.isReviewing)
    ).subscribe(() => {
      this.questionTimeLeft--;
      this.liveTranscript = this.speechService.getLiveTranscript();
      if (this.questionTimeLeft <= 0) {
        this.openReview();
      }
    });
  }

  openReview() {
    this.isReviewing = true;
    this.editableTranscript = this.speechService.popTranscript();
    // Hardware is kept running for next round but metrics pause in SessionService automatically if we handle it
  }

  saveAndNext() {
    console.log("Saving round with transcript:", this.editableTranscript);
    this.sessionService.saveRound(this.editableTranscript);
    if (!this.sessionService.nextQuestion()) {
      console.log("No more questions, ending session.");
      this.endSession();
    } else {
      console.log("Proceeding to next question.");
      this.startRound();
    }
  }

  skipQuestion() {
    if (this.roundTimerSub) this.roundTimerSub.unsubscribe();
    this.speechService.popTranscript(); // Throw away current round transcript
    if (!this.sessionService.skipQuestion()) {
      this.endSession();
    } else {
      this.startRound();
    }
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    this.webcamElement.nativeElement.srcObject = stream;
    this.webcamElement.nativeElement.onloadeddata = () => {
      this.canvasElement.nativeElement.width = this.webcamElement.nativeElement.videoWidth;
      this.canvasElement.nativeElement.height = this.webcamElement.nativeElement.videoHeight;
      this.predictWebcam();
    };
  }

  stopCamera() {
    if (this.webcamElement && this.webcamElement.nativeElement.srcObject) {
      const stream = this.webcamElement.nativeElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      this.webcamElement.nativeElement.srcObject = null;
    }
  }

  predictWebcam = async () => {
    let startTimeMs = performance.now();
    if (this.lastVideoTime !== this.webcamElement.nativeElement.currentTime) {
      this.lastVideoTime = this.webcamElement.nativeElement.currentTime;
      const results = this.faceLandmarker.detectForVideo(this.webcamElement.nativeElement, startTimeMs);
      let visualData: any = { faceDetected: false };
      if (results.faceLandmarks.length > 0) {
        visualData.faceDetected = true;
        const landmarks = results.faceLandmarks[0];
        const blendshapes = results.faceBlendshapes[0].categories;
        const ocularData = this.ocularService.update(landmarks);
        const poseData = this.poseService.update(landmarks);
        const expressionData = this.expressionService.faceApiReady
          ? await this.expressionService.analyzeFromVideo(this.webcamElement.nativeElement)
          : this.expressionService.analyze(blendshapes);
        this.updateOcularUI(ocularData);
        this.updatePoseUI(poseData);
        this.updateExpressionUI(expressionData);
        visualData.ocular = ocularData;
        visualData.pose = poseData;
        visualData.expression = expressionData;
      }
      const vocalData = this.audioService.getVocalMetrics();
      const fluencyData = this.speechService.getFluencyMetrics();
      this.updateAudioSpeechUI(vocalData, fluencyData);
      if (this.sessionService.isActive && !this.isReviewing) {
        this.sessionService.recordMetrics(visualData, vocalData, fluencyData);
        const score = this.sessionService.calculateRoundScore();
        this.finalScore = score.final;
        this.scoreColor = score.final > 80 ? "var(--accent-green)" : (score.final > 60 ? "var(--accent-orange)" : "var(--accent-red)");
      }
    }
    this.animationFrameId = requestAnimationFrame(this.predictWebcam);
  }

  updateExpressionUI(data: any) { this.liveFeedback = `Current Mood: ${data.mood}`; }
  updateOcularUI(data: any) { this.blinkCount = data.blinkCount; this.earWidth = Math.min(data.ear * 300, 100); this.earColor = this.earWidth < 20 ? "var(--accent-red)" : "var(--accent-green)"; }
  updatePoseUI(data: any) { this.headTilt = data.roll; this.stabilityColor = data.isStable ? "var(--accent-green)" : "var(--accent-orange)"; this.stabilityText = data.isStable ? "Keep head steady" : "Minimize movement"; }
  updateAudioSpeechUI(vocal: any, fluency: any) { this.vocalBarHeight = vocal.volume; this.vocalStatus = vocal.status; this.wordCount = fluency.wordCount || 0; this.wpm = fluency.wpm; this.hesitationCount = fluency.hesitations; this.paceStatus = fluency.status; }

  endSession() {
    this.summary = this.sessionService.getSessionSummary();
    this.sessionService.stopSession();
    this.speechService.stop();
    this.stopCamera();
    this.view = 'summary';
  }

  restartApp() {
    this.view = 'landing';
    this.selectedInterviewType = null;
    this.questionCount = 5;
    this.summary = null;
    this.sessionService.isActive = false;
    this.isReviewing = false;
    this.ocularService.reset();
    this.poseService.reset();
    this.speechService.reset();
  }

  formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  toggleRound(index: number) {
    console.log('Toggling round:', index);
    if (this.expandedRoundIndex === index) {
      this.expandedRoundIndex = null;
    } else {
      this.expandedRoundIndex = index;
    }
  }

  downloadReport() {
    if (!this.summary) return;

    // For jspdf 1.5.3, the class is the module itself in many build setups
    // or requires a cast to avoid TS errors
    const doc = new (jsPDF as any)('p', 'mm', 'a4');
    const margin = 20;
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setTextColor(55, 66, 250); // Primary Blue
    doc.text('AI Interview Performance Report', margin, y);
    y += 15;

    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(`Interview Type: ${this.summary.interviewType.toUpperCase()}`, margin, y);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, y);
    y += 10;
    doc.line(margin, y, 190, y);
    y += 15;

    // Overall Score
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.text('Overall Confidence Score:', margin, y);
    doc.setTextColor(46, 213, 115); // Accent Green
    doc.text(`${this.summary.averageScore}%`, 100, y);
    y += 15;

    // Breakdown Table
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('Performance Metrics:', margin, y);
    y += 10;
    const breakdown = this.summary.averageBreakdown;
    const metrics = [
      ['Expression', `${breakdown.expression}%`],
      ['Eye Contact', `${breakdown.ocular}%`],
      ['Posture', `${breakdown.pose}%`],
      ['Voice', `${breakdown.vocal}%`],
      ['Fluency', `${breakdown.fluency}%`]
    ];

    metrics.forEach(m => {
      doc.setFontSize(11);
      doc.setTextColor(50, 50, 50);
      doc.text(m[0], margin + 5, y);
      doc.text(m[1], 100, y);
      y += 7;
    });
    y += 10;

    // Statistics
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('Vital Statistics:', margin, y);
    y += 10;
    const stats = this.summary.averageStats;
    doc.setFontSize(11);
    doc.text(`- Blink Rate: ${stats.blinkRate} /min`, margin + 5, y); y += 7;
    doc.text(`- Speaking Pace: ${stats.wpm} WPM`, margin + 5, y); y += 7;
    doc.text(`- Head Stability: ${stats.stabilityPercent}%`, margin + 5, y); y += 7;
    doc.text(`- Average Volume: ${stats.avgVolume}%`, margin + 5, y); y += 15;

    // Areas of Improvement
    doc.setFontSize(14);
    doc.setTextColor(200, 0, 0); // Red
    doc.text('Strategic Areas for Improvement:', margin, y);
    y += 10;

    const improvements = this.getGlobalImprovement(breakdown);
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    improvements.forEach(imp => {
      const wrapped = doc.splitTextToSize(`• ${imp}`, 170);
      doc.text(wrapped, margin + 5, y);
      y += (wrapped.length * 6) + 2;
    });

    y += 10;
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('Note: This report is generated by AI analysis. Practice consistently to improve these scores.', margin, y);

    y += 15;
    doc.addPage();
    y = 20;

    // Per Question Details
    doc.setFontSize(16);
    doc.setTextColor(55, 66, 250);
    doc.text('Question-by-Question Breakdown', margin, y);
    y += 15;

    this.summary.rounds.forEach((round, i) => {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.setFont('Helvetica', 'bold');
      doc.text(`Q${i + 1}: ${round.question}`, margin, y);
      y += 7;

      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      if (round.score) {
        doc.text(`Confidence Mark: ${round.score.final}%`, margin + 5, y);
        y += 6;
        const transcript = doc.splitTextToSize(`Transcript: "${round.transcript || 'No transcript available'}"`, 160);
        doc.text(transcript, margin + 5, y);
        y += (transcript.length * 5) + 5;
      } else {
        doc.text('Status: Skipped', margin + 5, y);
        y += 10;
      }
      y += 5;
    });

    doc.save(`Interview_Report_${new Date().getTime()}.pdf`);
  }

  getGlobalImprovement(breakdown: any) {
    const feedback = [];
    if (breakdown.expression < 70) feedback.push("Work on maintaining a more professional and engaging facial expression.");
    if (breakdown.ocular < 70) feedback.push("Improve your eye contact by looking directly at the camera more consistently.");
    if (breakdown.pose < 70) feedback.push("Maintain better head stability – avoid excessive tilting or movement.");
    if (breakdown.vocal < 70) feedback.push("Focus on your vocal energy and volume levels to project more confidence.");
    if (breakdown.fluency < 70) feedback.push("Practice reducing hesitations and work on a steadier speaking pace.");
    return feedback.length > 0 ? feedback : ["Excellent overall performance! Maintain this level of engagement."];
  }
}
