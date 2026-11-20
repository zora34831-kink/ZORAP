
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  updateDoc,
  addDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

/* =========================================
   ZORAP ADMIN SYSTEM
========================================= */

const $ = (selector) => document.querySelector(selector);

let adminUser = null;
let adminProfile = null;
let usersCache = [];
let appealsCache = [];
let logsCache = [];
let activeAdminPage = "overview";

const ADMIN_COLLECTIONS = {
  users: "users",
  appeals: "appeals",
  logs: "adminLogs"
};

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);

const formatDate = (value) => {
  if (!value) return "-";

  const date = value.toDate
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const getInitial = (name = "U") =>
  escapeHTML(String(name).trim().charAt(0).toUpperCase() || "U");

function toast(message, type = "success") {
  if (window.zorapToast) {
    window.zorapToast(message, type);
    return;
  }

  const container = $("#toastContainer");

  if (!container) {
    console.log(message);
    return;
  }

  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;

  container.appendChild(item);

  setTimeout(() => item.remove(), 3500);
}

/* =========================================
   ACCESS CONTROL
========================================= */

async function checkAdminAccess(user) {
  if (!user) {
    location.replace("./index.html");
    return false;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      await signOut(auth);
      location.replace("./index.html");
      return false;
    }

    const profile = snapshot.data();

    // Role harus ditetapkan melalui proses tepercaya.
    if (profile.role !== "admin") {
      document.body.innerHTML = `
        <main style="
          min-height:100vh;
          display:grid;
          place-items:center;
          padding:24px;
          background:#0b0911;
          color:white;
          font-family:Arial,sans-serif;
          text-align:center
        ">
          <div>
            <h1 style="font-size:25px">Akses Ditolak</h1>
            <p style="color:#aaa">Akun ini tidak memiliki akses administrator.</p>
            <button id="returnApp" style="
              padding:12px 20px;
              border:0;
              border-radius:10px;
              background:#9872ed;
              color:white;
              cursor:pointer
            ">Kembali ke ZORAP</button>
          </div>
        </main>
      `;

      $("#returnApp")?.addEventListener("click", () => {
        location.replace("./app.html");
      });

      return false;
    }

    adminUser = user;
    adminProfile = profile;

    return true;

  } catch (error) {
    console.error("Admin access error:", error);
    toast("Gagal memeriksa akses administrator.", "error");
    return false;
  }
}

/* =========================================
   ADMIN PROFILE
========================================= */

function renderAdminProfile() {
  const name =
    adminProfile?.name ||
    adminUser?.displayName ||
    "Administrator";

  const role = adminProfile?.adminRole || "Administrator";

  if ($("#adminName")) {
    $("#adminName").textContent = name;
  }

  if ($("#adminRole")) {
    $("#adminRole").textContent = role;
  }

  if ($("#overviewAdminName")) {
    $("#overviewAdminName").textContent = name;
  }
}

/* =========================================
   LOG ACTIVITY
========================================= */

async function writeAdminLog(action, targetUid, details = {}) {
  if (!adminUser) return;

  try {
    await addDoc(collection(db, ADMIN_COLLECTIONS.logs), {
      adminId: adminUser.uid,
      adminName: adminProfile?.name || adminUser.email || "Admin",
      action,
      targetUid: targetUid || null,
      details,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Admin log error:", error);
    toast("Aksi dilakukan, tetapi log gagal disimpan.", "warning");
  }
}

/* =========================================
   LOAD USERS
========================================= */

async function loadUsers() {
  const table = $("#adminUsersTable");

  if (table) {
    table.innerHTML = `
      <tr>
        <td colspan="6" class="admin-loading">Memuat pengguna...</td>
      </tr>
    `;
  }

  try {
    const snapshot = await getDocs(
      query(
        collection(db, ADMIN_COLLECTIONS.users),
        limit(500)
      )
    );

    usersCache = snapshot.docs.map(item => ({
      uid: item.id,
      ...item.data()
    }));

    renderUsers();
    renderOverviewStats();

  } catch (error) {
    console.error("Load users:", error);
    toast("Gagal memuat pengguna.", "error");

    if (table) {
      table.innerHTML = `
        <tr><td colspan="6" class="admin-empty">
          Tidak dapat memuat data pengguna.
        </td></tr>
      `;
    }
  }
}

/* =========================================
   USER STATUS
========================================= */

function isSuspended(user) {
  if (!user.suspended) return false;

  if (user.suspensionType === "permanent") return true;

  if (!user.suspensionUntil) return true;

  const expiry = user.suspensionUntil.toDate
    ? user.suspensionUntil.toDate()
    : new Date(user.suspensionUntil);

  return expiry.getTime() > Date.now();
}

function getUserStatus(user) {
  if (isSuspended(user)) {
    return `<span class="admin-badge danger">Suspended</span>`;
  }

  if (user.verified) {
    return `<span class="admin-badge success">Verified</span>`;
  }

  return `<span class="admin-badge neutral">Normal</span>`;
}

/* =========================================
   RENDER USERS
========================================= */

function renderUsers() {
  const table = $("#adminUsersTable");
  if (!table) return;

  const keyword = ($("#adminUserSearch")?.value || "")
    .trim()
    .toLowerCase();

  const filter = $("#adminUserFilter")?.value || "all";

  const filtered = usersCache.filter(user => {
    const name = (user.name || "").toLowerCase();
    const username = (user.username || "").toLowerCase();
    const email = (user.email || "").toLowerCase();

    const matchesSearch =
      name.includes(keyword) ||
      username.includes(keyword) ||
      email.includes(keyword) ||
      user.uid.toLowerCase().includes(keyword);

    let matchesFilter = true;

    if (filter === "verified") {
      matchesFilter = !!user.verified;
    }

    if (filter === "normal") {
      matchesFilter = !user.verified && !isSuspended(user);
    }

    if (filter === "suspended") {
      matchesFilter = isSuspended(user);
    }

    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    table.innerHTML = `
      <tr>
        <td colspan="6" class="admin-empty">
          Tidak ada pengguna ditemukan.
        </td>
      </tr>
    `;
    return;
  }

  table.innerHTML = filtered.map(user => {
    const name = escapeHTML(user.name || "Pengguna");
    const username = escapeHTML(user.username || "tanpa_username");
    const email = escapeHTML(user.email || user.uid);

    return `
      <tr>
        <td>
          <div class="admin-user-cell">
            <div class="admin-avatar">${getInitial(name)}</div>
            <div>
              <strong>${name}</strong>
              <small>@${username}</small>
            </div>
          </div>
        </td>
        <td>${email}</td>
        <td>${getUserStatus(user)}</td>
        <td>${formatDate(user.createdAt)}</td>
        <td>
          <button class="admin-action-button"
            data-user-action="detail"
            data-uid="${escapeHTML(user.uid)}">
            Detail
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================
   OVERVIEW STATS
========================================= */

function renderOverviewStats() {
  const total = usersCache.length;
  const verified = usersCache.filter(user => user.verified).length;
  const suspended = usersCache.filter(user => isSuspended(user)).length;

  if ($("#totalUsers")) {
    $("#totalUsers").textContent = total.toLocaleString("id-ID");
  }

  if ($("#verifiedUsers")) {
    $("#verifiedUsers").textContent = verified.toLocaleString("id-ID");
  }

  if ($("#suspendedUsers")) {
    $("#suspendedUsers").textContent = suspended.toLocaleString("id-ID");
  }

  if ($("#pendingAppeals")) {
    $("#pendingAppeals").textContent =
      appealsCache.filter(item => item.status === "pending").length;
  }

  renderRecentUsers();
}

function renderRecentUsers() {
  const table = $("#recentUsersTable");
  if (!table) return;

  const recent = [...usersCache]
    .sort((a, b) => {
      const dateA = a.createdAt?.toMillis?.() || 0;
      const dateB = b.createdAt?.toMillis?.() || 0;
      return dateB - dateA;
    })
    .slice(0, 5);

  if (!recent.length) {
    table.innerHTML = `
      <tr><td colspan="4" class="admin-empty">
        Belum ada pengguna.
      </td></tr>
    `;
    return;
  }

  table.innerHTML = recent.map(user => `
    <tr>
      <td>${escapeHTML(user.name || "Pengguna")}</td>
      <td>@${escapeHTML(user.username || "-")}</td>
      <td>${getUserStatus(user)}</td>
      <td>${formatDate(user.createdAt)}</td>
    </tr>
  `).join("");
}

/* =========================================
   USER DETAIL MODAL
========================================= */

function openAdminModal(title, content) {
  const modal = $("#adminModal");
  const body = $("#adminModalBody");
  const contentElement = $("#adminModalContent");

  if (!modal) return;

  if (contentElement) {
    contentElement.innerHTML = `
      <div class="modal-heading">
        <h3>${escapeHTML(title)}</h3>
      </div>
      ${content}
    `;
  } else if (body) {
    body.innerHTML = content;
  }

  modal.classList.remove("hidden");
  modal.classList.add("active");
}

function closeAdminModal() {
  const modal = $("#adminModal");
  if (!modal) return;

  modal.classList.add("hidden");
  modal.classList.remove("active");
}

function showUserDetail(uid) {
  const user = usersCache.find(item => item.uid === uid);
  if (!user) return;

  const suspended = isSuspended(user);

  openAdminModal("Detail Pengguna", `
    <div class="admin-user-detail">
      <div class="admin-avatar">${getInitial(user.name || "U")}</div>
      <h3>${escapeHTML(user.name || "Pengguna")}</h3>
      <p>@${escapeHTML(user.username || "-")}</p>

      <div class="system-status-list">
        <div><span>Email</span><strong>${escapeHTML(user.email || "-")}</strong></div>
        <div><span>User ID</span><strong>${escapeHTML(uid)}</strong></div>
        <div><span>Status</span><strong>${suspended ? "Suspended" : "Aktif"}</strong></div>
        <div><span>Verified</span><strong>${user.verified ? "Ya" : "Tidak"}</strong></div>
        <div><span>Bergabung</span><strong>${formatDate(user.createdAt)}</strong></div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:20px">
        <button class="admin-action-button"
          data-user-action="verify"
          data-uid="${escapeHTML(uid)}">
          ${user.verified ? "Cabut Verified" : "Berikan Verified"}
        </button>

        <button class="admin-action-button danger"
          data-user-action="suspend"
          data-uid="${escapeHTML(uid)}">
          ${suspended ? "Cabut Suspend" : "Suspend"}
        </button>
      </div>
    </div>
  `);
}

/* =========================================
   VERIFIED MANAGEMENT
========================================= */

async function toggleVerification(uid) {
  if (uid === adminUser.uid) {
    toast("Tidak dapat mengubah status akun sendiri.", "warning");
    return;
  }

  const user = usersCache.find(item => item.uid === uid);
  if (!user) return;

  const nextValue = !user.verified;

  if (!confirm(
    nextValue
      ? "Berikan centang biru kepada pengguna ini?"
      : "Cabut centang biru pengguna ini?"
  )) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      verified: nextValue,
      verifiedAt: nextValue ? serverTimestamp() : null,
      verifiedBy: nextValue ? adminUser.uid : null
    });

    await writeAdminLog(
      nextValue ? "verified_granted" : "verified_revoked",
      uid,
      { verified: nextValue }
    );

    user.verified = nextValue;

    toast(
      nextValue
        ? "Centang biru berhasil diberikan."
        : "Centang biru berhasil dicabut."
    );

    closeAdminModal();
    renderUsers();
    renderOverviewStats();

  } catch (error) {
    console.error(error);
    toast("Gagal mengubah status verified. Periksa Firestore Rules.", "error");
  }
}

/* =========================================
   SUSPENSION MODAL
========================================= */

function showSuspendForm(uid) {
  const user = usersCache.find(item => item.uid === uid);
  if (!user) return;

  if (uid === adminUser.uid) {
    toast("Tidak dapat menangguhkan akun sendiri.", "warning");
    return;
  }

  if (isSuspended(user)) {
    removeSuspension(uid);
    return;
  }

  openAdminModal("Tangguhkan Akun", `
    <form id="adminSuspendForm">
      <p style="color:#aaa;font-size:12px">
        Akun: <strong>${escapeHTML(user.name || user.username || uid)}</strong>
      </p>

      <label for="suspensionType">Jenis penangguhan</label>
      <select id="suspensionType" required>
        <option value="temporary">Sementara</option>
        <option value="permanent">Permanen</option>
      </select>

      <div id="suspensionDurationBox">
        <label for="suspensionDuration">Durasi</label>
        <select id="suspensionDuration">
          <option value="1">1 hari</option>
          <option value="3">3 hari</option>
          <option value="7" selected>7 hari</option>
          <option value="30">30 hari</option>
        </select>
      </div>

      <label for="suspensionReason">Alasan</label>
      <textarea id="suspensionReason"
        maxlength="500"
        required
        placeholder="Tuliskan alasan penangguhan..."></textarea>

      <button class="admin-action-button danger"
        type="submit"
        style="width:100%;margin-top:15px;padding:12px">
        Konfirmasi Penangguhan
      </button>
    </form>
  `);

  $("#suspensionType")?.addEventListener("change", event => {
    const box = $("#suspensionDurationBox");
    if (box) {
      box.style.display =
        event.target.value === "permanent" ? "none" : "block";
    }
  });

  $("#adminSuspendForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const type = $("#suspensionType").value;
    const reason = $("#suspensionReason").value.trim();
    const days = Number($("#suspensionDuration").value);

    if (!reason) {
      toast("Alasan wajib diisi.", "warning");
      return;
    }

    const expiry = type === "temporary"
      ? Timestamp.fromDate(
          new Date(Date.now() + days * 24 * 60 * 60 * 1000)
        )
      : null;

    try {
      await updateDoc(doc(db, "users", uid), {
        suspended: true,
        suspensionType: type,
        suspensionReason: reason,
        suspensionUntil: expiry,
        suspendedAt: serverTimestamp(),
        suspendedBy: adminUser.uid
      });

      await writeAdminLog("user_suspended", uid, {
        type,
        reason,
        days: type === "temporary" ? days : null
      });

      user.suspended = true;
      user.suspensionType = type;
      user.suspensionUntil = expiry;
      user.suspensionReason = reason;

      closeAdminModal();
      renderUsers();
      renderOverviewStats();

      toast("Penangguhan berhasil disimpan.");

    } catch (error) {
      console.error(error);
      toast("Gagal menangguhkan akun. Periksa Firestore Rules.", "error");
    }
  });
}

/* =========================================
   REMOVE SUSPENSION
========================================= */

async function removeSuspension(uid) {
  const user = usersCache.find(item => item.uid === uid);
  if (!user) return;

  if (!confirm("Cabut penangguhan akun ini?")) return;

  try {
    await updateDoc(doc(db, "users", uid), {
      suspended: false,
      suspensionType: null,
      suspensionReason: null,
      suspensionUntil: null,
      suspensionRemovedAt: serverTimestamp(),
      suspensionRemovedBy: adminUser.uid
    });

    await writeAdminLog("suspension_removed", uid);

    user.suspended = false;
    user.suspensionType = null;
    user.suspensionUntil = null;

    closeAdminModal();
    renderUsers();
    renderOverviewStats();

    toast("Penangguhan berhasil dicabut.");

  } catch (error) {
    console.error(error);
    toast("Gagal mencabut penangguhan.", "error");
  }
}

/* =========================================
   LOAD APPEALS
========================================= */

async function loadAppeals() {
  const table = $("#appealsTable");

  if (table) {
    table.innerHTML = `
      <tr><td colspan="5" class="admin-loading">
        Memuat banding...
      </td></tr>
    `;
  }

  try {
    const snapshot = await getDocs(
      query(
        collection(db, ADMIN_COLLECTIONS.appeals),
        orderBy("createdAt", "desc"),
        limit(200)
      )
    );

    appealsCache = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    renderAppeals();
    renderOverviewStats();

  } catch (error) {
    console.error("Appeals error:", error);

    if (table) {
      table.innerHTML = `
        <tr><td colspan="5" class="admin-empty">
          Gagal memuat banding. Pastikan koleksi appeals dan Rules tersedia.
        </td></tr>
      `;
    }
  }
}

function renderAppeals() {
  const table = $("#appealsTable");
  if (!table) return;

  const pending = appealsCache.filter(
    appeal => appeal.status === "pending"
  );

  const count = $("#appealNavCount");
  if (count) {
    count.textContent = pending.length;
    count.style.display = pending.length ? "grid" : "none";
  }

  if (!appealsCache.length) {
    table.innerHTML = `
      <tr><td colspan="5" class="admin-empty">
        Belum ada pengajuan banding.
      </td></tr>
    `;
    return;
  }

  table.innerHTML = appealsCache.map(appeal => {
    const statusClass =
      appeal.status === "approved" ? "success" :
      appeal.status === "rejected" ? "danger" :
      "warning";

    return `
      <tr>
        <td>${escapeHTML(appeal.username || appeal.userName || appeal.userId || "-")}</td>
        <td>${escapeHTML(appeal.reason || appeal.message || "-")}</td>
        <td>${formatDate(appeal.createdAt)}</td>
        <td>
          <span class="admin-badge ${statusClass}">
            ${escapeHTML(appeal.status || "pending")}
          </span>
        </td>
        <td>
          <button class="admin-action-button"
            data-appeal-action="detail"
            data-id="${escapeHTML(appeal.id)}">
            Periksa
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================
   APPEAL DETAIL
========================================= */

function showAppealDetail(id) {
  const appeal = appealsCache.find(item => item.id === id);
  if (!appeal) return;

  const canReview = appeal.status === "pending";

  openAdminModal("Detail Banding", `
    <div class="system-status-list">
      <div><span>Pengguna</span><strong>${escapeHTML(appeal.username || appeal.userName || appeal.userId || "-")}</strong></div>
      <div><span>Status</span><strong>${escapeHTML(appeal.status || "pending")}</strong></div>
      <div><span>Diajukan</span><strong>${formatDate(appeal.createdAt)}</strong></div>
      <div><span>ID Banding</span><strong>${escapeHTML(id)}</strong></div>
    </div>

    <div style="margin-top:18px">
      <label>Isi pengajuan</label>
      <div style="
        padding:14px;
        border-radius:10px;
        background:#100d18;
        color:#ddd;
        font-size:12px;
        line-height:1.7;
        white-space:pre-wrap
      ">${escapeHTML(appeal.message || appeal.reason || "Tidak ada pesan.")}</div>
    </div>

    ${canReview ? `
      <label for="appealDecisionNote">Catatan keputusan</label>
      <textarea id="appealDecisionNote"
        maxlength="500"
        placeholder="Catatan untuk pengguna..."></textarea>

      <div style="display:flex;gap:9px;margin-top:15px">
        <button class="admin-action-button"
          data-appeal-action="approve"
          data-id="${escapeHTML(id)}">
          Terima Banding
        </button>

        <button class="admin-action-button danger"
          data-appeal-action="reject"
          data-id="${escapeHTML(id)}">
          Tolak Banding
        </button>
      </div>
    ` : `
      <p style="color:#aaa;font-size:11px;margin-top:18px">
        Banding ini sudah diproses.
      </p>
    `}
  `);
}

/* =========================================
   REVIEW APPEAL
========================================= */

async function reviewAppeal(id, decision) {
  const appeal = appealsCache.find(item => item.id === id);
  if (!appeal || appeal.status !== "pending") return;

  const note = $("#appealDecisionNote")?.value.trim() || "";

  if (!confirm(
    decision === "approved"
      ? "Terima pengajuan banding ini?"
      : "Tolak pengajuan banding ini?"
  )) return;

  try {
    await updateDoc(doc(db, ADMIN_COLLECTIONS.appeals, id), {
      status: decision,
      adminNote: note,
      reviewedBy: adminUser.uid,
      reviewedAt: serverTimestamp()
    });

    // Banding yang diterima menghapus status suspend.
    if (decision === "approved" && appeal.userId) {
      await updateDoc(doc(db, "users", appeal.userId), {
        suspended: false,
        suspensionType: null,
        suspensionReason: null,
        suspensionUntil: null,
        suspensionRemovedAt: serverTimestamp(),
        suspensionRemovedBy: adminUser.uid
      });

      const user = usersCache.find(item => item.uid === appeal.userId);
      if (user) {
        user.suspended = false;
        user.suspensionType = null;
        user.suspensionUntil = null;
      }
    }

    await writeAdminLog("appeal_" + decision, appeal.userId, {
      appealId: id,
      note
    });

    appeal.status = decision;

    closeAdminModal();
    renderAppeals();
    renderUsers();
    renderOverviewStats();

    toast(
      decision === "approved"
        ? "Banding diterima."
        : "Banding ditolak."
    );

  } catch (error) {
    console.error(error);
    toast("Gagal memproses banding.", "error");
  }
}

/* =========================================
   SUSPENSION TABLE
========================================= */

function renderSuspensions() {
  const table = $("#suspensionsTable");
  if (!table) return;

  const suspendedUsers = usersCache.filter(isSuspended);

  if (!suspendedUsers.length) {
    table.innerHTML = `
      <tr><td colspan="5" class="admin-empty">
        Tidak ada akun yang sedang ditangguhkan.
      </td></tr>
    `;
    return;
  }

  table.innerHTML = suspendedUsers.map(user => `
    <tr>
      <td>${escapeHTML(user.name || user.username || "Pengguna")}</td>
      <td>${escapeHTML(user.suspensionType || "-")}</td>
      <td>${escapeHTML(user.suspensionReason || "-")}</td>
      <td>${user.suspensionType === "permanent"
        ? "Permanen"
        : formatDate(user.suspensionUntil)}</td>
      <td>
        <button class="admin-action-button danger"
          data-user-action="unsuspend"
          data-uid="${escapeHTML(user.uid)}">
          Cabut
        </button>
      </td>
    </tr>
  `).join("");
}

/* =========================================
   LOAD ADMIN LOGS
========================================= */

async function loadLogs() {
  const container = $("#adminLogsList");
  if (container) {
    container.innerHTML = `<div class="admin-loading">Memuat aktivitas...</div>`;
  }

  try {
    const snapshot = await getDocs(
      query(
        collection(db, ADMIN_COLLECTIONS.logs),
        orderBy("createdAt", "desc"),
        limit(100)
      )
    );

    logsCache = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    renderLogs();

  } catch (error) {
    console.error("Logs error:", error);

    if (container) {
      container.innerHTML = `
        <div class="admin-empty">
          Gagal memuat log aktivitas.
        </div>
      `;
    }
  }
}

function renderLogs() {
  const container = $("#adminLogsList");
  if (!container) return;

  if (!logsCache.length) {
    container.innerHTML = `
      <div class="admin-empty">Belum ada aktivitas.</div>
    `;
    return;
  }

  container.innerHTML = logsCache.map(log => `
    <div class="admin-log-item">
      <div class="admin-log-dot"></div>
      <div>
        <strong>${escapeHTML(log.action || "Aktivitas")}</strong>
        <p>
          ${escapeHTML(log.adminName || "Administrator")}
          ${log.targetUid ? ` · Target: ${escapeHTML(log.targetUid)}` : ""}
        </p>
        <small>${formatDate(log.createdAt)}</small>
      </div>
    </div>
  `).join("");
}

/* =========================================
   ADMIN PAGE NAVIGATION
========================================= */

const ADMIN_PAGES = {
  overview: {
    id: "adminOverviewPage",
    title: "Overview"
  },
  users: {
    id: "adminUsersPage",
    title: "Pengguna"
  },
  verification: {
    id: "adminVerificationPage",
    title: "Verifikasi"
  },
  suspensions: {
    id: "adminSuspensionsPage",
    title: "Penangguhan"
  },
  appeals: {
    id: "adminAppealsPage",
    title: "Banding"
  },
  logs: {
    id: "adminLogsPage",
    title: "Aktivitas"
  }
};

function showAdminPage(page) {
  if (!ADMIN_PAGES[page]) return;

  activeAdminPage = page;

  Object.entries(ADMIN_PAGES).forEach(([key, item]) => {
    const element = document.getElementById(item.id);
    if (element) {
      element.classList.toggle("hidden", key !== page);
    }
  });

  document.querySelectorAll(".admin-nav-item").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.adminPage === page
    );
  });

  if ($("#adminPageTitle")) {
    $("#adminPageTitle").textContent = ADMIN_PAGES[page].title;
  }

  if ($("#adminBreadcrumb")) {
    $("#adminBreadcrumb").textContent =
      `Dashboard / ${ADMIN_PAGES[page].title}`;
  }

  if (page === "users" || page === "verification") {
    renderUsers();
  }

  if (page === "suspensions") {
    renderSuspensions();
  }

  if (page === "appeals") {
    loadAppeals();
  }

  if (page === "logs") {
    loadLogs();
  }
}

/* =========================================
   EVENT HANDLERS
========================================= */

function bindNavigation() {
  document.querySelectorAll(".admin-nav-item").forEach(button => {
    button.addEventListener("click", () => {
      showAdminPage(button.dataset.adminPage);
    });
  });
}

function bindUserActions() {
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-user-action]");
    if (!button) return;

    const action = button.dataset.userAction;
    const uid = button.dataset.uid;

    if (action === "detail") {
      showUserDetail(uid);
    }

    if (action === "verify") {
      toggleVerification(uid);
    }

    if (action === "suspend") {
      showSuspendForm(uid);
    }

    if (action === "unsuspend") {
      removeSuspension(uid);
    }
  });
}

function bindAppealActions() {
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-appeal-action]");
    if (!button) return;

    const action = button.dataset.appealAction;
    const id = button.dataset.id;

    if (action === "detail") {
      showAppealDetail(id);
    }

    if (action === "approve") {
      reviewAppeal(id, "approved");
    }

    if (action === "reject") {
      reviewAppeal(id, "rejected");
    }
  });
}

function bindSearch() {
  $("#adminUserSearch")?.addEventListener("input", renderUsers);
  $("#adminUserFilter")?.addEventListener("change", renderUsers);

  $("#verificationSearch")?.addEventListener("input", () => {
    const search = $("#verificationSearch").value;
    if ($("#adminUserSearch")) {
      $("#adminUserSearch").value = search;
    }
    renderUsers();
  });
}

function bindModal() {
  $("#adminModalClose")?.addEventListener("click", closeAdminModal);

  $("#adminModal")?.addEventListener("click", event => {
    if (event.target.id === "adminModal") {
      closeAdminModal();
    }
  });
}

function bindRefresh() {
  $("#adminRefreshBtn")?.addEventListener("click", async () => {
    await loadUsers();
    await loadAppeals();

    if (activeAdminPage === "logs") {
      await loadLogs();
    }

    toast("Dashboard diperbarui.");
  });
}

function bindLogout() {
  $("#adminLogoutBtn")?.addEventListener("click", async () => {
    if (!confirm("Keluar dari panel administrator?")) return;

    try {
      await signOut(auth);
      location.replace("./index.html");
    } catch (error) {
      console.error(error);
      toast("Gagal logout.", "error");
    }
  });
}

/* =========================================
   INITIALIZATION
========================================= */

async function initializeAdmin() {
  bindNavigation();
  bindUserActions();
  bindAppealActions();
  bindSearch();
  bindModal();
  bindRefresh();
  bindLogout();

  const allowed = await checkAdminAccess(adminUser);

  if (!allowed) return;

  renderAdminProfile();

  await Promise.all([
    loadUsers(),
    loadAppeals()
  ]);

  showAdminPage("overview");
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("./index.html");
    return;
  }

  adminUser = user;
  await initializeAdmin();
});
