import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_SECONDS, SAMPLE_RATE, startRecording } from '../web/src/services/speech/recorder.ts'

// No network or microphone required. Feed PCM at the rate reported by a device.
function device(t, rate, delayed = false) {
  const stats = { requests: 0, stops: 0, closes: 0 }
  const processor = { connect() {}, disconnect() {} }
  const stream = { getTracks: () => [{ stop: () => stats.stops++ }] }
  const permission = Promise.withResolvers()
  const context = class {
    constructor(options) {
      assert.equal(options, undefined, 'capture at the hardware sample rate')
      this.sampleRate = rate
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createScriptProcessor(size) { assert.equal(size, 4096); return processor }
    async close() { stats.closes++ }
  }
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  const originalMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: context })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => { stats.requests++; if (delayed) await permission.promise; return stream } },
  })
  t.after(() => {
    if (originalAudio) Object.defineProperty(globalThis, 'AudioContext', originalAudio)
    else delete globalThis.AudioContext
    if (originalMedia) Object.defineProperty(navigator, 'mediaDevices', originalMedia)
    else delete navigator.mediaDevices
  })
  return {
    stats, grant: () => permission.resolve(),
    feed: chunk => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => chunk } }),
  }
}

for (const rate of [16000, 44100, 48000]) {
  test(`encode ${rate} Hz hardware capture as a 16 kHz mono WAV`, async t => {
    const mic = device(t, rate)
    const recording = await startRecording(assert.fail, new AbortController().signal)
    mic.feed(new Float32Array(4096).fill(-1))
    mic.feed(new Float32Array(4096).fill(1))
    const wav = Buffer.from(await (await recording.stop()).arrayBuffer())
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
    assert.equal(wav.readUint16LE(22), 1)
    assert.equal(wav.readUint32LE(24), SAMPLE_RATE)
    assert.equal(wav.readUint16LE(34), 16)
    assert.equal(wav.readUint32LE(40), 2 * Math.floor(8192 * SAMPLE_RATE / rate))
    assert.equal(wav.readInt16LE(44), -32768)
    assert.equal(wav.readInt16LE(wav.length - 2), 32767)
    recording.cancel()
    assert.equal(mic.stats.stops, 1)
  })
}

test('release before permission arrives discards a late stream', async t => {
  const mic = device(t, 48000, true)
  const abort = new AbortController()
  const pending = startRecording(assert.fail, abort.signal)
  abort.abort()
  mic.grant()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(mic.stats.stops, 1)
  await assert.rejects(startRecording(assert.fail, abort.signal), { name: 'AbortError' })
  assert.equal(mic.stats.requests, 1)
})

test('an empty recording releases the microphone and produces no upload', async t => {
  const mic = device(t, 48000)
  const recording = await startRecording(assert.fail, new AbortController().signal)
  assert.equal(await recording.stop(), null)
  assert.equal(mic.stats.closes, 1)
  assert.equal(mic.stats.stops, 1)
})

test('cap cloud fallback recording at 120 seconds and signal the limit once', async t => {
  const mic = device(t, 44100)
  let calls = 0
  const recording = await startRecording(() => calls++, new AbortController().signal)
  const chunk = new Float32Array(4096)
  for (let i = 0; i < Math.ceil(44100 * MAX_SECONDS / chunk.length) + 3; i++) mic.feed(chunk)
  assert.equal(calls, 1)
  assert.equal((await recording.stop()).size, 44 + 2 * MAX_SECONDS * SAMPLE_RATE)
})
