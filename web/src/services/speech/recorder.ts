/**
 * 录音并编码为 ASR 接受的 WAV（单声道、16-bit PCM、16kHz）。
 *
 * 以设备采样率采集，写入 WAV 时再转成 16kHz。
 */
export const SAMPLE_RATE = 16000
/** ASR 单次时长上限 120 秒 */
export const MAX_SECONDS = 120

const BUFFER_SIZE = 4096

export type Recording = {
  /** 停止录音并返回 WAV；没有采到声音时返回 null */
  stop: () => Promise<Blob | null>
  /** 放弃录音，释放麦克风 */
  cancel: () => void
}

/** 开始录音；到达时长上限时调用 onLimit，由调用方决定何时 stop */
export const startRecording = async (onLimit: () => void, signal: AbortSignal): Promise<Recording> => {
  if (signal.aborted) {
    throw new DOMException('Cancelled', 'AbortError')
  }
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let released = false

  const release = () => {
    if (released) {
      return
    }
    released = true
    signal.removeEventListener('abort', release)
    if (processor) {
      processor.onaudioprocess = null
    }
    // 初始化可能只完成了一部分；单个节点断开失败也不能阻止麦克风释放。
    for (const node of [processor, source]) {
      try {
        node?.disconnect()
      } catch {
        // 继续释放其余资源。
      }
    }
    for (const track of stream?.getTracks() ?? []) {
      track.stop()
    }
    void context?.close().catch(() => {})
  }

  try {
    signal.addEventListener('abort', release, { once: true })
    context = new AudioContext()
    // Request playback activation during the gesture, before a permission dialog can consume it.
    const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve()
    await Promise.all([resumed, navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    }).then((media) => {
      if (released) {
        for (const track of media.getTracks()) track.stop()
        throw new DOMException('Cancelled', 'AbortError')
      }
      stream = media
    })])
    if (signal.aborted || !stream) throw new DOMException('Cancelled', 'AbortError')
    const rate = context.sampleRate
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
    const chunks: Float32Array[] = []
    let length = 0
    let limited = false
    processor.onaudioprocess = (event) => {
      if (limited) {
        return
      }
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      length += BUFFER_SIZE
      if (length >= MAX_SECONDS * rate) {
        limited = true
        onLimit()
      }
    }
    source.connect(processor)
    // ScriptProcessorNode 只有连到输出才会持续回调；输出缓冲保持静音
    processor.connect(context.destination)
    return {
      stop: async () => {
        release()
        return length === 0 ? null : encodeWav(chunks, length, rate)
      },
      cancel: release,
    }
  } catch (error) {
    release()
    throw error
  }
}

const encodeWav = (chunks: Float32Array[], length: number, rate: number) => {
  const ratio = rate / SAMPLE_RATE
  const samples = Math.min(Math.floor(length / ratio), MAX_SECONDS * SAMPLE_RATE)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples * 2, true)
  // Average each source window across chunk boundaries (typically 48 or 44.1 kHz).
  for (let i = 0; i < samples; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) {
      sum += chunks[Math.floor(j / BUFFER_SIZE)][j % BUFFER_SIZE]
    }
    const sample = Math.max(-1, Math.min(1, sum / (end - start)))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
