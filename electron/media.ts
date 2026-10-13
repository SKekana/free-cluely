import { MAX_CLIP_BYTES } from "./contracts"

export function normalizeAudioMime(mime: string): string {
  const value = mime.toLowerCase().split(";")[0].trim()
  const aliases: Record<string, string> = { "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/mp3": "audio/mpeg", "video/webm": "audio/webm" }
  const normalized = aliases[value] || value
  if (!["audio/wav", "audio/mpeg", "audio/webm", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4", "audio/m4a", "audio/aiff"].includes(normalized)) {
    throw new Error("Unsupported audio format. Use WAV, MP3, WebM, OGG, FLAC, AAC or M4A.")
  }
  return normalized
}
export function audioMime(bytes: Uint8Array, extension: string): string {
  const signature = Buffer.from(bytes.subarray(0, 12))
  if (signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8, 12) === "WAVE") return "audio/wav"
  if (signature.toString("ascii", 0, 3) === "ID3" || (signature[0] === 0xff && (signature[1] & 0xe0) === 0xe0)) return "audio/mpeg"
  const formats: Record<string, string> = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".webm": "audio/webm", ".ogg": "audio/ogg", ".flac": "audio/flac", ".m4a": "audio/m4a", ".aac": "audio/aac", ".aiff": "audio/aiff" }
  return normalizeAudioMime(formats[extension.toLowerCase()] || "")
}
export function validateClip(data: string): void {
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw new Error("Invalid audio data")
  if (Buffer.byteLength(data, "base64") > MAX_CLIP_BYTES) throw new Error("Audio clips must be 10 MB or smaller")
}
export function errorMessage(error: unknown, secret?: string): string {
  let message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error)
  if (secret) message = message.split(secret).join("[redacted]")
  return message.replace(/AIza[\w-]{20,}/g, "[redacted]").replace(/([?&]key=)[^&\s]+/g, "$1[redacted]").slice(0, 600)
}
export function isTransient(error: unknown): boolean {
  const code = Number((error as { status?: number })?.status)
  return [408, 500, 502, 503, 504].includes(code) || /fetch failed|ECONNRESET|ETIMEDOUT/i.test(errorMessage(error))
}
