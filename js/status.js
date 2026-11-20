
import { auth, db, storage } from "./firebase.js";

import {
  collection, doc, addDoc, getDocs, query,
  where, orderBy, serverTimestamp, updateDoc,
  arrayUnion, onSnapshot
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

import { getCurrentUser, showToast, openModal } from "./app.js";

const statusList = document.getElementById("statusList");
const addStatusBtn = document.getElementById("addStatusBtn");
const myStatusCard = document.getElementById("myStatusCard");

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[c]);
}

let unsubscribeStatus = null;

export async function loadStatuses() {
  const user = getCurrentUser();
  if (!user || !statusList) return;

  unsubscribeStatus?.();

  const q = query(
    collection(db, "statuses"),
    where("expiresAt", ">", new Date()),
    orderBy("expiresAt", "asc")
  );

  unsubscribeStatus = onSnapshot(q, snapshot => {
    const statuses = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    const grouped = new Map();

    statuses.forEach(status => {
      if (!grouped.has(status.ownerId)) {
        grouped.set(status.ownerId, []);
      }
      grouped.get(status.ownerId).push(status);
    });

    statusList.innerHTML = "";

    if (!grouped.size) {
      statusList.innerHTML = `
        <div class="empty-state">
          <h3>Belum ada pembaruan</h3>
          <p>Status teman akan muncul di sini.</p>
        </div>`;
    }

    grouped.forEach((items, ownerId) => {
      const first = items[0];

      const card = document.createElement("article");
      card.className = "status-card";
      card.innerHTML = `
        <div class="status-ring">
          <img src="${escapeHTML(first.photoURL || "./assets/default-avatar.svg")}" alt="">
        </div>
        <div class="status-info">
          <strong>${escapeHTML(first.ownerName || "Pengguna")}</strong>
          <span>${items.length} pembaruan</span>
        </div>
        <button class="secondary-button status-view">Lihat</button>
      `;

      card.querySelector(".status-view").onclick = () =>
        viewStatus(items);

      statusList.appendChild(card);
    });

    const mine = grouped.get(user.uid) || [];
    if (myStatusCard) {
      myStatusCard.textContent = mine.length
        ? `${mine.length} status aktif`
        : "Belum ada status";
    }
  }, error => {
    console.error(error);
    showToast("Gagal memuat status", "error");
  });
}

async function createStatus() {
  const user = getCurrentUser();
  if (!user) return;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*,video/*";

  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const allowed = ["image/", "video/"];
    if (!allowed.some(type => file.type.startsWith(type))) {
      showToast("Format file tidak didukung", "error");
      return;
    }

    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast("Ukuran file maksimal 25 MB", "error");
      return;
    }

    try {
      showToast("Mengunggah status...");

      const path = `statuses/${user.uid}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);

      await uploadBytes(storageRef, file);
      const mediaURL = await getDownloadURL(storageRef);

      const profileSnap = await getDocs(
        query(collection(db, "publicProfiles"), where("uid", "==", user.uid))
      );

      const profile = profileSnap.docs[0]?.data() || {};

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await addDoc(collection(db, "statuses"), {
        ownerId: user.uid,
        ownerName: profile.name || user.displayName || "Pengguna",
        photoURL: profile.photoURL || "",
        mediaURL,
        mediaType: file.type.startsWith("video/") ? "video" : "image",
        caption: "",
        createdAt: serverTimestamp(),
        expiresAt,
        views: []
      });

      showToast("Status berhasil dibagikan", "success");

    } catch (error) {
      console.error(error);
      showToast("Gagal mengunggah status", "error");
    }
  };

  fileInput.click();
}

function viewStatus(items) {
  if (!items.length) return;

  let index = 0;

  const render = () => {
    const item = items[index];
    const isVideo = item.mediaType === "video";

    openModal(`
      <div class="status-viewer">
        <div class="status-viewer-progress">
          ${items.map((_, i) => `
            <span class="${i <= index ? "active" : ""}"></span>
          `).join("")}
        </div>

        <div class="status-viewer-header">
          <strong>${escapeHTML(item.ownerName || "Pengguna")}</strong>
          <button id="statusViewerClose">Tutup</button>
        </div>

        ${isVideo
          ? `<video src="${escapeHTML(item.mediaURL)}" controls autoplay playsinline></video>`
          : `<img src="${escapeHTML(item.mediaURL)}" alt="Status">`
        }

        <div class="status-viewer-actions">
          <button id="statusPrevious" ${index === 0 ? "disabled" : ""}>Sebelumnya</button>
          <button id="statusNext" ${index === items.length - 1 ? "disabled" : ""}>Berikutnya</button>
        </div>
      </div>
    `);

    document.getElementById("statusViewerClose").onclick = () =>
      document.getElementById("modalClose")?.click();

    document.getElementById("statusPrevious").onclick = () => {
      if (index > 0) {
        index--;
        render();
      }
    };

    document.getElementById("statusNext").onclick = () => {
      if (index < items.length - 1) {
        index++;
        render();
      }
    };

    const user = getCurrentUser();

    if (user && item.ownerId !== user.uid) {
      updateDoc(doc(db, "statuses", item.id), {
        views: arrayUnion(user.uid)
      }).catch(console.error);
    }
  };

  render();
}

addStatusBtn?.addEventListener("click", createStatus);

window.addEventListener("zorap:ready", loadStatuses);
