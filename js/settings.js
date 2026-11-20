
import { auth, db } from "./firebase.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

const $ = selector => document.querySelector(selector);

let currentUser = null;
let currentProfile = {};
let settings = {
  theme: "dark",
  language: "id",
  lastSeen: "everyone",
  onlineStatus: "everyone",
  readReceipts: true,
  notifications: true,
  messagePreview: true,
  enterToSend: true,
  mediaAutoDownload: false
};

const settingsRef = () => doc(db, "users", currentUser.uid);

function notify(message) {
  if (window.zorapToast) {
    window.zorapToast(message);
  } else {
    alert(message);
  }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

window.addEventListener("zorap:ready", async event => {
  currentUser = auth.currentUser;
  currentProfile = event.detail?.profile || {};

  if (!currentUser) return;

  await loadSettings();
  updateSettingsProfile();
  bindSettingsEvents();
});

async function loadSettings() {
  try {
    const snapshot = await getDoc(settingsRef());

    if (snapshot.exists()) {
      const data = snapshot.data();

      settings = {
        ...settings,
        ...(data.settings || {})
      };
    }

    applyTheme(settings.theme);
  } catch (error) {
    console.error("Load settings:", error);
  }
}

async function saveSettings() {
  if (!currentUser) return;

  try {
    await setDoc(settingsRef(), {
      settings,
      updatedAt: serverTimestamp()
    }, { merge: true });

    return true;
  } catch (error) {
    console.error("Save settings:", error);
    notify("Pengaturan gagal disimpan.");
    return false;
  }
}

// =====================================
// PROFILE
// =====================================

function updateSettingsProfile() {
  const name = currentProfile.name ||
    currentUser.displayName ||
    "Pengguna";

  const username = currentProfile.username || "";

  const avatar = currentProfile.photoURL ||
    currentUser.photoURL ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=292039&color=fff`;

  if ($("#settingsName")) $("#settingsName").textContent = name;
  if ($("#settingsUsername")) {
    $("#settingsUsername").textContent = "@" + username;
  }

  if ($("#settingsAvatar")) $("#settingsAvatar").src = avatar;
}

function openProfileSettings() {
  const name = currentProfile.name ||
    currentUser?.displayName ||
    "";

  const username = currentProfile.username || "";

  openModal(`
    <div class="modal-heading">
      <h2>Profil akun</h2>
      <p>Kelola informasi profil ZORAP kamu.</p>
    </div>

    <label>Nama tampilan</label>
    <input id="profileNameInput" value="${escapeHTML(name)}" maxlength="40">

    <label>Username</label>
    <input value="@${escapeHTML(username)}" disabled>

    <label>Email</label>
    <input value="${escapeHTML(currentUser?.email || "Tidak tersedia")}" disabled>

    <div class="modal-actions">
      <button class="secondary-button" id="profileCancel">Batal</button>
      <button class="primary-button" id="profileSave">Simpan</button>
    </div>
  `);

  $("#profileCancel").onclick = closeModal;
  $("#profileSave").onclick = saveProfile;
}

async function saveProfile() {
  const name = $("#profileNameInput")?.value.trim();

  if (!name || name.length < 2) {
    notify("Nama minimal 2 karakter.");
    return;
  }

  try {
    await updateProfile(currentUser, {
      displayName: name
    });

    await updateDoc(settingsRef(), {
      name,
      updatedAt: serverTimestamp()
    });

    currentProfile.name = name;

    updateSettingsProfile();

    if ($("#myName")) $("#myName").textContent = name;

    closeModal();
    notify("Profil berhasil diperbarui.");

    window.dispatchEvent(new CustomEvent("zorap:profile-updated", {
      detail: { profile: currentProfile }
    }));
  } catch (error) {
    console.error(error);
    notify("Gagal memperbarui profil.");
  }
}

// =====================================
// MODAL
// =====================================

function openModal(html) {
  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.innerHTML = `
    <button class="modal-close" id="settingsModalClose">×</button>
    <div id="settingsModalBody">${html}</div>
  `;

  overlay.classList.remove("hidden");

  $("#settingsModalClose").onclick = closeModal;

  overlay.onclick = event => {
    if (event.target === overlay) closeModal();
  };
}

function closeModal() {
  $("#modalOverlay")?.classList.add("hidden");

  const content = $("#modalContent");
  if (content) content.innerHTML = "";
}

// =====================================
// APPEARANCE
// =====================================

function applyTheme(theme) {
  settings.theme = theme;

  const prefersLight = window.matchMedia?.(
    "(prefers-color-scheme: light)"
  ).matches;

  const light = theme === "light" ||
    (theme === "system" && prefersLight);

  document.body.classList.toggle("light-mode", light);

  const icon = $("#themeIcon");
  if (icon) icon.textContent = light ? "☀" : "☾";
}

function openAppearanceSettings() {
  openModal(`
    <div class="modal-heading">
      <h2>Appearance</h2>
      <p>Pilih tampilan aplikasi kamu.</p>
    </div>

    <div class="theme-options">
      <button class="theme-option" data-theme="dark">
        <span class="theme-preview dark-preview"></span>
        <strong>Dark</strong>
        <small>Dark interface</small>
      </button>

      <button class="theme-option" data-theme="light">
        <span class="theme-preview light-preview"></span>
        <strong>Light</strong>
        <small>Bright interface</small>
      </button>

      <button class="theme-option" data-theme="system">
        <span class="theme-preview system-preview"></span>
        <strong>System</strong>
        <small>Follow device</small>
      </button>
    </div>
  `);

  document.querySelectorAll("[data-theme]").forEach(button => {
    button.classList.toggle(
      "selected",
      button.dataset.theme === settings.theme
    );

    button.onclick = async () => {
      applyTheme(button.dataset.theme);
      await saveSettings();
      closeModal();
      notify("Tema berhasil diperbarui.");
    };
  });
}

// =====================================
// PRIVACY
// =====================================

function openPrivacySettings() {
  openModal(`
    <div class="modal-heading">
      <h2>Privacy</h2>
      <p>Atur informasi yang bisa dilihat orang lain.</p>
    </div>

    <label>Last seen</label>
    <select id="privacyLastSeen">
      <option value="everyone">Everyone</option>
      <option value="contacts">My contacts</option>
      <option value="nobody">Nobody</option>
    </select>

    <label>Online status</label>
    <select id="privacyOnline">
      <option value="everyone">Everyone</option>
      <option value="same">Same as last seen</option>
    </select>

    <label class="setting-toggle">
      <span>
        <strong>Read receipts</strong>
        <small>Izinkan tanda pesan dibaca.</small>
      </span>
      <input type="checkbox" id="privacyReadReceipts">
    </label>

    <div class="modal-actions">
      <button class="primary-button" id="savePrivacy">Simpan</button>
    </div>
  `);

  $("#privacyLastSeen").value = settings.lastSeen;
  $("#privacyOnline").value = settings.onlineStatus;
  $("#privacyReadReceipts").checked = settings.readReceipts;

  $("#savePrivacy").onclick = async () => {
    settings.lastSeen = $("#privacyLastSeen").value;
    settings.onlineStatus = $("#privacyOnline").value;
    settings.readReceipts = $("#privacyReadReceipts").checked;

    await saveSettings();
    closeModal();
    notify("Pengaturan privasi disimpan.");
  };
}

// =====================================
// CHAT SETTINGS
// =====================================

function openChatSettings() {
  openModal(`
    <div class="modal-heading">
      <h2>Chats</h2>
      <p>Atur cara kamu menggunakan chat.</p>
    </div>

    <label class="setting-toggle">
      <span>
        <strong>Enter untuk mengirim</strong>
        <small>Tekan Enter untuk mengirim pesan.</small>
      </span>
      <input type="checkbox" id="enterToSend">
    </label>

    <label class="setting-toggle">
      <span>
        <strong>Auto-download media</strong>
        <small>Unduh media secara otomatis.</small>
      </span>
      <input type="checkbox" id="autoDownload">
    </label>

    <div class="modal-actions">
      <button class="primary-button" id="saveChatSettings">Simpan</button>
    </div>
  `);

  $("#enterToSend").checked = settings.enterToSend;
  $("#autoDownload").checked = settings.mediaAutoDownload;

  $("#saveChatSettings").onclick = async () => {
    settings.enterToSend = $("#enterToSend").checked;
    settings.mediaAutoDownload = $("#autoDownload").checked;

    await saveSettings();
    closeModal();
    notify("Pengaturan chat disimpan.");
  };
}

// =====================================
// NOTIFICATIONS
// =====================================

function openNotificationSettings() {
  openModal(`
    <div class="modal-heading">
      <h2>Notifications</h2>
      <p>Atur notifikasi aplikasi.</p>
    </div>

    <label class="setting-toggle">
      <span>
        <strong>Notifications</strong>
        <small>Aktifkan notifikasi aplikasi.</small>
      </span>
      <input type="checkbox" id="notificationsEnabled">
    </label>

    <label class="setting-toggle">
      <span>
        <strong>Message preview</strong>
        <small>Tampilkan isi pesan pada notifikasi.</small>
      </span>
      <input type="checkbox" id="messagePreview">
    </label>

    <div class="modal-actions">
      <button class="primary-button" id="saveNotifications">Simpan</button>
    </div>
  `);

  $("#notificationsEnabled").checked = settings.notifications;
  $("#messagePreview").checked = settings.messagePreview;

  $("#saveNotifications").onclick = async () => {
    settings.notifications = $("#notificationsEnabled").checked;
    settings.messagePreview = $("#messagePreview").checked;

    await saveSettings();
    closeModal();
    notify("Pengaturan notifikasi disimpan.");
  };
}

// =====================================
// LANGUAGE
// =====================================

function openLanguageSettings() {
  openModal(`
    <div class="modal-heading">
      <h2>Language</h2>
      <p>Pilih bahasa aplikasi.</p>
    </div>

    <select id="languageSelect">
      <option value="id">Bahasa Indonesia</option>
      <option value="en">English</option>
    </select>

    <div class="modal-actions">
      <button class="primary-button" id="saveLanguage">Simpan</button>
    </div>
  `);

  $("#languageSelect").value = settings.language;

  $("#saveLanguage").onclick = async () => {
    settings.language = $("#languageSelect").value;
    await saveSettings();
    closeModal();

    notify(
      settings.language === "id"
        ? "Bahasa dipilih: Indonesia."
        : "Language selected: English."
    );

    notify("Penerjemahan seluruh halaman perlu integrasi bahasa tambahan.");
  };
}

// =====================================
// STORAGE
// =====================================

function openStorageSettings() {
  openModal(`
    <div class="modal-heading">
      <h2>Storage and data</h2>
      <p>Informasi penggunaan penyimpanan.</p>
    </div>

    <div class="storage-info">
      <div class="storage-info-item">
        <strong>Media</strong>
        <span>Firebase Storage</span>
      </div>
      <div class="storage-info-item">
        <strong>Messages</strong>
        <span>Cloud Firestore</span>
      </div>
    </div>

    <p class="settings-note">
      Penggunaan penyimpanan akan ditampilkan setelah sistem penghitungan
      media terintegrasi.
    </p>
  `);
}

// =====================================
// HELP AND ABOUT
// =====================================

function openHelp() {
  openModal(`
    <div class="modal-heading">
      <h2>Help Center</h2>
      <p>Bantuan penggunaan ZORAP.</p>
    </div>

    <div class="help-list">
      <div><strong>Account</strong><p>Kelola profil dan informasi akun.</p></div>
      <div><strong>Messages</strong><p>Kirim pesan melalui halaman Chats.</p></div>
      <div><strong>Contacts</strong><p>Cari pengguna melalui username.</p></div>
      <div><strong>Groups</strong><p>Buat grup dan tambahkan anggota.</p></div>
      <div><strong>Status</strong><p>Bagikan foto atau video selama 24 jam.</p></div>
    </div>
  `);
}

function openAbout() {
  openModal(`
    <div class="about-brand">
      <div class="brand-logo">Z</div>
      <h2>ZORAP</h2>
      <p>Messaging platform</p>
      <span>Version 1.0.0</span>
    </div>
    <p class="settings-note">
      ZORAP adalah aplikasi komunikasi berbasis web.
    </p>
  `);
}

// =====================================
// PASSWORD RESET
// =====================================

async function requestPasswordReset() {
  if (!currentUser?.email) {
    notify("Akun ini tidak memiliki email.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    notify("Link reset password dikirim ke email kamu.");
  } catch (error) {
    console.error(error);
    notify("Gagal mengirim email reset password.");
  }
}

// =====================================
// SETTINGS ROUTER
// =====================================

function openSetting(name) {
  switch (name) {
    case "account":
      openProfileSettings();
      break;

    case "privacy":
      openPrivacySettings();
      break;

    case "chats":
      openChatSettings();
      break;

    case "notifications":
      openNotificationSettings();
      break;

    case "appearance":
      openAppearanceSettings();
      break;

    case "language":
      openLanguageSettings();
      break;

    case "storage":
      openStorageSettings();
      break;

    case "help":
      openHelp();
      break;

    case "about":
      openAbout();
      break;

    default:
      notify("Pengaturan tidak tersedia.");
  }
}

// =====================================
// EVENT BINDINGS
// =====================================

function bindSettingsEvents() {
  document.querySelectorAll("[data-setting]").forEach(button => {
    button.onclick = () => openSetting(button.dataset.setting);
  });

  $("#settingsProfile")?.addEventListener("click", openProfileSettings);
  $("#openSettingsProfile")?.addEventListener("click", openProfileSettings);

  $("#themeToggle")?.addEventListener("click", async () => {
    const next = settings.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    await saveSettings();
  });

  $("#logoutBtn")?.addEventListener("click", async () => {
    const confirmed = confirm("Yakin ingin keluar dari ZORAP?");
    if (!confirmed) return;

    try {
      const { signOut } = await import(
        "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js"
      );

      await signOut(auth);
      window.location.href = "./index.html";
    } catch (error) {
      console.error(error);
      notify("Gagal logout.");
    }
  });
}

// =====================================
// PUBLIC API
// =====================================

window.zorapSettings = {
  get settings() {
    return { ...settings };
  },
  openSetting,
  openProfileSettings,
  openAppearanceSettings,
  requestPasswordReset,
  saveSettings
};
