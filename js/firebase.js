
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";

import { getAuth } from
  "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import { getFirestore } from
  "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import { getStorage } from
  "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAwl6AY7gy7c-zDrpGWcXhypw_Igqk5tKY",
  authDomain: "zora-dev2.firebaseapp.com",
  projectId: "zora-dev2",
  storageBucket: "zora-dev2.firebasestorage.app",
  messagingSenderId: "888945947839",
  appId: "1:888945947839:web:58c9857af469906e7d020a",
  measurementId: "G-KCSM7J6XLL"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
