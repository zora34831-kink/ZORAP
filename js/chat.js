
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
  increment,
  arrayUnion,
  writeBatch
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";


/* =====================================
   ZORAP UNIFIED CHAT ENGINE
===================================== */

const $ = selector => document.querySelector(selector);

let currentUser = null;
let currentProfile = null;

let activeConversation = null;
let conversations = [];

let conversationListener = null;
let messageListener = null;
let typingListener = null;

let sending = false;
let typingTimer = null;


/* =====================================
   INITIALIZATION
===================================== */

window.addEventListener("zorap:ready", event => {
  currentUser = event.detail.user;
  currentProfile = event.detail.profile;

  loadConversations();
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

function formatTime(timestamp) {
  if (!timestamp?.toDate) return "";

  return timestamp.toDate().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isGroup() {
  return activeConversation?.type === "group";
}


/* =====================================
   LOAD CONVERSATIONS
===================================== */

function loadConversations() {
  if (!currentUser) return;

  conversationListener?.();

  const q = query(
    collection(db, "conversations"),
    where("participants", "array-contains", currentUser.uid)
  );

  conversationListener = onSnapshot(q, snapshot => {
    conversations = snapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      .filter(item => item.hiddenFor?.[currentUser.uid] !== true);

    conversations.sort((a, b) => {
      const first = a.lastMessageAt?.toMillis?.() || 0;
      const second = b.lastMessageAt?.toMillis?.() || 0;
      return second - first;
    });

    renderConversationList();
  }, error => {
    console.error("Conversation list:", error);
    notify("Gagal memuat percakapan.");
  });
}


/* =====================================
   GET USER PROFILE
===================================== */

async function getUserProfile(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));

  if (!snapshot.exists()) {
    return {
      name: "Pengguna",
      username: "",
      photoURL: "",
      verified: false
    };
  }

  return snapshot.data();
}


/* =====================================
   OPEN PRIVATE CHAT
===================================== */

async function openPrivateChat(targetUser) {
  if (!currentUser || !targetUser?.uid) return;

  if (targetUser.uid === currentUser.uid) {
    notify("Tidak bisa membuka chat dengan diri sendiri.");
    return;
  }

  const id = [
    currentUser.uid,
    targetUser.uid
  ].sort().join("_");

  const ref = doc(db, "conversations", id);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    await setDoc(ref, {
      type: "private",
      participants: [
        currentUser.uid,
        targetUser.uid
      ],
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

  const profile = await getUserProfile(targetUser.uid);

  openConversation({
    id,
    type: "private",
    participants: [currentUser.uid, targetUser.uid],
    otherUid: targetUser.uid,
    groupName: profile.name,
    photoURL: profile.photoURL || "",
    verified: profile.verified === true
  });
}


/* =====================================
   OPEN GROUP
===================================== */

function openGroupConversation(group) {
  if (!currentUser || !group?.id) return;

  if (!group.participants?.includes(currentUser.uid)) {
    notify("Kamu bukan anggota grup ini.");
    return;
  }

  openConversation({
    ...group,
    type: "group",
    groupName: group.groupName || "Grup ZORAP",
    participants: group.participants || [],
    admins: group.admins || []
  });
}


/* =====================================
   OPEN CONVERSATION
===================================== */

function openConversation(conversation) {
  messageListener?.();
  typingListener?.();

  activeConversation = conversation;

  renderHeader();
  showChatScreen();

  listenMessages();
  listenTyping();

  markConversationRead();

  renderConversationList();

  window.dispatchEvent(
    new CustomEvent("zorap:conversationopen", {
      detail: conversation
    })
  );
}


/* =====================================
   HEADER
===================================== */

function renderHeader() {
  const header = $("#conversationHeader");
  if (!header || !activeConversation) return;

  const group = isGroup();

  header.replaceChildren();

  const left = document.createElement("div");
  left.className = "conversation-user";

  const back = document.createElement("button");
  back.className = "icon-button mobile-back";
  back.textContent = "‹";
  back.addEventListener("click", () => {
    $("#chatView")?.classList.add("hidden");
    $("#welcomePanel")?.classList.remove("hidden");

    document.querySelector(".app-layout")
      ?.classList.remove("mobile-chat-open");
  });

  const avatar = document.createElement("div");
  avatar.className = "avatar";

  if (activeConversation.photoURL) {
    const img = document.createElement("img");
    img.src = activeConversation.photoURL;
    img.alt = "";
    avatar.appendChild(img);
  } else {
    avatar.textContent = (
      activeConversation.groupName || "Z"
    ).charAt(0).toUpperCase();
  }

  const info = document.createElement("div");
  info.className = "conversation-user-info";

  const title = document.createElement("div");
  title.className = "name-line";

  const name = document.createElement("h3");
  name.textContent = activeConversation.groupName || "Percakapan";

  title.appendChild(name);

  if (!group && activeConversation.verified) {
    const verified = document.createElement("span");
    verified.className = "verified-badge";
    verified.textContent = "✓";
    title.appendChild(verified);
  }

  const status = document.createElement("span");
  status.id = "conversationStatus";
  status.textContent = group
    ? `${activeConversation.participants.length} anggota`
    : "ZORAP";

  info.append(title, status);
  left.append(back, avatar, info);

  const actions = document.createElement("div");
  actions.className = "conversation-actions";

  const more = document.createElement("button");
  more.className = "icon-button";
  more.textContent = "⋮";
  more.addEventListener("click", showConversationMenu);

  actions.appendChild(more);

  header.append(left, actions);
}


/* =====================================
   SHOW CHAT
===================================== */

function showChatScreen() {
  $("#welcomePanel")?.classList.add("hidden");
  $("#chatView")?.classList.remove("hidden");

  document.querySelector(".app-layout")
    ?.classList.add("mobile-chat-open");
}


/* =====================================
   LIST CONVERSATIONS
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
      <p>Mulai chat dengan temanmu.</p>
    `;
    list.appendChild(empty);
    return;
  }

  conversations.forEach(conversation => {
    const group = conversation.type === "group";

    const item = document.createElement("button");
    item.className = "chat-item";
    item.type = "button";

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
      avatar.textContent = (
        group ? conversation.groupName : "Z"
      )?.charAt(0)?.toUpperCase() || "Z";
    }

    const info = document.createElement("div");
    info.className = "chat-item-info";

    const top = document.createElement("div");
    top.className = "chat-item-top";

    const name = document.createElement("strong");
    name.textContent = group
      ? conversation.groupName || "Grup"
      : conversation.groupName || "Pengguna";

    if (!group && conversation.verified) {
      const verified = document.createElement("span");
      verified.className = "verified-badge";
      verified.textContent = "✓";
      name.appendChild(verified);
    }

    const time = document.createElement("span");
    time.className = "chat-time";
    time.textContent = formatTime(conversation.lastMessageAt);

    top.append(name, time);

    const bottom = document.createElement("div");
    bottom.className = "chat-item-bottom";

    const last = document.createElement("span");
    last.className = "chat-last-message";
    last.textContent = conversation.lastMessage || "Mulai percakapan";

    bottom.appendChild(last);

    const unreadCount =
      conversation.unreadCount?.[currentUser.uid] || 0;

    if (unreadCount > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-count";
      badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
      bottom.appendChild(badge);
    }

    info.append(top, bottom);
    item.append(avatar, info);

    item.addEventListener("click", () => {
      if (group) {
        openGroupConversation(conversation);
      } else {
        openPrivateChat({
          uid: getOtherUid(conversation),
          name: conversation.groupName
        });
      }
    });

    list.appendChild(item);
  });
}

function getOtherUid(conversation) {
  return conversation.participants?.find(
    uid => uid !== currentUser.uid
  );
}


/* =====================================
   LISTEN MESSAGES
===================================== */

function listenMessages() {
  if (!activeConversation) return;

  messageListener?.();

  const ref = collection(
    db,
    "conversations",
    activeConversation.id,
    "messages"
  );

  const q = query(
    ref,
    orderBy("createdAt", "asc")
  );

  messageListener = onSnapshot(q, snapshot => {
    renderMessages(snapshot.docs);
  }, error => {
    console.error("Messages:", error);
    notify("Gagal memuat riwayat pesan.");
  });
}


/* =====================================
   RENDER MESSAGES
===================================== */

async function renderMessages(documents) {
  const history = $("#messageHistory");
  if (!history) return;

  history.replaceChildren();

  const group = isGroup();

  for (const messageDoc of documents) {
    const message = messageDoc.data();

    if (message.hiddenFor?.includes(currentUser.uid)) {
      continue;
    }

    const sent = message.senderId === currentUser.uid;

    const row = document.createElement("div");
    row.className = `message-row ${sent ? "sent" : "received"}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (group && !sent) {
      const sender = document.createElement("div");
      sender.className = "message-sender";

      sender.textContent = message.senderName || "Anggota";
      bubble.appendChild(sender);
    }

    const text = document.createElement("div");
    text.className = "message-text";

    text.textContent = message.deletedForEveryone
      ? "Pesan ini telah dihapus."
      : message.text || "";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const time = document.createElement("span");
    time.textContent = formatTime(message.createdAt);
    meta.appendChild(time);

    if (sent) {
      const ticks = document.createElement("span");
      ticks.className = "message-ticks";

      const recipients = activeConversation.participants
        .filter(uid => uid !== currentUser.uid);

      const readBy = message.readBy || [];

      if (
        recipients.length &&
        recipients.every(uid => readBy.includes(uid))
      ) {
        ticks.classList.add("read");
        ticks.textContent = "✓✓";
      } else if ((message.deliveredTo || []).length) {
        ticks.textContent = "✓✓";
      } else {
        ticks.textContent = "✓";
      }

      meta.appendChild(ticks);
    }

    bubble.append(meta);
    bubble.prepend(text);

    bubble.addEventListener("contextmenu", event => {
      event.preventDefault();
      showMessageMenu(messageDoc.id, message, sent);
    });

    row.appendChild(bubble);
    history.appendChild(row);
  }

  history.scrollTop = history.scrollHeight;

  markConversationRead();
}


/* =====================================
   SEND MESSAGE
===================================== */

async function sendMessage() {
  if (!currentUser || !activeConversation || sending) return;

  const input = $("#messageInput");
  if (!input) return;

  const messageText = input.value.trim();

  if (!messageText) return;

  if (messageText.length > 5000) {
    notify("Pesan terlalu panjang.");
    return;
  }

  sending = true;

  const button = $("#sendMessageBtn");
  if (button) button.disabled = true;

  try {
    const conversationRef = doc(
      db,
      "conversations",
      activeConversation.id
    );

    await addDoc(
      collection(conversationRef, "messages"),
      {
        senderId: currentUser.uid,
        senderName:
          currentProfile?.name ||
          currentUser.displayName ||
          "Pengguna",
        text: messageText,
        createdAt: serverTimestamp(),
        readBy: [currentUser.uid],
        deliveredTo: [],
        hiddenFor: [],
        deletedForEveryone: false
      }
    );

    await updateDoc(conversationRef, {
      lastMessage: messageText,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      ...Object.fromEntries(
        activeConversation.participants
          .filter(uid => uid !== currentUser.uid)
          .map(uid => [
            `unreadCount.${uid}`,
            increment(1)
          ])
      )
    });

    input.value = "";
    await updateTyping(false);

  } catch (error) {
    console.error("Send:", error);
    notify("Pesan gagal dikirim.");
  } finally {
    sending = false;
    if (button) button.disabled = false;
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

async function markConversationRead() {
  if (!activeConversation || !currentUser) return;

  try {
    const ref = collection(
      db,
      "conversations",
      activeConversation.id,
      "messages"
    );

    const snapshot = await getDocs(
      query(ref, where("senderId", "!=", currentUser.uid))
    );

    const batch = writeBatch(db);
    let changes = 0;

    snapshot.docs.forEach(item => {
      const message = item.data();

      if (!message.readBy?.includes(currentUser.uid)) {
        batch.update(item.ref, {
          readBy: arrayUnion(currentUser.uid)
        });
        changes++;
      }
    });

    const conversationRef = doc(
      db,
      "conversations",
      activeConversation.id
    );

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

  const ref = doc(
    db,
    "conversations",
    activeConversation.id,
    "messages",
    messageId
  );

  try {
    if (sent) {
      await updateDoc(ref, {
        deletedForEveryone: true,
        text: "Pesan ini telah dihapus."
      });
    } else {
      await updateDoc(ref, {
        hiddenFor: arrayUnion(currentUser.uid)
      });
    }

    notify("Pesan dihapus.");

  } catch (error) {
    console.error(error);
    notify("Gagal menghapus pesan.");
  }
}


/* =====================================
   MESSAGE MENU
===================================== */

function showMessageMenu(id, message, sent) {
  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Opsi pesan";

  const createAction = (label, callback) => {
    const button = document.createElement("button");
    button.className = "setting-item";
    button.textContent = label;
    button.style.width = "100%";

    button.addEventListener("click", async () => {
      window.zorapCloseModal?.();
      await callback();
    });

    content.appendChild(button);
  };

  content.appendChild(title);

  createAction("Hapus untuk saya", () =>
    deleteMessage(id, message, false)
  );

  if (sent) {
    createAction("Hapus untuk semua orang", () =>
      deleteMessage(id, message, true)
    );
  }

  overlay.classList.remove("hidden");
}


/* =====================================
   TYPING STATUS
===================================== */

async function updateTyping(value) {
  if (!activeConversation || !currentUser) return;

  const ref = doc(
    db,
    "conversations",
    activeConversation.id,
    "typing",
    currentUser.uid
  );

  try {
    await setDoc(ref, {
      uid: currentUser.uid,
      typing: value,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Typing:", error);
  }
}

$("#messageInput")?.addEventListener("input", () => {
  updateTyping(true);

  clearTimeout(typingTimer);

  typingTimer = setTimeout(() => {
    updateTyping(false);
  }, 1800);
});


function listenTyping() {
  typingListener?.();

  if (!activeConversation || isGroup()) return;

  const otherUid = getOtherUid(activeConversation);

  if (!otherUid) return;

  const ref = doc(
    db,
    "conversations",
    activeConversation.id,
    "typing",
    otherUid
  );

  typingListener = onSnapshot(ref, snapshot => {
    const status = $("#conversationStatus");
    if (!status) return;

    status.textContent =
      snapshot.exists() && snapshot.data().typing
        ? "Sedang mengetik..."
        : "ZORAP";
  });
}


/* =====================================
   CONVERSATION MENU
===================================== */

function showConversationMenu() {
  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Percakapan";

  const leave = document.createElement("button");
  leave.className = "setting-item";
  leave.style.width = "100%";
  leave.textContent = isGroup()
    ? "Keluar dari grup"
    : "Sembunyikan percakapan";

  leave.addEventListener("click", async () => {
    window.zorapCloseModal?.();

    if (isGroup()) {
      await window.zorapGroups?.leaveGroup(activeConversation.id);
    } else {
      await updateDoc(
        doc(db, "conversations", activeConversation.id),
        {
          [`hiddenFor.${currentUser.uid}`]: true
        }
      );

      activeConversation = null;
      messageListener?.();

      $("#chatView")?.classList.add("hidden");
      $("#welcomePanel")?.classList.remove("hidden");

      document.querySelector(".app-layout")
        ?.classList.remove("mobile-chat-open");
    }
  });

  content.append(title, leave);
  overlay.classList.remove("hidden");
}


/* =====================================
   NEW CHAT
===================================== */

async function searchUsername(username) {
  const clean = username
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  if (!clean) return;

  try {
    const q = query(
      collection(db, "users"),
      where("username", "==", clean)
    );

    const result = await getDocs(q);

    if (result.empty) {
      notify("Username tidak ditemukan.");
      return;
    }

    const item = result.docs[0];

    await openPrivateChat({
      uid: item.id,
      ...item.data()
    });

    window.zorapCloseModal?.();

  } catch (error) {
    console.error(error);
    notify("Pencarian gagal.");
  }
}


/* =====================================
   NEW CHAT EVENT
===================================== */

function showNewChat() {
  const overlay = $("#modalOverlay");
  const content = $("#modalContent");

  if (!overlay || !content) return;

  content.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Mulai percakapan";

  const input = document.createElement("input");
  input.placeholder = "@username";
  input.style.width = "100%";
  input.style.height = "45px";
  input.style.marginTop = "15px";
  input.style.padding = "0 12px";

  const button = document.createElement("button");
  button.className = "primary-btn";
  button.textContent = "Cari pengguna";
  button.style.width = "100%";
  button.style.marginTop = "12px";

  button.addEventListener("click", () => {
    searchUsername(input.value);
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      searchUsername(input.value);
    }
  });

  content.append(title, input, button);
  overlay.classList.remove("hidden");
}

window.addEventListener("zorap:newchat", showNewChat);


/* =====================================
   GROUP EVENT
===================================== */

window.addEventListener("zorap:open-group", event => {
  openGroupConversation(event.detail);
});


/* =====================================
   PUBLIC API
===================================== */

window.zorapChat = {
  openPrivateChat,
  openGroupConversation,
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

console.log("ZORAP Unified Chat initialized.");
