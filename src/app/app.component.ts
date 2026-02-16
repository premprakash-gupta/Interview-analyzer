import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Observable } from 'rxjs';
import { getQuestions } from './models/questions.const';
import { AudioService } from './services/audio.service';
import { ExpressionService } from './services/expression.service';
import { OcularService } from './services/ocular.service';
import { PoseService } from './services/pose.service';
import { SessionService } from './services/session.service';
import { SpeechService } from './services/speech.service';

declare var FaceLandmarker: any;
declare var FilesetResolver: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('webcam') webcamElement: ElementRef<HTMLVideoElement>;
  @ViewChild('outputCanvas') canvasElement: ElementRef<HTMLCanvasElement>;

  view: 'landing' | 'session' | 'summary' = 'landing';
  selectedInterviewType: string | null = null;
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

  questions: string[] = [];
  currentQuestionIndex = 0;
  currentQuestion = '';
  summary: any = null;

  private animationFrameId: number;

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
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  async initializeModel() {
    try {
      // Wait for globals to be available (loaded via module script)
      let attempts = 0;
      while ((!(window as any).FilesetResolver || !(window as any).FaceLandmarker) && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      const FilesetResolver = (window as any).FilesetResolver;
      const FaceLandmarker = (window as any).FaceLandmarker;

      if (!FilesetResolver || !FaceLandmarker) {
        throw new Error("MediaPipe libraries failed to load.");
      }

      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
      );

      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true
      });

      const FACE_API_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
      await this.expressionService.initFaceApi(FACE_API_MODEL_URL);

      this.modelLoaded = true;
      console.log("AI Model Loaded.");
    } catch (err) {
      console.error("Failed to initialize models:", err);
    }
  }

  selectInterviewType(type: string) {
    this.selectedInterviewType = type;
  }

  async startSession() {
    if (!this.selectedInterviewType) return;

    this.questions = getQuestions(this.selectedInterviewType);
    this.sessionService.startSession(this.selectedInterviewType, this.questions);
    this.updateQuestionDisplay();

    this.view = 'session';

    try {
      await this.audioService.start();
      this.speechService.start();
      await this.startCamera();
    } catch (err) {
      console.error("Failed to start session hardware:", err);
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

      if (this.sessionService.isActive) {
        this.sessionService.recordMetrics(visualData, vocalData, fluencyData);
        this.calculateSessionScore();
      }
    }

    this.animationFrameId = requestAnimationFrame(this.predictWebcam);
  }

  updateExpressionUI(data: any) {
    this.liveFeedback = `Current Mood: ${data.mood}`;
  }

  updateOcularUI(data: any) {
    this.blinkCount = data.blinkCount;
    this.earWidth = Math.min(data.ear * 300, 100);
    this.earColor = this.earWidth < 20 ? "var(--accent-red)" : "var(--accent-green)";
  }

  updatePoseUI(data: any) {
    this.headTilt = data.roll;
    this.stabilityColor = data.isStable ? "var(--accent-green)" : "var(--accent-orange)";
    this.stabilityText = data.isStable ? "Keep head steady" : "Minimize movement";
  }

  updateAudioSpeechUI(vocal: any, fluency: any) {
    this.vocalBarHeight = vocal.volume;
    this.vocalStatus = vocal.status;
    this.wordCount = fluency.wordCount || 0;
    this.wpm = fluency.wpm;
    this.hesitationCount = fluency.hesitations;
    this.paceStatus = fluency.status;
  }

  calculateSessionScore() {
    const score = this.sessionService.calculateFinalScore();
    this.finalScore = score.final;

    if (score.final > 80) this.scoreColor = "var(--accent-green)";
    else if (score.final > 60) this.scoreColor = "var(--accent-orange)";
    else this.scoreColor = "var(--accent-red)";
  }

  nextQuestion() {
    if (!this.sessionService.nextQuestion()) {
      this.endSession();
    } else {
      this.updateQuestionDisplay();
    }
  }

  skipQuestion() {
    if (!this.sessionService.skipQuestion()) {
      this.endSession();
    } else {
      this.updateQuestionDisplay();
    }
  }

  updateQuestionDisplay() {
    this.currentQuestion = this.sessionService.getCurrentQuestion();
    this.currentQuestionIndex = this.sessionService.currentQuestionIndex;
  }

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
    this.ocularService.reset();
    this.poseService.reset();
    this.speechService.reset();
    // In a real app we might want to reload or reset more state
  }

  formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
}
