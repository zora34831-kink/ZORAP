
import { auth, db } from "./firebase.js";

import {
  doc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  updateProfile, updateEmail, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import { getCurrentUser, getCurrentProfile, showToast, applyTheme } from "./app.js";

const settingsPage = document.getElementById("page-settings");

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[c]);
}

function renderSettings() {
  if (!settingsPage) return;

  const user = getCurrentUser();
  const profile = getCurrentProfile() || {};

  if (!user) return;

  settingsPage.innerHTML = `
    <div class="settings-layout">
      <header class="settings-heading">
        <div>
          <span class="eyebrow">PERSONALIZATION</span>
          <h1>Pengaturan</h1>
          <p>Atur pengalaman ZORAP lu.</p>
        </div>
      </header>

      <section class="settings-card">
        <div class="settings-profile">
          <img src="${escapeHTML(profile.photoURL || "./assets/default-avatar.svg")}" alt="">
          <div>
            <h3>${escapeHTML(profile.name || user.displayName || "Pengguna")}</h3>
            <p>@${escapeHTML(profile.username || "")}</p>
          </div>
        </div>
        <button class="secondary-button" id="editProfileBtn">Edit profil</button>
      </section>

      <section class="settings-card">
        <h3>Tampilan</h3>
        <p>Pilih tema aplikasi.</p>
        <div class="settings-options">
          <button data-theme="dark">Dark</button>
          <button data-theme="light">Light</button>
          <button data-theme="system">System</button>
        </div>
      </section>

      <section class="settings-card">
        <h3>Privasi</h3>
        <label class="settings-toggle">
          <span>Tampilkan status online</span>
          <input type="checkbox" id="onlineVisibility" checked>
        </label>
        <label class="settings-toggle">
          <span>Konfirmasi telah dibaca</span>
          <input type="checkbox" id="readReceipts" checked>
        </label>
      </section>

      <section class="settings-card">
        <h3>Akun</h3>
        <button class="settings-action" id="changePasswordBtn">Ubah password</button>
        <button class="settings-action" id="aboutBtn">Tentang ZORAP</button>
      </section>
    </div>
  `;

  settingsPage.querySelectorAll("[data-theme]").forEach(button => {
    button.onclick = () => {
      const theme = button.dataset.theme;
      applyTheme(theme);
      localStorage.setItem("zorap-theme", theme);
      showToast("Tema berhasil diubah", "success");
    };
  });

  document.getElementById("editProfileBtn").onclick = editProfile;
  document.getElementById("changePasswordBtn").onclick = changePassword;
  document.getElementById("aboutBtn").onclick = () => {
    alert("ZORAP\nAplikasi komunikasi digital.");
  };

  const onlineInput = document.getElementById("onlineVisibility");
  const readInput = document.getElementById("readReceipts");

  onlineInput.checked = profile.settings?.showOnline !== false;
  readInput.checked = profile.settings?.readReceipts !== false;

  onlineInput.onchange = () => saveSetting("showOnline", onlineInput.checked);
  readInput.onchange = () => saveSetting("readReceipts", readInput.checked);
}

async function saveSetting(key, value) {
  const user = getCurrentUser();
  if (!user) return;

  try {
    await updateDoc(doc(db, "users", user.uid), {
      [`settings.${key}`]: value,
      updatedAt: serverTimestamp()
    });

    showToast("Pengaturan disimpan", "success");
  } catch (error) {
    console.error(error);
    showToast("Gagal menyimpan pengaturan", "error");
  }
}

async function editProfile() {
  const user = getCurrentUser();
  const profile = getCurrentProfile() || {};

  const name = prompt("Nama:", profile.name || "");
  if (name === null || !name.trim()) return;

  const bio = prompt("Bio:", profile.bio || "");
  if (bio === null) return;

  try {
    await updateDoc(doc(db, "users", user.uid), {
      name: name.trim().slice(0, 60),
      bio: bio.trim().slice(0, 160),
      updatedAt: serverTimestamp()
    });

    await updateDoc(doc(db, "publicProfiles", user.uid), {
      name: name.trim().slice(0, 60),
      bio: bio.trim().slice(0, 160),
      updatedAt: serverTimestamp()
    });

    await updateProfile(user, {
      displayName: name.trim().slice(0, 60)
    });

    showToast("Profil berhasil diperbarui", "success");
    renderSettings();

  } catch (error) {
    console.error(error);
    showToast("Gagal memperbarui profil", "error");
  }
}

async function changePassword() {
  const user = getCurrentUser();

  if (!user?.email) {
    showToast("Akun tidak memiliki email", "error");
    return;
  }

  const currentPassword = prompt("Masukkan password saat ini:");
  if (!currentPassword) return;

  const newPassword = prompt("Masukkan password baru (minimal 8 karakter):");
  if (!newPassword || newPassword.length < 8) {
    showToast("Password baru minimal 8 karakter", "warning");
    return;
  }

  try {
    const credential = EmailAuthProvider.credential(
      user.email,
      currentPassword
    );

    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);

    showToast("Password berhasil diubah", "success");

  } catch (error) {
    console.error(error);
    showToast("Gagal mengubah password. Periksa password saat ini.", "error");
  }
}

window.addEventListener("zorap:ready", renderSettings);
