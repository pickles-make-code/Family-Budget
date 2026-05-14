// ─────────────────────────────────────────────────────────────
//  STEP 1: Paste your Firebase config here
//  (from Firebase Console → Project Settings → Your Apps → SDK setup)
// ─────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN_HERE",
  projectId: "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID_HERE",
  appId: "PASTE_YOUR_APP_ID_HERE"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
