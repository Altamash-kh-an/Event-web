import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { PHOTO_BUCKET, supabase } from './lib/supabase'
import { siteConfig } from './siteConfig'
import './App.css'
import './admin.css'
import GuestMediaActions from './GuestMediaActionsFixed'

const GUEST_UPLOAD_FOLDER = siteConfig.uploadFolder
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL
const MAX_UPLOAD_BYTES = siteConfig.uploadLimits.maxBytes

function formatSupabaseError(error, file) {
  const detail = [error?.message, error?.details, error?.hint, error?.statusCode ? `status ${error.statusCode}` : ''].filter(Boolean).join(' — ')
  console.error('Supabase wedding photo upload failed', { error, fileName: file?.name, fileType: file?.type, fileSize: file?.size, bucket: PHOTO_BUCKET, folder: GUEST_UPLOAD_FOLDER })
  return `Upload failed for ${file?.name || 'this photo'}: ${detail || 'Supabase returned an unknown error.'}`
}

function isImageFile(item) {
  const mimeType = item.metadata?.mimetype
  return (typeof mimeType === 'string' && mimeType.startsWith('image/')) || /\.(jpe?g|png|webp|heic|heif)$/i.test(item.name)
}

function isVideoFile(item) {
  const mimeType = item.metadata?.mimetype
  return (typeof mimeType === 'string' && mimeType.startsWith('video/')) || /\.(mp4|webm|ogg|mov|m4v|avi)$/i.test(item.name)
}

function isMediaFile(item) {
  return isImageFile(item) || isVideoFile(item)
}

async function listAllPhotos(prefix = '') {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).list(prefix, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) throw error
  const files = []
  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name
    if (item.id === null) files.push(...await listAllPhotos(path))
    else if (item.name !== '.emptyFolderPlaceholder' && isMediaFile(item)) files.push({ ...item, path, mediaType: isVideoFile(item) ? 'video' : 'image' })
  }
  return files
}

function UploadPage() {
  const inputRef = useRef(null)
  const cameraVideoRef = useRef(null)
  const canvasRef = useRef(null)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const [photos, setPhotos] = useState([])
  const [message, setMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [successOpen, setSuccessOpen] = useState(false)
  const [session, setSession] = useState(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [adminPhotos, setAdminPhotos] = useState([])
  const [loadingGallery, setLoadingGallery] = useState(false)
  const [cameraMode, setCameraMode] = useState(null)
  const [cameraError, setCameraError] = useState('')
  const [capturedMedia, setCapturedMedia] = useState(null)
  const [wish, setWish] = useState('')
  const [galleryWish, setGalleryWish] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingMime, setRecordingMime] = useState('video/webm')
  const isAdminSession = Boolean(ADMIN_EMAIL) && session?.user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) loadAdminPhotos()
    else setAdminPhotos([])
  }, [session])

  useEffect(() => {
    const note = document.querySelector('.upload-box .file-note')
    if (note) note.textContent = `JPG, PNG, WEBP, HEIC · Up to ${siteConfig.uploadLimits.maxMegabytes} MB each`
  }, [photos.length])

  function choosePhotos(files) {
    const selected = Array.from(files || [])
    const invalid = selected.find((file) => !file.type.startsWith('image/'))
    const oversized = selected.find((file) => file.size > MAX_UPLOAD_BYTES)
    if (invalid) return setMessage(`${invalid.name} is not a supported image file.`)
    if (oversized) return setMessage(`${oversized.name} is larger than the ${siteConfig.uploadLimits.maxMegabytes} MB limit.`)
    if (!selected.length) return setMessage('Please choose an image file to continue.')
    setPhotos((current) => [...current, ...selected.map((file) => ({ file, url: URL.createObjectURL(file) }))])
    setMessage('')
  }

  function stopCamera() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setRecording(false)
    setCameraMode(null)
  }

  useEffect(() => {
    if (cameraVideoRef.current && streamRef.current) cameraVideoRef.current.srcObject = streamRef.current
  }, [cameraMode])

  useEffect(() => () => stopCamera(), [])

  async function openCamera(mode) {
    setCameraError('')
    setCapturedMedia(null)
    if (!navigator.mediaDevices?.getUserMedia) return setCameraError('Camera recording is not supported in this browser. Please choose a file from your gallery.')
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: mode === 'video' })
      setCameraMode(mode)
    } catch (error) {
      setCameraError(error.name === 'NotAllowedError' ? 'Camera permission was denied. You can still choose a file from your gallery.' : 'We could not access your camera. Please check your browser permissions and try again.')
    }
  }

  function capturePhoto() {
    const video = cameraVideoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return setCameraError('We could not capture that photo. Please try again.')
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
      setCapturedMedia({ file, url: URL.createObjectURL(file) })
      stopCamera()
    }, 'image/jpeg', 0.92)
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  function startRecording() {
    if (!window.MediaRecorder) return setCameraError('Video recording is not supported in this browser. Please choose a video from your gallery.')
    const options = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4']
    const mimeType = options.find((candidate) => MediaRecorder.isTypeSupported(candidate))
    if (!mimeType) return setCameraError('This browser cannot create a supported video recording. Please choose a video from your gallery.')
    const chunks = []
    let totalBytes = 0
    const recorder = new MediaRecorder(streamRef.current, { mimeType })
    recorderRef.current = recorder
    setRecordingMime(mimeType.split(';')[0])
    setRecordingSeconds(0)
    setRecording(true)
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return
      totalBytes += event.data.size
      chunks.push(event.data)
      if (totalBytes > 25 * 1024 * 1024) {
        setCameraError('This recording reached the 25 MB limit and was cancelled.')
        stopRecording()
      }
    }
    recorder.onstop = () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
      setRecording(false)
      if (totalBytes > 25 * 1024 * 1024 || !chunks.length) {
        if (!chunks.length) setCameraError('Recording cancelled. No video was captured.')
        return stopCamera()
      }
      const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
      const file = new File([blob], `camera-${Date.now()}.${extension}`, { type: blob.type })
      setCapturedMedia({ file, url: URL.createObjectURL(file) })
      stopCamera()
    }
    recorder.start(1000)
    timerRef.current = setInterval(() => {
      setRecordingSeconds((seconds) => {
        if (seconds + 1 >= 30) {
          setCameraError('The maximum 30-second recording length was reached.')
          stopRecording()
        }
        return Math.min(seconds + 1, 30)
      })
    }, 1000)
  }

  async function uploadCapturedMedia() {
    if (!capturedMedia) return
    if (capturedMedia.file.size > 25 * 1024 * 1024) return setCameraError('This video is larger than the 25 MB limit.')
    setUploading(true)
    setMessage('Uploading your memory…')
    const safeName = capturedMedia.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
    const path = `${GUEST_UPLOAD_FOLDER}/${crypto.randomUUID()}-${safeName}`
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, capturedMedia.file, { contentType: capturedMedia.file.type, cacheControl: '3600', upsert: false, metadata: wish.trim() ? { wedding_wish: wish.trim().slice(0, 160) } : undefined })
    setUploading(false)
    if (error) return setCameraError(`Upload failed: ${error.message}`)
    URL.revokeObjectURL(capturedMedia.url)
    setCapturedMedia(null)
    setWish('')
    setMessage('')
    setSuccessOpen(true)
  }

  async function upload() {
    if (!photos.length) return inputRef.current?.click()
    const galleryWishText = galleryWish.trim() || window.prompt(`${siteConfig.weddingWish.label} ${siteConfig.weddingWish.optionalText}`, siteConfig.weddingWish.placeholder)?.trim().slice(0, siteConfig.weddingWish.maxLength) || ''
    setUploading(true)
    setUploadProgress(0)
    setMessage('Uploading your memories…')
    const failures = []
    const uploaded = []
    for (const [index, photo] of photos.entries()) {
      if (!photo.file.type.startsWith('image/') || photo.file.size > MAX_UPLOAD_BYTES) {
        failures.push(`${photo.file.name}: unsupported type or larger than ${siteConfig.uploadLimits.maxMegabytes} MB`)
        continue
      }
      const safeName = photo.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      const path = `${GUEST_UPLOAD_FOLDER}/${crypto.randomUUID()}-${safeName}`
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, photo.file, { contentType: photo.file.type, upsert: false, metadata: galleryWishText ? { wedding_wish: galleryWishText } : undefined })
      if (error) failures.push(formatSupabaseError(error, photo.file))
      else if (data?.path) uploaded.push(photo)
      else failures.push(`${photo.file.name}: Supabase did not confirm an uploaded path`)
      setUploadProgress(Math.round(((index + 1) / photos.length) * 100))
    }
    uploaded.forEach((photo) => URL.revokeObjectURL(photo.url))
    setPhotos((current) => current.filter((photo) => !uploaded.includes(photo)))
    setUploading(false)
    if (failures.length) setMessage(failures.join(' | '))
    else {
      setGalleryWish('')
      setMessage('')
      setSuccessOpen(true)
    }
  }

  function startAnotherUpload() {
    setSuccessOpen(false)
    setMessage('')
    inputRef.current?.click()
  }

  function removePhoto(index) {
    URL.revokeObjectURL(photos[index].url)
    setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))
  }

  async function signIn(event) {
    event.preventDefault()
    setMessage('Signing in…')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setMessage(error ? error.message : '')
  }

  async function loadAdminPhotos() {
    setLoadingGallery(true)
    try {
      const data = await listAllPhotos()
      const withUrls = await Promise.all(data.map(async (photo) => {
        const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(photo.path, 3600)
        return { ...photo, signedUrl: signed?.signedUrl }
      }))
      setAdminPhotos(withUrls.filter((photo) => photo.signedUrl))
    } catch (error) { setMessage(error.message) }
    setLoadingGallery(false)
  }

  async function downloadZip() {
    if (!adminPhotos.length) return
    setMessage('Preparing ZIP…')
    const zip = new JSZip()
    await Promise.all(adminPhotos.map(async (photo, index) => {
      const response = await fetch(photo.signedUrl)
      zip.file(`${String(index + 1).padStart(3, '0')}-${photo.path}`, await response.blob())
    }))
    const content = await zip.generateAsync({ type: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(content)
    link.download = 'wedding-photos.zip'
    link.click()
    URL.revokeObjectURL(link.href)
    setMessage(`${adminPhotos.length} photos downloaded as a ZIP.`)
  }

  async function emptyAlbum() {
    if (!isAdminSession || !adminPhotos.length || !window.confirm(`Delete all ${adminPhotos.length} photos from the wedding album? This cannot be undone.`)) return
    setMessage('Clearing the album…')
    const paths = adminPhotos.map((photo) => photo.path)
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths.slice(index, index + 100))
      if (error) return setMessage(error.message)
    }
    await loadAdminPhotos()
    setMessage('Album cleared. 0 photos remain.')
  }

  return <main className="page"><div className="pattern pattern-one" aria-hidden="true" /><div className="pattern pattern-two" aria-hidden="true" /><section className="site-shell">
    <header className="topbar"><div className="monogram" aria-hidden="true">س</div><div className="topbar-label">{siteConfig.englishGreeting}</div><button className="admin-toggle" type="button" onClick={() => setAdminOpen((open) => !open)}>{session ? 'ALBUM ADMIN' : 'ADMIN LOGIN'}</button></header>
    <div className="hero-copy"><p className="arabic-greeting" lang="ar" dir="rtl">{siteConfig.arabicGreeting}</p><p className="arabic-welcome" lang="ar" dir="rtl">{siteConfig.arabicWelcome}</p><div className="gold-rule"><span>✦</span></div><p className="eyebrow">A WEDDING ALBUM</p><h1>{siteConfig.groomName} <em>weds</em> {siteConfig.brideName}</h1><p className="welcome-line">{siteConfig.welcomeLine}</p><p className="upload-copy">{siteConfig.uploadDescription}</p></div>
    <div className={`upload-box ${photos.length ? 'has-selection' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choosePhotos(event.dataTransfer.files) }}><div className="upload-icon" aria-hidden="true">✧</div><p className="drop-title">{photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} selected` : 'Share your cherished moments'}</p>{photos.length ? <div className="selected-summary"><img src={photos[0].url} alt={`Selected ${photos[0].file.name}`} /><div><p>{photos[0].file.name}</p>{photos.length > 1 && <span>+ {photos.length - 1} more selected</span>}</div></div> : <p className="drop-hint">Choose from your device or drag and drop here</p>}<button className="upload-button" onClick={photos.length ? upload : () => inputRef.current?.click()} type="button" disabled={uploading}>{uploading ? `UPLOADING ${uploadProgress}%` : photos.length ? 'UPLOAD SELECTED PHOTOS' : 'CHOOSE PHOTOS'}<span aria-hidden="true">↗</span></button><input ref={inputRef} className="hidden-input" type="file" accept="image/*" multiple onChange={(event) => { choosePhotos(event.target.files); event.target.value = '' }} />{!photos.length && <p className="file-note">JPG, PNG, WEBP, HEIC · Up to 20 MB each</p>}{uploading && <div className="progress-track" aria-label={`Upload progress ${uploadProgress}%`}><span style={{ width: `${uploadProgress}%` }} /></div>}</div>
    {photos.length > 0 && <div className="preview-grid" aria-label="Selected photo previews">{photos.map((photo, index) => <figure className="preview" key={`${photo.file.name}-${index}`}><img src={photo.url} alt={`Selected ${photo.file.name}`} /><button onClick={() => removePhoto(index)} type="button" aria-label={`Remove ${photo.file.name}`}>×</button></figure>)}</div>}
    {message && <p className="status" role="status">{message}</p>}
    {adminOpen && <aside className="admin-panel">{!session ? <form onSubmit={signIn}><h2>Private album</h2><p>Sign in to view, download or clear the album.</p><input type="email" placeholder="Admin email" value={email} onChange={(event) => setEmail(event.target.value)} required /><input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="admin-button" type="submit">SIGN IN</button></form> : <><div className="admin-heading"><div><h2>Private album</h2><p>{loadingGallery ? 'Loading photos…' : `${adminPhotos.length} photos`}</p></div><button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>SIGN OUT</button></div><div className="admin-actions"><button className="admin-button" type="button" onClick={loadAdminPhotos}>REFRESH</button><button className="admin-button" type="button" onClick={downloadZip} disabled={!adminPhotos.length}>DOWNLOAD ZIP</button>{isAdminSession && <button className="admin-button danger-button" type="button" onClick={emptyAlbum} disabled={!adminPhotos.length}>EMPTY ALBUM</button>}</div>{adminPhotos.length > 0 && <div className="preview-grid admin-grid">{adminPhotos.map((photo) => <img className="admin-photo" key={photo.path} src={photo.signedUrl} alt={photo.path} />)}</div>}</>}</aside>}
    <footer className="footer"><span>WITH LOVE</span><span>•</span><span>{siteConfig.groomName} &amp; {siteConfig.brideName}</span><span>•</span><span>FOREVER</span></footer>
    {successOpen && <div className="success-backdrop" role="presentation"><div className="success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title" aria-describedby="success-message"><div className="success-mark" aria-hidden="true">✦</div><h2 id="success-title">Thank you for being part of our album!</h2><p id="success-message">Your beautiful moment is now part of our wedding memories. We’re so glad you shared it with us.</p><button className="upload-button" type="button" onClick={startAnotherUpload}>Upload another photo</button></div></div>}
  </section></main>
}

function AdminPage() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [photos, setPhotos] = useState([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const isAdmin = Boolean(ADMIN_EMAIL) && session?.user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => { if (session) loadPhotos() }, [session])
  useEffect(() => {
    requestAnimationFrame(() => document.querySelectorAll('.admin-gallery img.admin-photo').forEach((image) => {
      const media = photos.find((item) => item.path === image.alt)
      if (media?.mediaType !== 'video') return
      const video = document.createElement('video')
      video.className = image.className; video.src = media.signedUrl; video.controls = true; video.playsInline = true; video.setAttribute('aria-label', media.path)
      image.replaceWith(video)
    }))
  }, [photos])

  async function signIn(event) {
    event.preventDefault()
    setStatus('Signing in…')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setStatus(error ? error.message : '')
  }

  async function loadPhotos() {
    setLoading(true)
    setStatus('')
    try {
      const data = await listAllPhotos()
      const signedPhotos = await Promise.all(data.map(async (photo) => {
        const { data: signed, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(photo.path, 3600)
        return error ? null : { ...photo, signedUrl: signed.signedUrl }
      }))
      setPhotos(signedPhotos.filter(Boolean))
    } catch (error) { setStatus(error.message); setPhotos([]) }
    setLoading(false)
  }

  async function downloadAll() {
    setDownloading(true)
    setStatus('Preparing ZIP…')
    try {
      const zip = new JSZip()
      await Promise.all(photos.map(async (photo, index) => { const response = await fetch(photo.signedUrl); if (!response.ok) throw new Error(`Could not download ${photo.name}`); zip.file(`${String(index + 1).padStart(3, '0')}-${photo.path}`, await response.blob()) }))
      const blob = await zip.generateAsync({ type: 'blob' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'wedding-photos.zip'; link.click(); URL.revokeObjectURL(url); setStatus(`${photos.length} photos downloaded.`)
    } catch (error) { setStatus(error.message) } finally { setDownloading(false) }
  }

  async function deleteAllPhotos() {
    if (!isAdmin || !photos.length || !window.confirm(`Delete all ${photos.length} photos from the wedding album? This cannot be undone.`)) return
    setStatus('Clearing the album…')
    try {
      const paths = photos.map((photo) => photo.path)
      for (let index = 0; index < paths.length; index += 100) { const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths.slice(index, index + 100)); if (error) throw error }
      await loadPhotos(); setStatus('Album cleared. 0 photos remain.')
    } catch (error) { setStatus(error.message) }
  }

  if (!session) return <main className="admin-page"><section className="admin-card"><a className="back-link" href="/">← Back to upload</a><p className="arabic-greeting" lang="ar" dir="rtl">{siteConfig.arabicGreeting}</p><p className="eyebrow">PRIVATE WEDDING ALBUM</p><h1>Admin <em>login</em></h1><form className="admin-login" onSubmit={signIn}><p>Sign in to manage the private photo album.</p><input type="email" placeholder="Admin email" value={email} onChange={(event) => setEmail(event.target.value)} required /><input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="admin-button" type="submit">SIGN IN</button></form>{status && <p className="status" role="status">{status}</p>}</section></main>

  return <main className="admin-page"><section className="admin-card admin-card-wide"><div className="admin-heading"><div><a className="back-link" href="/">← Upload page</a><p className="eyebrow">PRIVATE WEDDING ALBUM</p><h1>Your <em>photos</em></h1><p className="album-count">{loading ? 'Loading photos…' : `${photos.length} photos in the album`}</p></div><button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>SIGN OUT</button></div><div className="admin-actions"><button className="admin-button" type="button" onClick={loadPhotos}>REFRESH</button><button className="admin-button" type="button" onClick={downloadAll} disabled={!photos.length || downloading}>{downloading ? 'CREATING ZIP…' : 'DOWNLOAD ALL AS ZIP'}</button>{isAdmin && <button className="admin-button danger-button" type="button" onClick={deleteAllPhotos} disabled={!photos.length || downloading}>EMPTY ALBUM</button>}</div>{status && <p className="status" role="status">{status}</p>}{photos.length > 0 ? <div className="admin-gallery">{photos.map((photo) => <img className="admin-photo" key={photo.path} src={photo.signedUrl} alt={photo.path} />)}</div> : !loading && <p className="empty-album">No photos found in the private bucket.</p>}</section></main>
}

function App() { return window.location.pathname === '/admin' ? <AdminPage /> : <><UploadPage /><GuestMediaActions /></> }

export default App
