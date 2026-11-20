
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  collection, getDocs, doc, getDoc, updateDoc,
  query, orderBy, limit, where, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

let adminUser = null;
let usersCache = [];
let appealsCache = [];

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[c]);
}

function notify(message) {
  const container = $("toastContainer");
  if (!container) {
    alert(message);
    return;
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function showAdminPage(page) {
  document.querySelectorAll("[data-admin-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.adminPage === page);
  });

  document.querySelectorAll(".admin-page").forEach(section => {
    section.classList.toggle("active", section.id === `admin${capitalize(page)}Page`);
  });

  const title = $("adminPageTitle");
  if (title) title.textContent = page.charAt(0).toUpperCase() + page.slice(1);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function verifyAdmin(user) {
  const token = await user.getIdTokenResult(true);
  return token.claims.admin === true;
}

async function writeLog(action, targetUid, details = {}) {
  await addDoc(collection(db, "adminLogs"), {
    adminId: adminUser.uid,
    action,
    targetUid: targetUid || "",
    details,
    createdAt: serverTimestamp()
  });
}

async function loadUsers() {
  const snapshot = await getDocs(
    query(collection(db, "users"), limit(300))
  );

  usersCache = snapshot.docs.map(item => ({
    uid: item.id,
    ...item.data()
  }));

  renderUsers();
  renderOverview();
}

function renderOverview() {
  const total = usersCache.length;
  const verified = usersCache.filter(user => user.verified).length;
  const suspended = usersCache.filter(user => user.suspended).length;
  const pending = appealsCache.filter(item => item.status === "pending").length;

  if ($("totalUsers")) $("totalUsers").textContent = total;
  if ($("verifiedUsers")) $("verifiedUsers").textContent = verified;
  if ($("suspendedUsers")) $("suspendedUsers").textContent = suspended;
  if ($("pendingAppeals")) $("pendingAppeals").textContent = pending;

  if ($("overviewAdminName")) {
    $("overviewAdminName").textContent = adminUser?.email || "Administrator";
  }
}

function renderUsers() {
  const target = $("adminUsersTable");
  if (!target) return;

  const search = ($("adminUserSearch")?.value || "").toLowerCase();
  const filter = $("adminUserFilter")?.value || "all";

  const filtered = usersCache.filter(user => {
    const matchesSearch =
      (user.name || "").toLowerCase().includes(search) ||
      (user.username || "").toLowerCase().includes(search) ||
      (user.email || "").toLowerCase().includes(search) ||
      user.uid.toLowerCase().includes(search);

    const matchesFilter =
      filter === "all" ||
      (filter === "verified" && user.verified) ||
      (filter === "suspended" && user.suspended) ||
      (filter === "normal" && !user.suspended && !user.verified);

    return matchesSearch && matchesFilter;
  });

  target.innerHTML = filtered.map(user => `
    <tr>
      <td>
        <strong>${escapeHTML(user.name || "Tanpa nama")}</strong>
        <small>@${escapeHTML(user.username || "-")}</small>
      </td>
      <td>${escapeHTML(user.email || "-")}</td>
      <td>${user.verified ? "Verified" : "Belum"}</td>
      <td>${user.suspended ? "Suspended" : "Aktif"}</td>
      <td>
        <button class="admin-action" data-user-action="verified"
          data-uid="${escapeHTML(user.uid)}">
          ${user.verified ? "Cabut centang" : "Verifikasi"}
        </button>
        <button class="admin-action" data-user-action="suspend"
          data-uid="${escapeHTML(user.uid)}">
          ${user.suspended ? "Pulihkan" : "Suspend"}
        </button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5">Pengguna tidak ditemukan</td></tr>`;
}

async function callAdminEndpoint(endpoint, targetUid) {
  const token = await adminUser.getIdToken(true);

  const response = await fetch(`/api/admin/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ uid: targetUid })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Permintaan admin gagal");
  }

  return result;
}

async function toggleVerified(uid, currentlyVerified) {
  try {
    if (currentlyVerified) {
      await callAdminEndpoint("revoke", uid);
    } else {
      await callAdminEndpoint("grant", uid);
    }

    await updateDoc(doc(db, "users", uid), {
      verified: !currentlyVerified,
      verifiedAt: currentlyVerified ? null : serverTimestamp(),
      verifiedBy: currentlyVerified ? null : adminUser.uid
    });

    await writeLog(
      currentlyVerified ? "verified_removed" : "verified_granted",
      uid
    );

    notify("Status verifikasi diperbarui");
    await loadUsers();
  } catch (error) {
    console.error(error);
    notify(error.message);
  }
}

async function toggleSuspension(uid, currentlySuspended) {
  if (currentlySuspended) {
    if (!confirm("Pulihkan akun ini?")) return;

    try {
      await updateDoc(doc(db, "users", uid), {
        suspended: false,
        suspensionType: null,
        suspensionReason: null,
        suspensionUntil: null,
        suspensionRemovedAt: serverTimestamp(),
        suspensionRemovedBy: adminUser.uid
      });

      await writeLog("account_restored", uid);
      notify("Akun berhasil dipulihkan");
      await loadUsers();
    } catch (error) {
      console.error(error);
      notify("Gagal memulihkan akun");
    }

    return;
  }

  const reason = prompt("Alasan penangguhan akun:");
  if (!reason?.trim()) return;

  const duration = prompt(
    "Masukkan durasi dalam hari. Isi 0 untuk penangguhan permanen:"
  );

  if (duration === null || !/^\d+$/.test(duration)) {
    notify("Durasi tidak valid");
    return;
  }

  const days = Number(duration);
  const until = days > 0
    ? new Date(Date.now() + days * 86400000)
    : null;

  try {
    await updateDoc(doc(db, "users", uid), {
      suspended: true,
      suspensionType: days > 0 ? "temporary" : "permanent",
      suspensionReason: reason.trim().slice(0, 500),
      suspensionUntil: until,
      suspendedAt: serverTimestamp(),
      suspendedBy: adminUser.uid
    });

    await writeLog("account_suspended", uid, {
      type: days > 0 ? "temporary" : "permanent",
      days,
      reason: reason.trim()
    });

    notify("Akun berhasil ditangguhkan");
    await loadUsers();
  } catch (error) {
    console.error(error);
    notify("Gagal menangguhkan akun");
  }
}

async function loadAppeals() {
  const snapshot = await getDocs(
    query(collection(db, "appeals"), orderBy("createdAt", "desc"), limit(200))
  );

  appealsCache = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  renderAppeals();
  renderOverview();
}

function renderAppeals() {
  const target = $("appealsTable");
  if (!target) return;

  target.innerHTML = appealsCache.map(appeal => `
    <tr>
      <td>${escapeHTML(appeal.userId || "-")}</td>
      <td>${escapeHTML(appeal.reason || "-")}</td>
      <td>${escapeHTML(appeal.status || "pending")}</td>
      <td>
        ${appeal.status === "pending" ? `
          <button class="admin-action" data-appeal-action="approve"
            data-id="${escapeHTML(appeal.id)}">Setujui</button>
          <button class="admin-action" data-appeal-action="reject"
            data-id="${escapeHTML(appeal.id)}">Tolak</button>
        ` : "-"}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4">Belum ada banding</td></tr>`;

  if ($("appealNavCount")) {
    $("appealNavCount").textContent =
      appealsCache.filter(item => item.status === "pending").length;
  }
}

async function reviewAppeal(id, decision) {
  const note = prompt("Catatan admin (opsional):") || "";

  try {
    const appealRef = doc(db, "appeals", id);
    const appealSnap = await getDoc(appealRef);

    if (!appealSnap.exists()) throw new Error("Banding tidak ditemukan");

    const appeal = appealSnap.data();
    if (appeal.status !== "pending") {
      throw new Error("Banding sudah diproses");
    }

    await updateDoc(appealRef, {
      status: decision,
      adminNote: note.slice(0, 500),
      reviewedBy: adminUser.uid,
      reviewedAt: serverTimestamp()
    });

    if (decision === "approved") {
      await updateDoc(doc(db, "users", appeal.userId), {
        suspended: false,
        suspensionType: null,
        suspensionReason: null,
        suspensionUntil: null,
        suspensionRemovedAt: serverTimestamp(),
        suspensionRemovedBy: adminUser.uid
      });
    }

    await writeLog(`appeal_${decision}`, appeal.userId, { appealId: id });
    notify("Banding berhasil diproses");
    await loadAppeals();
    await loadUsers();

  } catch (error) {
    console.error(error);
    notify(error.message || "Gagal memproses banding");
  }
}

async function loadLogs() {
  const target = $("adminLogsList");
  if (!target) return;

  try {
    const snapshot = await getDocs(
      query(collection(db, "adminLogs"), orderBy("createdAt", "desc"), limit(100))
    );

    target.innerHTML = snapshot.docs.map(item => {
      const log = item.data();

      return `
        <article class="admin-log-item">
          <strong>${escapeHTML(log.action || "Aktivitas")}</strong>
          <span>Target: ${escapeHTML(log.targetUid || "-")}</span>
          <small>Admin: ${escapeHTML(log.adminId || "-")}</small>
        </article>`;
    }).join("") || "Belum ada aktivitas.";
  } catch (error) {
    console.error(error);
    target.textContent = "Gagal memuat log.";
  }
}

function bindEvents() {
  document.querySelectorAll("[data-admin-page]").forEach(button => {
    button.addEventListener("click", () => {
      showAdminPage(button.dataset.adminPage);
    });
  });

  $("adminUserSearch")?.addEventListener("input", renderUsers);
  $("adminUserFilter")?.addEventListener("change", renderUsers);

  $("adminUsersTable")?.addEventListener("click", event => {
    const button = event.target.closest("[data-user-action]");
    if (!button) return;

    const user = usersCache.find(item => item.uid === button.dataset.uid);
    if (!user) return;

    if (button.dataset.userAction === "verified") {
      toggleVerified(user.uid, !!user.verified);
    }

    if (button.dataset.userAction === "suspend") {
      toggleSuspension(user.uid, !!user.suspended);
    }
  });

  $("appealsTable")?.addEventListener("click", event => {
    const button = event.target.closest("[data-appeal-action]");
    if (!button) return;

    reviewAppeal(button.dataset.id, button.dataset.appealAction === "approve"
      ? "approved"
      : "rejected");
  });

  $("adminRefreshBtn")?.addEventListener("click", refreshAdmin);
  $("adminLogoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "./index.html";
  });
}

async function refreshAdmin() {
  try {
    await Promise.all([loadUsers(), loadAppeals(), loadLogs()]);
    notify("Data diperbarui");
  } catch (error) {
    console.error(error);
    notify("Gagal memperbarui data");
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "./index.html";
    return;
  }

  adminUser = user;

  try {
    const allowed = await verifyAdmin(user);

    if (!allowed) {
      document.body.innerHTML = `
        <main class="admin-denied">
          <h1>Akses ditolak</h1>
          <p>Akun ini tidak memiliki izin administrator.</p>
          <button id="backToLogin">Kembali ke login</button>
        </main>
      `;

      $("backToLogin").onclick = async () => {
        await signOut(auth);
        location.href = "./index.html";
      };

      return;
    }

    bindEvents();
    await refreshAdmin();
    showAdminPage("overview");

  } catch (error) {
    console.error(error);
    notify("Gagal memverifikasi akses administrator");
  }
});
