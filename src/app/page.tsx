'use client'

import { useEffect, useMemo, useRef, useState } from "react"
import {
  addAnswerIceCandidate,
  addOfferIceCandidate,
  createCallRefs,
  deleteCallData,
  getCallData,
  getCallRefs,
  listenAnswerCandidates,
  listenCallDoc,
  listenOfferCandidates,
  writeAnswer,
  writeOffer,
} from "@/lib/dal"
import { Toaster, toast } from 'sonner'
import { Plus, LogIn, Link as LinkIcon, Hash, Power } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

type Streams = MediaStream | null

export default function Home() {
  // UI state
  const [callId, setCallId] = useState<string>("")
  const [status, setStatus] = useState<string>('idle') // idle | initialized | connecting | connected | disconnected | failed
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [joining, setJoining] = useState<boolean>(false)
  const [inSession, setInSession] = useState<boolean>(false)
  const router = useRouter()
  const search = useSearchParams()

  // DOM refs
  const inputRef = useRef<HTMLInputElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  // Browser API refs (kept stable across renders)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<Streams>(null)
  const remoteStreamRef = useRef<Streams>(null)

  // Firestore listener unsubscribe refs so we can clean up on disconnect
  const callDocUnsubRef = useRef<null | (() => void)>(null)
  const offerCandUnsubRef = useRef<null | (() => void)>(null)
  const answerCandUnsubRef = useRef<null | (() => void)>(null)

  // STUN/TURN servers for ICE. In production, include a TURN server for reliability.
  const servers: RTCConfiguration = {
    iceServers: [
      {
        urls: [
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
        ],
      },
      // Optional TURN via env (NEXT_PUBLIC_TURN_URLS comma-separated)
      ...(process.env.NEXT_PUBLIC_TURN_URLS
        ? [{
            urls: process.env.NEXT_PUBLIC_TURN_URLS.split(',').map(s => s.trim()),
            username: process.env.NEXT_PUBLIC_TURN_USERNAME,
            credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
          } as RTCIceServer]
        : []),
    ],
    iceCandidatePoolSize: 10,
  }

  // Camera + mic setup and attach tracks to a new RTCPeerConnection
  const initializeCamera = async () => {
    try {
      // Create a new peer connection for this session
      pcRef.current = new RTCPeerConnection(servers)
      const pc = pcRef.current
      if (!pc) return

      // Track connection state for user feedback
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState
        if (st === 'connected') {
          setStatus('connected')
          toast.success('Connected')
        } else if (st === 'failed') {
          setStatus('failed')
          toast.error('Connection failed')
        } else if (st === 'disconnected' || st === 'closed') {
          setStatus('disconnected')
        }
      }
      // Log ICE changes to aid debugging in production
      pc.oniceconnectionstatechange = () => {
        // console.debug('iceConnectionState', pc.iceConnectionState)
      }

      // Get local stream and show preview
      const local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = local

      // Create a container for incoming remote tracks
      const remote = new MediaStream()
      remoteStreamRef.current = remote

      // Send local tracks
      local.getTracks().forEach((track) => pc.addTrack(track, local))

      // Receive remote tracks
      pc.ontrack = (e) => {
        e.streams[0]?.getTracks().forEach((track) => remote.addTrack(track))
      }

      // Attach streams to video elements
      if (localVideoRef.current) {
        // Avoid audio feedback from your own mic
        localVideoRef.current.muted = true
        localVideoRef.current.srcObject = local
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remote
      }
      setStatus('initialized')
      setMediaError(null)
      toast.success('Camera initialized')
    } catch (err) {
      console.error('initializeCamera error', err)
      let msg = 'Failed to access camera/mic'
      try {
        const e = err as any
        const name = (e && (e.name || e.code)) || ''
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          msg = 'Allow mic/camera in the browser to join'
        }
      } catch {}
      setMediaError(msg)
      toast.error(msg)
    }
  }

  // Auto-initialize camera on mount
  useEffect(() => {
    initializeCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redirect to meeting if session exists and URL lacks searchParams
  useEffect(() => {
    const id = search.get('id') || ''
    if (id) return
    try {
      const raw = localStorage.getItem('vcw.session')
      if (!raw) return
      const s = JSON.parse(raw) as { callId?: string; role?: string }
      if (s?.callId) {
        router.replace(`/?id=${encodeURIComponent(s.callId)}${s.role ? `&role=${encodeURIComponent(s.role)}` : ''}`)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Start a new call and publish the offer + ICE candidates
  const startCall = async () => {
    try {
      const pc = pcRef.current
      if (!pc) {
        console.warn('PeerConnection not ready. Click Initialize first.')
        toast.warning('Initialize camera first')
        return
      }

      // Firsetore References (wrapped by DAL)
      const { callDoc, offerCandidates, answerCandidates } = createCallRefs()

      // Expose the call id for sharing
      setCallId(callDoc.id)
      setInSession(true)

      // Gather local ICE and write to offerCandidates
      pc.onicecandidate = (e) => {
        if (e.candidate) addOfferIceCandidate(offerCandidates, e.candidate.toJSON())
      }

      setStatus('connecting')

      // Create and set local offer
      const offerDescription = await pc.createOffer()
      await pc.setLocalDescription(offerDescription)

      const offer = { sdp: offerDescription.sdp, type: offerDescription.type }
      await writeOffer(callDoc, offer)
      toast.success('Call created')

      // Persist session and update URL for share/join links (root path)
      try {
        localStorage.setItem('vcw.session', JSON.stringify({ role: 'caller', callId: callDoc.id }))
      } catch {}
      const url = `/?id=${encodeURIComponent(callDoc.id)}&role=caller`
      router.replace(url)

      // Listen for an answer and set as remote description
      callDocUnsubRef.current = listenCallDoc(callDoc, (snapshot) => {
        const data = snapshot.data()
        if (!pc.currentRemoteDescription && data?.answer) {
          const anserDescription = new RTCSessionDescription(data.answer)
          pc.setRemoteDescription(anserDescription)
        }
      }, (error) => {
        console.error('callDoc onSnapshot error', error)
      })

      // Listen for remote ICE candidates
      answerCandUnsubRef.current = listenAnswerCandidates(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const candidate = new RTCIceCandidate(change.doc.data())
            pc.addIceCandidate(candidate)
          }
        })
      }, (error) => {
        console.error('answerCandidates onSnapshot error', error)
      })
    } catch (err) {
      console.error('startCall error', err)
      toast.error('Failed to start call')
    }
  }

  // Join an existing call by ID and publish the answer + ICE candidates
  const answerCall = async () => {
    try {
      const pc = pcRef.current
      const remoteCallId = inputRef.current?.value
      if (!pc || !remoteCallId) return

      const { callDoc, answerCandidates, offerCandidates } = getCallRefs(remoteCallId)
      setInSession(true)

      // Gather local ICE and write to answerCandidates
      pc.onicecandidate = (e) => {
        if (e.candidate) addAnswerIceCandidate(answerCandidates, e.candidate.toJSON())
      }

      const callData = await getCallData(callDoc)
      if (!callData?.offer) {
        console.warn('No offer found for this call id')
        toast.warning('No offer found for this id')
        return
      }

      const offerDescription = new RTCSessionDescription(callData.offer)
      await pc.setRemoteDescription(offerDescription)

      setStatus('connecting')

      const answerDescription = await pc.createAnswer()
      await pc.setLocalDescription(answerDescription)

      const answer = { sdp: answerDescription.sdp, type: answerDescription.type }
      await writeAnswer(callDoc, answer)
      toast.success('Joined call')

      try {
        localStorage.setItem('vcw.session', JSON.stringify({ role: 'answerer', callId: remoteCallId }))
      } catch {}
      const url = `/?id=${encodeURIComponent(remoteCallId)}&role=answerer`
      router.replace(url)

      // Listen for caller ICE candidates
      offerCandUnsubRef.current = listenOfferCandidates(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const candidate = new RTCIceCandidate(change.doc.data())
            pc.addIceCandidate(candidate)
          }
        })
      }, (error) => {
        console.error('offerCandidates onSnapshot error', error)
      })
    } catch (err) {
      console.error('answerCall error', err)
      toast.error('Failed to join call')
    }
  }

  // Stop media, close PC, unsubscribe Firestore listeners, and clear UI
  const disconnect = async () => {
    try {
      // Snapshot session before clearing
      let sess: { role?: string; callId?: string } | null = null
      try {
        const raw = localStorage.getItem('vcw.session')
        if (raw) sess = JSON.parse(raw)
      } catch {}
      // Unsubscribe Firestore listeners if any
      callDocUnsubRef.current?.()
      offerCandUnsubRef.current?.()
      answerCandUnsubRef.current?.()
      callDocUnsubRef.current = null
      offerCandUnsubRef.current = null
      answerCandUnsubRef.current = null

      // Close peer connection
      if (pcRef.current) {
        pcRef.current.onicecandidate = null
        pcRef.current.ontrack = null
        pcRef.current.close()
        pcRef.current = null
      }

      // Stop local tracks
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      remoteStreamRef.current?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      remoteStreamRef.current = null

      // Detach from video elements
      if (localVideoRef.current) localVideoRef.current.srcObject = null
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      // Best-effort: delete call data if you are the caller (ask first)
      const idToClear = callId || sess?.callId || ''
      const role = sess?.role || ''
      if (idToClear && role === 'caller') {
        let shouldDelete = false
        try {
          // Simple confirmation. If declined, we only leave locally.
          shouldDelete = typeof window !== 'undefined'
            ? window.confirm('End meeting for everyone and delete the meeting link?')
            : false
        } catch {}
        if (shouldDelete) {
          try {
            await deleteCallData(idToClear)
            toast.success('Meeting data deleted')
          } catch (e) {
            console.error('deleteCallData error', e)
          }
        }
      }

      // Clear persisted session (user left)
      try { localStorage.removeItem('vcw.session') } catch {}
      setStatus('disconnected')
      setInSession(false)
      toast('Disconnected')
      // Clear UI state and URL
      setCallId("")
      if (inputRef.current) inputRef.current.value = ""
      router.replace('/')
    } catch (err) {
      console.error('disconnect error', err)
      toast.error('Failed to disconnect')
    }
  }

  // Current persisted context (URL takes precedence over localStorage)
  const persisted = useMemo(() => {
    const fromUrlId = search.get('id') || ''
    const fromUrlRole = search.get('role') || ''
    if (fromUrlId) return { callId: fromUrlId, role: fromUrlRole }
    try {
      const raw = localStorage.getItem('vcw.session')
      if (raw) {
        const s = JSON.parse(raw) as { callId?: string; role?: string }
        return { callId: s.callId || '', role: s.role || '' }
      }
    } catch {}
    return { callId: '', role: '' }
  }, [search])

  const isReady = !!localStreamRef.current && !!pcRef.current

  // Auto-join when a user opens a join link like /?id=<callId>
  // Will not trigger if role=caller (so callers don't re-join as answerers).
  const autoJoinTriedRef = useRef(false)
  useEffect(() => {
    if (autoJoinTriedRef.current) return
    if (!isReady) return

    const id = search.get('id') || ''
    const role = (search.get('role') || '').toLowerCase()
    if (!id) return
    if (role === 'caller') return

    // Prefill and auto-join
    if (inputRef.current) inputRef.current.value = id
    autoJoinTriedRef.current = true
    ;(async () => {
      try {
        setJoining(true)
        await answerCall()
      } finally {
        setJoining(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, search])

  // status badge styles
  const statusBadge: Record<string, string> = {
    idle: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
    initialized: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
    connecting: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
    connected: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
    disconnected: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <Toaster position="top-right"/>
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-300/60 bg-zinc-100/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap-reverse items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {!inSession && (
              <>
                <button
                  className="text-sm h-10 px-3 rounded border bg-emerald-200 text-emerald-950 cursor-pointer border-emerald-300 hover:bg-emerald-300 disabled:opacity-50 inline-flex items-center"
                  onClick={async () => {
                    if (!isReady) await initializeCamera()
                    await startCall()
                  }}
                  disabled={!isReady}
                >
                  <span className="inline-flex items-center gap-1.5" title="New meeting">
                    <Plus size={16} className="inline-block"/>
                    New
                  </span>
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Call ID"
                  defaultValue={(search.get('id') || '')}
                  className="text-sm h-10 px-2 rounded border border-zinc-300 bg-white w-44 placeholder:text-zinc-500 outline-none focus:ring-2 ring-sky-400"
                />
                <button
                  className="text-sm h-10 px-3 rounded border bg-sky-200 text-sky-950 border-sky-300 hover:bg-sky-300 disabled:opacity-50 inline-flex items-center cursor-pointer"
                  onClick={answerCall}
                  // disabled={!isReady}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <LogIn size={16} className="inline-block"/>
                    Join
                  </span>
                </button>
              </>
            )}
            {inSession && (
              <>
                {!!callId && (
                  <>
                    <button
                      className="text-xs h-10 px-2 rounded border border-zinc-300 bg-zinc-200 cursor-pointer hover:bg-zinc-300 inline-flex items-center"
                      title="Copy call id"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(callId); toast.success('Copied call id') } catch { toast.error('Copy failed') }
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Hash size={14} className="inline-block"/>
                        ID
                      </span>
                    </button>
                    <button
                      className="text-xs h-10 px-2 rounded border border-zinc-300 bg-zinc-200 cursor-pointer hover:bg-zinc-300 inline-flex items-center"
                      title="Copy join link"
                      onClick={async () => {
                        try { const url = `${window.location.origin}/?id=${encodeURIComponent(callId)}`; await navigator.clipboard.writeText(url); toast.success('Copied join link') } catch { toast.error('Copy failed') }
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <LinkIcon size={14} className="inline-block"/>
                        Link
                      </span>
                    </button>
                  </>
                )}
                <button
                  className="text-sm h-10 px-3 rounded border bg-rose-200 text-rose-950 cursor-pointer border-rose-300 hover:bg-rose-300 inline-flex items-center"
                  onClick={disconnect}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Power size={16} className="inline-block"/>
                    Disconnect
                  </span>
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className={`inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full ${status === 'connected' ? 'bg-emerald-300 text-emerald-950' : status === 'connecting' ? 'bg-sky-300 text-sky-950' : status === 'initialized' ? 'bg-amber-300 text-amber-950' : status === 'failed' ? 'bg-rose-300 text-rose-950' : 'bg-zinc-300 text-zinc-900'}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-700' : status === 'connecting' ? 'bg-sky-700' : status === 'initialized' ? 'bg-amber-700' : status === 'failed' ? 'bg-rose-700' : 'bg-zinc-700'}`}></span>
              <span className="capitalize">{status}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="max-w-5xl mx-auto px-4 py-5 w-full">
      {/* VIDEO STREAMS */}
      <div className="relative">
        {mediaError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <div className="px-4 py-3 rounded border bg-amber-200/40 text-amber-950 border-amber-300 text-sm shadow">
              {mediaError}
            </div>
          </div>
        )}
        {/* Joining banner for invitees */}
        {joining && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 rounded-full border bg-sky-200 text-sky-950 border-sky-300 text-xs px-3 py-1 shadow">
            Joining…
          </div>
        )}
        {/* REMOTE */}
        <video
          ref={remoteVideoRef}
          playsInline
          autoPlay
          className="w-full aspect-video object-cover bg-zinc-200 rounded-md"
        ></video>
        {/* LOCAL */}
        <video
          ref={localVideoRef}
          playsInline
          autoPlay
          className="w-1/3 absolute bottom-2 right-2 aspect-video object-cover bg-zinc-300/80 rounded-md"
        ></video>
      </div>

      </div>
    </div>
  )
}
