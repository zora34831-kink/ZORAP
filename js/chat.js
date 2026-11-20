
import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
  arrayUnion,
  increment
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  getCurrentUser,
  showToast
} from "./app.js";

// =====================================
// STATE
// =====================================

let currentConversationId = null;
let currentConversation = null;

let conversationUnsubscribe = null;
let messageUnsubscribe = null;

let conversationsCache = [];
let messagesCache = [];

let sending = false;

// =====================================
// DOM
// =====================================

const $ = id => document.getElementById(id);

const chatList = $("chatList");
const messageList = $("messageList");
const messageArea = $("messageArea");
const messageForm = $("messageForm");
const messageInput = $("messageInput");

// =====================================
// HELPERS
// =====================================

function currentUid() {
  return getCurrentUser()?.uid || auth.currentUser?.uid;
}

function formatTime(timestamp) {
  if (!timestamp?.toDate) return "";

  return timestamp.toDate().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "";

  return timestamp.toDate().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
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

function scrollToBottom() {
  if (!messageArea) return;

  requestAnimationFrame(() => {
    messageArea.scrollTop = messageArea.scrollHeight;
  });
}

// =====================================
// LOAD CONVERSATIONS
// =====================================

export function loadConversations() {
  const uid = currentUid();

  if (!uid || !chatList) return;

  const conversationsQuery = query(
    collection(db, "conversations"),
    where("participants", "array-contains", uid)
  );

  if (conversationUnsubscribe) {
    conversationUnsubscribe();
  }

  conversationUnsubscribe = onSnapshot(
    conversationsQuery,
    snapshot => {
      conversationsCache = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      conversationsCache.sort((a, b) => {
        const first = a.lastMessageAt?.toMillis?.() || 0;
        const second = b.lastMessageAt?.toMillis?.() || 0;
        return second - first;
      });

      renderConversationList();
      updateTotalUnread();
    },
    error => {
      console.error("Conversation listener:", error);
      showToast("Gagal memuat daftar chat.", "error");
    }
  );
}

// =====================================
// CONVERSATION DISPLAY
// =====================================

function getConversationName(conversation) {
  const uid = currentUid();

  if (conversation.type === "group") {
    return conversation.groupName || "Unnamed group";
  }

  const otherUid = conversation.participants?.find(
    participant => participant !== uid
  );

  return (
    conversation.memberNames?.[otherUid] ||
    conversation.names?.[otherUid] ||
    conversation.otherName ||
    "ZORAP User"
  );
}

function getConversationPhoto(conversation) {
  const uid = currentUid();

  if (conversation.type === "group") {
    return conversation.groupPhoto || "./assets/default-avatar.svg";
  }

  const otherUid = conversation.participants?.find(
    participant => participant !== uid
  );

  return (
    conversation.memberPhotos?.[otherUid] ||
    conversation.photos?.[otherUid] ||
    "./assets/default-avatar.svg"
  );
}

function renderConversationList() {
  if (!chatList) return;

  const search = $("chatSearch")?.value.toLowerCase() || "";

  const activeFilter =
    document.querySelector(".filter-chip.active")?.dataset.filter || "all";

  let filtered = conversationsCache.filter(conversation => {
    const name = getConversationName(conversation).toLowerCase();

    const matchesSearch = name.includes(search);

    const unread = Number(
      conversation.unreadCount?.[currentUid()] || 0
    );

    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "unread" && unread > 0) ||
      (activeFilter === "group" && conversation.type === "group") ||
      (activeFilter === "personal" && conversation.type !== "group");

    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    chatList.innerHTML = `
      <div class="empty-state">
        <h3>No conversations found</h3>
        <p>Start a new conversation with someone.</p>
      </div>
    `;
    return;
  }

  chatList.innerHTML = filtered.map(conversation => {
    const name = getConversationName(conversation);
    const photo = getConversationPhoto(conversation);

    const unread = Number(
      conversation.unreadCount?.[currentUid()] || 0
    );

    const active =
      currentConversationId === conversation.id ? "selected" : "";

    const preview = conversation.lastMessage || "Start a conversation";

    return `
      <button
        class="chat-row ${active}"
        data-conversation-id="${escapeHTML(conversation.id)}"
      >
        <div class="chat-row-avatar">
          <img
            src="${escapeHTML(photo)}"
            alt=""
            onerror="this.src='./assets/default-avatar.svg'"
          >
        </div>

        <div class="chat-row-content">
          <div class="chat-row-top">
            <strong>${escapeHTML(name)}</strong>
            <time>${formatTime(conversation.lastMessageAt)}</time>
          </div>

          <div class="chat-row-bottom">
            <span>${escapeHTML(preview)}</span>
            ${
              unread > 0
                ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>`
                : ""
            }
          </div>
        </div>
      </button>
    `;
  }).join("");

  chatList.querySelectorAll(".chat-row").forEach(button => {
    button.addEventListener("click", () => {
      openConversation(button.dataset.conversationId);
    });
  });
}

// =====================================
// TOTAL UNREAD
// =====================================

function updateTotalUnread() {
  const total = conversationsCache.reduce((sum, conversation) => {
    return sum + Number(
      conversation.unreadCount?.[currentUid()] || 0
    );
  }, 0);

  const element = $("totalUnread");

  if (element) {
    element.textContent = total > 99 ? "99+" : total;
    element.hidden = total === 0;
  }
}

// =====================================
// OPEN CONVERSATION
// =====================================

export async function openConversation(conversationId) {
  try {
    const conversationRef = doc(db, "conversations", conversationId);
    const conversationSnap = await getDoc(conversationRef);

    if (!conversationSnap.exists()) {
      showToast("Percakapan tidak ditemukan.", "error");
      return;
    }

    const conversation = conversationSnap.data();

    if (!conversation.participants?.includes(currentUid())) {
      showToast("Kamu bukan anggota percakapan ini.", "error");
      return;
    }

    currentConversationId = conversationId;
    currentConversation = conversation;

    $("conversationEmpty").hidden = true;
    $("conversationView").hidden = false;

    $("conversationPanel").classList.add("mobile-visible");
    document.body.classList.add("conversation-open");

    $("conversationName").textContent =
      getConversationName(conversation);

    $("conversationAvatar").src =
      getConversationPhoto(conversation);

    $("conversationPresence").textContent =
      conversation.type === "group"
        ? `${conversation.participants.length} members`
        : "Conversation";

    renderConversationList();

    listenMessages(conversationId);
    markConversationRead(conversationId);

  } catch (error) {
    console.error("Open conversation:", error);
    showToast("Gagal membuka percakapan.", "error");
  }
}

// =====================================
// LISTEN MESSAGES
// =====================================

function listenMessages(conversationId) {
  if (messageUnsubscribe) {
    messageUnsubscribe();
  }

  messageList.innerHTML = `
    <div class="loading-state">Loading messages...</div>
  `;

  const messagesQuery = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("createdAt", "asc")
  );

  messageUnsubscribe = onSnapshot(
    messagesQuery,
    snapshot => {
      messagesCache = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderMessages();
      markConversationRead(conversationId);
    },
    error => {
      console.error("Message listener:", error);

      showToast(
        "Gagal memuat riwayat pesan. Periksa Rules dan index Firestore.",
        "error"
      );
    }
  );
}

// =====================================
// RENDER MESSAGES
// =====================================

function renderMessages() {
  if (!messageList) return;

  const uid = currentUid();

  const visibleMessages = messagesCache.filter(message => {
    return !message.hiddenFor?.includes(uid);
  });

  if (!visibleMessages.length) {
    messageList.innerHTML = `
      <div class="empty-state message-empty">
        <h3>No messages yet</h3>
        <p>Send the first message to start the conversation.</p>
      </div>
    `;
    return;
  }

  let previousDate = "";

  messageList.innerHTML = visibleMessages.map(message => {
    const mine = message.senderId === uid;

    const date = formatDate(message.createdAt);

    let dateDivider = "";

    if (date && date !== previousDate) {
      previousDate = date;

      dateDivider = `
        <div class="message-date-divider">
          <span>${escapeHTML(date)}</span>
        </div>
      `;
    }

    const deleted = message.deletedForEveryone === true;

    const text = deleted
      ? "This message was deleted."
      : message.text || "";

    const read = message.readBy?.some(
      id => id !== uid
    );

    const delivered = message.deliveredTo?.some(
      id => id !== uid
    );

    let receipt = "";

    if (mine) {
      receipt = read
        ? '<span class="message-ticks read">✓✓</span>'
        : delivered
          ? '<span class="message-ticks">✓✓</span>'
          : '<span class="message-ticks">✓</span>';
    }

    return `
      ${dateDivider}

      <article
        class="message-item ${mine ? "mine" : "theirs"}"
        data-message-id="${escapeHTML(message.id)}"
      >
        <div class="message-bubble ${deleted ? "deleted" : ""}">
          ${
            !mine && !deleted
              ? `<small class="message-sender">${escapeHTML(message.senderName || "User")}</small>`
              : ""
          }

          <p>${escapeHTML(text)}</p>

          <div class="message-meta">
            <time>${formatTime(message.createdAt)}</time>
            ${receipt}
          </div>
        </div>

        ${
          !deleted
            ? `<button class="message-options" data-message-action="${escapeHTML(message.id)}" aria-label="Message options">···</button>`
            : ""
        }
      </article>
    `;
  }).join("");

  messageList.querySelectorAll("[data-message-action]").forEach(button => {
    button.addEventListener("click", () => {
      showMessageOptions(button.dataset.messageAction);
    });
  });

  scrollToBottom();
}

// =====================================
// SEND MESSAGE
// =====================================

messageForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (sending) return;
  if (!currentConversationId) return;

  const text = messageInput.value.trim();

  if (!text) return;

  if (text.length > 10000) {
    showToast("Pesan terlalu panjang.", "error");
    return;
  }

  const user = getCurrentUser();

  if (!user) return;

  sending = true;
  $("sendMessageBtn").disabled = true;

  const conversationId = currentConversationId;
  const conversation = currentConversation;

  messageInput.value = "";

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));

    const profile = profileSnap.exists()
      ? profileSnap.data()
      : {};

    const participants = conversation.participants || [];

    await addDoc(
      collection(db, "conversations", conversationId, "messages"),
      {
        senderId: user.uid,
        senderName: profile.name || user.displayName || "User",
        text,
        createdAt: serverTimestamp(),
        readBy: [user.uid],
        deliveredTo: [user.uid],
        hiddenFor: [],
        deletedForEveryone: false
      }
    );

    const updates = {
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // Update unread count untuk penerima
    for (const participant of participants) {
      if (participant !== user.uid) {
        updates[`unreadCount.${participant}`] = increment(1);
      }
    }

    await updateDoc(
      doc(db, "conversations", conversationId),
      updates
    );

  } catch (error) {
    console.error("Send message:", error);

    messageInput.value = text;

    showToast("Pesan gagal dikirim.", "error");
  } finally {
    sending = false;
    $("sendMessageBtn").disabled = false;
    messageInput.focus();
  }
});

// =====================================
// MARK AS READ
// =====================================

async function markConversationRead(conversationId) {
  const uid = currentUid();

  if (!uid) return;

  const unreadMessages = messagesCache.filter(message => {
    return (
      message.senderId !== uid &&
      !message.readBy?.includes(uid)
    );
  });

  for (const message of unreadMessages) {
    try {
      await updateDoc(
        doc(
          db,
          "conversations",
          conversationId,
          "messages",
          message.id
        ),
        {
          readBy: arrayUnion(uid)
        }
      );
    } catch (error) {
      console.warn("Read receipt update failed:", error);
    }
  }

  try {
    await updateDoc(
      doc(db, "conversations", conversationId),
      {
        [`unreadCount.${uid}`]: 0
      }
    );
  } catch (error) {
    console.warn("Unread count update failed:", error);
  }
}

// =====================================
// DELETE MESSAGE
// =====================================

function showMessageOptions(messageId) {
  const message = messagesCache.find(item => item.id === messageId);

  if (!message) return;

  const mine = message.senderId === currentUid();

  const content = document.createElement("div");

  content.innerHTML = `
    <div class="modal-heading">
      <span class="eyebrow">MESSAGE OPTIONS</span>
      <h2>Message actions</h2>
    </div>

    <button class="modal-action" id="deleteForMe">
      Delete for me
    </button>

    ${
      mine
        ? `<button class="modal-action danger" id="deleteForEveryone">
            Delete for everyone
          </button>`
        : ""
    }
  `;

  import("./app.js").then(({ openModal }) => {
    openModal(content);

    $("deleteForMe")?.addEventListener("click", () => {
      deleteMessageForMe(messageId);
    });

    $("deleteForEveryone")?.addEventListener("click", () => {
      deleteMessageForEveryone(messageId);
    });
  });
}

async function deleteMessageForMe(messageId) {
  try {
    await updateDoc(
      doc(
        db,
        "conversations",
        currentConversationId,
        "messages",
        messageId
      ),
      {
        hiddenFor: arrayUnion(currentUid())
      }
    );

    import("./app.js").then(module => module.closeModal());

    showToast("Message deleted for you.", "success");
  } catch (error) {
    console.error(error);
    showToast("Gagal menghapus pesan.", "error");
  }
}

async function deleteMessageForEveryone(messageId) {
  const message = messagesCache.find(item => item.id === messageId);

  if (!message || message.senderId !== currentUid()) {
    return;
  }

  if (!window.confirm("Hapus pesan ini untuk semua orang?")) {
    return;
  }

  try {
    await updateDoc(
      doc(
        db,
        "conversations",
        currentConversationId,
        "messages",
        messageId
      ),
      {
        deletedForEveryone: true
      }
    );

    import("./app.js").then(module => module.closeModal());

    showToast("Message deleted for everyone.", "success");
  } catch (error) {
    console.error(error);
    showToast("Gagal menghapus pesan.", "error");
  }
}

// =====================================
// SEARCH MESSAGES
// =====================================

$("conversationSearchBtn")?.addEventListener("click", () => {
  $("messageSearchPanel").hidden = false;
  $("messageSearchInput").focus();
});

$("closeMessageSearch")?.addEventListener("click", () => {
  $("messageSearchPanel").hidden = true;
  $("messageSearchInput").value = "";
  renderMessages();
});

$("messageSearchInput")?.addEventListener("input", event => {
  const search = event.target.value.toLowerCase();

  const filtered = messagesCache.filter(message => {
    return (message.text || "").toLowerCase().includes(search);
  });

  const original = messagesCache;

  messagesCache = filtered;
  renderMessages();
  messagesCache = original;
});

// =====================================
// CHAT FILTERS
// =====================================

document.querySelectorAll(".filter-chip").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");
    renderConversationList();
  });
});

$("chatSearch")?.addEventListener("input", renderConversationList);

// =====================================
// CONVERSATION MORE OPTIONS
// =====================================

$("conversationMoreBtn")?.addEventListener("click", () => {
  if (!currentConversationId) return;

  const content = document.createElement("div");

  content.innerHTML = `
    <div class="modal-heading">
      <span class="eyebrow">CONVERSATION</span>
      <h2>Chat options</h2>
    </div>

    <button class="modal-action danger" id="clearConversation">
      Clear conversation
    </button>
  `;

  import("./app.js").then(({ openModal }) => {
    openModal(content);

    $("clearConversation")?.addEventListener("click", () => {
      showToast(
        "Clear conversation belum diaktifkan. Fitur ini membutuhkan penghapusan pesan yang aman.",
        "info"
      );

      import("./app.js").then(module => module.closeModal());
    });
  });
});

// =====================================
// STARTUP
// =====================================

window.addEventListener("zorap:ready", () => {
  loadConversations();
});

// =====================================
// CLEANUP
// =====================================

window.addEventListener("beforeunload", () => {
  conversationUnsubscribe?.();
  messageUnsubscribe?.();
});
