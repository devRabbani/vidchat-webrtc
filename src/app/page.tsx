'use client'

import { useRef, useState } from "react"
import {
  addAnswerIceCandidate,
  addOfferIceCandidate,
  createCallRefs,
  getCallData,
  getCallRefs,
  listenAnswerCandidates,
  listenCallDoc,
  listenOfferCandidates,
  writeAnswer,
  writeOffer,
} from "@/lib/dal"
import { Toaster, toast } from 'sonner'

type Streams = MediaStream | null

export default function Home() {
  // UI state
  const [callId, setCallId] = useState<string>("")
  const [status, setStatus] = useState<string>('idle') // idle | initialized | connecting | connected | disconnected | failed

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

  // STUN servers for ICE. In production, add a TURN server for reliability.
  const servers: RTCConfiguration = {
    iceServers: [
      {
        urls: [
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
        ],
      },
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
      toast.success('Camera initialized')
    } catch (err) {
      console.error('initializeCamera error', err)
      toast.error('Failed to access camera/mic')
    }
  }

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
  const disconnect = () => {
    try {
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

      // Keep the call id visible (can be useful), but you could clear it
      // setCallId("")
      setStatus('disconnected')
      toast('Disconnected')
    } catch (err) {
      console.error('disconnect error', err)
      toast.error('Failed to disconnect')
    }
  }

  const isReady = !!localStreamRef.current && !!pcRef.current

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
    <div className="max-w-5xl mx-auto p-5">
      <Toaster position="top-center" richColors closeButton />
      {/* VIDEO STREAMS */}
      <div className="relative">
        {/* REMOTE */}
        <video
          ref={remoteVideoRef}
          playsInline
          autoPlay
          className="aspect-video bg-blue-300 rounded-md"
        ></video>
        {/* Connected indicator overlay */}
        {status === 'connected' && (
          <div
            className="absolute top-2 left-2 z-10 inline-flex items-center gap-2 rounded-full bg-green-600/90 text-white text-xs px-2 py-1 shadow"
            aria-live="polite"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>Connected</span>
          </div>
        )}
        {/* LOCAL */}
        <video
          ref={localVideoRef}
          playsInline
          autoPlay
          className="w-1/3 absolute bottom-2 right-2 aspect-video bg-orange-300 rounded-md"
        ></video>
      </div>

      {/* CONTROLS */}
      <div className="mt-4 flex flex-col gap-3">
        <div className={`inline-flex items-center gap-2 self-start px-3 py-1 rounded text-sm ${statusBadge[status] ?? statusBadge['idle']}`}>
          <span className="uppercase tracking-wide">Status</span>
          <span className="font-medium">{status}</span>
        </div>
        <button onClick={initializeCamera}>Initialize</button>
        {!!callId && (
          <p className="flex items-center gap-2">
            <strong>Call id :</strong> <span className="font-mono">{callId}</span>
            <button
              className="text-sm px-2 py-1 rounded border hover:bg-zinc-100 dark:hover:bg-zinc-900"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(callId)
                  toast.success('Copied call id')
                } catch {
                  toast.error('Copy failed')
                }
              }}
              title="Copy call id"
            >
              Copy
            </button>
          </p>
        )}

        <button
          className="bg-blue-500 hover:bg-blue-600 active:bg-blue-700 transition-all cursor-pointer text-white px-4 py-2 rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={startCall}
          disabled={!isReady}
          aria-disabled={!isReady}
          title={!isReady ? 'Initialize camera first' : 'Create a new call'}
        >
          Start Call
        </button>
        <p>Or</p>
        <div className="flex gap-4 items-center">
          <input
            type="text"
            className="border rounded px-2 py-1 min-w-64"
            ref={inputRef}
            placeholder="Enter the ID of the session"
            aria-label="Call ID to join"
          />
          <button
            className="bg-teal-500 hover:bg-teal-600 active:bg-teal-700 transition-all cursor-pointer text-white px-4 py-2 rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={answerCall}
            disabled={!isReady}
            aria-disabled={!isReady}
            title={!isReady ? 'Initialize camera first' : 'Join an existing call'}
          >
            Join Call
          </button>
        </div>
        <button
          onClick={disconnect}
          className="mt-2 bg-red-500 hover:bg-red-600 active:bg-red-700 transition-all cursor-pointer text-white px-4 py-2 rounded-md shadow-sm"
        >
          Disconnect
        </button>
        {/* Note: In a production app, consider deleting the call doc and subcollections when both peers leave. */}
      </div>
    </div>
  );
}
