import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  onSnapshot,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type QuerySnapshot,
  type DocumentSnapshot,
  type FirestoreError,
} from 'firebase/firestore'
import { db } from './firebase'
import { serverTimestamp } from 'firebase/firestore'

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
  // include timestamps to support TTL/cleanup
  return setDoc(callDoc, { offer, createdAt: serverTimestamp() })
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
  onError?: (error: FirestoreError) => void
) => onSnapshot(callDoc, onNext, onError)

export const listenOfferCandidates = (
  offerCandidates: CollectionReference<DocumentData>,
  onNext: (snapshot: QuerySnapshot<DocumentData>) => void,
  onError?: (error: FirestoreError) => void
) => onSnapshot(offerCandidates, onNext, onError)

export const listenAnswerCandidates = (
  answerCandidates: CollectionReference<DocumentData>,
  onNext: (snapshot: QuerySnapshot<DocumentData>) => void,
  onError?: (error: FirestoreError) => void
) => onSnapshot(answerCandidates, onNext, onError)

// Read a call doc once
export const getCallData = async (callDoc: DocumentReference<DocumentData>) => {
  return (await getDoc(callDoc)).data()
}

// Best-effort cleanup: delete all docs in a subcollection
export const deleteAllDocsInCollection = async (coll: CollectionReference<DocumentData>) => {
  const snap = await getDocs(coll)
  if (snap.empty) return

  // Firestore limits batches to 500 operations. Chunk if needed.
  const docs = snap.docs
  const chunkSize = 450
  for (let i = 0; i < docs.length; i += chunkSize) {
    const batch = writeBatch(db)
    for (const d of docs.slice(i, i + chunkSize)) {
      batch.delete(d.ref)
    }
    await batch.commit()
  }
}

// Delete the call doc and its subcollections (offer/answer candidates)
export const deleteCallData = async (id: string) => {
  const { callDoc, offerCandidates, answerCandidates } = getCallRefs(id)
  try { await deleteAllDocsInCollection(offerCandidates) } catch {}
  try { await deleteAllDocsInCollection(answerCandidates) } catch {}
  try { await deleteDoc(callDoc) } catch {}
}
