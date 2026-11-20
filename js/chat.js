
import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
  increment,
  deleteField
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";


/* =====================================
   ZORAP CHAT ENGINE
===================================== */

const $ = selector => document.querySelector(selector);

let activeConversation = null;
let activeChatListener = null;
let activeMessageListener = null;
let activeTypingListener = null;

let currentUser = null;
let currentProfile = null;
let conversations = [];

let sending = false;


/* =====================================
   APP READY
===================================== */

window.addEventListener("zorap:ready", event => {
  currentUser = event.detail.user;
  currentProfile = event.detail.profile;

  loadConversations();
});


/* =====================================
   HELPERS
===================================== */

function escapeText(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function formatTime(timestamp) {
  if (!timestamp?.toDate) return "";

  return timestamp.toDate().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getOtherParticipant(data) {
  return data.participants?.find(uid => uid !== currentUser.uid);
}

function getConversationId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

function notify(message) {
  window.zorapToast?.(message);
}


/* =====================================
   CREATE / OPEN CONVERSATION
===================================== */

async function openConversation(targetUser) {
  if (!currentUser || !targetUser?.uid) return;

  if (targetUser.uid === currentUser.uid) {
    notify("Kamu tidak bisa mengirim pesan ke akun sendiri.");
    return;
  }

  const conversationId = getConversationId(
    currentUser.uid,
    targetUser.uid
  );

  const conversationRef = doc(
    db,
    "conversations",
    conversationId
  );

  const existing = await getDoc(conversationRef);

  if (!existing.exists()) {
    await setDoc(conversationRef, {
      participants: [
        currentUser.uid,
        targetUser.uid
      ],
      type: "private",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      unreadCount: {
        [currentUser.uid]: 0,
        [targetUser.uid]: 0
      }
    });
  }

  const targetProfileRef = doc(db, "users", targetUser.uid);
  const targetProfileSnap = await getDoc(targetProfileRef);

  const profile = targetProfileSnap.exists()
    ? targetProfileSnap.data()
    : targetUser;

  activeConversation = {
    id: conversationId,
    otherUid: targetUser.uid,
    name: profile.name || profile.displayName || "Pengguna",
    username: profile.username || "",
    photoURL: profile.photoURL || "",
    verified: profile.verified === true
  };

  renderConversationHeader();
  showConversationScreen();

  listenMessages();
  listenTyping();

  await markConversationRead(conversationId);

  window.dispatchEvent(
    new CustomEvent("zorap:conversationopen", {
      detail: activeConversation
    })
  );
}


/* =====================================
   CONVERSATION HEADER
===================================== */

function renderConversationHeader() {
  const header = $("#conversationHeader");
  if (!header || !activeConversation) return;

  const profile = activeConversation;

  const name = escapeText(profile.name);

  header.innerHTML = `
    <div class="conversation-user">
      <button class="icon-button mobile-back"
        id="conversationBackBtn"
        aria-label="Kembali">
        <svg viewBox="0 0 24 24">
          <path d="m15 18-6-6 6-6"/>
        </svg>
      </button>

      <div class="avatar" id="conversationAvatar"></div>

      <div class="conversation-user-info">
        <div class="name-line">
          <h3>${name}</h3>

          ${
            profile.verified
              ? `<span class="verified-badge" aria-label="Terverifikasi">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 1.8 15 3l3.2-.1 1.2 3 2.4 2-1 3.2.5 3.1-2.7 1.9-1.5 2.9-3.2-.4-2.9 1.3-2.5-2-3.2-.7-.5-3.2-2.1-2.4 1.2-3-1-3.1 2.6-1.9L7 3l3.2.3z"/>
                    <path class="verified-check"
                      d="m8 12 2.5 2.5L16 9"/>
                  </svg>
                </span>`
              : ""
          }
        </div>

        <span id="conversationStatus">
          Menghubungkan...
        </span>
      </div>
    </div>

    <div class="conversation-actions">
      <button class="icon-button" id="voiceCallBtn"
        title="Panggilan suara">
        <svg viewBox="0 0 24 24">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3.1a2 2 0 0 1-.6 1.7L7.1 10.4a16 16 0 0 0 6.5 6.5l1.9-1.9a2 2 0 0 1 1.7-.6l3.1.5a2 2 0 0 1 1.7 2Z"/>
        </svg>
      </button>

      <button class="icon-button" id="videoCallBtn"
        title="Panggilan video">
        <svg viewBox="0 0 24 24">
          <rect x="3" y="6" width="13" height="12" rx="2"/>
          <path d="m16 10 5-3v10l-5-3"/>
        </svg>
      </button>

      <button class="icon-button" id="chatMoreBtn"
        title="Menu percakapan">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1"/>
          <circle cx="12" cy="12" r="1"/>
          <circle cx="12" cy="19" r="1"/>
        </svg>
      </button>
    </div>
  `;

  const avatar = $("#conversationAvatar");

  if (avatar) {
    if (profile.photoURL) {
      avatar.innerHTML = `<img src="${escapeText(profile.photoURL)}" alt="">`;
    } else {
      avatar.textContent = profile.name.charAt(0).toUpperCase();
    }
  }

  $("#conversationBackBtn")?.addEventListener("click", () => {
    $("#chatView")?.classList.add("hidden");
    $("#welcomePanel")?.classList.remove("hidden");

    document.querySelector(".app-layout")
      ?.classList.remove("mobile-chat-open");
  });

  $("#chatMoreBtn")?.addEventListener("click", showChatMenu);

  $("#voiceCallBtn")?.addEventListener("click", () => {
    notify("Fitur panggilan akan dihubungkan pada modul panggilan.");
  });

  $("#videoCallBtn")?.addEventListener("click", () => {
    notify("Fitur panggilan video akan dihubungkan pada modul panggilan.");
  });
}


/* =====================================
   SHOW CONVERSATION SCREEN
===================================== */

function showConversationScreen() {
  $("#welcomePanel")?.classList.add("hidden");
  $("#chatView")?.classList.remove("hidden");

  document.querySelector(".app-layout")
    ?.classList.add("mobile-chat-open");
}


/* =====================================
   LOAD CONVERSATIONS
===================================== */

function loadConversations() {
  if (!currentUser) return;

  if (activeChatListener) {
    activeChatListener();
  }

  const conversationsRef = collection(db, "conversations");

  const conversationQuery = query(
    conversationsRef,
    where("participants", "array-contains", currentUser.uid)
  );

  activeChatListener = onSnapshot(
    conversationQuery,
    async snapshot => {
      conversations = [];

      for (const item of snapshot.docs) {
        const data = item.data();

        const otherUid = getOtherParticipant(data);

        if (!otherUid) continue;

        const userSnap = await getDoc(doc(db, "users", otherUid));

        const profile = userSnap.exists()
          ? userSnap.data()
          : { name: "Pengguna", username: "" };

        conversations.push({
          id: item.id,
          otherUid,
          name: profile.name || "Pengguna",
          username: profile.username || "",
          photoURL: profile.photoURL || "",
          verified: profile.verified === true,
          lastMessage: data.lastMessage || "",
          lastMessageAt: data.lastMessageAt,
          unreadCount: data.unreadCount?.[currentUser.uid] || 0
        });
      }

      conversations.sort((a, b) => {
        const timeA = a.lastMessageAt?.toMillis?.() || 0;
        const timeB = b.lastMessageAt?.toMillis?.() || 0;

        return timeB - timeA;
      });

      renderConversationList();
    },
    error => {
      console.error("Conversation listener:", error);
      notify("Gagal memuat daftar percakapan.");
    }
  );
}


/* =====================================
   RENDER CONVERSATION LIST
===================================== */

function renderConversationList() {
  const list = $("#chatList");
  if (!list) return;

  list.replaceChildren();

  if (!conversations.length) {
    const empty = document.createElement("div");

    empty.className = "chat-empty";
    empty.innerHTML = `
      <div class="empty-icon">Z</div>
      <h3>Belum ada percakapan</h3>
      <p>Cari username temanmu untuk memulai percakapan.</p>
    `;

    list.appendChild(empty);
    return;
  }

  conversations.forEach(conversation => {
    const item = document.createElement("button");

    item.type = "button";
    item.className = "chat-item";

    if (activeConversation?.id === conversation.id) {
      item.classList.add("active");
    }

    const avatar = document.createElement("div");
    avatar.className = "avatar";

    if (conversation.photoURL) {
      const img = document.createElement("img");
      img.src = conversation.photoURL;
      img.alt = "";
      avatar.appendChild(img);
    } else {
      avatar.textContent = conversation.name.charAt(0).toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "chat-item-info";

    const top = document.createElement("div");
    top.className = "chat-item-top";

    const name = document.createElement("strong");
    name.textContent = conversation.name;

    if (conversation.verified) {
      const badge = document.createElement("span");
      badge.className = "verified-badge";
      badge.textContent = "✓";
      name.appendChild(badge);
    }

    const time = document.createElement("span");
    time.className = "chat-time";
    time.textContent = formatTime(conversation.lastMessageAt);

    top.append(name, time);

    const bottom = document.createElement("div");
    bottom.className = "chat-item-bottom";

    const lastMessage = document.createElement("span");
    lastMessage.className = "chat-last-message";
    lastMessage.textContent = conversation.lastMessage || "Mulai percakapan";

    bottom.appendChild(lastMessage);

    if (conversation.unreadCount > 0) {
      const unread = document.createElement("span");
      unread.className = "unread-count";
      unread.textContent = conversation.unreadCount > 99
        ? "99+"
        : conversation.unreadCount;

      bottom.appendChild(unread);
    }

    info.append(top, bottom);
    item.append(avatar, info);

    item.addEventListener("click", () => {
      openConversation(conversation);
    });

    list.appendChild(item);
  });
}


/* =====================================
   MESSAGE LISTENER
===================================== */

function listenMessages() {
  if (!activeConversation) return;

  activeMessageListener?.();

  const messagesRef = collection(
    db,
    "conversations",
    activeConversation.id,
    "messages"
  );

  const messageQuery = query(
    messagesRef,
    orderBy("createdAt", "asc")
  );

  activeMessageListener = onSnapshot(
    messageQuery,
    snapshot => {
      renderMessages(snapshot.docs);
      markConversationRead(activeConversation.id);
    },
    error => {
      console.error("Message listener:", error);
      notify("Gagal memuat pesan.");
    }
  );
}


/* =====================================
   RENDER MESSAGES
===================================== */

function renderMessages(documents) {
  const history = $("#messageHistory");
  if (!history) return;

  history.replaceChildren();

  documents.forEach(messageDoc => {
    const message = messageDoc.data();

    if (message.hiddenFor?.includes(currentUser.uid)) {
      return;
    }

    const sent = message.senderId === currentUser.uid;

    const row = document.createElement("div");
    row.className = `message-row ${sent ? "sent" : "received"}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text || "";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const time = document.createElement("span");
    time.textContent = formatTime(message.createdAt);

    meta.appendChild(time);

    if (sent) {
      const ticks = document.createElement("span");
      ticks.className = "message-ticks";

      const readBy = message.readBy || [];
      const deliveredTo = message.deliveredTo || [];

      if (readBy.includes(activeConversation.otherUid)) {
        ticks.classList.add("read");
        ticks.textContent = "✓✓";
        ticks.title = "Dibaca";
      } else if (deliveredTo.includes(activeConversation.otherUid)) {
        ticks.textContent = "✓✓";
        ticks.title = "Diterima";
      } else {
        ticks.textContent = "✓";
        ticks.title = "Terkirim";
      }

      meta.appendChild(ticks);
    }

    bubble.append(text, meta);

    bubble.addEventListener("contextmenu", event => {
      event.preventDefault();
      showMessageMenu(messageDoc.id, message, sent);
    });

    row.appendChild(bubble);
    history.appendChild(row);
  });

  history.scrollTop = history.scrollHeight;
}


/* =====================================
   SEND MESSAGE
===================================== */

async function sendMessage() {
  if (!activeConversation || !currentUser || sending) return;

  const input = $("#messageInput");
  if (!input) return;

  const messageText = input.value.trim();

  if (!messageText) return;

  if (messageText.length > 5000) {
    notify("Pesan terlalu panjang.");
    return;
  }

  sending = true;

  const sendButton = $("#sendMessageBtn");

  if (sendButton) sendButton.disabled = true;

  try {
    const conversationRef = doc(
      db,
      "conversations",
      activeConversation.id
    );

    const messageRef = collection(
      conversationRef,
      "messages"
    );

    await addDoc(messageRef, {
      senderId: currentUser.uid,
      text: messageText,
      createdAt: serverTimestamp(),
      readBy: [currentUser.uid],
      deliveredTo: [],
      hiddenFor: [],
      deletedForEveryone: false
    });

    await updateDoc(conversationRef, {
      lastMessage: messageText,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      [`unreadCount.${activeConversation.otherUid}`]: increment(1)
    });

    input.value = "";

    await updateTyping(false);

  } catch (error) {
    console.error("Send message:", error);
    notify("Pesan gagal dikirim. Periksa koneksi dan Firestore Rules.");
  } finally {
    sending = false;

    if (sendButton) sendButton.disabled = false;
    input?.focus();
  }
}

$("#sendMessageBtn")?.addEventListener("click", sendMessage);

$("#messageInput")?.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});


/* =====================================
   READ RECEIPTS
===================================== */

async function markConversationRead(conversationId) {
  if (!currentUser) return;

  try {
    const conversationRef = doc(
      db,
      "conversations",
      conversationId
    );

    const messagesRef = collection(
      conversationRef,
      "messages"
    );

    const snapshot = await getDocs(
      query(messagesRef, where("senderId", "!=", currentUser.uid))
    );

    const batch = writeBatch(db);

    snapshot.docs.forEach(messageDoc => {
      const message = messageDoc.data();

      if (!message.readBy?.includes(currentUser.uid)) {
        batch.update(messageDoc.ref, {
          readBy: [
            ...(message.readBy || []),
            currentUser.uid
          ]
        });
      }
    });

    batch.update(conversationRef, {
      [`unreadCount.${currentUser.uid}`]: 0
    });

    await batch.commit();

  } catch (error) {
    console.error("Read receipt:", error);
  }
}


/* =====================================
   DELETE MESSAGE
===================================== */

async function deleteMessage(messageId, message, sent) {
  if (!activeConversation) return;

  const messageRef = doc(
    db,
    "conversations",
    activeConversation.id,
    "messages",
    messageId
  );

  try {
    if (sent) {
      await updateDoc(messageRef, {
        deletedForEveryone: true,
        text: "Pesan ini telah dihapus."
      });
    } else {
      await updateDoc(messageRef, {
        hiddenFor: [
          ...(message.hiddenFor || []),
          currentUser.uid
        ]
      });
    }

    notify("Pesan dihapus.");

  } catch (error) {
    console.error(error);
    notify("Tidak dapat menghapus pesan.");
  }
}


/* =====================================
   MESSAGE MENU
===================================== */

function showMessageMenu(messageId, message, sent) {
  const actions = sent
    ? "Hapus untuk semua orang atau hapus dari tampilanmu."
    : "Hapus pesan ini dari tampilanmu.";

  if (!window.zorapModal) return;

  const modal = $("#modalOverlay");
  const content = $("#modalContent");

  if (!modal || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Pesan";
  title.style.fontSize = "18px";

  const description = document.createElement("p");
  description.textContent = actions;
  description.style.color = "var(--muted)";
  description.style.fontSize = "12px";
  description.style.margin = "12px 0";

  content.append(title, description);

  const addAction = (label, callback) => {
    const button = document.createElement("button");

    button.className = "setting-item";
    button.textContent = label;
    button.style.width = "100%";

    button.addEventListener("click", async () => {
      window.zorapCloseModal();
      await callback();
    });

    content.appendChild(button);
  };

  addAction("Hapus untuk saya", () => {
    return deleteMessage(messageId, message, false);
  });

  if (sent) {
    addAction("Hapus untuk semua orang", () => {
      return deleteMessage(messageId, message, true);
    });
  }

  modal.classList.remove("hidden");
}


/* =====================================
   DELETE CONVERSATION
===================================== */

async function deleteConversation() {
  if (!activeConversation) return;

  try {
    const conversationRef = doc(
      db,
      "conversations",
      activeConversation.id
    );

    await updateDoc(conversationRef, {
      [`hiddenFor.${currentUser.uid}`]: true
    });

    activeConversation = null;

    activeMessageListener?.();
    activeTypingListener?.();

    $("#chatView")?.classList.add("hidden");
    $("#welcomePanel")?.classList.remove("hidden");

    document.querySelector(".app-layout")
      ?.classList.remove("mobile-chat-open");

    notify("Percakapan disembunyikan.");

  } catch (error) {
    console.error(error);
    notify("Gagal menghapus percakapan.");
  }
}


/* =====================================
   CHAT MENU
===================================== */

function showChatMenu() {
  const modal = $("#modalOverlay");
  const content = $("#modalContent");

  if (!modal || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Percakapan";
  title.style.fontSize = "18px";

  content.appendChild(title);

  const button = document.createElement("button");

  button.className = "setting-item";
  button.textContent = "Hapus percakapan";
  button.style.width = "100%";

  button.addEventListener("click", async () => {
    window.zorapCloseModal();
    await deleteConversation();
  });

  content.appendChild(button);
  modal.classList.remove("hidden");
}


/* =====================================
   USERNAME SEARCH
===================================== */

async function searchUsername(username) {
  if (!currentUser) return;

  const cleanUsername = username
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  if (!cleanUsername) {
    notify("Masukkan username.");
    return;
  }

  try {
    const usersQuery = query(
      collection(db, "users"),
      where("username", "==", cleanUsername)
    );

    const snapshot = await getDocs(usersQuery);

    if (snapshot.empty) {
      notify("Username tidak ditemukan.");
      return;
    }

    const userDoc = snapshot.docs[0];

    await openConversation({
      uid: userDoc.id,
      ...userDoc.data()
    });

    window.zorapCloseModal?.();

  } catch (error) {
    console.error("Search username:", error);
    notify("Pencarian gagal. Periksa Firestore Rules.");
  }
}


/* =====================================
   NEW CHAT MODAL
===================================== */

function showNewChatModal() {
  const modal = $("#modalOverlay");
  const content = $("#modalContent");

  if (!modal || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Mulai percakapan";
  title.style.fontSize = "19px";

  const description = document.createElement("p");
  description.textContent = "Masukkan username pengguna ZORAP.";
  description.style.margin = "10px 0 17px";
  description.style.color = "var(--muted)";
  description.style.fontSize = "12px";

  const input = document.createElement("input");

  input.type = "text";
  input.placeholder = "@username";
  input.autocomplete = "off";
  input.style.width = "100%";
  input.style.height = "45px";
  input.style.padding = "0 13px";
  input.style.border = "1px solid var(--border)";
  input.style.borderRadius = "12px";
  input.style.background = "var(--surface-2)";
  input.style.color = "var(--text)";
  input.style.outline = "none";

  const button = document.createElement("button");

  button.className = "primary-btn";
  button.textContent = "Cari pengguna";
  button.style.width = "100%";
  button.style.marginTop = "13px";

  button.addEventListener("click", () => {
    searchUsername(input.value);
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      searchUsername(input.value);
    }
  });

  content.append(title, description, input, button);

  modal.classList.remove("hidden");

  setTimeout(() => input.focus(), 100);
}

window.addEventListener("zorap:newchat", showNewChatModal);


/* =====================================
   TYPING INDICATOR
===================================== */

async function updateTyping(isTyping) {
  if (!activeConversation || !currentUser) return;

  const typingRef = doc(
    db,
    "conversations",
    activeConversation.id,
    "typing",
    currentUser.uid
  );

  try {
    if (isTyping) {
      await setDoc(typingRef, {
        uid: currentUser.uid,
        typing: true,
        updatedAt: serverTimestamp()
      });
    } else {
      await setDoc(typingRef, {
        uid: currentUser.uid,
        typing: false,
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.error("Typing status:", error);
  }
}

let typingTimeout;

$("#messageInput")?.addEventListener("input", () => {
  updateTyping(true);

  clearTimeout(typingTimeout);

  typingTimeout = setTimeout(() => {
    updateTyping(false);
  }, 1800);
});

function listenTyping() {
  if (!activeConversation) return;

  activeTypingListener?.();

  const typingRef = doc(
    db,
    "conversations",
    activeConversation.id,
    "typing",
    activeConversation.otherUid
  );

  activeTypingListener = onSnapshot(typingRef, snapshot => {
    const status = $("#conversationStatus");

    if (!status) return;

    const typing = snapshot.exists() &&
      snapshot.data().typing === true;

    status.textContent = typing
      ? "Sedang mengetik..."
      : "ZORAP";
  });
}


/* =====================================
   PUBLIC API
===================================== */

window.zorapChat = {
  openConversation,
  searchUsername,
  loadConversations,

  get activeConversation() {
    return activeConversation;
  },

  get conversations() {
    return conversations;
  }
};

console.log("ZORAP Chat Engine initialized.");
