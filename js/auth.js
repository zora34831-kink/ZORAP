
import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

const form = $("authForm");
const title = $("authTitle");
const description = $("authDescription");
const submit = $("authSubmit");
const submitText = $("authSubmitText");

let mode = "login";
let loading = false;

// =====================================
// UI HELPERS
// =====================================

function showMessage(type, message) {
  $("authError").hidden = type !== "error";
  $("authSuccess").hidden = type !== "success";

  if (type === "error") {
    $("authError").textContent = message;
  } else {
    $("authSuccess").textContent = message;
  }
}

function clearMessages() {
  $("authError").hidden = true;
  $("authSuccess").hidden = true;
}

function setLoading(value) {
  loading = value;
  submit.disabled = value;
  submitText.textContent = value ? "Please wait..." :
    mode === "login" ? "Sign in" : "Create account";
}

function setMode(nextMode) {
  mode = nextMode;
  clearMessages();

  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });

  const registering = mode === "register";

  $("nameField").hidden = !registering;
  $("usernameField").hidden = !registering;
  $("confirmPasswordField").hidden = !registering;
  $("forgotPassword").hidden = registering;

  $("authName").required = registering;
  $("authUsername").required = registering;
  $("authConfirmPassword").required = registering;

  $("authPassword").autocomplete =
    registering ? "new-password" : "current-password";

  title.textContent = registering ? "Create your account" : "Welcome back";

  description.textContent = registering
    ? "Set up your account and join the conversation."
    : "Sign in to continue your conversations.";

  setLoading(false);
}

// =====================================
// USERNAME VALIDATION
// =====================================

function validUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

// =====================================
// REGISTER
// =====================================

async function register() {
  const name = $("authName").value.trim();
  const username = $("authUsername").value.trim().toLowerCase();
  const email = $("authEmail").value.trim().toLowerCase();
  const password = $("authPassword").value;
  const confirmPassword = $("authConfirmPassword").value;

  if (!name || !username || !email || !password) {
    throw new Error("Lengkapi semua data terlebih dahulu.");
  }

  if (!validUsername(username)) {
    throw new Error(
      "Username harus 3–20 karakter dan hanya boleh berisi huruf, angka, dan underscore."
    );
  }

  if (password.length < 8) {
    throw new Error("Password minimal 8 karakter.");
  }

  if (password !== confirmPassword) {
    throw new Error("Konfirmasi password tidak cocok.");
  }

  const usernameRef = doc(db, "usernames", username);
  const usernameSnap = await getDoc(usernameRef);

  if (usernameSnap.exists()) {
    throw new Error("Username sudah digunakan.");
  }

  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  const user = credential.user;

  try {
    await updateProfile(user, {
      displayName: name
    });

    await setDoc(usernameRef, {
      uid: user.uid,
      username,
      createdAt: serverTimestamp()
    });

    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      name,
      username,
      email,
      phone: "",
      photoURL: "",
      bio: "",
      role: "user",
      verified: false,
      suspended: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      settings: {
        theme: "system",
        language: "id",
        notifications: true,
        readReceipts: true,
        lastSeen: true
      }
    });

    await setDoc(doc(db, "publicProfiles", user.uid), {
      uid: user.uid,
      name,
      username,
      photoURL: "",
      bio: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

  } catch (error) {
    // Avoid leaving an authenticated account with an incomplete profile.
    await signOut(auth);
    throw error;
  }

  window.location.replace("./app.html");
}

// =====================================
// LOGIN
// =====================================

async function login() {
  const email = $("authEmail").value.trim().toLowerCase();
  const password = $("authPassword").value;

  if (!email || !password) {
    throw new Error("Masukkan email dan password.");
  }

  const credential = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  const user = credential.user;

  const profileSnap = await getDoc(doc(db, "users", user.uid));

  if (!profileSnap.exists()) {
    await signOut(auth);
    throw new Error("Profil akun tidak ditemukan. Hubungi administrator.");
  }

  const profile = profileSnap.data();

  if (profile.suspended === true) {
    const expiry = profile.suspensionUntil?.toDate?.();

    if (
      profile.suspensionType === "permanent" ||
      !expiry ||
      expiry.getTime() > Date.now()
    ) {
      await signOut(auth);
      throw new Error("Akun sedang ditangguhkan.");
    }
  }

  window.location.replace("./app.html");
}

// =====================================
// FORM SUBMIT
// =====================================

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (loading) return;

  clearMessages();
  setLoading(true);

  try {
    if (mode === "register") {
      await register();
    } else {
      await login();
    }
  } catch (error) {
    console.error("Authentication error:", error);

    const messages = {
      "auth/email-already-in-use": "Email sudah terdaftar.",
      "auth/invalid-email": "Format email tidak valid.",
      "auth/invalid-credential": "Email atau password salah.",
      "auth/user-not-found": "Akun tidak ditemukan.",
      "auth/wrong-password": "Password salah.",
      "auth/weak-password": "Password terlalu lemah.",
      "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
      "auth/network-request-failed": "Koneksi internet bermasalah.",
      "permission-denied": "Akses database ditolak. Periksa Firestore Rules."
    };

    showMessage(
      "error",
      messages[error.code] || error.message || "Terjadi kesalahan."
    );
  } finally {
    setLoading(false);
  }
});

// =====================================
// TABS
// =====================================

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    setMode(tab.dataset.mode);
  });
});

// =====================================
// PASSWORD VISIBILITY
// =====================================

$("togglePassword").addEventListener("click", () => {
  const input = $("authPassword");

  input.type = input.type === "password" ? "text" : "password";
});

// =====================================
// FORGOT PASSWORD
// =====================================

$("forgotPassword").addEventListener("click", async () => {
  const email = $("authEmail").value.trim();

  clearMessages();

  if (!email) {
    showMessage("error", "Masukkan email terlebih dahulu.");
    $("authEmail").focus();
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);

    showMessage(
      "success",
      "Jika akun dengan email tersebut tersedia, tautan reset password akan dikirim."
    );
  } catch (error) {
    console.error(error);

    showMessage(
      "error",
      "Tidak dapat mengirim email reset. Periksa alamat email dan konfigurasi Firebase."
    );
  }
});

// =====================================
// SESSION CHECK
// =====================================

onAuthStateChanged(auth, async user => {
  if (!user) return;

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));

    if (!profileSnap.exists()) return;

    const profile = profileSnap.data();

    if (profile.suspended === true) {
      const expiry = profile.suspensionUntil?.toDate?.();

      if (
        profile.suspensionType === "permanent" ||
        !expiry ||
        expiry.getTime() > Date.now()
      ) {
        await signOut(auth);
        return;
      }
    }

    if (window.location.pathname.endsWith("/index.html") ||
        window.location.pathname === "/") {
      window.location.replace("./app.html");
    }
  } catch (error) {
    console.error("Session check failed:", error);
  }
});

setMode("login");
