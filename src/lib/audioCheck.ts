/** A short two-tone test sound (WAV, made here), played like a call's voice: to check what you hear. */
export function testToneUrl() {
  const rate = 16000;
  const seconds = 1.2;
  const n = Math.floor(rate * seconds);
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = t < 0.6 ? 660 : 880;
    const fade = Math.min(1, t * 20, (seconds - t) * 20);
    data[i] = Math.round(Math.sin(2 * Math.PI * f * t) * 0.45 * fade * 32767);
  }
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export async function playTestTone(sinkId?: string | null) {
  const url = testToneUrl();
  const el = new Audio(url) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (sinkId && el.setSinkId) await el.setSinkId(sinkId).catch(() => {});
  try {
    await el.play();
    await new Promise((r) => (el.onended = r));
  } finally {
    URL.revokeObjectURL(url);
  }
}
