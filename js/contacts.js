
import { auth, db } from "./firebase.js";

import {
  collection, doc, getDoc, getDocs, query, where,
  addDoc, setDoc, serverTimestamp, orderBy, limit
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  getCurrentUser, showToast, navigateTo
} from "./app.js";

import { openConversation } from "./chat.js";

const searchInput = document.getElementById("contactSearch");
const searchButton = document.getElementById("contactSearchBtn");
const results = document.getElementById("contactResults");

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[char]);
}

async function searchUsers() {
  const current = getCurrentUser();
  const username = searchInput?.value.trim().replace(/^@/, "").toLowerCase();

  if (!current) return;
  if (!username) {
    showToast("Masukkan username terlebih dahulu", "warning");
    return;
  }

  results.innerHTML = `<div class="loading-state">Mencari pengguna...</div>`;

  try {
    const usernameSnap = await getDoc(doc(db, "usernames", username));

    if (!usernameSnap.exists()) {
      results.innerHTML = `<div class="empty-state">Pengguna tidak ditemukan</div>`;
      return;
    }

    const targetUid = usernameSnap.data().uid;

    if (targetUid === current.uid) {
      results.innerHTML = `<div class="empty-state">Itu akun lu sendiri</div>`;
      return;
    }

    const profileSnap = await getDoc(doc(db, "publicProfiles", targetUid));

    if (!profileSnap.exists()) {
      results.innerHTML = `<div class="empty-state">Profil tidak tersedia</div>`;
      return;
    }

    const profile = profileSnap.data();

    results.innerHTML = `
      <article class="contact-result">
        <img src="${escapeHTML(profile.photoURL || "./assets/default-avatar.svg")}"
             class="contact-avatar" alt="">
        <div class="contact-result-info">
          <strong>${escapeHTML(profile.name || "Pengguna")}</strong>
          <span>@${escapeHTML(profile.username || username)}</span>
        </div>
        <button class="primary-button" id="contactAddBtn">Tambah</button>
        <button class="secondary-button" id="contactChatBtn">Chat</button>
      </article>
    `;

    document.getElementById("contactAddBtn").onclick = () =>
      addContact(targetUid, profile);

    document.getElementById("contactChatBtn").onclick = () =>
      startPrivateChat(targetUid, profile);

  } catch (error) {
    console.error(error);
    results.innerHTML = `<div class="empty-state">Gagal mencari pengguna</div>`;
    showToast("Periksa koneksi atau Firestore Rules", "error");
  }
}

async function addContact(targetUid, profile) {
  const current = getCurrentUser();
  if (!current) return;

  try {
    const contactRef = doc(
      db, "users", current.uid, "contacts", targetUid
    );

    const existing = await getDoc(contactRef);

    if (existing.exists()) {
      showToast("Kontak sudah ditambahkan");
      return;
    }

    await setDoc(contactRef, {
      uid: targetUid,
      name: profile.name || "Pengguna",
      username: profile.username || "",
      photoURL: profile.photoURL || "",
      createdAt: serverTimestamp()
    });

    showToast("Kontak berhasil ditambahkan", "success");
  } catch (error) {
    console.error(error);
    showToast("Gagal menambahkan kontak", "error");
  }
}

async function startPrivateChat(targetUid, profile) {
  const current = getCurrentUser();
  if (!current) return;

  try {
    const conversationsRef = collection(db, "conversations");

    const existingQuery = query(
      conversationsRef,
      where("participants", "array-contains", current.uid),
      limit(100)
    );

    const snapshot = await getDocs(existingQuery);

    const existing = snapshot.docs.find(item => {
      const data = item.data();
      return data.type === "private" &&
        data.participants?.includes(targetUid);
    });

    let conversationId;

    if (existing) {
      conversationId = existing.id;
    } else {
      const currentProfile = await getDoc(
        doc(db, "publicProfiles", current.uid)
      );

      const myProfile = currentProfile.exists()
        ? currentProfile.data()
        : {};

      const conversation = await addDoc(conversationsRef, {
        type: "private",
        participants: [current.uid, targetUid],
        createdBy: current.uid,
        admins: [current.uid],
        memberNames: {
          [current.uid]: myProfile.name || current.displayName || "Pengguna",
          [targetUid]: profile.name || "Pengguna"
        },
        memberPhotos: {
          [current.uid]: myProfile.photoURL || "",
          [targetUid]: profile.photoURL || ""
        },
        unreadCount: {
          [current.uid]: 0,
          [targetUid]: 0
        },
        lastMessage: "",
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      conversationId = conversation.id;
    }

    navigateTo("chats");
    await openConversation(conversationId);

  } catch (error) {
    console.error(error);
    showToast("Gagal membuka percakapan", "error");
  }
}

searchButton?.addEventListener("click", searchUsers);

searchInput?.addEventListener("keydown", event => {
  if (event.key === "Enter") searchUsers();
});

window.addEventListener("zorap:ready", () => {
  searchInput?.addEventListener("input", () => {
    if (!searchInput.value.trim()) {
      results.innerHTML = "";
    }
  });
});
