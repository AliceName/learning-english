export type RecordingSilenceOptions = { enabled?: boolean; silenceSeconds?: number };

// An energy heuristic for ending a turn, not speech recognition. Quiet input
// alone must never be interpreted as a completed answer.
export class RecordingSilenceDetector {
  private elapsed = 0;
  private sound = 0;
  private trailingSilence = 0;
  private stopped = false;
  private readonly enabled: boolean;
  private readonly silenceSeconds: number;

  constructor(options: RecordingSilenceOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.silenceSeconds = Number.isFinite(options.silenceSeconds) && options.silenceSeconds! >= .75 && options.silenceSeconds! <= 5
      ? options.silenceSeconds! : 1.5;
  }

  addFrame(rms: number, seconds: number) {
    if (!this.enabled || this.stopped) return false;
    if (!Number.isFinite(rms) || rms < 0 || !Number.isFinite(seconds) || seconds <= 0) {
      this.trailingSilence = 0;
      return false;
    }
    this.elapsed += seconds;
    if (rms >= .012) {
      this.sound += seconds;
      this.trailingSilence = 0;
    } else if (rms <= .008) {
      this.trailingSilence += seconds;
    } else {
      // A soft tail or uncertain background sound postpones the cut.
      this.trailingSilence = 0;
    }
    if (this.sound + 1e-9 >= .3 && this.elapsed + 1e-9 >= 1 && this.trailingSilence + 1e-9 >= this.silenceSeconds) {
      this.stopped = true;
      return true;
    }
    return false;
  }
}
