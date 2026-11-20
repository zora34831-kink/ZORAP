
import { auth, db, storage } from "./firebase.js";

import {
  collection,
  doc,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  Timestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";


/* =====================================
   ZORAP STATUS ENGINE
===================================== */

const $ = selector => document.querySelector(selector);

let currentUser = null;
let currentProfile = null;

let statusListener = null;
let statuses = [];
let activeStatus = null;

let viewerTimer = null;
let uploadBusy = false;

const STATUS_DURATION = 24 * 60 * 60 * 1000;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;


/* =====================================
   INITIALIZATION
===================================== */

window.addEventListener("zorap:ready", event => {
  currentUser = event.detail.user;
  currentProfile = event.detail.profile;

  loadStatuses();
});


function notify(message) {
  window.zorapToast?.(message);
}

function formatTime(timestamp) {
  if (!timestamp?.toDate) return "";

  return timestamp.toDate().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
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

function getExpiry() {
  return Timestamp.fromMillis(Date.now() + STATUS_DURATION);
}


/* =====================================
   LOAD STATUSES
===================================== */

function loadStatuses() {
  if (!currentUser) return;

  statusListener?.();

  const statusQuery = query(
    collection(db, "statuses"),
    where("expiresAt", ">", Timestamp.now()),
    orderBy("expiresAt", "asc")
  );

  statusListener = onSnapshot(statusQuery, async snapshot => {
    statuses = [];

    const grouped = new Map();

    for (const item of snapshot.docs) {
      const data = item.data();

      if (!data.uid || !data.mediaURL) continue;

      if (!grouped.has(data.uid)) {
        grouped.set(data.uid, []);
      }

      grouped.get(data.uid).push({
        id: item.id,
        ...data
      });
    }

    for (const [uid, items] of grouped) {
      const userSnap = await getDoc(doc(db, "users", uid));

      const profile = userSnap.exists()
        ? userSnap.data()
        : {};

      statuses.push({
        uid,
        name: profile.name || "Pengguna",
        username: profile.username || "",
        photoURL: profile.photoURL || "",
        verified: profile.verified === true,
        items: items.sort((a, b) => {
          const first = a.createdAt?.toMillis?.() || 0;
          const second = b.createdAt?.toMillis?.() || 0;
          return first - second;
        })
      });
    }

    renderStatuses();

  }, error => {
    console.error("Status listener:", error);
    notify("Gagal memuat status.");
  });
}


/* =====================================
   RENDER STATUS LIST
===================================== */

function renderStatuses() {
  const container = $("#statusList");
  if (!container) return;

  container.replaceChildren();

  const ownStatus = statuses.find(
    item => item.uid === currentUser.uid
  );

  const others = statuses.filter(
    item => item.uid !== currentUser.uid
  );

  const addStatusItem = (profile, isOwn = false) => {
    const button = document.createElement("button");

    button.className = "status-user";
    button.type = "button";

    const avatar = document.createElement("div");
    avatar.className = "status-avatar";

    const image = document.createElement("img");
    image.alt = "";

    image.src = profile.photoURL ||
      profile.items?.[0]?.mediaURL ||
      "";

    if (!image.src) {
      avatar.textContent = (profile.name || "Z")
        .charAt(0).toUpperCase();
    } else {
      avatar.appendChild(image);
    }

    if (profile.items?.length) {
      avatar.classList.add("has-status");

      const unseen = profile.items.some(
        item => !(item.viewers || []).includes(currentUser.uid)
      );

      avatar.classList.add(
        unseen ? "status-unseen" : "status-seen"
      );
    }

    const name = document.createElement("span");
    name.className = "status-user-name";
    name.textContent = isOwn ? "Status saya" : profile.name;

    button.append(avatar, name);

    button.addEventListener("click", () => {
      if (isOwn && !profile.items?.length) {
        showUploadDialog();
      } else {
        openStatusViewer(profile);
      }
    });

    container.appendChild(button);
  };

  const ownProfile = {
    uid: currentUser.uid,
    name: currentProfile?.name || "Saya",
    photoURL: currentProfile?.photoURL || "",
    items: ownStatus?.items || []
  };

  addStatusItem(ownProfile, true);

  others.forEach(profile => addStatusItem(profile));
}


/* =====================================
   UPLOAD DIALOG
===================================== */

function showUploadDialog() {
  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Buat status";

  const description = document.createElement("p");
  description.textContent =
    "Bagikan foto atau video yang akan tersedia selama 24 jam.";
  description.style.color = "var(--muted)";
  description.style.fontSize = "13px";
  description.style.margin = "10px 0 18px";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,video/mp4,video/webm";
  input.style.width = "100%";

  const caption = document.createElement("textarea");
  caption.placeholder = "Tambahkan keterangan...";
  caption.maxLength = 500;
  caption.style.width = "100%";
  caption.style.marginTop = "12px";

  const submit = document.createElement("button");
  submit.className = "primary-btn";
  submit.textContent = "Bagikan status";
  submit.style.width = "100%";
  submit.style.marginTop = "15px";

  submit.addEventListener("click", async () => {
    if (!input.files?.[0]) {
      notify("Pilih foto atau video terlebih dahulu.");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Mengunggah...";

    try {
      await uploadStatus(input.files[0], caption.value);
      window.zorapCloseModal?.();
    } finally {
      submit.disabled = false;
      submit.textContent = "Bagikan status";
    }
  });

  content.append(title, description, input, caption, submit);

  overlay.classList.remove("hidden");
}


/* =====================================
   UPLOAD STATUS
===================================== */

async function uploadStatus(file, caption = "") {
  if (!currentUser || uploadBusy) return;

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (!isImage && !isVideo) {
    notify("Format file tidak didukung.");
    return;
  }

  if (isImage && file.size > MAX_IMAGE_SIZE) {
    notify("Foto maksimal 10 MB.");
    return;
  }

  if (isVideo && file.size > MAX_VIDEO_SIZE) {
    notify("Video maksimal 50 MB.");
    return;
  }

  if (isVideo && !["video/mp4", "video/webm"].includes(file.type)) {
    notify("Format video harus MP4 atau WebM.");
    return;
  }

  uploadBusy = true;

  try {
    const fileExtension = file.name.split(".").pop()
      .replace(/[^a-zA-Z0-9]/g, "");

    const fileName = `${crypto.randomUUID()}.${fileExtension}`;

    const storagePath =
      `statuses/${currentUser.uid}/${fileName}`;

    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file, {
      contentType: file.type
    });

    const mediaURL = await getDownloadURL(storageRef);

    await addDoc(collection(db, "statuses"), {
      uid: currentUser.uid,
      mediaURL,
      storagePath,
      mediaType: isImage ? "image" : "video",
      caption: caption.trim().slice(0, 500),
      createdAt: serverTimestamp(),
      expiresAt: getExpiry(),
      viewers: []
    });

    notify("Status berhasil dibagikan.");

  } catch (error) {
    console.error("Upload status:", error);
    notify("Gagal mengunggah status.");
  } finally {
    uploadBusy = false;
  }
}


/* =====================================
   STATUS VIEWER
===================================== */

function openStatusViewer(profile) {
  if (!profile?.items?.length) return;

  activeStatus = {
    ...profile,
    index: 0
  };

  const overlay = $("#statusViewer");
  if (!overlay) {
    notify("Elemen statusViewer belum tersedia di HTML.");
    return;
  }

  overlay.classList.remove("hidden");
  showCurrentStatus();
}


/* =====================================
   SHOW CURRENT STATUS
===================================== */

async function showCurrentStatus() {
  if (!activeStatus) return;

  const item = activeStatus.items[activeStatus.index];

  if (!item) {
    closeStatusViewer();
    return;
  }

  const media = $("#statusMedia");
  const caption = $("#statusCaption");
  const name = $("#statusViewerName");
  const avatar = $("#statusViewerAvatar");
  const time = $("#statusViewerTime");
  const progress = $("#statusProgress");
  const deleteButton = $("#deleteStatusBtn");
  const viewersButton = $("#statusViewersBtn");

  if (!media) return;

  clearTimeout(viewerTimer);

  media.replaceChildren();

  const element = document.createElement(
    item.mediaType === "video" ? "video" : "img"
  );

  element.src = item.mediaURL;

  if (item.mediaType === "video") {
    element.autoplay = true;
    element.controls = true;
    element.playsInline = true;
  } else {
    element.alt = "Status";
  }

  media.appendChild(element);

  if (caption) caption.textContent = item.caption || "";

  if (name) name.textContent = activeStatus.name;

  if (avatar) {
    avatar.textContent = (activeStatus.name || "Z")
      .charAt(0).toUpperCase();
  }

  if (time) time.textContent = formatTime(item.createdAt);

  if (deleteButton) {
    deleteButton.classList.toggle(
      "hidden",
      activeStatus.uid !== currentUser.uid
    );
  }

  if (viewersButton) {
    viewersButton.classList.toggle(
      "hidden",
      activeStatus.uid !== currentUser.uid
    );
  }

  renderStatusProgress();

  if (activeStatus.uid !== currentUser.uid) {
    markStatusViewed(item.id);
  }

  if (item.mediaType === "image") {
    viewerTimer = setTimeout(nextStatus, 5000);
  } else {
    element.addEventListener("ended", nextStatus, { once: true });
  }
}


/* =====================================
   STATUS PROGRESS
===================================== */

function renderStatusProgress() {
  const container = $("#statusProgress");
  if (!container || !activeStatus) return;

  container.replaceChildren();

  activeStatus.items.forEach((item, index) => {
    const segment = document.createElement("div");
    segment.className = "status-progress-segment";

    const fill = document.createElement("div");
    fill.className = "status-progress-fill";

    if (index < activeStatus.index) {
      fill.style.width = "100%";
    }

    if (index === activeStatus.index) {
      fill.style.width = "100%";
      fill.style.animation = "statusProgress 5s linear forwards";
    }

    segment.appendChild(fill);
    container.appendChild(segment);
  });
}


/* =====================================
   NEXT / PREVIOUS
===================================== */

function nextStatus() {
  if (!activeStatus) return;

  if (activeStatus.index < activeStatus.items.length - 1) {
    activeStatus.index++;
    showCurrentStatus();
  } else {
    closeStatusViewer();
  }
}

function previousStatus() {
  if (!activeStatus) return;

  if (activeStatus.index > 0) {
    activeStatus.index--;
    showCurrentStatus();
  }
}


/* =====================================
   VIEW STATUS
===================================== */

async function markStatusViewed(statusId) {
  if (!currentUser) return;

  try {
    await updateDoc(
      doc(db, "statuses", statusId),
      {
        viewers: arrayUnion(currentUser.uid)
      }
    );
  } catch (error) {
    console.error("Mark viewed:", error);
  }
}


/* =====================================
   VIEWERS
===================================== */

async function showStatusViewers() {
  if (!activeStatus) return;

  const item = activeStatus.items[activeStatus.index];

  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Dilihat oleh";

  const viewers = item.viewers || [];

  const description = document.createElement("p");
  description.textContent = `${viewers.length} penonton`;
  description.style.color = "var(--muted)";

  content.append(title, description);

  for (const uid of viewers) {
    const profile = await getDoc(doc(db, "users", uid));

    const user = profile.exists() ? profile.data() : {};

    const row = document.createElement("div");
    row.className = "setting-item";
    row.textContent = user.name || "Pengguna ZORAP";

    content.appendChild(row);
  }

  overlay.classList.remove("hidden");
}


/* =====================================
   DELETE STATUS
===================================== */

async function deleteStatus() {
  if (!activeStatus || activeStatus.uid !== currentUser.uid) return;

  const item = activeStatus.items[activeStatus.index];

  try {
    await deleteDoc(doc(db, "statuses", item.id));

    if (item.storagePath) {
      try {
        await deleteObject(ref(storage, item.storagePath));
      } catch (storageError) {
        console.error("Storage cleanup:", storageError);
      }
    }

    notify("Status berhasil dihapus.");

    if (activeStatus.items.length <= 1) {
      closeStatusViewer();
    } else {
      activeStatus.items.splice(activeStatus.index, 1);
      activeStatus.index = Math.min(
        activeStatus.index,
        activeStatus.items.length - 1
      );

      showCurrentStatus();
    }

  } catch (error) {
    console.error("Delete status:", error);
    notify("Gagal menghapus status.");
  }
}


/* =====================================
   CLOSE VIEWER
===================================== */

function closeStatusViewer() {
  clearTimeout(viewerTimer);

  activeStatus = null;

  const overlay = $("#statusViewer");
  overlay?.classList.add("hidden");

  const media = $("#statusMedia");
  if (media) media.replaceChildren();
}


/* =====================================
   EVENTS
===================================== */

$("#createStatusBtn")?.addEventListener(
  "click",
  showUploadDialog
);

$("#statusPrevious")?.addEventListener(
  "click",
  previousStatus
);

$("#statusNext")?.addEventListener(
  "click",
  nextStatus
);

$("#closeStatusViewer")?.addEventListener(
  "click",
  closeStatusViewer
);

$("#deleteStatusBtn")?.addEventListener(
  "click",
  deleteStatus
);

$("#statusViewersBtn")?.addEventListener(
  "click",
  showStatusViewers
);


/* =====================================
   PUBLIC API
===================================== */

window.zorapStatus = {
  loadStatuses,
  uploadStatus,
  openStatusViewer,
  closeStatusViewer,
  nextStatus,
  previousStatus,

  get statuses() {
    return statuses;
  }
};

console.log("ZORAP Status Engine initialized.");
