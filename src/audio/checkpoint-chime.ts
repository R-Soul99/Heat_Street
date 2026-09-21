import * as THREE from "three";

export interface CheckpointChime {
  play(): void;
  dispose(): void;
}

export function createCheckpointChime(listener: THREE.AudioListener): CheckpointChime {
  const context = listener.context;
  const gain = context.createGain();
  gain.gain.value = 0.045;
  gain.connect(context.destination);
  return {
    play(): void {
      if (context.state !== "running") return;
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.linearRampToValueAtTime(990, context.currentTime + 0.11);
      oscillator.connect(gain);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
    },
    dispose(): void { gain.disconnect(); },
  };
}