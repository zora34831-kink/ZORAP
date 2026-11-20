
import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  limit
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";


/* =====================================
   ZORAP CONTACT SYSTEM
===================================== */

const $ = selector => document.querySelector(selector);

let currentUser = null;
let currentProfile = null;

let contacts = [];
let contactListener = null;
let searchTimeout = null;


/* =====================================
   HELPERS
===================================== */

function toast(message) {
  window.zorapToast?.(message);
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

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function getDisplayName(user) {
  return user.name || user.displayName || "Pengguna ZORAP";
}


/* =====================================
   INITIALIZATION
===================================== */

window.addEventListener("zorap:ready", event => {
  currentUser = event.detail.user;
  currentProfile = event.detail.profile;

  loadContacts();
});


/* =====================================
   LOAD CONTACTS
===================================== */

function loadContacts() {
  if (!currentUser) return;

  contactListener?.();

  const contactsRef = collection(
    db,
    "users",
    currentUser.uid,
    "contacts"
  );

  contactListener = onSnapshot(
    contactsRef,
    async snapshot => {
      const result = [];

      for (const contactDoc of snapshot.docs) {
        const uid = contactDoc.id;

        if (uid === currentUser.uid) continue;

        try {
          const userSnap = await getDoc(
            doc(db, "users", uid)
          );

          if (!userSnap.exists()) continue;

          result.push({
            uid,
            ...userSnap.data(),
            savedAt: contactDoc.data().savedAt
          });

        } catch (error) {
          console.error("Load contact:", error);
        }
      }

      contacts = result;

      renderContacts();

      window.dispatchEvent(
        new CustomEvent("zorap:contacts-updated", {
          detail: { contacts }
        })
      );

    },
    error => {
      console.error("Contacts listener:", error);
      toast("Gagal memuat kontak.");
    }
  );
}


/* =====================================
   RENDER CONTACTS
===================================== */

function renderContacts() {
  const container = $("#contactsList");

  if (!container) return;

  container.replaceChildren();

  if (!contacts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const heading = document.createElement("h3");
    heading.textContent = "Belum ada kontak";

    const description = document.createElement("p");
    description.textContent =
      "Cari username teman untuk menambah kontak.";

    empty.append(heading, description);
    container.appendChild(empty);

    return;
  }

  contacts.sort((a, b) =>
    getDisplayName(a).localeCompare(getDisplayName(b))
  );

  contacts.forEach(user => {
    const row = document.createElement("div");
    row.className = "contact-item";

    const avatar = document.createElement("div");
    avatar.className = "contact-avatar";

    if (user.photoURL) {
      const image = document.createElement("img");
      image.src = user.photoURL;
      image.alt = "";
      avatar.appendChild(image);
    } else {
      avatar.textContent =
        getDisplayName(user).charAt(0).toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "contact-info";

    const name = document.createElement("strong");
    name.textContent = getDisplayName(user);

    const username = document.createElement("span");
    username.textContent = "@" + (user.username || "");

    info.append(name, username);

    if (user.verified === true) {
      const verified = document.createElement("span");
      verified.className = "verified-badge";
      verified.textContent = "✓";
      name.appendChild(verified);
    }

    const actions = document.createElement("div");
    actions.className = "contact-actions";

    const chatButton = document.createElement("button");
    chatButton.type = "button";
    chatButton.textContent = "Chat";
    chatButton.className = "contact-chat-btn";

    chatButton.addEventListener("click", () => {
      openContactChat(user);
    });

    const moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.textContent = "•••";
    moreButton.className = "contact-more-btn";

    moreButton.addEventListener("click", () => {
      showContactMenu(user);
    });

    actions.append(chatButton, moreButton);

    row.append(avatar, info, actions);
    container.appendChild(row);
  });
}


/* =====================================
   SEARCH USER
===================================== */

async function searchUser(username) {
  if (!currentUser) {
    toast("Kamu belum login.");
    return [];
  }

  const normalized = normalizeUsername(username);

  if (normalized.length < 2) {
    toast("Masukkan username minimal 2 karakter.");
    return [];
  }

  if (!/^[a-z0-9._]+$/.test(normalized)) {
    toast("Username hanya boleh menggunakan huruf, angka, titik, dan garis bawah.");
    return [];
  }

  try {
    const usersQuery = query(
      collection(db, "users"),
      where("username", "==", normalized),
      limit(10)
    );

    const snapshot = await getDocs(usersQuery);

    return snapshot.docs
      .filter(item => item.id !== currentUser.uid)
      .map(item => ({
        uid: item.id,
        ...item.data()
      }));

  } catch (error) {
    console.error("Search user:", error);
    toast("Pencarian pengguna gagal.");
    return [];
  }
}


/* =====================================
   RENDER SEARCH RESULTS
===================================== */

function renderSearchResults(results) {
  const container = $("#contactSearchResults");

  if (!container) return;

  container.replaceChildren();

  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "Pengguna tidak ditemukan.";
    container.appendChild(empty);
    return;
  }

  results.forEach(user => {
    const row = document.createElement("div");
    row.className = "contact-search-result";

    const avatar = document.createElement("div");
    avatar.className = "contact-avatar";

    if (user.photoURL) {
      const image = document.createElement("img");
      image.src = user.photoURL;
      image.alt = "";
      avatar.appendChild(image);
    } else {
      avatar.textContent =
        getDisplayName(user).charAt(0).toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "contact-info";

    const name = document.createElement("strong");
    name.textContent = getDisplayName(user);

    const username = document.createElement("span");
    username.textContent = "@" + (user.username || "");

    info.append(name, username);

    if (user.verified === true) {
      const verified = document.createElement("span");
      verified.className = "verified-badge";
      verified.textContent = "✓";
      name.appendChild(verified);
    }

    const isSaved = contacts.some(
      contact => contact.uid === user.uid
    );

    const button = document.createElement("button");
    button.type = "button";
    button.className = "contact-add-btn";
    button.textContent = isSaved ? "Tersimpan" : "Tambah";
    button.disabled = isSaved;

    if (!isSaved) {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Menyimpan...";

        const success = await addContact(user.uid);

        if (success) {
          button.textContent = "Tersimpan";
        } else {
          button.textContent = "Tambah";
          button.disabled = false;
        }
      });
    }

    row.append(avatar, info, button);
    container.appendChild(row);
  });
}


/* =====================================
   ADD CONTACT
===================================== */

async function addContact(uid) {
  if (!currentUser || !uid) return false;

  if (uid === currentUser.uid) {
    toast("Kamu tidak bisa menambahkan akun sendiri.");
    return false;
  }

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      toast("Pengguna tidak ditemukan.");
      return false;
    }

    const contactRef = doc(
      db,
      "users",
      currentUser.uid,
      "contacts",
      uid
    );

    const existing = await getDoc(contactRef);

    if (existing.exists()) {
      toast("Kontak sudah tersimpan.");
      return true;
    }

    await setDoc(contactRef, {
      uid,
      savedAt: serverTimestamp()
    });

    toast("Kontak berhasil ditambahkan.");

    return true;

  } catch (error) {
    console.error("Add contact:", error);
    toast("Gagal menambahkan kontak.");
    return false;
  }
}


/* =====================================
   REMOVE CONTACT
===================================== */

async function removeContact(uid) {
  if (!currentUser || !uid) return;

  try {
    await deleteDoc(
      doc(db, "users", currentUser.uid, "contacts", uid)
    );

    toast("Kontak berhasil dihapus.");

  } catch (error) {
    console.error("Remove contact:", error);
    toast("Gagal menghapus kontak.");
  }
}


/* =====================================
   OPEN CHAT
===================================== */

async function openContactChat(user) {
  if (!user?.uid) return;

  if (window.zorapChat?.openPrivateChat) {
    await window.zorapChat.openPrivateChat(user);
    return;
  }

  window.dispatchEvent(
    new CustomEvent("zorap:open-contact", {
      detail: { user }
    })
  );
}


/* =====================================
   CONTACT MENU
===================================== */

function showContactMenu(user) {
  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = getDisplayName(user);

  const description = document.createElement("p");
  description.textContent = "@" + (user.username || "");

  const chatButton = document.createElement("button");
  chatButton.className = "primary-btn";
  chatButton.textContent = "Kirim pesan";

  chatButton.addEventListener("click", () => {
    window.zorapCloseModal?.();
    openContactChat(user);
  });

  const removeButton = document.createElement("button");
  removeButton.className = "danger-btn";
  removeButton.textContent = "Hapus kontak";

  removeButton.addEventListener("click", async () => {
    window.zorapCloseModal?.();
    await removeContact(user.uid);
  });

  content.append(
    title,
    description,
    chatButton,
    removeButton
  );

  overlay.classList.remove("hidden");
}


/* =====================================
   SEARCH FORM
===================================== */

const searchInput = $("#contactSearchInput");
const searchButton = $("#contactSearchBtn");

async function executeSearch() {
  if (!searchInput) return;

  const username = searchInput.value.trim();

  if (!username) {
    toast("Masukkan username terlebih dahulu.");
    return;
  }

  if (searchButton) {
    searchButton.disabled = true;
    searchButton.textContent = "Mencari...";
  }

  const results = await searchUser(username);

  renderSearchResults(results);

  if (searchButton) {
    searchButton.disabled = false;
    searchButton.textContent = "Cari";
  }
}

searchButton?.addEventListener("click", executeSearch);

searchInput?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    executeSearch();
  }
});


/* =====================================
   SEARCH MODAL
===================================== */

function openContactSearch() {
  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Cari teman";

  const description = document.createElement("p");
  description.textContent =
    "Masukkan username pengguna ZORAP.";

  const input = document.createElement("input");
  input.id = "contactSearchInput";
  input.placeholder = "Contoh: zora123";
  input.autocomplete = "off";

  const button = document.createElement("button");
  button.id = "contactSearchBtn";
  button.className = "primary-btn";
  button.textContent = "Cari";

  const results = document.createElement("div");
  results.id = "contactSearchResults";

  content.append(
    title,
    description,
    input,
    button,
    results
  );

  overlay.classList.remove("hidden");

  button.addEventListener("click", async () => {
    const username = input.value.trim();

    if (!username) {
      toast("Masukkan username terlebih dahulu.");
      return;
    }

    button.disabled = true;
    button.textContent = "Mencari...";

    const users = await searchUser(username);

    renderSearchResults(users);

    button.disabled = false;
    button.textContent = "Cari";
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      button.click();
    }
  });

  input.focus();
}


/* =====================================
   EVENT LISTENERS
===================================== */

$("#openContactsBtn")?.addEventListener(
  "click",
  openContactSearch
);

$("#addContactBtn")?.addEventListener(
  "click",
  openContactSearch
);


/* =====================================
   PUBLIC API
===================================== */

window.zorapContacts = {
  loadContacts,
  searchUser,
  addContact,
  removeContact,
  openContactChat,
  openContactSearch,

  get contacts() {
    return contacts;
  }
};

console.log("ZORAP Contacts initialized.");
