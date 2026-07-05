type SoundName = "fire" | "enemyHit" | "playerHit" | "powerUp" | "wave" | "gameOver";

export class AudioBus {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  unlock(): void {
    if (this.context === null) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      void this.context.resume();
    }
  }

  play(sound: SoundName): void {
    if (this.context === null || this.master === null) {
      return;
    }

    const now = this.context.currentTime;

    switch (sound) {
      case "fire":
        this.tone(520, 0.04, "triangle", now, 0.16);
        break;
      case "enemyHit":
        this.tone(180, 0.08, "sawtooth", now, 0.2);
        this.noise(0.08, now, 0.18);
        break;
      case "playerHit":
        this.tone(90, 0.18, "square", now, 0.24);
        this.noise(0.16, now, 0.22);
        break;
      case "powerUp":
        this.tone(440, 0.06, "triangle", now, 0.16);
        this.tone(740, 0.1, "triangle", now + 0.05, 0.13);
        this.tone(980, 0.12, "triangle", now + 0.12, 0.1);
        break;
      case "wave":
        this.tone(330, 0.08, "triangle", now, 0.14);
        this.tone(660, 0.12, "triangle", now + 0.07, 0.12);
        break;
      case "gameOver":
        this.tone(220, 0.18, "sawtooth", now, 0.2);
        this.tone(130, 0.28, "sawtooth", now + 0.16, 0.18);
        break;
    }
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    start: number,
    volume: number,
  ): void {
    if (this.context === null || this.master === null) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.68), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, start: number, volume: number): void {
    if (this.context === null || this.master === null) {
      return;
    }

    const bufferSize = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
    const channel = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(gain);
    gain.connect(this.master);
    source.start(start);
  }
}
