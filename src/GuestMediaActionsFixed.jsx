import { useEffect, useRef, useState } from 'react'
import { PHOTO_BUCKET, supabase } from './lib/supabase'
import { siteConfig } from './siteConfig'
import './GuestMediaActions.css'
import './GuestMediaActionsFixed.css'
import { showGuestConfirm } from './guestDialogs'
import './GuestDialogs.css'

const MAX_VIDEO_BYTES = siteConfig.uploadLimits.maxBytes
const VIDEO_MIME_TYPES = ['video/webm', 'video/mp4', 'video/ogg']

function videoExtensionForMimeType(mimeType) {
  return { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/ogg': 'ogv' }[mimeType]
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

function cameraErrorMessage(requestError, mode, selectedCamera) {
  if (requestError.name === 'NotAllowedError' || requestError.name === 'SecurityError') return `${mode === 'video' ? 'Camera and microphone permissions' : 'Camera permission'} were denied or blocked. Open this HTTPS site’s browser settings, enable ${mode === 'video' ? 'Camera and Microphone' : 'Camera'}, then tap Try again.`
  if (requestError.name === 'NotFoundError') return mode === 'video' ? 'No camera or microphone was found on this device.' : 'No camera was found on this device.'
  if (requestError.name === 'NotReadableError') return 'The selected camera or microphone is already being used by another app.'
  if (requestError.name === 'OverconstrainedError') return `The ${selectedCamera === 'user' ? 'front' : 'back'} camera is not available. Choose another camera and try again.`
  return `Could not access the camera: ${requestError.message || 'unknown error'}`
}

export default function GuestMediaActionsFixed() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const recorderRef = useRef(null)
  const timerRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const closingRef = useRef(false)
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
  const [selectedCamera, setSelectedCamera] = useState('environment')
  const [videoDevices, setVideoDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  useEffect(() => {
    if (!videoRef.current || !stream) return undefined
    const video = videoRef.current
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.style.objectFit = 'contain'
    const facingMode = stream.getVideoTracks?.()[0]?.getSettings?.().facingMode
    video.style.transform = selectedCamera === 'user' || facingMode === 'user' ? 'scaleX(-1)' : 'none'
    const playPreview = async () => {
      try { await video.play() } catch (playError) { setError(`Camera preview could not start: ${playError.message || 'playback was blocked'}. Tap the camera button again.`) }
    }
    playPreview()
    return () => { if (video.srcObject === stream) video.srcObject = null }
  }, [stream, selectedCamera])

  useEffect(() => {
    const applyConfiguredCopy = () => {
      const wishLabel = document.querySelector('.camera-studio .wish-label')
      const wishInput = document.querySelector('.camera-studio #wedding-wish')
      const uploadButton = document.querySelector('.camera-studio .upload-button:last-of-type')
      const successTitle = document.querySelector('.success-modal h2')
      const successMessage = document.querySelector('.success-modal p')
      const successButton = document.querySelector('.success-modal .upload-button')
      if (wishLabel) wishLabel.innerHTML = `${siteConfig.weddingWish.label} <span>${siteConfig.weddingWish.optionalText}</span>`
      if (wishInput) wishInput.placeholder = siteConfig.weddingWish.placeholder
      if (uploadButton && !busy) uploadButton.textContent = siteConfig.uploadMessages.memoryButton
      if (successTitle) successTitle.textContent = siteConfig.uploadMessages.successTitle
      if (successMessage) successMessage.textContent = siteConfig.uploadMessages.successMessage
      if (successButton) successButton.textContent = siteConfig.uploadMessages.uploadAnother
    }
    applyConfiguredCopy()
  }, [busy, open, media, success])

  useEffect(() => {
    const modal = document.querySelector('.camera-studio')
    if (!modal) return undefined
    let modalClose = modal.querySelector('.camera-dismiss')
    if (!modalClose) {
      modalClose = document.createElement('button')
      modalClose.className = 'camera-dismiss'
      modalClose.type = 'button'
      modalClose.setAttribute('aria-label', 'Close camera')
      modalClose.textContent = '×'
      modal.appendChild(modalClose)
    }
    const closeHandler = () => { void resetModal() }
    modalClose.addEventListener('click', closeHandler)
    const preview = modal.querySelector('.captured-preview')
    let mediaClose
    if (preview && media) {
      mediaClose = preview.querySelector('.media-dismiss') || document.createElement('button')
      mediaClose.className = 'media-dismiss'
      mediaClose.type = 'button'
      mediaClose.setAttribute('aria-label', 'Remove captured memory')
      mediaClose.textContent = '×'
      if (!mediaClose.parentElement) preview.appendChild(mediaClose)
      mediaClose.addEventListener('click', dismissMedia)
    }
    return () => {
      modalClose?.removeEventListener('click', closeHandler)
      mediaClose?.removeEventListener('click', dismissMedia)
    }
  }, [open, media, recording])

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    stopStream(streamRef.current)
  }, [])

  function clearMediaPreview() {
    if (media) URL.revokeObjectURL(media.url)
    setMedia(null)
    setWish('')
  }

  function reportUploadError(uploadError, file) {
    const rawMessage = uploadError?.message || ''
    const isNetworkError = uploadError?.name === 'TypeError' && /fetch|network|failed/i.test(rawMessage)
    const category = isNetworkError ? 'Network error while contacting Supabase. Check HTTPS, internet access, and the configured Supabase URL.' : 'Supabase Storage rejected the upload.'
    const detail = [rawMessage, uploadError?.details, uploadError?.hint, uploadError?.status || uploadError?.statusCode ? `status ${uploadError.status || uploadError.statusCode}` : ''].filter(Boolean).join(' — ')
    console.error('Supabase wedding media upload failed', { category, name: uploadError?.name, message: rawMessage, details: uploadError?.details, hint: uploadError?.hint, status: uploadError?.status || uploadError?.statusCode, fileName: file?.name, fileType: file?.type, fileSize: file?.size, bucket: PHOTO_BUCKET, folder: siteConfig.uploadFolder })
    return `Upload failed for ${file?.name || 'this memory'}: ${category} ${detail || 'Supabase returned an unknown error.'}`
  }

  async function closeModal({ confirmDiscard = true } = {}) {
    if (confirmDiscard && (recording || media)) {
      const confirmed = await showGuestConfirm(recording ? 'Stop and discard this recording?' : 'Discard this captured memory?', 'DISCARD')
      if (!confirmed) return false
    }
    closingRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    stopStream(streamRef.current)
    streamRef.current = null
    setStream(null)
    setRecording(false)
    setOpen(false)
    setMode(null)
    setVideoDevices([])
    setSelectedDeviceId('')
    return true
  }

  async function dismissMedia() {
    if (!media || !(await showGuestConfirm('Remove this captured memory?', 'REMOVE MEMORY'))) return
    URL.revokeObjectURL(media.url)
    setMedia(null)
    setWish('')
    setError('')
  }

  async function resetModal({ confirmDiscard = true } = {}) {
    if (!(await closeModal({ confirmDiscard }))) return false
    clearMediaPreview()
    setError('')
    return true
  }

  async function listVideoDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setVideoDevices(devices.filter((device) => device.kind === 'videoinput'))
    } catch {
      // Device enumeration is optional; the facing-mode buttons still work.
    }
  }

  async function requestCameraStream(nextMode, cameraSelection, deviceId = '') {
    const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: cameraSelection }
    return navigator.mediaDevices.getUserMedia({ video, audio: nextMode === 'video' })
  }

  async function requestCamera(nextMode, cameraSelection = nextMode === 'photo' ? 'environment' : 'user', deviceId = '') {
    if (!(await resetModal())) return
    closingRef.current = false
    setOpen(true)
    setMode(nextMode)
    setSelectedCamera(cameraSelection)
    setSelectedDeviceId(deviceId)
    if (!navigator.mediaDevices?.getUserMedia) return setError('Camera and microphone access is not supported in this browser. Please use HTTPS or choose a file from your gallery.')
    try {
      const nextStream = await requestCameraStream(nextMode, cameraSelection, deviceId)
      if (closingRef.current) return stopStream(nextStream)
      streamRef.current = nextStream
      setStream(nextStream)
      await listVideoDevices()
    } catch (requestError) {
      setError(cameraErrorMessage(requestError, nextMode, cameraSelection))
    }
  }

  async function switchCamera(cameraSelection) {
    if (recording) return setError('Stop the recording before switching cameras.')
    stopStream(streamRef.current)
    streamRef.current = null
    setStream(null)
    setError('Switching camera…')
    setSelectedCamera(cameraSelection)
    setSelectedDeviceId('')
    try {
      const nextStream = await requestCameraStream(mode, cameraSelection)
      if (closingRef.current) return stopStream(nextStream)
      streamRef.current = nextStream
      setStream(nextStream)
      setError('')
      await listVideoDevices()
    } catch (requestError) {
      setError(cameraErrorMessage(requestError, mode, cameraSelection))
    }
  }

  async function selectDevice(event) {
    if (recording) return
    const deviceId = event.target.value
    if (!deviceId) return
    stopStream(streamRef.current)
    streamRef.current = null
    setStream(null)
    setSelectedDeviceId(deviceId)
    setError('Switching camera…')
    try {
      const nextStream = await requestCameraStream(mode, selectedCamera, deviceId)
      if (closingRef.current) return stopStream(nextStream)
      streamRef.current = nextStream
      setStream(nextStream)
      setError('')
    } catch (requestError) {
      setError(cameraErrorMessage(requestError, mode, selectedCamera))
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
      if (closingRef.current) return
      const actualMimeType = (recorder.mimeType || requestedMimeType).split(';')[0].toLowerCase()
      if (!VIDEO_MIME_TYPES.includes(actualMimeType) || !videoExtensionForMimeType(actualMimeType)) { setError(`This browser produced an unsupported video format (${actualMimeType || 'unknown'}). Please choose a video from your gallery.`); stopStream(streamRef.current); streamRef.current = null; setStream(null); return }
      const blob = new Blob(chunksRef.current, { type: actualMimeType })
      if (!blob.size) { setError('Recording cancelled. No video was captured.'); void closeModal(); return }
      if (blob.size > MAX_VIDEO_BYTES) { setError(`The recording exceeded the ${siteConfig.uploadLimits.maxMegabytes} MB limit. Please record a shorter video.`); stopStream(streamRef.current); streamRef.current = null; setStream(null); return }
      const extension = videoExtensionForMimeType(actualMimeType)
      const file = new File([blob], `camera-${Date.now()}.${extension}`, { type: actualMimeType })
      stopStream(streamRef.current); streamRef.current = null; setStream(null); setMedia({ file, url: URL.createObjectURL(file) })
    }
    recorder.start(1000)
    timerRef.current = setInterval(() => setSeconds((value) => {
      if (value + 1 >= siteConfig.uploadLimits.maxVideoSeconds) { setError(`The maximum ${siteConfig.uploadLimits.maxVideoSeconds}-second recording length was reached.`); stopRecording() }
      return Math.min(value + 1, siteConfig.uploadLimits.maxVideoSeconds)
    }), 1000)
  }

  async function upload() {
    if (!media) return
    if (!media.file.type || (!media.file.type.startsWith('image/') && !VIDEO_MIME_TYPES.includes(media.file.type))) return setError(`This file type (${media.file.type || 'unknown'}) is not supported.`)
    if (media.file.size > MAX_VIDEO_BYTES) return setError(`This file is larger than the ${siteConfig.uploadLimits.maxMegabytes} MB limit.`)
    setBusy(true); setError('')
    const safeName = media.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
    const path = `${siteConfig.uploadFolder}/${crypto.randomUUID()}-${safeName}`
    try {
      const { data: uploadData, error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, media.file, { contentType: media.file.type, upsert: false, metadata: wish.trim() ? { wedding_wish: wish.trim().slice(0, siteConfig.weddingWish.maxLength) } : undefined })
      setBusy(false)
      if (uploadError) return setError(reportUploadError(uploadError, media.file))
      if (!uploadData?.path) return setError('Supabase did not confirm the uploaded file path. The memory was not marked as uploaded.')
    } catch (uploadError) {
      setBusy(false)
      return setError(reportUploadError(uploadError, media.file))
    }
    await resetModal({ confirmDiscard: false }); setSuccess(true)
  }

  return <>
    <div className="guest-media-actions"><button className="guest-action" type="button" onClick={() => requestCamera('photo')}>TAKE A PHOTO</button><button className="guest-action" type="button" onClick={() => requestCamera('video')}>RECORD A SHORT VIDEO</button></div>
    {open && <section className="camera-studio" role="dialog" aria-modal="true" aria-label={mode === 'video' ? 'Record a short video' : 'Take a photo'}><div className="camera-heading"><h2>{mode === 'video' ? 'Record a short video' : 'Take a photo'}</h2><button className="text-button" type="button" onClick={resetModal}>CLOSE</button></div><div className="camera-picker" aria-label="Choose camera"><span className="camera-picker-label">Camera</span><div className="camera-facing-controls"><button className={selectedCamera === 'user' ? 'camera-choice active' : 'camera-choice'} type="button" onClick={() => switchCamera('user')} disabled={recording}>Front camera</button><button className={selectedCamera === 'environment' ? 'camera-choice active' : 'camera-choice'} type="button" onClick={() => switchCamera('environment')} disabled={recording}>Back camera</button></div>{videoDevices.length > 1 && <label className="camera-device-select">Other camera<select value={selectedDeviceId} onChange={selectDevice} disabled={recording}><option value="">Choose a camera…</option>{videoDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>}</div><div className="camera-viewport">{stream ? <video ref={videoRef} className="camera-preview" autoPlay playsInline muted /> : <p className="camera-state">{error || 'Requesting camera permission…'}</p>}</div><canvas ref={canvasRef} className="hidden-input" />{stream && <div className="camera-controls">{mode === 'photo' ? <button className="upload-button" type="button" onClick={capturePhoto}>CAPTURE PHOTO</button> : <><span className="recording-timer" aria-live="polite">{recording ? `0:${String(seconds).padStart(2, '0')}` : '0:00'} / 0:30</span><button className="upload-button" type="button" onClick={recording ? stopRecording : startRecording}>{recording ? 'STOP RECORDING' : 'START RECORDING'}</button></>}</div>}{media && <><div className="captured-preview">{media.file.type.startsWith('video/') ? <video src={media.url} controls playsInline /> : <img src={media.url} alt="Captured wedding memory" />}</div><label className="wish-label" htmlFor="wedding-wish">Add a short wedding wish <span>(optional)</span></label><textarea id="wedding-wish" maxLength="160" rows="2" value={wish} onChange={(event) => setWish(event.target.value)} placeholder="Wishing you both a lifetime of happiness…" /><button className="upload-button" type="button" onClick={upload} disabled={busy}>{busy ? 'UPLOADING…' : 'UPLOAD THIS MEMORY'}</button></>}{error && <p className="status" role="alert">{error}</p>}{error && !media && <button className="admin-button" type="button" onClick={() => requestCamera(mode || 'photo', selectedCamera, selectedDeviceId)}>TRY CAMERA AGAIN</button>}</section>}
    {success && <div className="success-backdrop" role="presentation"><div className="success-modal" role="dialog" aria-modal="true"><div className="success-mark" aria-hidden="true">✦</div><h2>Thank you for being part of our album!</h2><p>Your beautiful moment is now part of our wedding memories. We’re so glad you shared it with us.</p><button className="upload-button" type="button" onClick={() => setSuccess(false)}>Upload another memory</button></div></div>}
  </>
}
