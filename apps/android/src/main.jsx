import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App.jsx'

const API_BASE = 'http://127.0.0.1:3300'

async function startNodeBackend() {
  if (!Capacitor.isNativePlatform()) return

  const { NodeJS } = await import('@capacitor-community/capacitor-nodejs')
  const { Filesystem, Directory } = await import('@capacitor/filesystem')

  const { uri } = await Filesystem.getUri({ path: '', directory: Directory.Data })
  const dataDir = uri.replace('file://', '')

  await new Promise((resolve, reject) => {
    NodeJS.addListener('loaded', () => {
      NodeJS.send({ eventName: 'init', args: [{ dataDir }] })
    })
    NodeJS.addListener('ready', () => resolve())
    NodeJS.addListener('error', (e) => reject(new Error(e?.message ?? 'Node.js error')))
    NodeJS.start({ entryFilePath: 'main.js' }).catch(reject)
  })
}

async function waitForServer(retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (r.ok) return
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Backend did not start in time')
}

function Root() {
  const [ready, setReady] = useState(!Capacitor.isNativePlatform())
  const [error, setError] = useState(null)

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      startNodeBackend()
        .then(() => waitForServer())
        .then(() => setReady(true))
        .catch(e => setError(e.message))
    }
  }, [])

  if (error) {
    return (
      <div style={{
        display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', height:'100vh', background:'#0A0E20',
        color:'#ff6b6b', padding:24, textAlign:'center'
      }}>
        <p style={{fontSize:16}}>后端启动失败</p>
        <p style={{fontSize:12, marginTop:8, opacity:0.7}}>{error}</p>
      </div>
    )
  }

  if (!ready) {
    return (
      <div style={{
        display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', height:'100vh', background:'#0A0E20',
        color:'rgba(255,255,255,0.7)', gap:16
      }}>
        <div style={{
          width:40, height:40, borderRadius:'50%',
          border:'3px solid rgba(255,255,255,0.15)',
          borderTopColor:'rgba(255,255,255,0.7)',
          animation:'spin 0.8s linear infinite'
        }} />
        <p style={{fontSize:14}}>正在启动…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  return (
    <StrictMode>
      <App />
    </StrictMode>
  )
}

createRoot(document.getElementById('root')).render(<Root />)
