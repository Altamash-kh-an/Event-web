import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { PHOTO_BUCKET, supabase } from './lib/supabase'
import { siteConfig } from './siteConfig'
import './App.css'
import './admin.css'

const GUEST_UPLOAD_FOLDER = siteConfig.uploadFolder
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL

function isImageFile(item) {
  const mimeType = item.metadata?.mimetype
  return (typeof mimeType === 'string' && mimeType.startsWith('image/')) || /\.(jpe?g|png|webp|heic|heif)$/i.test(item.name)
}

async function listAllPhotos(prefix = '') {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).list(prefix, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) throw error
  const files = []
  for (const item of data || []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name
    if (item.id === null) files.push(...await listAllPhotos(path))
    else if (item.name !== '.emptyFolderPlaceholder' && isImageFile(item)) files.push({ ...item, path })
  }
  return files
}

function UploadPage() {
  const inputRef = useRef(null)
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

  function choosePhotos(files) {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/'))
    if (!selected.length) return setMessage('Please choose an image file to continue.')
    setPhotos((current) => [...current, ...selected.map((file) => ({ file, url: URL.createObjectURL(file) }))])
    setMessage('')
  }

  async function upload() {
    if (!photos.length) return inputRef.current?.click()
    setUploading(true)
    setUploadProgress(0)
    setMessage('Uploading your memories…')
    const failures = []
    for (const [index, photo] of photos.entries()) {
      const safeName = photo.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      const path = `${GUEST_UPLOAD_FOLDER}/${crypto.randomUUID()}-${safeName}`
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, photo.file, { contentType: photo.file.type, upsert: false })
      if (error) failures.push(photo.file.name)
      setUploadProgress(Math.round(((index + 1) / photos.length) * 100))
    }
    photos.forEach((photo) => URL.revokeObjectURL(photo.url))
    setPhotos([])
    setUploading(false)
    if (failures.length) setMessage(`Could not upload: ${failures.join(', ')}`)
    else {
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

function App() { return window.location.pathname === '/admin' ? <AdminPage /> : <UploadPage /> }

export default App
