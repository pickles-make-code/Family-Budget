// ─────────────────────────────────────────────────────────────
//  STEP 1: Paste your Firebase config here
//  (from Firebase Console → Project Settings → Your Apps → SDK setup)
// ─────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyAkyGDVCWPGS_7rfhj56vDUSs1hvfaPH1k",
  authDomain: "personal-budget-1ebe3.firebaseapp.com",
  projectId: "personal-budget-1ebe3",
  storageBucket: "personal-budget-1ebe3.firebasestorage.app",
  messagingSenderId: "885010100680",
  appId: "1:885010100680:web:f5d63c7b16f3ef8a7ad0fd"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
