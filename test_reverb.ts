import * as Tone from 'tone';

async function testEthereal() {
  const ctx = new Tone.OfflineContext(1, 10, 44100);
  Tone.setContext(ctx);

  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.5 }
  });

  const reverb = new Tone.Freeverb({ roomSize: 0.94, dampening: 1000, wet: 0.6 });
  synth.chain(reverb, ctx.destination);

  // Trigger rapid notes to simulate dense sequence
  for (let i = 0; i < 32; i++) {
    synth.triggerAttackRelease("C5", "16n", i * 0.125);
  }

  const buffer = await ctx.render();
  const data = buffer.getChannelData(0);
  
  let maxAmp = 0;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > maxAmp) maxAmp = Math.abs(data[i]);
  }
  
  console.log("Max Amplitude:", maxAmp);
  if (maxAmp > 1.0) {
    console.log("BUG DETECTED: CLIPPING / RUNAWAY FEEDBACK");
  } else {
    console.log("Audio is safe.");
  }
}

testEthereal().catch(console.error);
