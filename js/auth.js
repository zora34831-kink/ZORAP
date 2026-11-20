
import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";


/* =====================================
   ELEMENTS
===================================== */

const splash = document.getElementById("splash");
const authScreen = document.getElementById("authScreen");

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

const authTitle = document.getElementById("authTitle");
const authDescription = document.getElementById("authDescription");

const switchAuth = document.getElementById("switchAuth");
const switchText = document.getElementById("switchText");

const authMessage = document.getElementById("authMessage");

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");

const registerName = document.getElementById("registerName");
const registerUsername = document.getElementById("registerUsername");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");

const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");

const forgotPassword = document.getElementById("forgotPassword");
const togglePassword = document.getElementById("togglePassword");


/* =====================================
   CONFIGURATION
===================================== */

const APP_URL = "./app.html";
const SPLASH_DURATION = 5000;

let isRegisterMode = false;


/* =====================================
   HELPER
===================================== */

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));


function showMessage(message, type = "error") {
  if (!authMessage) return;

  authMessage.textContent = message;
  authMessage.classList.remove("hidden", "success", "error");
  authMessage.classList.add(type);
}


function hideMessage() {
  authMessage?.classList.add("hidden");
}


function setLoading(button, loading, text) {
  if (!button) return;

  button.disabled = loading;

  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.textContent = text || "Memproses...";
  } else if (button.dataset.originalText) {
    button.innerHTML = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}


function getFirebaseError(error) {
  const errors = {
    "auth/invalid-email": "Format email tidak valid.",
    "auth/user-not-found": "Akun tidak ditemukan.",
    "auth/wrong-password": "Password yang kamu masukkan salah.",
    "auth/invalid-credential": "Email atau password salah.",
    "auth/email-already-in-use": "Email sudah digunakan.",
    "auth/weak-password": "Password terlalu lemah.",
    "auth/network-request-failed": "Periksa koneksi internet kamu.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "auth/user-disabled": "Akun ini sedang dinonaktifkan.",
    "auth/missing-email": "Masukkan email terlebih dahulu.",
    "permission-denied": "Akses database ditolak. Periksa Firestore Rules.",
    "unavailable": "Server sedang tidak tersedia."
  };

  return errors[error.code] || error.message || "Terjadi kesalahan.";
}


/* =====================================
   SPLASH SCREEN
===================================== */

const splashStart = Date.now();

async function finishSplash() {
  const elapsed = Date.now() - splashStart;
  const remaining = Math.max(0, SPLASH_DURATION - elapsed);

  await sleep(remaining);

  splash?.classList.add("splash-hidden");

  setTimeout(() => {
    if (splash) splash.style.display = "none";
  }, 500);
}


/* =====================================
   DARK / LIGHT MODE
===================================== */

const themeToggle = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeIcon");
const themeText = document.getElementById("themeText");

function applyTheme(theme) {
  document.body.classList.toggle(
    "light-mode",
    theme === "light"
  );

  if (themeIcon) {
    themeIcon.textContent =
      theme === "light" ? "☾" : "☀";
  }

  if (themeText) {
    themeText.textContent =
      theme === "light" ? "Dark mode" : "Light mode";
  }

  localStorage.setItem("zorap-theme", theme);
}

applyTheme(
  localStorage.getItem("zorap-theme") || "dark"
);

themeToggle?.addEventListener("click", () => {
  const currentTheme =
    document.body.classList.contains("light-mode")
      ? "light"
      : "dark";

  applyTheme(
    currentTheme === "light" ? "dark" : "light"
  );
});


/* =====================================
   PASSWORD VISIBILITY
===================================== */

togglePassword?.addEventListener("click", () => {
  const visible = loginPassword.type === "text";

  loginPassword.type = visible ? "password" : "text";
  togglePassword.textContent = visible ? "Lihat" : "Sembunyikan";
});


/* =====================================
   SWITCH LOGIN / REGISTER
===================================== */

switchAuth?.addEventListener("click", () => {
  isRegisterMode = !isRegisterMode;

  hideMessage();

  loginForm.classList.toggle("hidden", isRegisterMode);
  registerForm.classList.toggle("hidden", !isRegisterMode);

  if (isRegisterMode) {
    authTitle.innerHTML = "Buat akun<br>barumu.";
    authDescription.textContent =
      "Bergabung dan mulai percakapan di ZORAP.";

    switchText.textContent = "Sudah punya akun?";
    switchAuth.textContent = "Masuk sekarang";
  } else {
    authTitle.innerHTML = "Selamat datang<br>kembali.";
    authDescription.textContent =
      "Masuk untuk melanjutkan percakapanmu.";

    switchText.textContent = "Belum punya akun?";
    switchAuth.textContent = "Daftar sekarang";
  }
});


/* =====================================
   LOGIN
===================================== */

loginForm?.addEventListener("submit", async event => {
  event.preventDefault();

  hideMessage();

  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    showMessage("Email dan password wajib diisi.");
    return;
  }

  setLoading(loginButton, true, "Sedang masuk...");

  try {
    await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    showMessage("Login berhasil.", "success");

    // Perpindahan halaman ditangani onAuthStateChanged.

  } catch (error) {
    showMessage(getFirebaseError(error));
  } finally {
    setLoading(loginButton, false);
  }
});


/* =====================================
   REGISTER
===================================== */

registerForm?.addEventListener("submit", async event => {
  event.preventDefault();

  hideMessage();

  const name = registerName.value.trim();
  const username = registerUsername.value
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  const email = registerEmail.value.trim();
  const password = registerPassword.value;

  if (name.length < 2) {
    showMessage("Nama minimal 2 karakter.");
    return;
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    showMessage(
      "Username 3–20 karakter. Gunakan huruf kecil, angka, dan underscore."
    );
    return;
  }

  if (password.length < 6) {
    showMessage("Password minimal 6 karakter.");
    return;
  }

  setLoading(registerButton, true, "Membuat akun...");

  let createdUser = null;

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    createdUser = credential.user;

    await updateProfile(createdUser, {
      displayName: name
    });

    const usernameRef = doc(db, "usernames", username);
    const userRef = doc(db, "users", createdUser.uid);

    await runTransaction(db, async transaction => {
      const usernameSnapshot =
        await transaction.get(usernameRef);

      if (usernameSnapshot.exists()) {
        throw new Error("USERNAME_TAKEN");
      }

      transaction.set(usernameRef, {
        uid: createdUser.uid,
        username,
        createdAt: serverTimestamp()
      });

      transaction.set(userRef, {
        uid: createdUser.uid,
        name,
        username,
        email,
        photoURL: "",
        bio: "",
        verified: false,
        role: "user",
        status: "active",
        online: false,
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    });

    showMessage(
      "Akun berhasil dibuat. Selamat datang di ZORAP!",
      "success"
    );

    // Pengalihan dilakukan oleh onAuthStateChanged.

  } catch (error) {
    if (error.message === "USERNAME_TAKEN") {
      showMessage("Username sudah digunakan. Pilih username lain.");
    } else {
      showMessage(getFirebaseError(error));

      // Jangan meninggalkan akun yang baru dibuat
      // dalam keadaan setengah terdaftar.
      if (createdUser) {
        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error(signOutError);
        }
      }
    }
  } finally {
    setLoading(registerButton, false);
  }
});


/* =====================================
   RESET PASSWORD
===================================== */

forgotPassword?.addEventListener("click", async () => {
  hideMessage();

  const email = loginEmail.value.trim();

  if (!email) {
    showMessage("Masukkan email kamu terlebih dahulu.");
    loginEmail.focus();
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);

    showMessage(
      "Link reset password berhasil dikirim. Periksa email kamu.",
      "success"
    );

  } catch (error) {
    showMessage(getFirebaseError(error));
  }
});


/* =====================================
   AUTH SESSION
===================================== */

let splashFinished = false;
let authUser = undefined;

const splashPromise = finishSplash().then(() => {
  splashFinished = true;
  handleAuthState();
});

function handleAuthState() {
  if (!splashFinished || authUser === undefined) return;

  if (authUser) {
    window.location.replace(APP_URL);
  } else {
    authScreen?.classList.remove("hidden");
  }
}

onAuthStateChanged(auth, user => {
  authUser = user;
  handleAuthState();
});
