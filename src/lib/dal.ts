import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type QuerySnapshot,
  type DocumentSnapshot,
} from 'firebase/firestore'
import { db } from './firebase'

export type CallRefs = {
  callDoc: DocumentReference<DocumentData>
  offerCandidates: CollectionReference<DocumentData>
  answerCandidates: CollectionReference<DocumentData>
}

// Create a new call document and its subcollections
export const createCallRefs = (): CallRefs => {
  const callDoc = doc(collection(db, 'calls'))
  const offerCandidates = collection(callDoc, 'offerCandidates')
  const answerCandidates = collection(callDoc, 'answerCandidates')
  return { callDoc, offerCandidates, answerCandidates }
}

// Get existing call document by id and its subcollections
export const getCallRefs = (id: string): CallRefs => {
  const callDoc = doc(db, 'calls', id)
  const offerCandidates = collection(callDoc, 'offerCandidates')
  const answerCandidates = collection(callDoc, 'answerCandidates')
  return { callDoc, offerCandidates, answerCandidates }
}

// Write offer/answer payloads
export const writeOffer = (callDoc: DocumentReference<DocumentData>, offer: RTCSessionDescriptionInit) => {
  return setDoc(callDoc, { offer })
}

export const writeAnswer = (callDoc: DocumentReference<DocumentData>, answer: RTCSessionDescriptionInit) => {
  return updateDoc(callDoc, { answer })
}

// Add ICE candidates
export const addOfferIceCandidate = (
  offerCandidates: CollectionReference<DocumentData>,
  candidate: RTCIceCandidateInit
) => addDoc(offerCandidates, candidate)

export const addAnswerIceCandidate = (
  answerCandidates: CollectionReference<DocumentData>,
  candidate: RTCIceCandidateInit
) => addDoc(answerCandidates, candidate)

// Listeners (return Unsubscribe)
export const listenCallDoc = (
  callDoc: DocumentReference<DocumentData>,
  onNext: (snapshot: DocumentSnapshot<DocumentData>) => void,
  onError?: (error: any) => void
) => onSnapshot(callDoc, onNext, onError)

export const listenOfferCandidates = (
  offerCandidates: CollectionReference<DocumentData>,
  onNext: (snapshot: QuerySnapshot<DocumentData>) => void,
  onError?: (error: any) => void
) => onSnapshot(offerCandidates, onNext, onError)

export const listenAnswerCandidates = (
  answerCandidates: CollectionReference<DocumentData>,
  onNext: (snapshot: QuerySnapshot<DocumentData>) => void,
  onError?: (error: any) => void
) => onSnapshot(answerCandidates, onNext, onError)

// Read a call doc once
export const getCallData = async (callDoc: DocumentReference<DocumentData>) => {
  return (await getDoc(callDoc)).data()
}
