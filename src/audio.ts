// Effects only: no background music, engine loop or sound-control UI.
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private analyser?: AnalyserNode;
  private voices = new Set<OscillatorNode>();
  private running = false;
  async unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain(); this.master.gain.value = .65;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -12; limiter.ratio.value = 5;
        this.master.connect(limiter); limiter.connect(this.context.destination);
        if(import.meta.env.DEV) {this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;this.master.connect(this.analyser);}
      }
      await this.context.resume();
    } catch { /* Audio availability does not block gameplay. */ }
  }
  setRunning(running: boolean) {
    this.running = running;
    if(!running) {for(const voice of this.voices){try{voice.stop();}catch{/* Already ended. */}}this.voices.clear();}
  }
  private note(frequency: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine', endFrequency?: number) {
    if (!this.context || !this.master) return;
    const osc=this.context.createOscillator(), gain=this.context.createGain();
    osc.type=type;osc.frequency.setValueAtTime(frequency,start);
    if(endFrequency)osc.frequency.exponentialRampToValueAtTime(endFrequency,start+duration);
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.012);gain.gain.exponentialRampToValueAtTime(.001,start+duration);
    osc.connect(gain);gain.connect(this.master);osc.start(start);osc.stop(start+duration+.025);
    this.voices.add(osc);osc.onended=()=>{this.voices.delete(osc);osc.disconnect();gain.disconnect();};
  }
  effect(freq:number,duration:number,volume=.12,type:OscillatorType='sine') {
    if(this.context?.state==='running')this.note(freq,this.context.currentTime,duration,volume,type,Math.max(35,freq*.5));
  }
  animal(kind:'dog'|'chicken') {
    if(!this.running||this.context?.state!=='running')return;
    const t=this.context.currentTime;
    if(kind==='dog'){this.note(220,t,.13,.22,'sawtooth',85);this.note(190,t+.18,.13,.18,'sawtooth',70);}
    else{this.note(900,t,.085,.13,'triangle',550);this.note(1150,t+.13,.08,.1,'triangle',650);}
  }
  status() {
    const samples=new Float32Array(256);this.analyser?.getFloatTimeDomainData(samples);
    return {rms:Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length),state:this.context?.state??'locked',running:this.running,activeVoices:this.voices.size};
  }
}
