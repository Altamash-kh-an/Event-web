import { useEffect, useRef, useState } from 'react'
import { PHOTO_BUCKET, supabase } from './lib/supabase'
import { siteConfig } from './siteConfig'
import './GuestMediaActions.css'
import './GuestMediaActionsFixed.css'

const MAX_VIDEO_BYTES = 25 * 1024 * 1024
const VIDEO_MIME_TYPES = ['video/webm', 'video/mp4', 'video/ogg']

function videoExtensionForMimeType(mimeType) {
  return { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/ogg': 'ogv' }[mimeType]
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

export default function GuestMediaActionsFixed() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const recorderRef = useRef(null)
  const timerRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState(null)
  const [stream, setStream] = useState(null)
  const [media, setMedia] = useState(null)
  const [wish, setWish] = useState('')
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!videoRef.current || !stream) return undefined
    const video = videoRef.current
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    const playPreview = async () => {
      try { await video.play() } catch (playError) { setError(`Camera preview could not start: ${playError.message || 'playback was blocked'}. Tap the camera button again.`) }
    }
    playPreview()
    return () => { if (video.srcObject === stream) video.srcObject = null }
  }, [stream])

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    stopStream(streamRef.current)
  }, [])

  function clearMediaPreview() {
    if (media) URL.revokeObjectURL(media.url)
    setMedia(null)
    setWish('')
  }

  function closeModal() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    stopStream(streamRef.current)
    streamRef.current = null
    setStream(null)
    setRecording(false)
    setOpen(false)
    setMode(null)
  }

  function resetModal() {
    closeModal()
    clearMediaPreview()
    setError('')
  }

  async function requestCamera(nextMode) {
    resetModal()
    setOpen(true)
    setMode(nextMode)
    if (!navigator.mediaDevices?.getUserMedia) return setError('Camera and microphone access is not supported in this browser. Please use HTTPS or choose a file from your gallery.')
    const constraints = nextMode === 'photo'
      ? { video: { facingMode: { ideal: 'environment' } }, audio: false }
      : { video: { facingMode: { ideal: 'user' } }, audio: true }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = nextStream
      setStream(nextStream)
    } catch (requestError) {
      const message = requestError.name === 'NotAllowedError'
        ? 'Camera permission was denied or blocked. Allow Camera in the browser site settings, then tap Try again.'
        : requestError.name === 'NotFoundError'
          ? nextMode === 'video' ? 'No camera or microphone was found on this device.' : 'No camera was found on this device.'
          : requestError.name === 'NotReadableError' ? 'The camera or microphone is already being used by another app.' : `Could not access the camera: ${requestError.message || 'unknown error'}`
      setError(message)
    }
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video?.videoWidth || !canvas) return setError('The live camera preview is not ready yet. Please wait a moment and try again.')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return setError('The photo could not be captured. Please try again.')
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
      stopStream(streamRef.current); streamRef.current = null; setStream(null); setMedia({ file, url: URL.createObjectURL(file) })
    }, 'image/jpeg', 0.92)
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  function startRecording() {
    if (!streamRef.current) return setError('The live camera preview is not ready yet. Please try again.')
    if (!window.MediaRecorder) return setError('Video recording is not supported in this browser. Please choose a video from your gallery.')
    const requestedMimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/ogg'].find((candidate) => MediaRecorder.isTypeSupported(candidate))
    if (!requestedMimeType) return setError('This browser cannot create a supported video recording. Please choose a video from your gallery.')
    chunksRef.current = []
    const recorder = new MediaRecorder(streamRef.current, { mimeType: requestedMimeType })
    recorderRef.current = recorder
    setSeconds(0); setError(''); setRecording(true)
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
    recorder.onerror = () => { setError('The video recording failed. Please try again.'); setRecording(false); stopStream(streamRef.current) }
    recorder.onstop = () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null; setRecording(false)
      const actualMimeType = (recorder.mimeType || requestedMimeType).split(';')[0].toLowerCase()
      if (!VIDEO_MIME_TYPES.includes(actualMimeType) || !videoExtensionForMimeType(actualMimeType)) { setError(`This browser produced an unsupported video format (${actualMimeType || 'unknown'}). Please choose a video from your gallery.`); stopStream(streamRef.current); streamRef.current = null; setStream(null); return }
      const blob = new Blob(chunksRef.current, { type: actualMimeType })
      if (!blob.size) { setError('Recording cancelled. No video was captured.'); return closeModal() }
      if (blob.size > MAX_VIDEO_BYTES) { setError('The recording exceeded the 25 MB limit. Please record a shorter video.'); stopStream(streamRef.current); streamRef.current = null; setStream(null); return }
      const extension = videoExtensionForMimeType(actualMimeType)
      const file = new File([blob], `camera-${Date.now()}.${extension}`, { type: actualMimeType })
      stopStream(streamRef.current); streamRef.current = null; setStream(null); setMedia({ file, url: URL.createObjectURL(file) })
    }
    recorder.start(1000)
    timerRef.current = setInterval(() => setSeconds((value) => {
      if (value + 1 >= 30) { setError('The maximum 30-second recording length was reached.'); stopRecording() }
      return Math.min(value + 1, 30)
    }), 1000)
  }

  async function upload() {
    if (!media) return
    if (media.file.size > MAX_VIDEO_BYTES) return setError('This video is larger than the 25 MB limit.')
    setBusy(true); setError('')
    const safeName = media.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
    const path = `${siteConfig.uploadFolder}/${crypto.randomUUID()}-${safeName}`
    const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, media.file, { contentType: media.file.type, upsert: false, metadata: wish.trim() ? { wedding_wish: wish.trim().slice(0, siteConfig.weddingWish.maxLength) } : undefined })
    setBusy(false)
    if (uploadError) return setError(`Upload failed: ${uploadError.message}. Make sure the wedding-photos bucket allows ${media.file.type}.`)
    resetModal(); setSuccess(true)
  }

  return <>
    <div className="guest-media-actions"><button className="guest-action" type="button" onClick={() => requestCamera('photo')}>TAKE A PHOTO</button><button className="guest-action" type="button" onClick={() => requestCamera('video')}>RECORD A SHORT VIDEO</button></div>
    {open && <section className="camera-studio" role="dialog" aria-modal="true" aria-label={mode === 'video' ? 'Record a short video' : 'Take a photo'}><div className="camera-heading"><h2>{mode === 'video' ? 'Record a short video' : 'Take a photo'}</h2><button className="text-button" type="button" onClick={resetModal}>CLOSE</button></div><div className="camera-viewport">{stream ? <video ref={videoRef} className="camera-preview" autoPlay playsInline muted /> : <p className="camera-state">{error || 'Requesting camera permission…'}</p>}</div><canvas ref={canvasRef} className="hidden-input" />{stream && <div className="camera-controls">{mode === 'photo' ? <button className="upload-button" type="button" onClick={capturePhoto}>CAPTURE PHOTO</button> : <><span className="recording-timer" aria-live="polite">{recording ? `0:${String(seconds).padStart(2, '0')}` : '0:00'} / 0:30</span><button className="upload-button" type="button" onClick={recording ? stopRecording : startRecording}>{recording ? 'STOP RECORDING' : 'START RECORDING'}</button></>}</div>}{media && <><div className="captured-preview">{media.file.type.startsWith('video/') ? <video src={media.url} controls playsInline /> : <img src={media.url} alt="Captured wedding memory" />}</div><label className="wish-label" htmlFor="wedding-wish">Add a short wedding wish <span>(optional)</span></label><textarea id="wedding-wish" maxLength="160" rows="2" value={wish} onChange={(event) => setWish(event.target.value)} placeholder="Wishing you both a lifetime of happiness…" /><button className="upload-button" type="button" onClick={upload} disabled={busy}>{busy ? 'UPLOADING…' : 'UPLOAD THIS MEMORY'}</button></>}{error && <p className="status" role="alert">{error}</p>}{error && !media && <button className="admin-button" type="button" onClick={() => requestCamera(mode || 'photo')}>TRY CAMERA AGAIN</button>}</section>}
    {success && <div className="success-backdrop" role="presentation"><div className="success-modal" role="dialog" aria-modal="true"><div className="success-mark" aria-hidden="true">✦</div><h2>Thank you for being part of our album!</h2><p>Your beautiful moment is now part of our wedding memories. We’re so glad you shared it with us.</p><button className="upload-button" type="button" onClick={() => setSuccess(false)}>Upload another memory</button></div></div>}
  </>
}
