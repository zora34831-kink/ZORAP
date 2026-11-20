
import { auth, db, storage } from "./firebase.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

const $ = (selector) => document.querySelector(selector);

let currentUser = null;
let currentProfile = {};
let statuses = [];
let statusListener = null;
let activeStatusIndex = 0;
let activeStatusGroup = [];

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const STATUS_DURATION = 24 * 60 * 60 * 1000;

function toast(message) {
  if (window.zorapToast) {
    window.zorapToast(message);
  } else {
    console.log(message);
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

function formatTime(timestamp) {
  if (!timestamp) return "Baru saja";

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  const diff = Date.now() - date.getTime();

  if (diff < 60000) return "Baru saja";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} menit lalu`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} jam lalu`;

  return date.toLocaleDateString("id-ID");
}

function getExpiryDate(status) {
  if (status.expiresAt?.toDate) {
    return status.expiresAt.toDate();
  }

  if (status.expiresAt) {
    return new Date(status.expiresAt);
  }

  return new Date(0);
}

function isExpired(status) {
  return getExpiryDate(status).getTime() <= Date.now();
}

function getAvatar(user) {
  return user?.photoURL ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.ownerName || "Z")}&background=292039&color=fff`;
}

// =====================================
// INITIALIZATION
// =====================================

window.addEventListener("zorap:ready", event => {
  currentUser = auth.currentUser;
  currentProfile = event.detail?.profile || {};

  if (!currentUser) return;

  startStatusListener();
  updateMyStatusProfile();
});

function updateMyStatusProfile() {
  const avatar = getAvatar({
    ...currentProfile,
    ownerName: currentProfile.name || "Z"
  });

  const image = $("#statusMyAvatar");
  if (image) image.src = avatar;
}

// =====================================
// LISTEN TO STATUSES
// =====================================

function startStatusListener() {
  if (statusListener) statusListener();

  const statusQuery = query(
    collection(db, "statuses"),
    orderBy("createdAt", "desc")
  );

  statusListener = onSnapshot(
    statusQuery,
    snapshot => {
      statuses = snapshot.docs
        .map(item => ({
          id: item.id,
          ...item.data()
        }))
        .filter(item => !isExpired(item));

      renderStatuses();
    },
    error => {
      console.error("Status listener:", error);
      toast("Gagal memuat status.");
    }
  );
}

// =====================================
// RENDER STATUS LIST
// =====================================

function renderStatuses() {
  const container = $("#statusList");
  if (!container) return;

  const grouped = new Map();

  statuses.forEach(status => {
    if (!grouped.has(status.ownerId)) {
      grouped.set(status.ownerId, []);
    }

    grouped.get(status.ownerId).push(status);
  });

  const otherGroups = [...grouped.entries()]
    .filter(([ownerId]) => ownerId !== currentUser?.uid);

  if (!otherGroups.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Belum ada status</h3>
        <p>Status teman kamu akan muncul di sini.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = otherGroups.map(([ownerId, items]) => {
    const latest = items[0];
    const name = escapeHTML(latest.ownerName || "Pengguna");
    const username = escapeHTML(latest.ownerUsername || "");
    const avatar = escapeHTML(getAvatar(latest));
    const count = items.length;

    return `
      <button class="status-item" data-status-owner="${escapeHTML(ownerId)}">
        <div class="status-ring">
          <img src="${avatar}" alt="">
        </div>
        <div class="status-item-info">
          <strong>${name}</strong>
          <small>@${username} · ${formatTime(latest.createdAt)}</small>
        </div>
        <span class="status-count">${count}</span>
      </button>
    `;
  }).join("");
}

// =====================================
// UPLOAD STATUS
// =====================================

function openStatusPicker() {
  if (!currentUser) {
    toast("Silakan login terlebih dahulu.");
    return;
  }

  $("#statusFileInput")?.click();
}

$("#createStatusBtn")?.addEventListener("click", openStatusPicker);
$("#addStatusBtn")?.addEventListener("click", openStatusPicker);

$("#statusFileInput")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file) return;

  event.target.value = "";

  if (!file.type.startsWith("image/") &&
      !file.type.startsWith("video/")) {
    toast("Pilih file foto atau video.");
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    toast("Ukuran file maksimal 30 MB.");
    return;
  }

  await uploadStatus(file);
});

async function uploadStatus(file) {
  if (!currentUser) return;

  const uploadButton = $("#createStatusBtn");

  try {
    if (uploadButton) {
      uploadButton.disabled = true;
      uploadButton.textContent = "Mengunggah...";
    }

    const extension = file.name.split(".").pop() || "file";
    const filename = `${Date.now()}_${crypto.randomUUID()}.${extension}`;
    const storagePath = `statuses/${currentUser.uid}/${filename}`;

    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file, {
      contentType: file.type
    });

    const mediaUrl = await getDownloadURL(storageRef);

    const caption = await askCaption();

    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + STATUS_DURATION)
    );

    await addDoc(collection(db, "statuses"), {
      ownerId: currentUser.uid,
      ownerName: currentProfile.name || currentUser.displayName || "Pengguna",
      ownerUsername: currentProfile.username || "",
      ownerPhotoURL: currentProfile.photoURL || currentUser.photoURL || "",
      mediaUrl,
      mediaPath: storagePath,
      mediaType: file.type.startsWith("video/") ? "video" : "image",
      caption,
      createdAt: serverTimestamp(),
      expiresAt
    });

    toast("Status berhasil dibagikan.");
  } catch (error) {
    console.error("Upload status:", error);
    toast("Gagal mengunggah status: " + error.message);
  } finally {
    if (uploadButton) {
      uploadButton.disabled = false;
      uploadButton.textContent = "Create status";
    }
  }
}

// =====================================
// CAPTION MODAL
// =====================================

function askCaption() {
  return new Promise(resolve => {
    const overlay = $("#modalOverlay");
    const content = $("#modalContent");

    if (!overlay || !content) {
      resolve("");
      return;
    }

    content.innerHTML = `
      <button class="modal-close" id="captionCancel">×</button>
      <div class="modal-heading">
        <h2>Tambah caption</h2>
        <p>Tulis sesuatu untuk status kamu.</p>
      </div>

      <textarea
        id="statusCaptionInput"
        maxlength="300"
        placeholder="Tulis caption..."
        rows="4"
      ></textarea>

      <div class="modal-actions">
        <button class="secondary-button" id="captionSkip">Lewati</button>
        <button class="primary-button" id="captionPublish">Bagikan</button>
      </div>
    `;

    overlay.classList.remove("hidden");

    const finish = value => {
      overlay.classList.add("hidden");
      content.innerHTML = "";
      resolve(value);
    };

    $("#captionCancel").onclick = () => finish("");
    $("#captionSkip").onclick = () => finish("");

    $("#captionPublish").onclick = () => {
      finish($("#statusCaptionInput")?.value.trim() || "");
    };
  });
}

// =====================================
// OPEN STATUS VIEWER
// =====================================

$("#statusList")?.addEventListener("click", event => {
  const button = event.target.closest("[data-status-owner]");
  if (!button) return;

  const ownerId = button.dataset.statusOwner;

  activeStatusGroup = statuses.filter(
    status => status.ownerId === ownerId
  );

  activeStatusIndex = 0;
  showStatus();
});

$("#myStatusCard")?.addEventListener("click", event => {
  if (event.target.closest("#addStatusBtn")) return;

  activeStatusGroup = statuses.filter(
    status => status.ownerId === currentUser?.uid
  );

  if (!activeStatusGroup.length) {
    openStatusPicker();
    return;
  }

  activeStatusIndex = 0;
  showStatus();
});

async function showStatus() {
  const viewer = $("#statusViewer");
  const content = $("#statusViewerContent");
  const info = $("#statusViewerInfo");

  if (!viewer || !content || !info) return;

  const status = activeStatusGroup[activeStatusIndex];

  if (!status) {
    closeStatusViewer();
    return;
  }

  viewer.classList.remove("hidden");

  const isMine = status.ownerId === currentUser?.uid;
  const name = escapeHTML(status.ownerName || "Pengguna");
  const caption = escapeHTML(status.caption || "");
  const avatar = escapeHTML(getAvatar({
    photoURL: status.ownerPhotoURL,
    ownerName: status.ownerName
  }));

  const media = status.mediaType === "video"
    ? `<video src="${escapeHTML(status.mediaUrl)}" controls autoplay playsinline></video>`
    : `<img src="${escapeHTML(status.mediaUrl)}" alt="Status">`;

  content.innerHTML = `
    <div class="status-progress">
      ${activeStatusGroup.map((_, index) => `
        <span class="${index <= activeStatusIndex ? "completed" : ""}"></span>
      `).join("")}
    </div>

    <div class="status-viewer-header">
      <img src="${avatar}" alt="">
      <div>
        <strong>${name}</strong>
        <small>${formatTime(status.createdAt)}</small>
      </div>
    </div>

    <div class="status-media">
      ${media}
    </div>

    ${caption ? `<p class="status-caption">${caption}</p>` : ""}
  `;

  info.innerHTML = `
    ${isMine
      ? `<button class="secondary-button" id="statusViewersBtn">Lihat penonton</button>
         <button class="danger-button" id="deleteMyStatusBtn">Hapus status</button>`
      : ""}
    <button class="icon-button" id="previousStatusBtn" ${activeStatusIndex === 0 ? "disabled" : ""}>←</button>
    <button class="icon-button" id="nextStatusBtn">→</button>
  `;

  if (!isMine) {
    await recordStatusView(status);
  }

  $("#previousStatusBtn").onclick = () => {
    if (activeStatusIndex > 0) {
      activeStatusIndex--;
      showStatus();
    }
  };

  $("#nextStatusBtn").onclick = () => {
    if (activeStatusIndex < activeStatusGroup.length - 1) {
      activeStatusIndex++;
      showStatus();
    } else {
      closeStatusViewer();
    }
  };

  $("#deleteMyStatusBtn")?.addEventListener("click", deleteCurrentStatus);
  $("#statusViewersBtn")?.addEventListener("click", showStatusViewers);
}

async function recordStatusView(status) {
  if (!currentUser || status.ownerId === currentUser.uid) return;

  try {
    await setDoc(
      doc(db, "statuses", status.id, "views", currentUser.uid),
      {
        userId: currentUser.uid,
        username: currentProfile.username || "",
        viewedAt: serverTimestamp()
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Record status view:", error);
  }
}

// =====================================
// VIEW STATUS VIEWERS
// =====================================

async function showStatusViewers() {
  const status = activeStatusGroup[activeStatusIndex];
  if (!status || status.ownerId !== currentUser?.uid) return;

  try {
    const { getDocs } = await import(
      "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js"
    );

    const snapshot = await getDocs(
      collection(db, "statuses", status.id, "views")
    );

    const names = snapshot.docs.map(item => {
      const data = item.data();
      return escapeHTML(data.username || data.userId || "Pengguna");
    });

    const content = $("#modalContent");
    const overlay = $("#modalOverlay");

    if (!content || !overlay) return;

    content.innerHTML = `
      <button class="modal-close" id="closeViewerList">×</button>
      <h2>Penonton status</h2>
      <p>${names.length} orang melihat status ini.</p>
      <div class="viewer-list">
        ${names.length
          ? names.map(name => `<div class="viewer-list-item">${name}</div>`).join("")
          : "<p>Belum ada yang melihat status ini.</p>"}
      </div>
    `;

    overlay.classList.remove("hidden");
    $("#closeViewerList").onclick = () => {
      overlay.classList.add("hidden");
      showStatus();
    };
  } catch (error) {
    console.error(error);
    toast("Gagal memuat penonton.");
  }
}

// =====================================
// DELETE OWN STATUS
// =====================================

async function deleteCurrentStatus() {
  const status = activeStatusGroup[activeStatusIndex];

  if (!status || status.ownerId !== currentUser?.uid) return;

  const confirmed = confirm("Hapus status ini?");

  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "statuses", status.id));

    if (status.mediaPath) {
      try {
        await deleteObject(ref(storage, status.mediaPath));
      } catch (storageError) {
        console.warn("File status tidak berhasil dihapus:", storageError);
      }
    }

    toast("Status berhasil dihapus.");
    closeStatusViewer();
  } catch (error) {
    console.error("Delete status:", error);
    toast("Gagal menghapus status.");
  }
}

// =====================================
// CLOSE VIEWER
// =====================================

function closeStatusViewer() {
  const viewer = $("#statusViewer");
  const content = $("#statusViewerContent");
  const info = $("#statusViewerInfo");

  viewer?.classList.add("hidden");

  if (content) content.innerHTML = "";
  if (info) info.innerHTML = "";

  activeStatusGroup = [];
  activeStatusIndex = 0;
}

$("#closeStatusViewer")?.addEventListener("click", closeStatusViewer);

// =====================================
// PUBLIC API
// =====================================

window.zorapStatus = {
  uploadStatus,
  openStatusPicker,
  closeStatusViewer,
  refresh: startStatusListener
};
