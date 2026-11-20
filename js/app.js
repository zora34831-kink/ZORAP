
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

// =====================================
// DOM
// =====================================

const $ = id => document.getElementById(id);

const splash = $("appSplash");
const shell = $("appShell");

let currentUser = null;
let currentProfile = null;
let currentPage = "chats";

// =====================================
// TOAST
// =====================================

export function showToast(message, type = "info") {
  const container = $("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `app-toast ${type}`;

  const text = document.createElement("span");
  text.textContent = message;

  toast.appendChild(text);
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// =====================================
// MODAL
// =====================================

export function openModal(content) {
  const modal = $("appModal");
  const modalContent = $("modalContent");

  if (!modal || !modalContent) return;

  modalContent.replaceChildren();

  if (typeof content === "string") {
    modalContent.innerHTML = content;
  } else if (content instanceof Node) {
    modalContent.appendChild(content);
  }

  modal.hidden = false;

  requestAnimationFrame(() => {
    modal.classList.add("visible");
  });
}

export function closeModal() {
  const modal = $("appModal");
  if (!modal) return;

  modal.classList.remove("visible");

  setTimeout(() => {
    modal.hidden = true;
    $("modalContent")?.replaceChildren();
  }, 200);
}

$("modalClose")?.addEventListener("click", closeModal);
$("modalBackdrop")?.addEventListener("click", closeModal);

// =====================================
// THEME
// =====================================

export function applyTheme(theme) {
  const selected = ["dark", "light"].includes(theme)
    ? theme
    : "dark";

  document.documentElement.dataset.theme = selected;

  try {
    localStorage.setItem("zorap-theme", selected);
  } catch (error) {
    console.warn("Theme storage unavailable", error);
  }
}

function initializeTheme() {
  let theme = "dark";

  try {
    theme = localStorage.getItem("zorap-theme") || "dark";
  } catch {}

  applyTheme(theme);
}

initializeTheme();

$("themeToggle")?.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "dark"
      ? "light"
      : "dark";

  applyTheme(next);
});

// =====================================
// NAVIGATION
// =====================================

const pageTitles = {
  chats: "Messages",
  updates: "Updates",
  groups: "Groups",
  contacts: "Contacts",
  calls: "Calls",
  settings: "Settings"
};

export function navigateTo(page) {
  if (!pageTitles[page]) return;

  currentPage = page;

  document.querySelectorAll(".app-page").forEach(element => {
    element.classList.toggle(
      "active",
      element.id === `page-${page}`
    );
  });

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  $("pageHeading").textContent = pageTitles[page];

  document.body.classList.remove("conversation-open");

  if (window.innerWidth <= 800) {
    $("conversationPanel")?.classList.remove("mobile-visible");
  }
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    navigateTo(button.dataset.page);
  });
});

// =====================================
// PROFILE
// =====================================

function setProfile(profile, user) {
  currentProfile = profile;

  const name = profile.name || user.displayName || "ZORAP User";
  const username = profile.username || "user";
  const photo = profile.photoURL || "./assets/default-avatar.svg";

  $("sidebarName").textContent = name;
  $("sidebarUsername").textContent = `@${username}`;

  $("sidebarAvatar").src = photo;
  $("settingsAvatar").src = photo;
  $("statusMyAvatar").src = photo;

  $("settingsName").textContent = name;
  $("settingsUsername").textContent = `@${username}`;
}

export function getCurrentUser() {
  return currentUser;
}

export function getCurrentProfile() {
  return currentProfile;
}

// =====================================
// ACCOUNT SUSPENSION
// =====================================

function isSuspended(profile) {
  if (!profile || profile.suspended !== true) return false;

  if (profile.suspensionType === "permanent") {
    return true;
  }

  const expiry = profile.suspensionUntil?.toDate?.();

  if (!expiry) return true;

  return expiry.getTime() > Date.now();
}

// =====================================
// SESSION
// =====================================

async function initializeUser(user) {
  const profileRef = doc(db, "users", user.uid);
  const profileSnap = await getDoc(profileRef);

  if (!profileSnap.exists()) {
    await signOut(auth);
    window.location.replace("./index.html");
    return;
  }

  const profile = profileSnap.data();

  if (isSuspended(profile)) {
    await signOut(auth);
    window.location.replace("./index.html");
    return;
  }

  currentUser = user;

  setProfile(profile, user);

  // Update last active timestamp
  try {
    await updateDoc(profileRef, {
      lastSeen: serverTimestamp()
    });
  } catch (error) {
    console.warn("Last seen update failed:", error);
  }

  // Reveal application after splash
  setTimeout(() => {
    splash.hidden = true;
    shell.hidden = false;

    document.body.classList.add("app-ready");

    window.dispatchEvent(
      new CustomEvent("zorap:ready", {
        detail: {
          user,
          profile
        }
      })
    );
  }, 5000);
}

// =====================================
// AUTH STATE
// =====================================

let authResolved = false;

onAuthStateChanged(auth, async user => {
  if (authResolved) return;
  authResolved = true;

  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  try {
    await initializeUser(user);
  } catch (error) {
    console.error("App initialization failed:", error);

    showToast(
      "Gagal memuat akun. Periksa koneksi dan Firestore Rules.",
      "error"
    );
  }
});

// =====================================
// LOGOUT
// =====================================

$("logoutBtn")?.addEventListener("click", async () => {
  const confirmed = window.confirm("Keluar dari akun ZORAP?");

  if (!confirmed) return;

  try {
    await signOut(auth);
    window.location.replace("./index.html");
  } catch (error) {
    console.error(error);
    showToast("Gagal keluar dari akun.", "error");
  }
});

// =====================================
// PROFILE SHORTCUT
// =====================================

$("profileShortcut")?.addEventListener("click", () => {
  navigateTo("settings");
});

// =====================================
// GLOBAL SEARCH
// =====================================

$("globalSearchBtn")?.addEventListener("click", () => {
  navigateTo("chats");

  const search = $("chatSearch");

  if (search) {
    search.focus();
  }
});

// =====================================
// NEW CHAT
// =====================================

$("newChatBtn")?.addEventListener("click", () => {
  navigateTo("contacts");

  $("contactSearch")?.focus();
});

// =====================================
// BACK TO CHAT LIST
// =====================================

$("backToChats")?.addEventListener("click", () => {
  $("conversationPanel")?.classList.remove("mobile-visible");
  document.body.classList.remove("conversation-open");
});

// =====================================
// APP GLOBAL EVENTS
// =====================================

window.addEventListener("online", () => {
  showToast("Connection restored.", "success");
});

window.addEventListener("offline", () => {
  showToast("You are offline.", "error");
});

// =====================================
// INITIAL UI
// =====================================

navigateTo("chats");
