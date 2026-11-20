
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import { getDatabase } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

import { getStorage } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

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

const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const storage = getStorage(app);

export { app, auth, db, rtdb, storage };
