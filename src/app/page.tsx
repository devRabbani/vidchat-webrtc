'use client'

import { db } from "@/lib/firebase"
import { addDoc, collection, doc, getDoc, onSnapshot, setDoc, updateDoc } from "firebase/firestore"
import { useRef, useState } from "react"

type Streams = MediaStream | null

export default function Home() {

  // States
  const [callId, setCallId] = useState<string>("")

  const inputRef = useRef<HTMLInputElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  // Refs for Browser APIs
  const pcRef = useRef<RTCPeerConnection | null>(null)


  const servers = {
    iceServers: [
      {
        urls: [
          "stun:stun1.l.google.com:19302",
          "stun:stun2.l.google.com:19302",
        ],
      },
    ],
    iceCandidatePoolSize: 10,
}

  // Global State
  // const pc = new RTCPeerConnection(servers)
  let localStream : Streams = null
  let remoteStream : Streams = null


  // Functions

  const initializeCamera = async () => {
    pcRef.current = new RTCPeerConnection(servers)
    const pc = pcRef.current!
    // Get local stream, show it in self-view and add it to be sent.
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    remoteStream = new MediaStream();

    // Add tracks from local stream to peer connection
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream!);
    });

    // Get tracks from remote stream
    pc.ontrack = (e) => {
      e.streams[0].getTracks().forEach((track) => {
        remoteStream!.addTrack(track);
      });
    };

    remoteVideoRef.current!.srcObject = remoteStream;
    localVideoRef.current!.srcObject = localStream;
  }


  const startCall = async () => {
    const pc = pcRef.current!
    // Firsetore References
    const callDoc = doc(collection(db, 'calls'))
    const offerCandidates = collection(callDoc, 'offerCandidates')
    const answerCandidates = collection(callDoc, 'answerCandidates')

    // Set the callId
    setCallId(callDoc.id)


    // Get ICE candidates for caller and save to offererCandidates collection
    pc.onicecandidate = (e) => {
      e.candidate && addDoc(offerCandidates, e.candidate.toJSON())
    }

    // Create Offer
    const offerDescription = await pc.createOffer()
    await pc.setLocalDescription(offerDescription)

    const offer = {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    }

    // Add Offer to Call Document
    await setDoc(callDoc, { offer })
    
    // Realtime listener for answer
    onSnapshot(callDoc, snapshot => {
      const data = snapshot.data()

      if (!pc.currentRemoteDescription && data?.answer) {
        const anserDescription = new RTCSessionDescription(data.answer)
        pc.setRemoteDescription(anserDescription)
      }
    })

    // Listen for remote ICE candidates and add to peer connection
    onSnapshot(answerCandidates, snapshot => { 
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data())
          pc.addIceCandidate(candidate)
        }
      })
    })
  }

  // Answer Call
  const answerCall = async () => {
    const pc = pcRef.current!
    const remoteCallId = inputRef.current?.value
    if (!remoteCallId) return

    const callDoc = doc(db, 'calls', remoteCallId)
    const answerCandidates = collection(callDoc, 'answerCandidates')
    const offerCandidates = collection(callDoc, 'offerCandidates')

    pc.onicecandidate = (e) => {
      e.candidate && addDoc(answerCandidates,e.candidate.toJSON())
    }

    const callData = (await getDoc(callDoc)).data()

    const offerDescription = new RTCSessionDescription(callData?.offer)
    await pc.setRemoteDescription(offerDescription)

    const answerDescription = await pc.createAnswer()
    await pc.setLocalDescription(answerDescription)

    const answer = {
      sdp: answerDescription.sdp,
      type: answerDescription.type,
    }

    await updateDoc(callDoc, { answer })
    

    onSnapshot(offerCandidates, snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data())
          pc.addIceCandidate(candidate)
        }
      })
    })

  }

  return (
    <div className="max-w-5xl mx-auto p-5">
      {/* VIDEO STREAMS */}
      <div className="relative">
        {/* REMOTE */}
        <video
          ref={remoteVideoRef}
          playsInline
          autoPlay
          className="aspect-video bg-blue-300 rounded-md"
        ></video>
        {/* LOCAL */}
        <video
          ref={localVideoRef}
          playsInline
          autoPlay
          className="w-1/3 absolute bottom-2 right-2 aspect-video bg-orange-300 rounded-md"
        ></video>
      </div>
    
      {/* CONTROLS */}
      <div className="mt-4">
        <button onClick={initializeCamera}>Initialize</button>
        {!!callId && (
          <p>
            <strong>Call id :</strong> {callId}
          </p>
        )}

        <button
          className="bg-blue-500 hover:bg-blue-600 active:bg-blue-700 transition-all cursor-pointer text-white px-4 py-2 rounded-md shadow-sm"
          onClick={startCall}
        >
          Start Call
        </button>
        <p>Or</p>
        <div className="flex gap-4">
          <input
            type="text"
            className=""
            ref={inputRef}
            placeholder="Enter the ID of the session"
          />
          <button className="bg-teal-500 hover:bg-teal-600 active:bg-teal-700 transition-all cursor-pointer text-white px-4 py-2 rounded-md shadow-sm" onClick={answerCall}>
            Join Call
          </button>
        </div>
        <button className="mt-4 bg-red-500 hover:bg-red-600 active:bg-red-700 transition-all cursor-pointer text-white px-4 py-2 rounded-md shadow-sm">
          Disconnect
        </button>
      </div>
    </div>
  );
}
