
import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";


/* =====================================
   ZORAP GROUP ENGINE
===================================== */

const $ = selector => document.querySelector(selector);

let currentUser = null;
let currentProfile = null;
let groupListener = null;
let userGroups = [];


/* =====================================
   INITIALIZATION
===================================== */

window.addEventListener("zorap:ready", event => {
  currentUser = event.detail.user;
  currentProfile = event.detail.profile;

  loadGroups();
});


function notify(message) {
  window.zorapToast?.(message);
}

function escapeText(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}


/* =====================================
   LOAD GROUPS
===================================== */

function loadGroups() {
  if (!currentUser) return;

  groupListener?.();

  const groupsQuery = query(
    collection(db, "conversations"),
    where("participants", "array-contains", currentUser.uid),
    where("type", "==", "group")
  );

  groupListener = onSnapshot(
    groupsQuery,
    snapshot => {
      userGroups = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      userGroups.sort((a, b) => {
        const first = a.updatedAt?.toMillis?.() || 0;
        const second = b.updatedAt?.toMillis?.() || 0;
        return second - first;
      });

      renderGroups();
    },
    error => {
      console.error("Load groups:", error);
      notify("Gagal memuat grup.");
    }
  );
}


/* =====================================
   RENDER GROUP LIST
===================================== */

function renderGroups() {
  const container = $("#groupsList");
  if (!container) return;

  container.replaceChildren();

  if (!userGroups.length) {
    const empty = document.createElement("div");

    empty.className = "chat-empty";
    empty.innerHTML = `
      <div class="empty-icon">Z</div>
      <h3>Belum ada grup</h3>
      <p>Buat grup dan mulai percakapan bersama temanmu.</p>
    `;

    container.appendChild(empty);
    return;
  }

  userGroups.forEach(group => {
    const item = document.createElement("button");

    item.type = "button";
    item.className = "chat-item group-item";

    const avatar = document.createElement("div");
    avatar.className = "avatar";

    if (group.groupPhoto) {
      const image = document.createElement("img");
      image.src = group.groupPhoto;
      image.alt = "";
      avatar.appendChild(image);
    } else {
      avatar.textContent = (group.groupName || "G")
        .charAt(0)
        .toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "chat-item-info";

    const top = document.createElement("div");
    top.className = "chat-item-top";

    const name = document.createElement("strong");
    name.textContent = group.groupName || "Grup ZORAP";

    const count = document.createElement("span");
    count.className = "chat-time";
    count.textContent = `${group.participants?.length || 0} anggota`;

    top.append(name, count);

    const bottom = document.createElement("div");
    bottom.className = "chat-item-bottom";

    const description = document.createElement("span");
    description.className = "chat-last-message";
    description.textContent = group.lastMessage || "Mulai percakapan";

    bottom.appendChild(description);
    info.append(top, bottom);

    item.append(avatar, info);

    item.addEventListener("click", () => {
      openGroup(group);
    });

    container.appendChild(item);
  });
}


/* =====================================
   CREATE GROUP
===================================== */

async function createGroup(groupName, description, usernames) {
  if (!currentUser) return;

  const name = groupName.trim();
  const about = description.trim();

  if (name.length < 3) {
    notify("Nama grup minimal 3 karakter.");
    return;
  }

  if (name.length > 40) {
    notify("Nama grup maksimal 40 karakter.");
    return;
  }

  const usernameList = [
    ...new Set(
      usernames
        .split(",")
        .map(item => item.trim().replace(/^@/, "").toLowerCase())
        .filter(Boolean)
    )
  ];

  if (!usernameList.length) {
    notify("Tambahkan minimal satu anggota.");
    return;
  }

  try {
    const participants = [currentUser.uid];

    for (const username of usernameList) {
      const userQuery = query(
        collection(db, "users"),
        where("username", "==", username)
      );

      const result = await getDocs(userQuery);

      if (result.empty) {
        notify(`Username @${username} tidak ditemukan.`);
        return;
      }

      const member = result.docs[0];

      if (member.id !== currentUser.uid) {
        participants.push(member.id);
      }
    }

    const uniqueParticipants = [...new Set(participants)];

    if (uniqueParticipants.length < 2) {
      notify("Grup membutuhkan minimal dua anggota.");
      return;
    }

    if (uniqueParticipants.length > 100) {
      notify("Maksimal 100 anggota untuk versi ini.");
      return;
    }

    const groupRef = doc(collection(db, "conversations"));

    await setDoc(groupRef, {
      type: "group",
      groupName: name,
      description: about,
      groupPhoto: "",
      participants: uniqueParticipants,
      admins: [currentUser.uid],
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "Grup berhasil dibuat",
      lastMessageAt: serverTimestamp(),
      unreadCount: Object.fromEntries(
        uniqueParticipants.map(uid => [uid, 0])
      )
    });

    notify("Grup berhasil dibuat.");
    window.zorapCloseModal?.();

  } catch (error) {
    console.error("Create group:", error);
    notify("Gagal membuat grup. Periksa Firestore Rules.");
  }
}


/* =====================================
   CREATE GROUP MODAL
===================================== */

function showCreateGroupModal() {
  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Buat grup baru";

  const description = document.createElement("p");
  description.textContent =
    "Buat ruang percakapan bersama teman-temanmu.";
  description.style.color = "var(--muted)";
  description.style.fontSize = "13px";
  description.style.margin = "8px 0 18px";

  const nameInput = createInput(
    "Nama grup",
    "Contoh: Teman Sekolah"
  );

  const aboutInput = createInput(
    "Deskripsi grup",
    "Tentang grup ini..."
  );

  const membersInput = createInput(
    "Username anggota",
    "username1, username2"
  );

  const submit = document.createElement("button");
  submit.className = "primary-btn";
  submit.textContent = "Buat grup";
  submit.style.width = "100%";
  submit.style.marginTop = "15px";

  submit.addEventListener("click", async () => {
    submit.disabled = true;

    try {
      await createGroup(
        nameInput.value,
        aboutInput.value,
        membersInput.value
      );
    } finally {
      submit.disabled = false;
    }
  });

  content.append(
    title,
    description,
    nameInput,
    aboutInput,
    membersInput,
    submit
  );

  overlay.classList.remove("hidden");
}

function createInput(placeholder, ariaLabel) {
  const input = document.createElement("input");

  input.type = "text";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", ariaLabel);

  input.style.width = "100%";
  input.style.height = "45px";
  input.style.padding = "0 13px";
  input.style.marginTop = "10px";
  input.style.border = "1px solid var(--border)";
  input.style.borderRadius = "12px";
  input.style.background = "var(--surface-2)";
  input.style.color = "var(--text)";
  input.style.outline = "none";

  return input;
}


/* =====================================
   OPEN GROUP
===================================== */

function openGroup(group) {
  if (!group || !currentUser) return;

  window.dispatchEvent(
    new CustomEvent("zorap:open-group", {
      detail: {
        id: group.id,
        type: "group",
        groupName: group.groupName,
        description: group.description || "",
        participants: group.participants || [],
        admins: group.admins || [],
        createdBy: group.createdBy,
        groupPhoto: group.groupPhoto || "",
        lastMessage: group.lastMessage || ""
      }
    })
  );
}


/* =====================================
   ADD MEMBER
===================================== */

async function addMember(groupId, username) {
  const cleanUsername = username
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  if (!cleanUsername) return;

  try {
    const groupRef = doc(db, "conversations", groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      notify("Grup tidak ditemukan.");
      return;
    }

    const group = groupSnap.data();

    if (!group.admins?.includes(currentUser.uid)) {
      notify("Hanya admin grup yang bisa menambahkan anggota.");
      return;
    }

    const userQuery = query(
      collection(db, "users"),
      where("username", "==", cleanUsername)
    );

    const result = await getDocs(userQuery);

    if (result.empty) {
      notify("Username tidak ditemukan.");
      return;
    }

    const memberId = result.docs[0].id;

    if (group.participants.includes(memberId)) {
      notify("Pengguna sudah menjadi anggota.");
      return;
    }

    await updateDoc(groupRef, {
      participants: arrayUnion(memberId),
      [`unreadCount.${memberId}`]: 0,
      updatedAt: serverTimestamp()
    });

    notify("Anggota berhasil ditambahkan.");

  } catch (error) {
    console.error("Add member:", error);
    notify("Gagal menambahkan anggota.");
  }
}


/* =====================================
   REMOVE MEMBER
===================================== */

async function removeMember(groupId, memberId) {
  try {
    const groupRef = doc(db, "conversations", groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) return;

    const group = groupSnap.data();

    if (!group.admins?.includes(currentUser.uid)) {
      notify("Kamu bukan admin grup.");
      return;
    }

    if (memberId === group.createdBy) {
      notify("Pembuat grup tidak dapat dikeluarkan.");
      return;
    }

    await updateDoc(groupRef, {
      participants: arrayRemove(memberId),
      updatedAt: serverTimestamp()
    });

    notify("Anggota dikeluarkan.");

  } catch (error) {
    console.error(error);
    notify("Gagal mengeluarkan anggota.");
  }
}


/* =====================================
   LEAVE GROUP
===================================== */

async function leaveGroup(groupId) {
  try {
    const groupRef = doc(db, "conversations", groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) return;

    const group = groupSnap.data();

    if (group.createdBy === currentUser.uid) {
      notify("Pembuat grup perlu mengalihkan kepemilikan sebelum keluar.");
      return;
    }

    await updateDoc(groupRef, {
      participants: arrayRemove(currentUser.uid),
      admins: arrayRemove(currentUser.uid),
      updatedAt: serverTimestamp()
    });

    notify("Kamu telah keluar dari grup.");

  } catch (error) {
    console.error(error);
    notify("Gagal keluar dari grup.");
  }
}


/* =====================================
   DELETE GROUP
===================================== */

async function deleteGroup(groupId) {
  try {
    const groupRef = doc(db, "conversations", groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) return;

    const group = groupSnap.data();

    if (group.createdBy !== currentUser.uid) {
      notify("Hanya pembuat grup yang dapat menghapus grup.");
      return;
    }

    await deleteDoc(groupRef);

    notify("Grup berhasil dihapus.");

  } catch (error) {
    console.error(error);
    notify("Gagal menghapus grup.");
  }
}


/* =====================================
   BUTTON EVENTS
===================================== */

$("#createGroupBtn")?.addEventListener(
  "click",
  showCreateGroupModal
);


/* =====================================
   PUBLIC API
===================================== */

window.zorapGroups = {
  loadGroups,
  createGroup,
  openGroup,
  addMember,
  removeMember,
  leaveGroup,
  deleteGroup,

  get groups() {
    return userGroups;
  }
};

console.log("ZORAP Groups Engine initialized.");
