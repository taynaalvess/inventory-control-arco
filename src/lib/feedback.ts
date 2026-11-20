let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine') {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.02);
}

/** Bipe sonoro + vibração para confirmar leitura do código. */
export function beep(kind: 'ok' | 'error' | 'done' = 'ok') {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (kind === 'ok') tone(1320, 0, 0.09, 'square');
    else if (kind === 'done') {
      tone(880, 0, 0.1);
      tone(1320, 0.12, 0.15);
    } else {
      tone(220, 0, 0.15, 'sawtooth');
      tone(180, 0.18, 0.2, 'sawtooth');
    }
  } catch {
    /* áudio indisponível */
  }
  try {
    navigator.vibrate?.(kind === 'error' ? [80, 60, 80] : 40);
  } catch {
    /* ignora */
  }
}
