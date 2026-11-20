
import { auth, db } from "./firebase.js";

import {
  collection, doc, getDoc, getDocs, query, where,
  addDoc, updateDoc, arrayUnion, arrayRemove,
  serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import { getCurrentUser, showToast } from "./app.js";
import { openConversation } from "./chat.js";

const groupList = document.getElementById("groupList");
const createButton = document.getElementById("createGroupBtn");

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[c]);
}

let unsubscribeGroups = null;

export async function loadGroups() {
  const user = getCurrentUser();
  if (!user || !groupList) return;

  unsubscribeGroups?.();

  const q = query(
    collection(db, "conversations"),
    where("participants", "array-contains", user.uid)
  );

  unsubscribeGroups = onSnapshot(q, snapshot => {
    const groups = snapshot.docs
      .filter(item => item.data().type === "group")
      .sort((a, b) => {
        const ta = a.data().updatedAt?.seconds || 0;
        const tb = b.data().updatedAt?.seconds || 0;
        return tb - ta;
      });

    if (!groups.length) {
      groupList.innerHTML = `
        <div class="empty-state">
          <h3>Belum ada grup</h3>
          <p>Buat grup untuk mulai ngobrol bersama.</p>
        </div>`;
      return;
    }

    groupList.innerHTML = groups.map(item => {
      const group = item.data();

      return `
        <article class="group-row" data-id="${escapeHTML(item.id)}">
          <div class="group-avatar">
            ${escapeHTML((group.groupName || "G").charAt(0).toUpperCase())}
          </div>
          <div class="group-info">
            <strong>${escapeHTML(group.groupName || "Grup")}</strong>
            <span>${group.participants?.length || 0} anggota</span>
          </div>
          <button class="secondary-button group-open"
                  data-id="${escapeHTML(item.id)}">Buka</button>
        </article>`;
    }).join("");

    groupList.querySelectorAll(".group-open").forEach(button => {
      button.addEventListener("click", () => {
        openConversation(button.dataset.id);
      });
    });
  }, error => {
    console.error(error);
    showToast("Gagal memuat grup", "error");
  });
}

async function createGroup() {
  const user = getCurrentUser();
  if (!user) return;

  const groupName = prompt("Masukkan nama grup:");
  if (!groupName?.trim()) return;

  const description = prompt("Deskripsi grup (opsional):") || "";

  try {
    const profileSnap = await getDoc(
      doc(db, "publicProfiles", user.uid)
    );

    const profile = profileSnap.exists() ? profileSnap.data() : {};

    const groupRef = await addDoc(collection(db, "conversations"), {
      type: "group",
      groupName: groupName.trim().slice(0, 60),
      description: description.trim().slice(0, 500),
      groupPhoto: "",
      participants: [user.uid],
      admins: [user.uid],
      createdBy: user.uid,
      memberNames: {
        [user.uid]: profile.name || user.displayName || "Pengguna"
      },
      memberPhotos: {
        [user.uid]: profile.photoURL || ""
      },
      unreadCount: {
        [user.uid]: 0
      },
      lastMessage: "Grup dibuat",
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast("Grup berhasil dibuat", "success");
    await openConversation(groupRef.id);

  } catch (error) {
    console.error(error);
    showToast("Gagal membuat grup", "error");
  }
}

export async function addGroupMember(groupId, targetUid) {
  const user = getCurrentUser();
  if (!user) return;

  try {
    const groupRef = doc(db, "conversations", groupId);
    const snapshot = await getDoc(groupRef);

    if (!snapshot.exists()) throw new Error("Grup tidak ditemukan");

    const group = snapshot.data();

    if (!group.admins?.includes(user.uid)) {
      throw new Error("Hanya admin grup yang dapat menambahkan anggota");
    }

    if (group.participants.includes(targetUid)) {
      showToast("Pengguna sudah menjadi anggota");
      return;
    }

    const profileSnap = await getDoc(
      doc(db, "publicProfiles", targetUid)
    );

    if (!profileSnap.exists()) {
      throw new Error("Profil pengguna tidak ditemukan");
    }

    const profile = profileSnap.data();

    await updateDoc(groupRef, {
      participants: arrayUnion(targetUid),
      [`memberNames.${targetUid}`]: profile.name || "Pengguna",
      [`memberPhotos.${targetUid}`]: profile.photoURL || "",
      [`unreadCount.${targetUid}`]: 0,
      updatedAt: serverTimestamp()
    });

    showToast("Anggota berhasil ditambahkan", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Gagal menambahkan anggota", "error");
  }
}

export async function leaveGroup(groupId) {
  const user = getCurrentUser();
  if (!user) return;

  try {
    const groupRef = doc(db, "conversations", groupId);
    const snapshot = await getDoc(groupRef);

    if (!snapshot.exists()) return;

    const group = snapshot.data();

    if (group.createdBy === user.uid && group.participants.length > 1) {
      showToast("Pemilik grup harus memindahkan kepemilikan terlebih dahulu");
      return;
    }

    await updateDoc(groupRef, {
      participants: arrayRemove(user.uid),
      admins: arrayRemove(user.uid),
      updatedAt: serverTimestamp()
    });

    showToast("Lu sudah keluar dari grup", "success");
  } catch (error) {
    console.error(error);
    showToast("Gagal keluar dari grup", "error");
  }
}

createButton?.addEventListener("click", createGroup);

window.addEventListener("zorap:ready", loadGroups);
