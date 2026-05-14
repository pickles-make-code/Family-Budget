# 💰 Family Budget App

A personal budget tracker that syncs across your phone and computer in real time, powered by Firebase.

---

## 🚀 Setup Guide (takes about 15 minutes)

### STEP 1 — Create a Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** → name it anything (e.g. "Family Budget")
3. Disable Google Analytics (not needed) → click **"Create project"**

---

### STEP 2 — Set up Firestore database

1. In the left sidebar click **"Firestore Database"**
2. Click **"Create database"**
3. Choose **"Start in test mode"** (you can lock it down later)
4. Pick any region close to you → click **"Enable"**

---

### STEP 3 — Get your Firebase config

1. Click the ⚙️ gear icon → **"Project settings"**
2. Scroll down to **"Your apps"** → click the **`</>`** (Web) icon
3. Register the app with any nickname (e.g. "budget-web")
4. Copy the `firebaseConfig` object that appears — it looks like:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc123"
}
```

5. Open the file `src/firebase.js` in this project and paste your values in (replacing the `PASTE_YOUR_..._HERE` placeholders)

---

### STEP 4 — Deploy to Vercel

1. Push this folder to a **GitHub repo** (free at github.com)
   - Create a new repo, then drag the project folder into it

2. Go to **https://vercel.com** → sign in with GitHub → click **"Add New Project"**

3. Import your GitHub repo → click **"Deploy"**

4. Vercel gives you a free URL like `https://family-budget-abc123.vercel.app`
   — open that on your phone and computer and bookmark it!

---

### STEP 5 — Add your Vercel URL to Firebase (fixes any errors)

1. In Firebase Console → **Authentication** → **Settings** → **Authorised domains**
2. Add your Vercel URL (e.g. `family-budget-abc123.vercel.app`)

---

## ✅ That's it!

Every change you make (budget items, debt payments, etc.) saves automatically to Firebase within a second. Open the same URL on any device and it'll be in sync.

---

## 🔒 Optional: Lock down your database (recommended)

Once it's working, go to Firestore → **Rules** and replace the rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /budgets/{docId} {
      allow read, write: if true; // or add auth rules later
    }
  }
}
```

For now "test mode" works fine for personal use.

---

## 🛠 Running locally (optional)

```bash
npm install
npm run dev
```

Then open http://localhost:5173
