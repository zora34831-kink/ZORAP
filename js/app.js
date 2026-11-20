
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";


/* =====================================
   ZORAP APP CORE
===================================== */

const $ = selector => document.querySelector(selector);

const appLayout = $(".app-layout");

let currentUser = null;
let currentProfile = null;
let activePage = "chats";


/* =====================================
   TOAST NOTIFICATION
===================================== */

function toast(message, duration = 2800) {
  const container = $("#toastContainer");
  if (!container) return;

  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;

  container.appendChild(element);

  setTimeout(() => {
    element.style.opacity = "0";
    element.style.transform = "translateX(10px)";

    setTimeout(() => element.remove(), 250);
  }, duration);
}

window.zorapToast = toast;


/* =====================================
   MODAL SYSTEM
===================================== */

const modalOverlay = $("#modalOverlay");
const modalContent = $("#modalContent");

function openModal(title, description) {
  if (!modalOverlay || !modalContent) return;

  modalContent.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = title;
  heading.style.fontSize = "19px";
  heading.style.marginBottom = "10px";

  const paragraph = document.createElement("p");
  paragraph.textContent = description;
  paragraph.style.color = "var(--muted)";
  paragraph.style.fontSize = "12px";
  paragraph.style.lineHeight = "1.7";

  modalContent.append(heading, paragraph);

  modalOverlay.classList.remove("hidden");
}

function closeModal() {
  modalOverlay?.classList.add("hidden");
}

$("#modalCloseBtn")?.addEventListener("click", closeModal);

modalOverlay?.addEventListener("click", event => {
  if (event.target === modalOverlay) closeModal();
});

window.zorapModal = openModal;
window.zorapCloseModal = closeModal;


/* =====================================
   DARK / LIGHT MODE
===================================== */

const themeToggle = $("#themeToggle");

function applyTheme(theme) {
  const selectedTheme = theme === "light" ? "light" : "dark";

  document.body.classList.toggle(
    "light-mode",
    selectedTheme === "light"
  );

  localStorage.setItem("zorap-theme", selectedTheme);

  const themeIcon = $("#themeIcon");

  if (themeIcon) {
    themeIcon.innerHTML = selectedTheme === "light"
      ? `
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
      `
      : `
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>
      `;
  }

  themeToggle?.setAttribute(
    "aria-label",
    selectedTheme === "light" ? "Aktifkan dark mode" : "Aktifkan light mode"
  );
}

applyTheme(localStorage.getItem("zorap-theme") || "dark");

themeToggle?.addEventListener("click", () => {
  const isLight = document.body.classList.contains("light-mode");

  applyTheme(isLight ? "dark" : "light");
});


/* =====================================
   PROFILE
===================================== */

function setAvatar(element, name, photoURL) {
  if (!element) return;

  element.replaceChildren();

  if (photoURL) {
    const image = document.createElement("img");
    image.src = photoURL;
    image.alt = "Foto profil";
    image.referrerPolicy = "no-referrer";

    image.onerror = () => {
      element.textContent = (name || "Z").charAt(0).toUpperCase();
    };

    element.appendChild(image);
  } else {
    element.textContent = (name || "Z").charAt(0).toUpperCase();
  }
}

function renderProfile(profile) {
  const name = profile.name || currentUser?.displayName || "Pengguna ZORAP";
  const username = profile.username || "username";
  const photoURL = profile.photoURL || currentUser?.photoURL || "";

  const myName = $("#myName");
  const myUsername = $("#myUsername");

  if (myName) myName.textContent = name;
  if (myUsername) myUsername.textContent = "@" + username;

  setAvatar($("#myAvatar"), name, photoURL);
  setAvatar($("#settingsAvatar"), name, photoURL);

  const settingsName = $("#settingsName");
  const settingsUsername = $("#settingsUsername");

  if (settingsName) settingsName.textContent = name;
  if (settingsUsername) {
    settingsUsername.textContent = "@" + username;
  }

  // Simpan profil yang sedang aktif untuk modul lain.
  window.zorapCurrentProfile = profile;
}


/* =====================================
   LOAD USER PROFILE
===================================== */

async function loadProfile(user) {
  try {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);

    if (snapshot.exists()) {
      currentProfile = {
        uid: user.uid,
        ...snapshot.data()
      };
    } else {
      currentProfile = {
        uid: user.uid,
        name: user.displayName || "Pengguna ZORAP",
        username: "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        verified: false,
        role: "user"
      };
    }

    renderProfile(currentProfile);

    return currentProfile;

  } catch (error) {
    console.error("Gagal memuat profil:", error);

    toast("Gagal memuat profil pengguna.");

    currentProfile = {
      uid: user.uid,
      name: user.displayName || "Pengguna ZORAP",
      username: "",
      email: user.email || "",
      photoURL: user.photoURL || "",
      verified: false
    };

    renderProfile(currentProfile);

    return currentProfile;
  }
}


/* =====================================
   NAVIGATION
===================================== */

const pageElements = {
  chats: $("#welcomePanel"),
  updates: $("#updatesPage"),
  groups: $("#groupsPage"),
  calls: $("#callsPage"),
  settings: $("#settingsPage")
};

function showPage(page) {
  if (!pageElements[page]) return;

  activePage = page;

  Object.entries(pageElements).forEach(([key, element]) => {
    element?.classList.toggle("hidden", key !== page);
  });

  // Tutup tampilan percakapan ketika berpindah halaman.
  $("#chatView")?.classList.add("hidden");

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  const titles = {
    chats: "Pesan",
    updates: "Pembaruan",
    groups: "Grup",
    calls: "Panggilan",
    settings: "Pengaturan"
  };

  const pageTitle = $("#pageTitle");

  if (pageTitle) {
    pageTitle.textContent = titles[page];
  }

  if (window.innerWidth <= 650) {
    appLayout?.classList.remove("mobile-chat-open");
  }

  window.dispatchEvent(
    new CustomEvent("zorap:pagechange", {
      detail: { page }
    })
  );
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});


/* =====================================
   MOBILE NAVIGATION
===================================== */

$("#mobileBackBtn")?.addEventListener("click", () => {
  $("#chatView")?.classList.add("hidden");
  $("#welcomePanel")?.classList.remove("hidden");

  appLayout?.classList.remove("mobile-chat-open");
});


/* =====================================
   NEW CHAT BUTTONS
===================================== */

function startNewChat() {
  window.dispatchEvent(
    new CustomEvent("zorap:newchat")
  );
}

$("#newChatBtn")?.addEventListener("click", startNewChat);
$("#emptyNewChatBtn")?.addEventListener("click", startNewChat);
$("#welcomeNewChatBtn")?.addEventListener("click", startNewChat);


/* =====================================
   PROFILE MODAL
===================================== */

function showMyProfile() {
  if (!currentProfile) {
    toast("Profil belum tersedia.");
    return;
  }

  const profile = currentProfile;

  openModal(
    profile.name || "Profil ZORAP",
    `Username: @${profile.username || "-"}\nEmail: ${profile.email || currentUser?.email || "-"}`
  );

  const verified = profile.verified === true;

  if (verified) {
    const badge = document.createElement("span");
    badge.className = "verified-badge";
    badge.textContent = "✓";
    badge.style.marginTop = "12px";
    modalContent?.appendChild(badge);
  }
}

$("#openMyProfile")?.addEventListener("click", showMyProfile);
$("#settingsProfile")?.addEventListener("click", showMyProfile);


/* =====================================
   SETTINGS ACTIONS
===================================== */

const settingDescriptions = {
  account: [
    "Akun",
    "Kelola informasi akun, email, dan keamanan ZORAP."
  ],
  privacy: [
    "Privasi",
    "Pengaturan terakhir dilihat, status online, dan tanda dibaca."
  ],
  avatar: [
    "Profil dan avatar",
    "Kelola nama, foto profil, username, dan bio."
  ],
  chats: [
    "Chat",
    "Atur tampilan dan preferensi percakapan."
  ],
  notifications: [
    "Notifikasi",
    "Pengaturan pemberitahuan pesan dan grup."
  ],
  appearance: [
    "Tampilan",
    "Pilih mode gelap atau terang untuk ZORAP."
  ],
  storage: [
    "Penyimpanan dan data",
    "Pengaturan media dan penggunaan data."
  ],
  language: [
    "Bahasa",
    "Bahasa aplikasi ZORAP."
  ],
  help: [
    "Bantuan",
    "Informasi bantuan dan dukungan ZORAP."
  ],
  about: [
    "Tentang ZORAP",
    "ZORAP adalah aplikasi pesan pribadi. Versi 1.0.0."
  ]
};

document.querySelectorAll("[data-setting]").forEach(button => {
  button.addEventListener("click", () => {
    const setting = settingDescriptions[button.dataset.setting];

    if (!setting) return;

    if (button.dataset.setting === "appearance") {
      openAppearanceSettings();
      return;
    }

    openModal(setting[0], setting[1]);
  });
});


/* =====================================
   APPEARANCE SETTINGS
===================================== */

function openAppearanceSettings() {
  if (!modalContent || !modalOverlay) return;

  modalContent.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Tampilan";
  title.style.fontSize = "19px";

  const description = document.createElement("p");
  description.textContent = "Pilih tema yang nyaman digunakan.";
  description.style.color = "var(--muted)";
  description.style.fontSize = "12px";
  description.style.margin = "10px 0 20px";

  const options = document.createElement("div");
  options.style.display = "grid";
  options.style.gap = "10px";

  [
    { value: "dark", label: "Dark Mode", description: "Tampilan gelap" },
    { value: "light", label: "Light Mode", description: "Tampilan terang" }
  ].forEach(option => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "setting-item";
    button.style.border = "1px solid var(--border)";
    button.style.borderRadius = "13px";

    const info = document.createElement("span");
    info.style.flex = "1";

    const strong = document.createElement("strong");
    strong.textContent = option.label;

    const small = document.createElement("small");
    small.textContent = option.description;

    info.append(strong, small);

    const indicator = document.createElement("span");
    indicator.textContent =
      localStorage.getItem("zorap-theme") === option.value ? "✓" : "";

    button.append(info, indicator);

    button.addEventListener("click", () => {
      applyTheme(option.value);
      closeModal();
      toast(`${option.label} diaktifkan.`);
    });

    options.appendChild(button);
  });

  modalContent.append(title, description, options);
  modalOverlay.classList.remove("hidden");
}


/* =====================================
   LOGOUT
===================================== */

function showLogoutConfirmation() {
  if (!modalContent || !modalOverlay) return;

  modalContent.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Keluar dari ZORAP?";
  title.style.fontSize = "19px";

  const description = document.createElement("p");
  description.textContent =
    "Kamu akan keluar dari sesi akun ini. Data akun dan percakapan tidak dihapus.";
  description.style.color = "var(--muted)";
  description.style.fontSize = "12px";
  description.style.lineHeight = "1.7";
  description.style.margin = "12px 0 22px";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "primary-btn";
  cancelButton.textContent = "Batal";
  cancelButton.style.flex = "1";
  cancelButton.style.background = "var(--surface-2)";
  cancelButton.style.color = "var(--text)";
  cancelButton.style.boxShadow = "none";

  const logoutButton = document.createElement("button");
  logoutButton.type = "button";
  logoutButton.className = "primary-btn";
  logoutButton.textContent = "Keluar";
  logoutButton.style.flex = "1";
  logoutButton.style.background = "#d94d69";

  cancelButton.addEventListener("click", closeModal);

  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    logoutButton.textContent = "Memproses...";

    try {
      await signOut(auth);
      window.location.replace("./index.html");
    } catch (error) {
      console.error(error);
      toast("Gagal keluar. Coba lagi.");
      logoutButton.disabled = false;
      logoutButton.textContent = "Keluar";
    }
  });

  actions.append(cancelButton, logoutButton);
  modalContent.append(title, description, actions);

  modalOverlay.classList.remove("hidden");
}

$("#logoutBtn")?.addEventListener("click", showLogoutConfirmation);


/* =====================================
   MORE MENU
===================================== */

$("#moreMenuBtn")?.addEventListener("click", () => {
  openModal(
    "Menu ZORAP",
    "Pengaturan akun, privasi, dan pengalaman pesanmu tersedia melalui menu Pengaturan."
  );
});


/* =====================================
   GLOBAL SEARCH
===================================== */

$("#globalSearchBtn")?.addEventListener("click", () => {
  showPage("chats");

  const search = $("#chatSearch");
  search?.focus();

  toast("Cari percakapan atau username.");
});


/* =====================================
   AUTHENTICATION
===================================== */

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("./index.html");
    return;
  }

  currentUser = user;

  await loadProfile(user);

  window.dispatchEvent(
    new CustomEvent("zorap:ready", {
      detail: {
        user,
        profile: currentProfile
      }
    })
  );
});


/* =====================================
   EXPOSE APP CONTROLS
===================================== */

window.zorapApp = {
  get user() {
    return currentUser;
  },

  get profile() {
    return currentProfile;
  },

  get activePage() {
    return activePage;
  },

  showPage,
  toast,
  openModal,
  closeModal,
  applyTheme
};

console.log("ZORAP App initialized.");
