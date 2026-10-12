// Original procedural soundtrack. No downloaded audio or third-party music rights.
export class GameAudio {
  enabled = true;
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: OscillatorNode;
  private engineGain?: GainNode;
  private timer?: number;
  private voices = new Set<OscillatorNode>();
  private analyser?: AnalyserNode;
  private running = false;
  private nextNote = 0;
  private beat = 0;
  musicNotes = 0;

  async unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain(); this.master.gain.value = .65;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -12; limiter.ratio.value = 5;
        this.master.connect(limiter); limiter.connect(this.context.destination);
        if(import.meta.env.DEV) {this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;this.master.connect(this.analyser);}
        this.engine = this.context.createOscillator(); this.engine.type = 'triangle'; this.engine.frequency.value = 48;
        this.engineGain = this.context.createGain(); this.engineGain.gain.value = 0;
        this.engine.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
      }
      await this.context.resume();
      if (this.running) this.schedule();
    } catch { /* Browser may refuse audio; gameplay remains available. */ }
  }
  setRunning(running: boolean) {
    this.running = running;
    this.stopMusic();
    if (running && this.enabled && this.context?.state === 'running') {
      this.nextNote = this.context.currentTime + .04; this.beat = 0;
      this.schedule(); this.timer = window.setInterval(() => this.schedule(), 100);
    }
    if (this.engineGain && this.context) this.engineGain.gain.setTargetAtTime(running && this.enabled ? .035 : 0, this.context.currentTime, .07);
  }
  private stopMusic() {
    if (this.timer !== undefined) window.clearInterval(this.timer); this.timer = undefined;
    for (const voice of this.voices) { try { voice.stop(); } catch { /* Already ended. */ } }
    this.voices.clear();
  }
  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) { this.stopMusic(); if (this.master && this.context) this.master.gain.setTargetAtTime(0, this.context.currentTime, .03); }
    else { if (this.master && this.context) this.master.gain.setTargetAtTime(.65, this.context.currentTime, .03); void this.unlock().then(() => this.setRunning(this.running)); }
    return this.enabled;
  }
  updateEngine(speed: number) {
    if (this.engine && this.context) this.engine.frequency.setTargetAtTime(43 + speed * 5, this.context.currentTime, .1);
  }
  private note(frequency: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine', endFrequency?: number) {
    if (!this.context || !this.master) return;
    const osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, start);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + .012);
    gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(start); osc.stop(start + duration + .025);
    this.voices.add(osc); osc.onended = () => { this.voices.delete(osc); osc.disconnect(); gain.disconnect(); };
  }
  private schedule() {
    if (!this.enabled || !this.running || this.context?.state !== 'running') return;
    if (this.nextNote < this.context.currentTime) this.nextNote = this.context.currentTime + .03;
    const melody = [72,76,79,76,74,72,69,67,69,72,76,79,81,79,76,72,74,77,81,77,76,74,72,69,67,69,72,74,76,74,72,67];
    const bass = [48,45,53,43];
    while (this.nextNote < this.context.currentTime + .3) {
      const midi = melody[this.beat % melody.length];
      this.note(440 * 2 ** ((midi - 69) / 12), this.nextNote, .34, .105, 'triangle');
      if (this.beat % 4 === 0) this.note(440 * 2 ** ((bass[Math.floor(this.beat / 8) % 4] - 69) / 12), this.nextNote, .85, .095);
      if (this.beat % 2 === 0) this.note(160, this.nextNote, .09, .055, 'sine', 65);
      this.musicNotes++; this.beat++; this.nextNote += .25;
    }
  }
  effect(freq: number, duration: number, volume = .12, type: OscillatorType = 'sine') {
    if (this.enabled && this.context?.state === 'running') this.note(freq, this.context.currentTime, duration, volume, type, Math.max(35, freq * .5));
  }
  animal(kind: 'dog' | 'chicken') {
    if (!this.enabled || this.context?.state !== 'running') return;
    const t = this.context.currentTime;
    if (kind === 'dog') { this.note(220, t, .13, .22, 'sawtooth', 85); this.note(190, t + .18, .13, .18, 'sawtooth', 70); }
    else { this.note(900, t, .085, .13, 'triangle', 550); this.note(1150, t + .13, .08, .1, 'triangle', 650); }
  }
  status() { const samples=new Float32Array(256);this.analyser?.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length); return {rms,...this.details()}; }
  private details() { return { enabled: this.enabled, state: this.context?.state ?? 'locked', running: this.running, musicNotes: this.musicNotes, activeVoices: this.voices.size }; }
}
