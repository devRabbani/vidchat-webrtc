import { collection, doc } from "firebase/firestore"
import { db } from "./firebase"


// Create Offer
export const createOffer = async () => { 
    const callDoc = doc(collection(db, 'calls'))
    const offerCandidates = collection(callDoc, 'offerCandidates')
    const answerCandidates = collection(callDoc, 'answerCandidates')
}