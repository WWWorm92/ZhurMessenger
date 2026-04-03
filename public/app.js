const EMOJIS = ["😀", "😎", "😂", "😍", "🥳", "👍", "🔥", "❤️", "🤝", "👏", "🚀", "💡", "😅", "😮", "🙏", "👀", "🎉", "✅", "❗", "🤖", "☕", "🍕"];
const REGISTRATION_ENABLED = false;
const DOM_WINDOW_SIZE = 220;
const DOM_WINDOW_STEP = 90;
const APP_VERSION = "2026.03.30-1";

const state = {
  mode: "login",
  token: "",
  me: null,
  users: [],
  rooms: [],
  invitations: [],
  listMode: "dm",
  listFilter: "all",
  selected: null,
  search: "",
  dmMessagesByUserId: new Map(),
  roomMessagesByRoomId: new Map(),
  dmHasMoreByUserId: new Map(),
  roomHasMoreByRoomId: new Map(),
  loadingOlder: false,
  pinnedByDialogId: new Map(),
  pinnedByRoomId: new Map(),
  dmReadByPeerId: new Map(),
  typingDmByUserId: new Map(),
  typingRoomByRoomId: new Map(),
  unseenStartByChatKey: new Map(),
  unseenCountByChatKey: new Map(),
  newlyArrivedMessageIds: new Set(),
  renderWindowStartByChatKey: new Map(),
  selectionMode: false,
  selectedMessageIds: new Set(),
  pendingImage: null,
  replyToMessageId: null,
  onlineIds: new Set(),
  socket: null,
  swRegistration: null,
  notificationsEnabled: localStorage.getItem("notificationsEnabled") !== "0",
  remoteVersion: APP_VERSION,
  theme: localStorage.getItem("theme") || "light",
};

let typingEmitTimer = null;
let typingActiveKey = "";
const typingClearTimers = new Map();
let renderScheduled = false;
let renderScheduledForceBottom = false;
let refreshInFlight = null;

const els = {
  overlay: document.getElementById("overlay"),
  toastStack: document.getElementById("toastStack"),
  updateBanner: document.getElementById("updateBanner"),
  reloadAppBtn: document.getElementById("reloadAppBtn"),
  authView: document.getElementById("authView"),
  chatView: document.getElementById("chatView"),
  loginTab: document.getElementById("loginTab"),
  registerTab: document.getElementById("registerTab"),
  authForm: document.getElementById("authForm"),
  authSubmitBtn: document.getElementById("authSubmitBtn"),
  authError: document.getElementById("authError"),
  authRoomPreview: document.getElementById("authRoomPreview"),
  usernameInput: document.getElementById("usernameInput"),
  passwordInput: document.getElementById("passwordInput"),
  displayNameField: document.getElementById("displayNameField"),
  displayNameInput: document.getElementById("displayNameInput"),
  avatarField: document.getElementById("avatarField"),
  avatarInput: document.getElementById("avatarInput"),
  leftPanel: document.getElementById("leftPanel"),
  sideMenu: document.getElementById("sideMenu"),
  openChatsBtn: document.getElementById("openChatsBtn"),
  openMenuBtn: document.getElementById("openMenuBtn"),
  closeMenuBtn: document.getElementById("closeMenuBtn"),
  menuProfileBtn: document.getElementById("menuProfileBtn"),
  menuAdminBtn: document.getElementById("menuAdminBtn"),
  menuSettingsBtn: document.getElementById("menuSettingsBtn"),
  menuContactsBtn: document.getElementById("menuContactsBtn"),
  menuInvitesBtn: document.getElementById("menuInvitesBtn"),
  menuInvitesBadge: document.getElementById("menuInvitesBadge"),
  menuAboutBtn: document.getElementById("menuAboutBtn"),
  meAvatar: document.getElementById("meAvatar"),
  meName: document.getElementById("meName"),
  meUsername: document.getElementById("meUsername"),
  menuMeAvatar: document.getElementById("menuMeAvatar"),
  menuMeName: document.getElementById("menuMeName"),
  menuMeUsername: document.getElementById("menuMeUsername"),
  chatSearchInput: document.getElementById("chatSearchInput"),
  dmTab: document.getElementById("dmTab"),
  roomsTab: document.getElementById("roomsTab"),
  roomActions: document.getElementById("roomActions"),
  roomTools: document.getElementById("roomTools"),
  roomToolsMeta: document.getElementById("roomToolsMeta"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  invitationsBtn: document.getElementById("invitationsBtn"),
  listFilters: document.getElementById("listFilters"),
  entityList: document.getElementById("entityList"),
  chatHeadAvatar: document.getElementById("chatHeadAvatar"),
  chatHeadMain: document.getElementById("chatHeadMain"),
  chatTitle: document.getElementById("chatTitle"),
  chatStatus: document.getElementById("chatStatus"),
  chatActionsBtn: document.getElementById("chatActionsBtn"),
  selectionAllBtn: document.getElementById("selectionAllBtn"),
  selectionCopyBtn: document.getElementById("selectionCopyBtn"),
  selectionForwardBtn: document.getElementById("selectionForwardBtn"),
  selectionDeleteBtn: document.getElementById("selectionDeleteBtn"),
  selectionClearBtn: document.getElementById("selectionClearBtn"),
  jumpBottomBtn: document.getElementById("jumpBottomBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  messages: document.getElementById("messages"),
  stickyDayLabel: document.getElementById("stickyDayLabel"),
  messageForm: document.getElementById("messageForm"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  imageInput: document.getElementById("imageInput"),
  fileInput: document.getElementById("fileInput"),
  attachToggleBtn: document.getElementById("attachToggleBtn"),
  attachMenu: document.getElementById("attachMenu"),
  imageBtn: document.getElementById("imageBtn"),
  fileBtn: document.getElementById("fileBtn"),
  pollBtn: document.getElementById("pollBtn"),
  emojiToggle: document.getElementById("emojiToggle"),
  emojiPanel: document.getElementById("emojiPanel"),
  composeMeta: document.getElementById("composeMeta"),
  composeMetaText: document.getElementById("composeMetaText"),
  composeMetaCancel: document.getElementById("composeMetaCancel"),
  imagePreviewBar: document.getElementById("imagePreviewBar"),
  imagePreviewThumb: document.getElementById("imagePreviewThumb"),
  imagePreviewName: document.getElementById("imagePreviewName"),
  imagePreviewSendBtn: document.getElementById("imagePreviewSendBtn"),
  imagePreviewCancelBtn: document.getElementById("imagePreviewCancelBtn"),
  uploadProgress: document.getElementById("uploadProgress"),
  sheet: document.getElementById("sheet"),
  sheetTitle: document.getElementById("sheetTitle"),
  sheetBody: document.getElementById("sheetBody"),
  sheetForm: document.getElementById("sheetForm"),
  sheetSubmit: document.getElementById("sheetSubmit"),
  sheetClose: document.getElementById("sheetClose"),
  contextMenu: document.getElementById("contextMenu"),
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function renderMessageText(text) {
  const source = String(text || "");
  const urlRegex = /(https?:\/\/[^\s<]+)|(www\.[^\s<]+\.[a-z]{2,}[^\s<.,!?;:]*)|(\b[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s<.,!?;:]*)?)/gi;
  let lastIndex = 0;
  let html = "";
  source.replace(urlRegex, (match, _http, _www, _bare, offset) => {
    html += escapeHtml(source.slice(lastIndex, offset));
    let href = match;
    if (!/^https?:\/\//i.test(href)) {
      href = `https://${href}`;
    }
    const safeHref = escapeAttribute(href);
    html += `<a class="msg-link" href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(match)}</a>`;
    lastIndex = offset + match.length;
    return match;
  });
  html += escapeHtml(source.slice(lastIndex));
  return html;
}

function showToast(message, type = "info") {
  if (!els.toastStack || !message) {
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<strong>${type === "error" ? "Ошибка" : type === "success" ? "Готово" : "Сообщение"}</strong><p>${escapeHtml(message)}</p>`;
  els.toastStack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  const cleanup = () => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 180);
  };
  toast.addEventListener("click", cleanup);
  setTimeout(cleanup, 3200);
}

function refreshSelectionBar() {
  updateChatHeader();
}

function clearMessageSelection() {
  state.selectionMode = false;
  state.selectedMessageIds.clear();
  refreshSelectionBar();
  renderMessages();
}

function toggleMessageSelection(messageId) {
  state.selectionMode = true;
  if (state.selectedMessageIds.has(messageId)) {
    state.selectedMessageIds.delete(messageId);
  } else {
    state.selectedMessageIds.add(messageId);
  }
  if (!state.selectedMessageIds.size) {
    state.selectionMode = false;
  }
  refreshSelectionBar();
  renderMessages();
}

function selectAllLoadedMessages() {
  const ids = getCurrentMessages()
    .map((message) => Number(message.id))
    .filter(Boolean);
  state.selectionMode = true;
  state.selectedMessageIds = new Set(ids);
  refreshSelectionBar();
  renderMessages();
}

function allLoadedMessagesSelected() {
  const loaded = getCurrentMessages().map((message) => Number(message.id)).filter(Boolean);
  if (!loaded.length) {
    return false;
  }
  return loaded.every((id) => state.selectedMessageIds.has(id));
}

function refreshUpdateBanner() {
  const hasUpdate = Boolean(state.remoteVersion && state.remoteVersion !== APP_VERSION);
  els.updateBanner?.classList.toggle("hidden", !hasUpdate);
}

async function checkForAppUpdate() {
  try {
    const response = await fetch(`/version.json?v=${Date.now()}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    state.remoteVersion = String(data.version || APP_VERSION);
    refreshUpdateBanner();
  } catch (error) {
    // ignore update check errors
  }
}

window.alert = (message) => {
  showToast(String(message || ""), "error");
};

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  state.theme = normalized;
  document.body.setAttribute("data-theme", normalized);
  localStorage.setItem("theme", normalized);
}

function setToken(token) {
  state.token = token;
}

function setMode(mode) {
  state.mode = REGISTRATION_ENABLED && mode === "register" ? "register" : "login";
  const register = state.mode === "register";
  els.loginTab?.classList.toggle("active", !register);
  els.registerTab?.classList.toggle("active", register);
  els.displayNameField.classList.toggle("hidden", !register);
  els.avatarField.classList.toggle("hidden", !register);
  els.displayNameInput.required = register;
  els.authSubmitBtn.textContent = register ? "Создать аккаунт" : "Войти";
  els.authError.textContent = "";
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function avatarMarkup(entity) {
  const image = escapeHtml(entity?.avatarUrl || "");
  const name = escapeHtml(entity?.displayName || entity?.name || entity?.username || "User");
  if (image) {
    return `<img src="${image}" alt="${name}" />`;
  }
  return escapeHtml(initials(name));
}

function iconSvg(name) {
  const icons = {
    room: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 10h6M9 14h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10V8a4 4 0 1 1 8 0v2M7 10h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7.5h12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H6a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><path d="m7 16 3.2-3.2a1 1 0 0 1 1.4 0l1.8 1.8 2.1-2.1a1 1 0 0 1 1.4 0L18 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    poll: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18V9M12 18V6M18 18v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 18h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 6 6m-1.5-4.5 3 3-2 2 .5 4.5-1.5 1.5-4.5-.5-2 2-3-3 2-2-.5-4.5L7 8l2-2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14h3l4 3V7L8 10H5v4ZM17 10l4 4M21 10l-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    smile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 10h.01M15 10h.01" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M9 14c.8.9 1.8 1.3 3 1.3s2.2-.4 3-1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    composeSend: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 13-6-3.5 12-4-4-5.5-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  };
  return icons[name] || icons.chat;
}

function iconMarkup(name, extraClass = "") {
  return `<span class="ui-icon ${extraClass}" aria-hidden="true">${iconSvg(name)}</span>`;
}



function isPrivateRoom(room) {
  return room?.accessType === "private" || room?.accessType === "invite";
}

function roomRoleLabel(role) {
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  return "member";
}

function memberStatusBadges(user) {
  const badges = [];
  if (user.role) {
    badges.push(`<span class="role-chip ${escapeHtml(roomRoleLabel(user.role))}">${escapeHtml(roomRoleLabel(user.role))}</span>`);
  }
  if (user.isMuted) {
    badges.push(`<span class="role-chip warning">muted</span>`);
  }
  if (user.canPostMedia === false) {
    badges.push(`<span class="role-chip restricted">no media</span>`);
  }
  if (user.isAdmin) {
    badges.push(`<span class="role-chip admin">system admin</span>`);
  }
  return badges.join("");
}

function formatTime(value) {
  const normalized = String(value || "").replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  const ms = asUtcMs(value);
  if (!ms) {
    return "";
  }
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLastSeen(value) {
  const ms = asUtcMs(value);
  if (!ms) {
    return "был(а) давно";
  }
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < 5 * minute) {
    return "был(а) недавно";
  }
  if (diff < hour) {
    return `был(а) ${Math.max(1, Math.round(diff / minute))} мин назад`;
  }
  return `был(а) ${formatDateTime(value)}`;
}

function presenceLabel(user) {
  if (!user) {
    return "не в сети";
  }
  return user.online || state.onlineIds.has(user.id) ? "в сети" : formatLastSeen(user.lastSeenAt);
}

function formatDayLabel(value) {
  const ms = asUtcMs(value);
  if (!ms) {
    return "";
  }
  const date = new Date(ms);
  const today = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dateStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const diffDays = Math.round((todayStart - dateStart) / dayMs);
  if (diffDays === 0) {
    return "Сегодня";
  }
  if (diffDays === 1) {
    return "Вчера";
  }
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function asUtcMs(value) {
  if (!value) {
    return 0;
  }
  const text = String(value);
  const normalized = text.includes("T") || text.endsWith("Z") ? text : `${text.replace(" ", "T")}Z`;
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function cleanupTypingForRoom(roomId) {
  const map = state.typingRoomByRoomId.get(roomId);
  if (map && map.size === 0) {
    state.typingRoomByRoomId.delete(roomId);
  }
}

function setTypingPresence(scope, targetId, userId, isTyping) {
  const key = `${scope}:${targetId}:${userId}`;
  const timer = typingClearTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    typingClearTimers.delete(key);
  }

  if (scope === "dm") {
    if (isTyping) {
      state.typingDmByUserId.set(targetId, true);
      const nextTimer = setTimeout(() => {
        state.typingDmByUserId.delete(targetId);
        typingClearTimers.delete(key);
        updateChatHeader();
      }, 2200);
      typingClearTimers.set(key, nextTimer);
    } else {
      state.typingDmByUserId.delete(targetId);
    }
    updateChatHeader();
    return;
  }

  let roomMap = state.typingRoomByRoomId.get(targetId);
  if (!roomMap) {
    roomMap = new Map();
    state.typingRoomByRoomId.set(targetId, roomMap);
  }

  if (isTyping) {
    roomMap.set(userId, true);
    const nextTimer = setTimeout(() => {
      const existing = state.typingRoomByRoomId.get(targetId);
      if (existing) {
        existing.delete(userId);
        cleanupTypingForRoom(targetId);
      }
      typingClearTimers.delete(key);
      updateChatHeader();
    }, 2200);
    typingClearTimers.set(key, nextTimer);
  } else {
    roomMap.delete(userId);
    cleanupTypingForRoom(targetId);
  }

  updateChatHeader();
}

function resolveTypingStatus(fallback) {
  if (!state.selected) {
    return fallback;
  }

  if (state.selected.type === "dm") {
    if (state.typingDmByUserId.get(state.selected.id)) {
      return "печатает...";
    }
    return fallback;
  }

  const roomMap = state.typingRoomByRoomId.get(state.selected.id);
  if (!roomMap || roomMap.size === 0) {
    return fallback;
  }
  const names = Array.from(roomMap.keys())
    .map((id) => state.users.find((u) => u.id === id)?.displayName || "кто-то")
    .filter(Boolean);
  if (!names.length) {
    return "кто-то печатает...";
  }
  if (names.length === 1) {
    return `${names[0]} печатает...`;
  }
  return `${names[0]} и еще ${names.length - 1} печатают...`;
}

function parseTypingKey(key) {
  const [scope, id] = String(key || "").split(":");
  const targetId = Number(id);
  if (!targetId || !["dm", "room"].includes(scope)) {
    return null;
  }
  return { scope, targetId };
}

function emitTypingState(isTyping, forcedKey = "") {
  if (!state.socket) {
    return;
  }

  const current = forcedKey ? parseTypingKey(forcedKey) : state.selected
    ? { scope: state.selected.type === "room" ? "room" : "dm", targetId: state.selected.id }
    : null;
  if (!current?.targetId) {
    return;
  }

  state.socket.emit("typing:update", {
    scope: current.scope,
    targetId: current.targetId,
    isTyping,
  });
}

function stopTypingEmit() {
  if (typingEmitTimer) {
    clearTimeout(typingEmitTimer);
    typingEmitTimer = null;
  }
  if (typingActiveKey) {
    emitTypingState(false, typingActiveKey);
    typingActiveKey = "";
  }
}

function onComposerInputChanged() {
  if (!state.selected || els.messageInput.disabled || !state.socket) {
    stopTypingEmit();
    return;
  }
  const text = els.messageInput.value.trim();
  const nextKey = `${state.selected.type === "room" ? "room" : "dm"}:${state.selected.id}`;
  if (!text) {
    stopTypingEmit();
    return;
  }

  if (typingActiveKey && typingActiveKey !== nextKey) {
    emitTypingState(false, typingActiveKey);
    typingActiveKey = "";
  }

  if (!typingActiveKey) {
    emitTypingState(true, nextKey);
    typingActiveKey = nextKey;
  }

  if (typingEmitTimer) {
    clearTimeout(typingEmitTimer);
  }
  typingEmitTimer = setTimeout(() => {
    stopTypingEmit();
  }, 1300);
}

async function api(url, options = {}) {
  async function doFetch(withToken = true) {
    const headers = { ...(options.headers || {}) };
    if (!options.isFormData) {
      headers["Content-Type"] = "application/json";
    }
    if (withToken && state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function tryRefreshAccessToken() {
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        throw new Error(data.error || "Session expired");
      }
      setToken(data.token);
      if (data.user) {
        state.me = data.user;
      }
      return true;
    })();

    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  const isAuthFlow = String(url).startsWith("/api/auth/login") || String(url).startsWith("/api/auth/refresh");

  let { response, data } = await doFetch(true);
  if (response.status === 401 && state.token && !isAuthFlow) {
    try {
      await tryRefreshAccessToken();
      ({ response, data } = await doFetch(true));
    } catch (error) {
      if (String(url).startsWith("/api/auth/me")) {
        throw error;
      }
      resetSession();
      throw error;
    }
  }

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function uploadAvatar(file) {
  const form = new FormData();
  form.append("avatar", file);
  return api("/api/uploads/avatar", { method: "POST", body: form, isFormData: true });
}

async function uploadRoomAvatar(file) {
  const form = new FormData();
  form.append("avatar", file);
  return api("/api/uploads/room-avatar", { method: "POST", body: form, isFormData: true });
}

async function uploadMessageFile(file) {
  const form = new FormData();
  form.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/message-file", true);
    if (state.token) {
      xhr.setRequestHeader("Authorization", `Bearer ${state.token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      setUploadProgress(percent);
    };

    xhr.onerror = () => reject(new Error("Ошибка сети при загрузке файла"));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || `Upload failed (${xhr.status})`));
          return;
        }
        resolve(data);
      } catch {
        reject(new Error(`Некорректный ответ сервера (${xhr.status})`));
      }
    };

    setUploadProgress(3);
    xhr.send(form);
  });
}

function isNotificationsAvailable() {
  return "Notification" in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerServiceWorkerIfNeeded() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  if (state.swRegistration) {
    return state.swRegistration;
  }
  try {
    state.swRegistration = await navigator.serviceWorker.register("/sw.js");
    return state.swRegistration;
  } catch (error) {
    return null;
  }
}

async function removePushSubscriptionOnServer(endpoint = "") {
  if (!state.token) {
    return;
  }
  try {
    await api("/api/notifications/subscriptions", {
      method: "DELETE",
      body: JSON.stringify(endpoint ? { endpoint } : {}),
    });
  } catch (error) {
    // ignore
  }
}

async function syncPushSubscription() {
  const registration = await registerServiceWorkerIfNeeded();
  if (!registration || !("PushManager" in window)) {
    return;
  }

  const existing = await registration.pushManager.getSubscription();
  const canUsePush =
    state.notificationsEnabled && isNotificationsAvailable() && Notification.permission === "granted";

  if (!canUsePush) {
    if (existing) {
      const endpoint = existing.endpoint;
      await existing.unsubscribe();
      await removePushSubscriptionOnServer(endpoint);
    }
    return;
  }

  const vapid = await api("/api/notifications/vapid-public-key").catch(() => ({ publicKey: null }));
  if (!vapid?.publicKey) {
    return;
  }

  let subscription = existing;
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });
  }

  await api("/api/notifications/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: subscription.toJSON().keys || {},
      userAgent: navigator.userAgent,
    }),
  });
}

async function requestNotificationPermissionAndSync() {
  if (!isNotificationsAvailable()) {
    throw new Error("Браузер не поддерживает уведомления");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Уведомления не разрешены");
  }
  await syncPushSubscription();
}

function canShowLocalNotification() {
  return (
    state.notificationsEnabled &&
    isNotificationsAvailable() &&
    Notification.permission === "granted"
  );
}

async function showLocalNotification({ title, body }) {
  if (!canShowLocalNotification()) {
    return;
  }
  const registration = await registerServiceWorkerIfNeeded();
  if (registration?.showNotification) {
    registration.showNotification(title, {
      body,
      icon: "/icon-192.svg",
      badge: "/icon-192.svg",
      data: { url: "/" },
    });
    return;
  }
  new Notification(title, { body, icon: "/icon-192.svg" });
}

async function uploadMessageImage(file) {
  const form = new FormData();
  form.append("image", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/message-image", true);
    if (state.token) {
      xhr.setRequestHeader("Authorization", `Bearer ${state.token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      setUploadProgress(percent);
    };

    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || "Upload failed"));
          return;
        }
        resolve(data);
      } catch (error) {
        reject(new Error("Upload failed"));
      }
    };

    setUploadProgress(3);
    xhr.send(form);
  });
}

function setUploadProgress(percent) {
  if (!els.uploadProgress) {
    return;
  }
  const value = Number(percent || 0);
  if (value <= 0) {
    els.uploadProgress.classList.add("hidden");
    els.uploadProgress.style.width = "0%";
    return;
  }
  els.uploadProgress.classList.remove("hidden");
  els.uploadProgress.style.width = `${Math.min(100, value)}%`;
  if (value >= 100) {
    setTimeout(() => {
      setUploadProgress(0);
    }, 300);
  }
}

function clearPendingImage() {
  if (state.pendingImage?.previewUrl) {
    URL.revokeObjectURL(state.pendingImage.previewUrl);
  }
  state.pendingImage = null;
  if (els.imagePreviewBar) {
    els.imagePreviewBar.classList.add("hidden");
  }
  if (els.imagePreviewThumb) {
    els.imagePreviewThumb.removeAttribute("src");
  }
  if (els.imagePreviewName) {
    els.imagePreviewName.textContent = "Изображение";
  }
}

function setPendingImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Можно отправлять только изображения");
  }
  clearPendingImage();
  const previewUrl = URL.createObjectURL(file);
  state.pendingImage = { file, previewUrl };
  if (els.imagePreviewThumb) {
    els.imagePreviewThumb.src = previewUrl;
  }
  if (els.imagePreviewName) {
    els.imagePreviewName.textContent = file.name || "Изображение";
  }
  els.imagePreviewBar?.classList.remove("hidden");
}

function openImageViewer(imageUrl) {
  if (!imageUrl) {
    return;
  }
  openSheet(
    "Вложение",
    "",
    `<div class="image-viewer"><img class="image-viewer-img" src="${escapeHtml(imageUrl)}" alt="image" /><a class="ghost" href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener noreferrer">Открыть оригинал</a></div>`,
    async () => {}
  );
}

function showAuth() {
  els.authView.classList.remove("hidden");
  els.chatView.classList.add("hidden");
}

async function loadPublicRoomPreviewIfNeeded() {
  const slugMatch = location.pathname.match(/^\/room\/([a-z0-9-]+)$/i);
  if (!slugMatch?.[1] || state.token || !els.authRoomPreview) {
    els.authRoomPreview?.classList.add("hidden");
    return;
  }
  try {
    const response = await fetch(`/api/public/room-slug/${encodeURIComponent(slugMatch[1])}`);
    const data = await response.json().catch(() => ({}));
    const room = data.room;
    if (!room) return;
    els.authRoomPreview.classList.remove("hidden");
    els.authRoomPreview.innerHTML = `
      <div class="profile-hero-main">
        <div class="avatar profile-hero-avatar">${room.avatarUrl ? `<img src="${escapeHtml(room.avatarUrl)}" alt="${escapeHtml(room.name)}" />` : (room.accessType === "private" ? iconMarkup("lock") : iconMarkup("room"))}</div>
        <div>
          <strong># ${escapeHtml(room.name)}</strong>
          <p class="msg-time">${room.accessType === "private" ? "Закрытая" : "Публичная"} комната · участников: ${room.membersCount}</p>
          ${room.description ? `<p class="msg-time">${escapeHtml(room.description)}</p>` : ""}
        </div>
      </div>
      <div class="settings-empty room-link-box"><strong>Войдите, чтобы открыть комнату</strong><p class="msg-time">${escapeHtml(`${location.origin}/room/${room.slug}`)}</p></div>
    `;
  } catch {
    els.authRoomPreview.classList.add("hidden");
  }
}

async function handleIncomingNavigation(urlString) {
  if (!urlString) return;
  try {
    const url = new URL(urlString, location.origin);
    const dmId = Number(url.searchParams.get("dm") || 0);
    const roomId = Number(url.searchParams.get("room") || 0);
    const slugMatch = url.pathname.match(/^\/room\/([a-z0-9-]+)$/i);

    if (slugMatch?.[1] && state.token) {
      const data = await api(`/api/room-slug/${encodeURIComponent(slugMatch[1])}`);
      if (data.room?.id) {
        await selectRoom(data.room.id);
        history.replaceState({}, "", "/");
      }
      return;
    }

    if (!state.token) {
      return;
    }
    if (dmId) {
      await selectDm(dmId);
      history.replaceState({}, "", "/");
      return;
    }
    if (roomId) {
      await selectRoom(roomId);
      history.replaceState({}, "", "/");
    }
  } catch {
    // ignore broken navigation intents
  }
}

function showChat() {
  els.authView.classList.add("hidden");
  els.chatView.classList.remove("hidden");
}

function openLeftPanel() {
  els.leftPanel.classList.add("open");
  syncOverlay();
}

function closeLeftPanel() {
  els.leftPanel.classList.remove("open");
  syncOverlay();
}

function openSideMenu() {
  els.sideMenu.classList.add("open");
  syncOverlay();
}

function closeSideMenu() {
  els.sideMenu.classList.remove("open");
  syncOverlay();
}

function syncOverlay() {
  const visible =
    els.leftPanel.classList.contains("open") ||
    els.sideMenu.classList.contains("open") ||
    !els.sheet.classList.contains("hidden");
  els.overlay.classList.toggle("hidden", !visible);
}

function openSheet(title, submitText, bodyHtml, onSubmit, actions = []) {
  els.sheetTitle.textContent = title;
  const hasSubmit = Boolean(String(submitText || "").trim());
  els.sheetSubmit.textContent = hasSubmit ? String(submitText) : "";
  els.sheetSubmit.classList.toggle("hidden", !hasSubmit);
  els.sheetBody.innerHTML = bodyHtml;

  let actionsHtml = "";
  if (actions.length > 0) {
    actionsHtml = `<div class="sheet-actions">${actions.map(a => `<button type="button" class="sheet-action">${escapeHtml(a.label)}</button>`).join("")}</div>`;
  }

  const existingActions = els.sheetBody.parentNode.querySelector(".sheet-actions");
  if (existingActions) {
    existingActions.remove();
  }
  els.sheetBody.insertAdjacentHTML("afterend", actionsHtml);

  els.sheetBody.parentNode.querySelectorAll(".sheet-action").forEach((btn, i) => {
    btn.addEventListener("click", () => actions[i].onClick());
  });

  els.sheet.classList.remove("hidden");
  syncOverlay();

  const handler = async (event) => {
    event.preventDefault();
    if (!hasSubmit) {
      return;
    }
    try {
      const formData = new FormData(els.sheetForm);
      const shouldClose = await onSubmit(formData);
      if (shouldClose === false) {
        return;
      }
      closeSheet();
    } catch (error) {
      if (error?.message) {
        alert(error.message || "Ошибка");
      }
    }
  };

  els.sheetForm.onsubmit = handler;
}

function renderSheetLoading(title, lines = 3) {
  openSheet(
    title,
    "",
    `
      <div class="stack settings-layout">
        <section class="settings-hero skeleton-card">
          <div class="skeleton-line lg"></div>
          <div class="skeleton-line"></div>
        </section>
        <section class="settings-card skeleton-card">
          ${Array.from({ length: lines })
            .map(() => `<div class="skeleton-line"></div>`)
            .join("")}
        </section>
      </div>
    `,
    async () => {}
  );
}

function closeSheet() {
  els.sheet.classList.add("hidden");
  els.sheetBody.innerHTML = "";
  els.sheetForm.onsubmit = null;
  const actions = els.sheet.querySelector(".sheet-actions");
  if (actions) actions.remove();
  syncOverlay();
}

function hideContextMenu() {
  els.contextMenu.classList.add("hidden");
  els.contextMenu.innerHTML = "";
}

function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
}

function attachLongPress(element, onPress) {
  if (!isTouchDevice()) {
    return;
  }

  let timer = null;
  let startX = 0;
  let startY = 0;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  element.addEventListener("touchstart", (event) => {
    if (!event.touches || event.touches.length !== 1) {
      return;
    }
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      onPress(startX, startY);
    }, 520);
  }, { passive: true });

  element.addEventListener("touchmove", (event) => {
    if (!timer || !event.touches || !event.touches.length) {
      return;
    }
    const dx = Math.abs(event.touches[0].clientX - startX);
    const dy = Math.abs(event.touches[0].clientY - startY);
    if (dx > 10 || dy > 10) {
      clear();
    }
  }, { passive: true });

  element.addEventListener("touchend", clear, { passive: true });
  element.addEventListener("touchcancel", clear, { passive: true });
}

function attachSwipeActions(element, { leftLabel, rightLabel, onLeft, onRight }) {
  if (!isTouchDevice()) {
    return;
  }

  let startX = 0;
  let startY = 0;
  let lastDx = 0;
  let tracking = false;
  let horizontal = false;

  const reset = () => {
    element.style.transform = "";
    element.classList.remove("swiping", "swipe-left", "swipe-right");
    element.dataset.swipeLabel = "";
    lastDx = 0;
    tracking = false;
    horizontal = false;
  };

  element.addEventListener(
    "touchstart",
    (event) => {
      if (!event.touches || event.touches.length !== 1) {
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      lastDx = 0;
      tracking = true;
      horizontal = false;
      element.style.transition = "";
    },
    { passive: true }
  );

  element.addEventListener(
    "touchmove",
    (event) => {
      if (!tracking || !event.touches || !event.touches.length) {
        return;
      }
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (!horizontal) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
          return;
        }
        if (Math.abs(dx) <= Math.abs(dy) * 1.2) {
          tracking = false;
          return;
        }
        horizontal = true;
      }

      event.preventDefault();
      lastDx = Math.max(-86, Math.min(86, dx));
      element.classList.add("swiping");
      element.classList.toggle("swipe-left", lastDx < 0);
      element.classList.toggle("swipe-right", lastDx > 0);
      element.dataset.swipeLabel = lastDx < 0 ? leftLabel : lastDx > 0 ? rightLabel : "";
      element.style.transform = `translateX(${lastDx}px)`;
    },
    { passive: false }
  );

  element.addEventListener(
    "touchend",
    async () => {
      if (!horizontal) {
        reset();
        return;
      }
      const threshold = 58;
      const fireLeft = lastDx <= -threshold;
      const fireRight = lastDx >= threshold;

      element.style.transition = "transform 0.18s ease";
      reset();

      if (fireLeft || fireRight) {
        element.dataset.swipeUntil = String(Date.now() + 260);
      }

      try {
        if (fireLeft && onLeft) {
          await onLeft();
        } else if (fireRight && onRight) {
          await onRight();
        }
      } catch (error) {
        if (error?.message) {
          alert(error.message);
        }
      }
    },
    { passive: true }
  );

  element.addEventListener("touchcancel", reset, { passive: true });
}

function showContextMenu(x, y, items = [], options = {}) {
  if (!items.length) {
    hideContextMenu();
    return;
  }

  els.contextMenu.innerHTML = items
    .map(
      (item, index) =>
        `<button class="context-item ${item.danger ? "danger" : ""}" data-ctx-index="${index}" type="button">${escapeHtml(item.label)}</button>`
    )
    .join("");

  const mobileSheetMode = options.forceFloating ? false : (window.innerWidth <= 900 || isTouchDevice());
  els.contextMenu.classList.remove("hidden");
  els.contextMenu.classList.toggle("mobile-sheet", mobileSheetMode);
  if (mobileSheetMode) {
    els.contextMenu.style.left = "12px";
    els.contextMenu.style.right = "12px";
    els.contextMenu.style.top = "auto";
    els.contextMenu.style.bottom = "12px";
  } else {
    els.contextMenu.style.right = "auto";
    els.contextMenu.style.bottom = "auto";
    const menuRect = els.contextMenu.getBoundingClientRect();
    const maxX = window.innerWidth - menuRect.width - 8;
    const maxY = window.innerHeight - menuRect.height - 8;
    const left = Math.max(8, Math.min(x, maxX));
    const top = Math.max(8, Math.min(y, maxY));
    els.contextMenu.style.left = `${left}px`;
    els.contextMenu.style.top = `${top}px`;
  }

  els.contextMenu.querySelectorAll("[data-ctx-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      const idx = Number(button.dataset.ctxIndex);
      hideContextMenu();
      const action = items[idx];
      if (action?.onClick) {
        try {
          await action.onClick();
        } catch (error) {
          if (error?.message) {
            alert(error.message);
          }
        }
      }
    });
  });
}

function setReply(messageId) {
  const target = getMessageById(messageId);
  if (!target) {
    return;
  }
  state.replyToMessageId = messageId;
  const sender = state.selected?.type === "room" ? target.sender : resolveDmSender(target);
  const preview = target.deletedAt
    ? "Сообщение удалено"
    : target.content || (target.imageUrl ? "[изображение]" : "[сообщение]");
  els.composeMetaText.innerHTML = `<strong>${escapeHtml(sender?.displayName || "")}</strong>: ${escapeHtml(preview.slice(0, 120))}`;
  els.composeMetaText.dataset.replyMsgId = String(messageId);
  els.composeMetaText.title = "Перейти к сообщению";
  els.composeMeta.classList.remove("hidden");
  els.messageInput.focus();
}

function clearReply() {
  state.replyToMessageId = null;
  els.composeMeta.classList.add("hidden");
  els.composeMetaText.textContent = "";
  delete els.composeMetaText.dataset.replyMsgId;
}

async function jumpToMessageInCurrentChat(id, { close = false } = {}) {
  let target = els.messages.querySelector(`[data-msg-id='${id}']`);

  if (!target && ensureMessageInRenderWindow(id)) {
    target = els.messages.querySelector(`[data-msg-id='${id}']`);
  }

  if (!target) {
    for (let i = 0; i < 8 && !target; i += 1) {
      const current = getCurrentMessages();
      if (!current.length) {
        break;
      }
      const oldest = current[0];
      if (state.selected.type === "dm") {
        if (!state.dmHasMoreByUserId.get(state.selected.id)) break;
        await loadDmMessages(state.selected.id, { beforeId: oldest.id, append: true });
      } else {
        if (!state.roomHasMoreByRoomId.get(state.selected.id)) break;
        await loadRoomMessages(state.selected.id, { beforeId: oldest.id, append: true });
      }
      renderMessages();
      target = els.messages.querySelector(`[data-msg-id='${id}']`);
    }
  }

  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("msg-highlight");
    setTimeout(() => target.classList.remove("msg-highlight"), 1400);
    if (close) {
      closeSheet();
    }
  }
}

function setListMode(mode) {
  state.listMode = mode;
  clearReply();
  els.dmTab.classList.toggle("active", mode === "dm");
  els.roomsTab.classList.toggle("active", mode === "room");
  els.roomActions.classList.toggle("hidden", mode !== "room");
  els.roomTools?.classList.toggle("hidden", mode !== "room");
  refreshListFiltersUI();
  renderEntityList();
  updateChatHeader();
  renderMessages();
}

function refreshListFiltersUI() {
  if (!els.listFilters) {
    return;
  }
  els.listFilters.querySelectorAll("[data-list-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.listFilter === state.listFilter);
  });
}

async function updateChatPreference(scope, targetId, patch) {
  await api("/api/chat-prefs", {
    method: "PATCH",
    body: JSON.stringify({ scope, targetId, ...patch }),
  });

  const list = scope === "dm" ? state.users : state.rooms;
  const item = list.find((entry) => Number(entry.id) === Number(targetId));
  if (item) {
    Object.assign(item, patch);
  }

  renderEntityList();
  updateChatHeader();
}

async function loadMe() {
  const data = await api("/api/auth/me");
  state.me = data.user;
}

async function loadUsers() {
  const data = await api("/api/users");
  state.users = data.users || [];
}

async function loadRooms() {
  const data = await api("/api/rooms");
  state.rooms = data.rooms || [];
}

async function loadInvitations() {
  const data = await api("/api/invitations");
  state.invitations = data.invitations || [];
}

function invitationCount() {
  return state.invitations.length;
}

function refreshInvitationsButton() {
  if (!els.invitationsBtn) {
    return;
  }
  const count = invitationCount();
  els.invitationsBtn.innerHTML = count > 0 ? `Приглашения <span class="btn-badge">${count > 99 ? "99+" : count}</span>` : "Приглашения";
  if (els.menuInvitesBadge) {
    els.menuInvitesBadge.classList.toggle("hidden", count <= 0);
    els.menuInvitesBadge.textContent = count > 99 ? "99+" : String(count);
  }
}

function renderMe() {
  if (!state.me) {
    return;
  }
  els.meAvatar.innerHTML = avatarMarkup(state.me);
  els.meName.textContent = `${state.me.displayName}${state.me.isAdmin ? " · ADMIN" : ""}`;
  els.meUsername.textContent = `@${state.me.username}`;
  if (els.menuMeAvatar) {
    els.menuMeAvatar.innerHTML = avatarMarkup(state.me);
  }
  if (els.menuMeName) {
    els.menuMeName.textContent = state.me.displayName;
  }
  if (els.menuMeUsername) {
    els.menuMeUsername.textContent = `@${state.me.username}${state.me.isAdmin ? " · admin" : ""}`;
  }
  if (els.menuAdminBtn) {
    els.menuAdminBtn.classList.toggle("hidden", !state.me.isAdmin);
  }
}

function passesListFilter(entry) {
  if (state.listFilter === "archived") {
    return Boolean(entry.archived);
  }
  if (entry.archived) {
    return false;
  }
  if (state.listFilter === "unread") {
    return Number(entry.unreadCount || 0) > 0;
  }
  return true;
}

function filteredUsers() {
  const q = state.search.toLowerCase();
  let list = state.users.filter((user) => {
    if (!passesListFilter(user)) {
      return false;
    }
    if (!q) {
      return true;
    }
    const text = `${user.displayName} ${user.username}`.toLowerCase();
    return text.includes(q);
  });

  list = list.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    if (Number(a.unreadCount || 0) !== Number(b.unreadCount || 0)) {
      return Number(b.unreadCount || 0) - Number(a.unreadCount || 0);
    }
    const aTime = a.lastMessageAt ? new Date(String(a.lastMessageAt).replace(" ", "T") + "Z").getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(String(b.lastMessageAt).replace(" ", "T") + "Z").getTime() : 0;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return String(a.displayName).localeCompare(String(b.displayName), "ru");
  });

  return list;
}

function filteredRooms() {
  const q = state.search.toLowerCase();
  let list = state.rooms.filter((room) => {
    if (!passesListFilter(room)) {
      return false;
    }
    if (!q) {
      return true;
    }
    return room.name.toLowerCase().includes(q);
  });

  list = list.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    if (Number(a.unreadCount || 0) !== Number(b.unreadCount || 0)) {
      return Number(b.unreadCount || 0) - Number(a.unreadCount || 0);
    }
    const aTime = a.lastMessageAt ? new Date(String(a.lastMessageAt).replace(" ", "T") + "Z").getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(String(b.lastMessageAt).replace(" ", "T") + "Z").getTime() : 0;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return String(a.name).localeCompare(String(b.name), "ru");
  });

  return list;
}

function messagePreviewText(message) {
  if (!message) {
    return "";
  }
  const base = String(message.content || "").trim();
  if (message.type === "image") {
    return base || "[изображение]";
  }
  if (message.type === "poll") {
    return base || "[опрос]";
  }
  if (message.type === "file") {
    return message.fileName || "[файл]";
  }
  return base;
}

function touchDmPreviewFromMessage(message, { incrementUnread = false } = {}) {
  const peerId = message.senderId === state.me?.id ? message.receiverId : message.senderId;
  const user = state.users.find((item) => item.id === peerId);
  if (!user) {
    return;
  }
  user.lastMessage = messagePreviewText(message);
  user.lastFileName = message.fileName || user.lastFileName || "";
  user.lastMessageType = message.type || "text";
  user.lastMessageAt = message.createdAt || user.lastMessageAt;
  if (incrementUnread) {
    user.unreadCount = Number(user.unreadCount || 0) + 1;
  }
}

function touchRoomPreviewFromMessage(message, { incrementUnread = false } = {}) {
  const room = state.rooms.find((item) => item.id === message.roomId);
  if (!room) {
    return;
  }
  room.lastMessage = messagePreviewText(message);
  room.lastMessageType = message.type || "text";
  room.lastMessageAt = message.createdAt || room.lastMessageAt;
  if (incrementUnread) {
    room.unreadCount = Number(room.unreadCount || 0) + 1;
  }
}

function buildDmContextItems(user) {
  return [
    { label: "Открыть диалог", onClick: async () => selectDm(user.id) },
    {
      label: user.pinned ? "Открепить" : "Закрепить",
      onClick: async () => updateChatPreference("dm", user.id, { pinned: !user.pinned }),
    },
    {
      label: user.muted ? "Включить звук" : "Без звука",
      onClick: async () => updateChatPreference("dm", user.id, { muted: !user.muted }),
    },
    {
      label: user.archived ? "Вернуть из архива" : "В архив",
      onClick: async () => updateChatPreference("dm", user.id, { archived: !user.archived }),
    },
    { label: "Очистить диалог", danger: true, onClick: async () => clearDialogWithUser(user.id) },
  ];
}

function buildRoomContextItems(room) {
  const canDeleteRoom = state.me?.isAdmin || room.createdBy === state.me?.id || room.canOwn;
  const items = [{ label: "Открыть комнату", onClick: async () => selectRoom(room.id) }];
  items.push({
    label: room.pinned ? "Открепить" : "Закрепить",
    onClick: async () => updateChatPreference("room", room.id, { pinned: !room.pinned }),
  });
  items.push({
    label: room.muted ? "Включить звук" : "Без звука",
    onClick: async () => updateChatPreference("room", room.id, { muted: !room.muted }),
  });
  items.push({
    label: room.archived ? "Вернуть из архива" : "В архив",
    onClick: async () => updateChatPreference("room", room.id, { archived: !room.archived }),
  });
  if (!room.joined && isPrivateRoom(room)) {
    items.push({
      label: room.hasJoinRequest ? "Заявка отправлена" : "Запросить доступ",
      onClick: async () => {
        if (room.hasJoinRequest) {
          showToast("Заявка уже отправлена", "info");
          return;
        }
        await api(`/api/rooms/${room.id}/request-join`, { method: "POST" });
        await loadRooms();
        renderEntityList();
        showToast("Заявка на вступление отправлена", "success");
      },
    });
  }
  if (canDeleteRoom) {
    items.push({ label: "Удалить комнату", danger: true, onClick: async () => deleteRoom(room.id) });
  }
  return items;
}

function renderEntityList() {
  els.entityList.innerHTML = "";
  if (els.roomToolsMeta) {
    const roomCount = state.rooms.filter((room) => !room.archived).length;
    const inviteCount = invitationCount();
    els.roomToolsMeta.textContent = inviteCount ? `${roomCount} комнат · ${inviteCount} приглаш.` : `${roomCount} комнат доступно`;
  }
  if (state.listMode === "dm") {
    const users = filteredUsers();
    if (!users.length) {
      const label = state.listFilter === "archived" ? "Архив пуст" : "Никого не найдено";
      els.entityList.innerHTML = `<li class='empty-panel'><strong>${label}</strong><p class='msg-time'>${state.search ? "Попробуйте изменить запрос поиска" : "Откройте контакты или дождитесь нового диалога"}</p></li>`;
      return;
    }

    for (const user of users) {
      const li = document.createElement("li");
      li.className = "chat-item";
      li.classList.toggle("active", state.selected?.type === "dm" && state.selected.id === user.id);
      const secondary = user.lastMessageAt
      ? `${user.lastMessageType === "image" ? `${iconMarkup("image", "inline-icon")}` : user.lastMessageType === "poll" ? `${iconMarkup("poll", "inline-icon")}` : user.lastMessageType === "file" ? `${iconMarkup("room", "inline-icon")}` : ""}${escapeHtml((user.lastMessageType === "file" ? (user.lastFileName || user.lastMessage) : user.lastMessage || "").slice(0, 52) || "[медиа]")}`
        : `@${escapeHtml(user.username)} · ${escapeHtml(presenceLabel(user))}`;
      li.innerHTML = `
        <div class="avatar">${avatarMarkup(user)}</div>
        <div class="chat-item-main">
          <div class="room-card-headline">
            <strong>${escapeHtml(user.displayName)}${user.isAdmin ? " 👑" : ""}</strong>
            <span class="msg-time">${user.lastMessageAt ? formatTime(user.lastMessageAt) : presenceLabel(user)}</span>
          </div>
          <div class="room-card-badges">
            <span class="chat-item-badge dm">dialog</span>
            ${state.onlineIds.has(user.id) ? `<span class="chat-item-badge online">online</span>` : `<span class="chat-item-badge dm">last seen</span>`}
            ${user.isAdmin ? `<span class="chat-item-badge manage">admin</span>` : ""}
          </div>
          <p>${secondary}</p>
        </div>
        <div class="chat-item-tail">
          ${user.pinned ? `<span class="chat-mini-flag">${iconMarkup("pin", "xs")}</span>` : ""}
          ${user.muted ? `<span class="chat-mini-flag">${iconMarkup("mute", "xs")}</span>` : ""}
          ${user.unreadCount ? `<span class="chat-unread">${user.unreadCount > 99 ? "99+" : user.unreadCount}</span>` : ""}
          <span class="chat-item-arrow">${iconMarkup("arrowRight", "xs")}</span>
          <button type="button" class="chat-more-btn" data-item-menu="dm" aria-label="Действия">${iconMarkup("more", "xs")}</button>
        </div>
      `;
      li.addEventListener("click", () => {
        const blockedUntil = Number(li.dataset.swipeUntil || 0);
        if (blockedUntil > Date.now()) {
          return;
        }
        selectDm(user.id);
      });
      li.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showContextMenu(event.clientX, event.clientY, buildDmContextItems(user));
      });
      attachLongPress(li, (x, y) => {
        showContextMenu(x, y, buildDmContextItems(user));
      });
      li.querySelector("[data-item-menu='dm']")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        showContextMenu(rect.right, rect.bottom + 6, buildDmContextItems(user));
      });
      attachSwipeActions(li, {
        leftLabel: user.archived ? "Вернуть" : "В архив",
        rightLabel: user.pinned ? "Открепить" : "Закрепить",
        onLeft: async () => updateChatPreference("dm", user.id, { archived: !user.archived }),
        onRight: async () => updateChatPreference("dm", user.id, { pinned: !user.pinned }),
      });
      els.entityList.appendChild(li);
    }
    return;
  }

  const rooms = filteredRooms();
  if (!rooms.length) {
    const label = state.listFilter === "archived" ? "Архив комнат пуст" : "Комнаты не найдены";
    els.entityList.innerHTML = `<li class='empty-panel'><strong>${label}</strong><p class='msg-time'>${state.search ? "Попробуйте изменить запрос поиска" : "Создайте комнату или примите приглашение"}</p></li>`;
    return;
  }

  for (const room of rooms) {
    const li = document.createElement("li");
    li.className = "chat-item";
    li.classList.toggle("active", state.selected?.type === "room" && state.selected.id === room.id);
    const icon = room.avatarUrl ? `<img src="${escapeHtml(room.avatarUrl)}" alt="${escapeHtml(room.name)}" />` : (isPrivateRoom(room) ? iconMarkup("lock") : iconMarkup("room"));
    const secondary = room.lastMessageAt
      ? `${room.lastMessageType === "image" ? `${iconMarkup("image", "inline-icon")}` : room.lastMessageType === "poll" ? `${iconMarkup("poll", "inline-icon")}` : ""}${escapeHtml((room.lastMessage || "").slice(0, 52) || "[медиа]")}`
      : room.description
        ? escapeHtml(room.description.slice(0, 60))
      : room.joined
        ? `Участников: ${room.membersCount}`
        : room.hasInvitation
          ? "Есть приглашение"
          : room.hasJoinRequest
            ? "Заявка отправлена"
            : "Запроси приглашение";
    li.innerHTML = `
      <div class="avatar">${icon}</div>
      <div class="chat-item-main">
        <div class="room-card-headline">
          <strong>${escapeHtml(room.name)}</strong>
          <span class="msg-time">${room.lastMessageAt ? formatTime(room.lastMessageAt) : room.joined ? "активно" : "новая"}</span>
        </div>
        <div class="room-card-badges">
          <span class="chat-item-badge ${isPrivateRoom(room) ? "lock" : "public"}">${isPrivateRoom(room) ? "private" : "public"}</span>
          ${room.hasInvitation ? `<span class="chat-item-badge invitation">invite</span>` : room.hasJoinRequest ? `<span class="chat-item-badge invitation">requested</span>` : ""}
          ${room.canManage ? `<span class="chat-item-badge manage">manage</span>` : ""}
        </div>
        <p>${secondary}</p>
      </div>
      <div class="chat-item-tail">
        ${room.pinned ? `<span class="chat-mini-flag">${iconMarkup("pin", "xs")}</span>` : ""}
        ${room.muted ? `<span class="chat-mini-flag">${iconMarkup("mute", "xs")}</span>` : ""}
        ${room.unreadCount ? `<span class="chat-unread">${room.unreadCount > 99 ? "99+" : room.unreadCount}</span>` : ""}
        <span class="chat-item-arrow">${room.joined ? iconMarkup("arrowRight", "xs") : iconMarkup("plus", "xs")}</span>
        <button type="button" class="chat-more-btn" data-item-menu="room" aria-label="Действия">${iconMarkup("more", "xs")}</button>
      </div>
    `;
    li.addEventListener("click", () => {
      const blockedUntil = Number(li.dataset.swipeUntil || 0);
      if (blockedUntil > Date.now()) {
        return;
      }
      selectRoom(room.id);
    });
    li.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, buildRoomContextItems(room));
    });
    attachLongPress(li, (x, y) => {
      showContextMenu(x, y, buildRoomContextItems(room));
    });
    li.querySelector("[data-item-menu='room']")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      showContextMenu(rect.right, rect.bottom + 6, buildRoomContextItems(room));
    });
    attachSwipeActions(li, {
      leftLabel: room.archived ? "Вернуть" : "В архив",
      rightLabel: room.pinned ? "Открепить" : "Закрепить",
      onLeft: async () => updateChatPreference("room", room.id, { archived: !room.archived }),
      onRight: async () => updateChatPreference("room", room.id, { pinned: !room.pinned }),
    });
    els.entityList.appendChild(li);
  }
}

function getCurrentMessages() {
  if (!state.selected) {
    return [];
  }
  if (state.selected.type === "dm") {
    return state.dmMessagesByUserId.get(state.selected.id) || [];
  }
  return state.roomMessagesByRoomId.get(state.selected.id) || [];
}

function getMessageById(messageId) {
  return getCurrentMessages().find((message) => message.id === messageId) || null;
}

function resolveDmSender(message) {
  if (message.senderId === state.me.id) {
    return state.me;
  }
  return (
    state.users.find((user) => user.id === message.senderId) || {
      displayName: "Unknown",
      username: "unknown",
      avatarUrl: "",
      isAdmin: false,
    }
  );
}

function isNearBottom(threshold = 72) {
  const distance = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  return distance <= threshold;
}

function chatKey(scope, id) {
  return `${scope}:${id}`;
}

function selectedChatKey() {
  if (!state.selected) {
    return "";
  }
  return chatKey(state.selected.type === "room" ? "room" : "dm", state.selected.id);
}

function getRenderWindowStart(key, total) {
  const current = Number(state.renderWindowStartByChatKey.get(key) || 0);
  const maxStart = Math.max(0, total - DOM_WINDOW_SIZE);
  return Math.max(0, Math.min(current, maxStart));
}

function resetRenderWindowForSelectedToBottom() {
  const key = selectedChatKey();
  if (!key) {
    return;
  }
  const total = getCurrentMessages().length;
  state.renderWindowStartByChatKey.set(key, Math.max(0, total - DOM_WINDOW_SIZE));
}

function ensureMessageInRenderWindow(messageId) {
  const key = selectedChatKey();
  if (!key || !messageId) {
    return false;
  }
  const messages = getCurrentMessages();
  const index = messages.findIndex((item) => item.id === messageId);
  if (index < 0) {
    return false;
  }
  const nextStart = Math.max(0, index - 40);
  state.renderWindowStartByChatKey.set(key, nextStart);
  renderMessages();
  return true;
}

function clearUnseenForKey(key) {
  if (!key) {
    return;
  }
  state.unseenStartByChatKey.delete(key);
  state.unseenCountByChatKey.delete(key);
}

function refreshJumpBottomButton() {
  if (!els.jumpBottomBtn) {
    return;
  }
  const key = selectedChatKey();
  const unseen = Number(state.unseenCountByChatKey.get(key) || 0);
  const hasMessages = getCurrentMessages().length > 0;
  const show = Boolean(state.selected) && hasMessages && !isNearBottom(96);
  els.jumpBottomBtn.classList.toggle("hidden", !show);
  els.jumpBottomBtn.textContent = unseen > 0 ? `Новые ${unseen} ↓` : "Вниз ↓";
}

function refreshStickyDayLabel() {
  if (!els.stickyDayLabel) {
    return;
  }
  const separators = Array.from(els.messages.querySelectorAll(".date-separator.day-separator"));
  if (!separators.length) {
    els.stickyDayLabel.classList.add("hidden");
    return;
  }

  const scrollTop = els.messages.scrollTop;
  const canScroll = els.messages.scrollHeight - els.messages.clientHeight > 20;
  if (!canScroll) {
    els.stickyDayLabel.classList.add("hidden");
    return;
  }

  let active = separators[0];
  for (const separator of separators) {
    if (separator.offsetTop - scrollTop <= 18) {
      active = separator;
    } else {
      break;
    }
  }

  const label = active.dataset.dayLabel || active.textContent || "";
  if (!label) {
    els.stickyDayLabel.classList.add("hidden");
    return;
  }

  els.stickyDayLabel.textContent = label;
  els.stickyDayLabel.classList.remove("hidden");
}

function scrollMessagesToBottom(smooth = false) {
  els.messages.scrollTo({
    top: els.messages.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
  clearUnseenForKey(selectedChatKey());
  refreshJumpBottomButton();
  refreshStickyDayLabel();
}

function scheduleRenderMessages({ forceBottom = false } = {}) {
  renderScheduledForceBottom = renderScheduledForceBottom || forceBottom;
  if (renderScheduled) {
    return;
  }
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    const shouldForceBottom = renderScheduledForceBottom;
    renderScheduledForceBottom = false;
    renderMessages({ forceBottom: shouldForceBottom });
  });
}

function renderPoll(poll) {
  if (!poll) {
    return "";
  }
  const options = poll.options
    .map(
      (option) => `
      <button class="poll-option ${option.votedByMe ? "voted" : ""}" data-poll-id="${poll.id}" data-option-id="${option.id}" type="button">
        ${escapeHtml(option.text)} · ${option.votes}
      </button>
    `
    )
    .join("");
  const totalVotes = poll.options.reduce((sum, item) => sum + item.votes, 0);
  const canClose = !poll.isClosed && (state.me?.isAdmin || poll.creatorId === state.me?.id);

  return `
    <div class="poll-box">
      <strong>${escapeHtml(poll.question)}</strong>
      ${options}
      <span class="msg-time">Голосов: ${totalVotes}${poll.isClosed ? " · закрыт" : ""}</span>
      ${canClose ? `<button class="ghost" data-close-poll="${poll.id}" type="button">Закрыть опрос</button>` : ""}
    </div>
  `;
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKind(name) {
  const ext = String(name || "").toLowerCase().split('.').pop() || "";
  if (["pdf"].includes(ext)) return "PDF";
  if (["doc", "docx"].includes(ext)) return "DOC";
  if (["xls", "xlsx", "csv"].includes(ext)) return "XLS";
  if (["zip", "7z", "rar"].includes(ext)) return "ZIP";
  if (["txt"].includes(ext)) return "TXT";
  return "FILE";
}

function renderFileMessage(message) {
  if (!message.fileUrl || message.deletedAt) {
    return "";
  }
  const kind = fileKind(message.fileName);
  return `
    <div class="file-box">
      <div class="file-kind-badge kind-${escapeHtml(kind.toLowerCase())}">${escapeHtml(kind)}</div>
      <div class="file-box-main">
        <strong>${escapeHtml(message.fileName || "Файл")}</strong>
        <p class="msg-time">${escapeHtml(formatFileSize(message.fileSize) || "Документ")} · документ</p>
      </div>
      <div class="file-box-actions">
        <a class="ghost compact-btn" href="${escapeHtml(message.fileUrl)}" target="_blank" rel="noopener noreferrer">Открыть</a>
        <button class="ghost compact-btn" type="button" data-copy-file-link="${escapeHtml(message.fileUrl)}">Копия</button>
      </div>
    </div>
  `;
}


function renderMessages({ forceBottom = false } = {}) {
  const prevDistanceFromBottom =
    els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  const wasNearBottom = prevDistanceFromBottom <= 72;
  els.messages.innerHTML = "";
  refreshSelectionBar();

  if (!state.selected) {
    els.messages.innerHTML = `<div class="empty-chat-state"><strong>Выберите чат</strong><p class="msg-time">Личные диалоги, комнаты и приглашения появятся здесь. Начните с контактов или списка комнат.</p></div>`;
    refreshJumpBottomButton();
    refreshStickyDayLabel();
    return;
  }

  if (state.selected?.type === "dm") {
    const pinned = state.pinnedByDialogId.get(state.selected.id);
    if (pinned && !pinned.deletedAt) {
      const pin = document.createElement("div");
      pin.className = "pinned-banner";
      pin.innerHTML = `<strong>${iconMarkup("pin", "xs")}</strong> ${escapeHtml((pinned.content || "[медиа/опрос]").slice(0, 180))}`;
      pin.addEventListener("click", () => {
        const target = els.messages.querySelector(`[data-msg-id='${pinned.id}']`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
      els.messages.appendChild(pin);
    }
  }

  if (state.selected?.type === "room") {
    const pinned = state.pinnedByRoomId.get(state.selected.id);
    if (pinned && !pinned.deletedAt) {
      const pin = document.createElement("div");
      pin.className = "pinned-banner";
      pin.innerHTML = `<strong>${iconMarkup("pin", "xs")}</strong> ${escapeHtml((pinned.content || "[медиа/опрос]").slice(0, 180))}`;
      pin.addEventListener("click", () => {
        const target = els.messages.querySelector(`[data-msg-id='${pinned.id}']`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
      els.messages.appendChild(pin);
    }
  }

  const allMessages = getCurrentMessages();
  const key = selectedChatKey();
  let start = getRenderWindowStart(key, allMessages.length);
  if (forceBottom || wasNearBottom) {
    start = Math.max(0, allMessages.length - DOM_WINDOW_SIZE);
    if (key) {
      state.renderWindowStartByChatKey.set(key, start);
    }
  }
  const messages = allMessages.slice(start);
  if (!messages.length) {
    const title = state.selected.type === "room" ? "В комнате пока тихо" : "Диалог пока пуст";
    const hint = state.selected.type === "room"
      ? "Напишите первое сообщение, чтобы начать обсуждение."
      : "Отправьте первое сообщение и начните разговор.";
    els.messages.innerHTML = `<div class="empty-chat-state"><strong>${title}</strong><p class="msg-time">${hint}</p></div>`;
    refreshJumpBottomButton();
    refreshStickyDayLabel();
    return;
  }
  const peerReadAt = state.selected?.type === "dm" ? asUtcMs(state.dmReadByPeerId.get(state.selected.id)) : 0;
  const unreadStartId = Number(state.unseenStartByChatKey.get(selectedChatKey()) || 0);
  let prevMessage = null;
  let prevDayKey = "";
  for (const message of messages) {
    const createdAtKeyMs = asUtcMs(message.createdAt);
    const dayKey = createdAtKeyMs ? new Date(createdAtKeyMs).toISOString().slice(0, 10) : "";
    if (dayKey && dayKey !== prevDayKey) {
      const divider = document.createElement("div");
      const dayLabel = formatDayLabel(message.createdAt);
      divider.className = "date-separator day-separator";
      divider.textContent = dayLabel;
      divider.dataset.dayLabel = dayLabel;
      els.messages.appendChild(divider);
      prevDayKey = dayKey;
    }

    if (unreadStartId && message.id === unreadStartId) {
      const unreadDivider = document.createElement("div");
      unreadDivider.className = "date-separator unread-separator";
      unreadDivider.textContent = "Новые сообщения";
      els.messages.appendChild(unreadDivider);
    }

    const mine = message.senderId === state.me.id;
    const sender = state.selected?.type === "room" ? message.sender : resolveDmSender(message);
    const replyTarget = message.replyToMessageId ? getMessageById(message.replyToMessageId) : null;
    const replyPreview = replyTarget
      ? replyTarget.deletedAt
        ? "Сообщение удалено"
        : replyTarget.content || (replyTarget.imageUrl ? "[изображение]" : "[сообщение]")
      : "";

    const node = document.createElement("article");
    const createdAtMs = asUtcMs(message.createdAt);
    const prevAtMs = asUtcMs(prevMessage?.createdAt);
    const grouped =
      Boolean(prevMessage) &&
      prevMessage.senderId === message.senderId &&
      createdAtMs &&
      prevAtMs &&
      createdAtMs - prevAtMs < 5 * 60 * 1000 &&
      !replyTarget;

    const isNewlyArrived = state.newlyArrivedMessageIds.has(message.id);
    const selected = state.selectedMessageIds.has(message.id);
    node.className = `msg ${mine ? "mine" : ""} ${message.deletedAt ? "deleted" : ""} ${grouped ? "grouped" : ""} ${isNewlyArrived ? "new-appear" : ""} ${selected ? "selected" : ""}`;
    node.setAttribute("data-msg-id", String(message.id));
    const readMark =
      state.selected?.type === "dm" && mine
        ? `<span class="msg-read">${createdAtMs && peerReadAt && createdAtMs <= peerReadAt ? "✓✓" : "✓"}</span>`
        : "";
    node.innerHTML = `
      ${selected ? `<div class="msg-select-marker">${iconMarkup("arrowRight", "xs")}</div>` : ""}
      <div class="msg-head ${grouped ? "hidden" : ""}">
        <span class="msg-author">${escapeHtml(sender.displayName)}${sender.isAdmin ? " 👑" : ""}</span>
        <span class="msg-time">#${message.id}</span>
      </div>
      ${message.forwardedFromName ? `<div class="msg-forwarded">${iconMarkup("arrowRight", "xs")}<span>Forwarded from ${escapeHtml(message.forwardedFromName)}</span></div>` : ""}
      ${replyTarget ? `<div class="msg-reply">${escapeHtml(replyPreview.slice(0, 120))}</div>` : ""}
      <div class="msg-text">${message.deletedAt ? "Сообщение удалено" : renderMessageText(message.content || "")}</div>
      ${!message.deletedAt && message.imageUrl ? `<img class="msg-image" src="${escapeHtml(message.imageUrl)}" alt="image" />` : ""}
      ${!message.deletedAt ? renderFileMessage(message) : ""}
      ${!message.deletedAt ? renderPoll(message.poll) : ""}
      <div class="reactions">
        ${(message.reactions || [])
          .map(
            (reaction) =>
              `<button class="reaction-chip ${reaction.reactedByMe ? "me" : ""}" data-react-msg="${message.id}" data-react-emoji="${escapeHtml(reaction.emoji)}" type="button">${escapeHtml(reaction.emoji)} ${reaction.count}</button>`
          )
          .join("")}
      </div>
      <div class="msg-meta">
        <span class="msg-time">${formatTime(message.createdAt)}${message.editedAt ? " · edited" : ""}</span>
        ${readMark}
      </div>
    `;
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMessageActions(message.id, event.clientX, event.clientY);
    });
    attachLongPress(node, (x, y) => {
      if (!state.selectionMode) {
        toggleMessageSelection(message.id);
        return;
      }
      openMessageActions(message.id, x, y);
    });
    node.addEventListener("click", (event) => {
      if (state.selectionMode) {
        event.preventDefault();
        toggleMessageSelection(message.id);
      }
    });
    els.messages.appendChild(node);
    if (isNewlyArrived) {
      setTimeout(() => {
        node.classList.remove("new-appear");
      }, 420);
      state.newlyArrivedMessageIds.delete(message.id);
    }
    prevMessage = message;
  }

  els.messages.querySelectorAll("[data-react-msg]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.reactMsg);
      const emoji = button.dataset.reactEmoji;
      await toggleReaction(id, emoji);
    });
  });

  els.messages.querySelectorAll("[data-poll-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const pollId = Number(button.dataset.pollId);
      const optionId = Number(button.dataset.optionId);
      const message = getCurrentMessages().find((item) => item.poll?.id === pollId);
      if (!message?.poll) {
        return;
      }
      await votePoll(message.poll, optionId);
    });
  });

  els.messages.querySelectorAll("[data-close-poll]").forEach((button) => {
    button.addEventListener("click", async () => closePoll(Number(button.dataset.closePoll)));
  });

  els.messages.querySelectorAll(".msg-image").forEach((img) => {
    img.addEventListener("click", () => {
      openImageViewer(img.getAttribute("src") || "");
    });
  });

  els.messages.querySelectorAll("[data-copy-file-link]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const value = String(button.dataset.copyFileLink || "");
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        showToast("Ссылка на файл скопирована", "success");
      } catch {
        showToast(value, "info");
      }
    });
  });

  if (forceBottom || wasNearBottom) {
    els.messages.scrollTop = els.messages.scrollHeight;
  } else {
    const nextTop = els.messages.scrollHeight - els.messages.clientHeight - prevDistanceFromBottom;
    els.messages.scrollTop = Math.max(0, nextTop);
  }
  refreshJumpBottomButton();
  refreshStickyDayLabel();
}

async function loadOlderMessagesIfNeeded() {
  if (state.loadingOlder || !state.selected) {
    return;
  }

  const messages = getCurrentMessages();
  if (!messages.length) {
    return;
  }

  const oldest = messages[0];
  if (!oldest?.id) {
    return;
  }

  if (state.selected.type === "dm") {
    if (!state.dmHasMoreByUserId.get(state.selected.id)) {
      return;
    }
    state.loadingOlder = true;
    const prevHeight = els.messages.scrollHeight;
    await loadDmMessages(state.selected.id, { beforeId: oldest.id, append: true });
    renderMessages();
    els.messages.scrollTop = els.messages.scrollHeight - prevHeight;
    state.loadingOlder = false;
    return;
  }

  if (!state.roomHasMoreByRoomId.get(state.selected.id)) {
    return;
  }
  state.loadingOlder = true;
  const prevHeight = els.messages.scrollHeight;
  await loadRoomMessages(state.selected.id, { beforeId: oldest.id, append: true });
  renderMessages();
  els.messages.scrollTop = els.messages.scrollHeight - prevHeight;
  state.loadingOlder = false;
}

function expandRenderWindowBackwardIfNeeded() {
  if (!state.selected) {
    return false;
  }
  const key = selectedChatKey();
  if (!key) {
    return false;
  }
  const all = getCurrentMessages();
  const start = getRenderWindowStart(key, all.length);
  if (start <= 0) {
    return false;
  }

  const oldTop = els.messages.scrollTop;
  const oldHeight = els.messages.scrollHeight;
  state.renderWindowStartByChatKey.set(key, Math.max(0, start - DOM_WINDOW_STEP));
  renderMessages();
  const delta = els.messages.scrollHeight - oldHeight;
  els.messages.scrollTop = Math.max(0, oldTop + delta);
  return true;
}

function updateChatHeader() {
  const chatHead = document.querySelector('.chat-head');
  els.chatActionsBtn.classList.add("hidden");
  els.selectionAllBtn?.classList.add("hidden");
  els.selectionCopyBtn?.classList.add("hidden");
  els.selectionForwardBtn?.classList.add("hidden");
  els.selectionDeleteBtn?.classList.add("hidden");
  els.selectionClearBtn?.classList.add("hidden");
  els.chatHeadMain?.classList.remove("clickable");
  chatHead?.classList.remove('selection-mode');
  if (!state.selected) {
    els.chatTitle.textContent = "Выберите чат";
    els.chatStatus.textContent = "Личные и групповые диалоги";
    els.chatHeadAvatar.innerHTML = iconMarkup("chat");
    els.messageInput.disabled = true;
    els.sendBtn.disabled = true;
    return;
  }

  if (state.selectionMode && state.selectedMessageIds.size) {
    const loadedCount = getCurrentMessages().length;
    chatHead?.classList.add('selection-mode');
    els.chatTitle.textContent = `${state.selectedMessageIds.size} выбрано`;
    els.chatStatus.textContent = loadedCount ? `${state.selectedMessageIds.size} из ${loadedCount} загруженных` : "Режим выбора сообщений";
    els.chatHeadAvatar.innerHTML = iconMarkup("chat");
    els.selectionAllBtn?.classList.remove("hidden");
    if (els.selectionAllBtn) {
      els.selectionAllBtn.textContent = allLoadedMessagesSelected() ? "Снять все" : "Выбрать все";
    }
    els.selectionCopyBtn?.classList.remove("hidden");
    els.selectionForwardBtn?.classList.remove("hidden");
    els.selectionDeleteBtn?.classList.remove("hidden");
    els.selectionClearBtn?.classList.remove("hidden");
    return;
  }

  els.chatActionsBtn.classList.remove("hidden");

  if (state.selected.type === "dm") {
    const user = state.users.find((item) => item.id === state.selected.id);
    if (!user) {
      return;
    }
    els.chatHeadMain?.classList.add("clickable");
    els.chatTitle.textContent = user.displayName;
    els.chatStatus.textContent = resolveTypingStatus(state.onlineIds.has(user.id) ? "В сети" : "Не в сети");
    els.chatHeadAvatar.innerHTML = avatarMarkup(user);
    els.messageInput.disabled = false;
    els.sendBtn.disabled = false;
    return;
  }

  const room = state.rooms.find((item) => item.id === state.selected.id);
  if (!room) {
    return;
  }
  els.chatHeadMain?.classList.add("clickable");
  els.chatTitle.textContent = `# ${room.name}`;
  const roomBaseStatus = room.joined
    ? `${room.description ? room.description.slice(0, 80) : `Участников: ${room.membersCount}`}`
    : "Нажми, чтобы войти";
  els.chatStatus.textContent = resolveTypingStatus(roomBaseStatus);
  els.chatHeadAvatar.innerHTML = room.avatarUrl
    ? `<img src="${escapeHtml(room.avatarUrl)}" alt="${escapeHtml(room.name)}" />`
    : (isPrivateRoom(room) ? iconMarkup("lock") : iconMarkup("room"));
  const canPost = room.joined && room.canPost !== false;
  els.messageInput.disabled = !canPost;
  els.sendBtn.disabled = !canPost;
  if (room.joined && room.canPost === false) {
    els.chatStatus.textContent = resolveTypingStatus("Писать могут только админы комнаты");
  }
}

async function loadDmMessages(userId, { beforeId = null, append = false } = {}) {
  const query = new URLSearchParams({ limit: "60" });
  if (beforeId) {
    query.set("beforeId", String(beforeId));
  }
  const data = await api(`/api/messages/${userId}?${query.toString()}`);
  const incoming = data.messages || [];
  const current = state.dmMessagesByUserId.get(userId) || [];
  const next = append ? [...incoming, ...current] : incoming;
  state.dmMessagesByUserId.set(userId, next);
  state.dmHasMoreByUserId.set(userId, Boolean(data.hasMore));
  state.pinnedByDialogId.set(userId, data.pinned || null);
  if (!append || data.peerLastReadAt) {
    state.dmReadByPeerId.set(userId, data.peerLastReadAt || null);
  }
  const user = state.users.find((item) => item.id === userId);
  if (user) {
    user.unreadCount = 0;
  }
  if (!append) {
    state.renderWindowStartByChatKey.set(chatKey("dm", userId), Math.max(0, next.length - DOM_WINDOW_SIZE));
  }
  return incoming.length;
}

async function loadRoomMessages(roomId, { beforeId = null, append = false } = {}) {
  const query = new URLSearchParams({ limit: "60" });
  if (beforeId) {
    query.set("beforeId", String(beforeId));
  }
  const data = await api(`/api/rooms/${roomId}/messages?${query.toString()}`);
  const incoming = data.messages || [];
  const current = state.roomMessagesByRoomId.get(roomId) || [];
  const next = append ? [...incoming, ...current] : incoming;
  state.roomMessagesByRoomId.set(roomId, next);
  state.roomHasMoreByRoomId.set(roomId, Boolean(data.hasMore));
  state.pinnedByRoomId.set(roomId, data.pinned || null);
  const room = state.rooms.find((item) => item.id === roomId);
  if (room) {
    room.unreadCount = 0;
  }
  if (!append) {
    state.renderWindowStartByChatKey.set(chatKey("room", roomId), Math.max(0, next.length - DOM_WINDOW_SIZE));
  }
  return incoming.length;
}

async function selectDm(userId) {
  try {
    stopTypingEmit();
    clearPendingImage();
    clearReply();
    state.selected = { type: "dm", id: userId };
    clearUnseenForKey(selectedChatKey());
    renderEntityList();
    updateChatHeader();
    await loadDmMessages(userId);
    renderEntityList();
    updateChatHeader();
    renderMessages({ forceBottom: true });
    closeLeftPanel();
  } catch (error) {
    alert(error.message);
  }
}

async function selectRoom(roomId) {
  try {
    stopTypingEmit();
    clearPendingImage();
    const room = state.rooms.find((item) => item.id === roomId);
    if (!room) {
      return;
    }

    if (!room.joined) {
      if (isPrivateRoom(room)) {
        try {
          await api(`/api/rooms/${roomId}/join`, { method: "POST" });
          await loadRooms();
        } catch (error) {
          openSheet(
            "Закрытая комната",
            room.hasJoinRequest ? "" : "Отправить заявку",
            `<div class="stack"><p>Вход в эту комнату только по персональному приглашению.</p><p class="msg-time">Попроси владельца комнаты или администратора отправить приглашение, либо отправь заявку на вступление.</p></div>`,
            async () => {
              await api(`/api/rooms/${roomId}/request-join`, { method: "POST" });
              await loadRooms();
              renderEntityList();
              showToast("Заявка на вступление отправлена", "success");
            }
          );
          return;
        }
      } else {
        await api(`/api/rooms/${roomId}/join`, { method: "POST" });
        await loadRooms();
      }
    }

    clearReply();
    state.selected = { type: "room", id: roomId };
    clearUnseenForKey(selectedChatKey());
    renderEntityList();
    updateChatHeader();
    await loadRoomMessages(roomId);
    renderEntityList();
    updateChatHeader();
    renderMessages({ forceBottom: true });
    closeLeftPanel();
  } catch (error) {
    alert(error.message);
  }
}

async function openRoomMembersSheet(roomId) {
  if (!roomId) {
    return;
  }

  const roomFromState = state.rooms.find((item) => Number(item.id) === Number(roomId)) || null;
  const data = await api(`/api/rooms/${roomId}`);
  const room = data || {};
  const members = data.members || [];
  const roomName = room.name || roomFromState?.name || "Комната";
  const myRole = room.myRole || roomFromState?.myRole || null;

  const canOwn = Boolean(room.canOwn) || myRole === "owner" || state.me?.isAdmin;
  const canManage = Boolean(room.canManage) || canOwn;
  const canInvite = Boolean(room.canInvite) || canManage;

  const settingsBlock = canOwn
    ? `
      <section class="settings-card">
        <div class="settings-card-head">
          <div>
            <strong>Настройки комнаты</strong>
            <p class="msg-time">Параметры доступа и поведения комнаты.</p>
          </div>
        </div>
        <label>
          <span>Название</span>
          <input name="roomName" minlength="2" maxlength="40" value="${escapeHtml(roomName)}" />
        </label>
        <label>
          <span>Описание</span>
          <textarea name="roomDescription" maxlength="300" rows="3" placeholder="О чем эта комната">${escapeHtml(room.description || "")}</textarea>
        </label>
        <label>
          <span>Ссылка комнаты</span>
          <input name="roomSlug" minlength="3" maxlength="64" value="${escapeHtml(room.slug || "")}" placeholder="general-chat" />
        </label>
        <label>
          <span>Аватар комнаты</span>
          <input name="roomAvatar" type="file" accept="image/*" />
        </label>
        ${room.slug ? `<button type="button" class="settings-empty room-link-box" data-copy-room-link="${escapeHtml(`${location.origin}/room/${room.slug}`)}"><strong>Ссылка комнаты</strong><p class="msg-time">${escapeHtml(`${location.origin}/room/${room.slug}`)}</p></button>` : ""}
        <label>
          <span>Доступ</span>
          <select name="roomAccessType">
            <option value="public" ${room.accessType === "public" ? "selected" : ""}>Публичная</option>
            <option value="private" ${room.accessType === "private" ? "selected" : ""}>Закрытая</option>
          </select>
        </label>
        <label>
          <span>Кто может писать</span>
          <select name="roomWhoCanPost">
            <option value="members" ${(room.whoCanPost || "members") === "members" ? "selected" : ""}>Все участники</option>
            <option value="admins" ${(room.whoCanPost || "members") === "admins" ? "selected" : ""}>Только админы</option>
          </select>
        </label>
        <label>
          <span>Кто может приглашать</span>
          <select name="roomWhoCanInvite">
            <option value="admins" ${(room.whoCanInvite || "admins") === "admins" ? "selected" : ""}>Только админы</option>
            <option value="members" ${(room.whoCanInvite || "admins") === "members" ? "selected" : ""}>Все участники</option>
          </select>
        </label>
      </section>
    `
    : "";

  const body = members.length
    ? `${settingsBlock}<section class="settings-card"><div class="settings-card-head"><div><strong>Участники</strong><p class="msg-time">Управление ролями и доступом участников.</p></div></div><div id="roomMembersList" class="menu-contacts room-members-list">${members
        .map(
          (user) => `
        <div class="menu-contact-item ${canManage && user.id !== state.me?.id && user.id !== room.createdBy ? "with-action" : ""}">
          <div class="avatar">${avatarMarkup(user)}</div>
          <div>
            <strong>${escapeHtml(user.displayName)}</strong>
            <div class="member-badges-row">${memberStatusBadges(user)}</div>
            <p class="msg-time">@${escapeHtml(user.username)} ${user.online ? "· онлайн" : "· офлайн"}</p>
          </div>
          <div class="member-actions">
            ${canManage && user.id !== state.me?.id && user.role !== "owner" ? `<button type="button" class="chat-more-btn member-menu-btn" data-room-member-menu="${user.id}">${iconMarkup("more", "xs")}</button>` : ""}
          </div>
        </div>
      `
        )
        .join("")}</div></section>`
    : `${settingsBlock}<section class="settings-card"><div class="settings-empty"><strong>Пусто</strong><p class='msg-time'>Нет участников</p></div></section>`;

  const leaveButton = room.joined && myRole !== "owner"
    ? `<button type="button" class="ghost danger" data-room-leave="${roomId}">Покинуть комнату</button>`
    : "";

  const fullBody = `<div class="stack settings-layout"><section class="settings-hero"><div class="profile-hero-main"><div class="avatar profile-hero-avatar">${room.avatarUrl ? `<img src="${escapeHtml(room.avatarUrl)}" alt="${escapeHtml(roomName)}" />` : (isPrivateRoom(room) ? iconMarkup("lock") : iconMarkup("room"))}</div><div><strong># ${escapeHtml(roomName)}</strong><p class="msg-time">Роль: ${escapeHtml(roomRoleLabel(myRole))} · ${room.accessType === "private" ? "закрытая" : "публичная"} комната</p>${room.description ? `<p class="msg-time">${escapeHtml(room.description)}</p>` : ""}</div></div></section>${body}${canManage ? `<section class="settings-card"><button type="button" class="ghost" data-room-audit="${roomId}">Журнал модерации</button></section>` : ""}${leaveButton ? `<section class="settings-card">${leaveButton}</section>` : ""}</div>`;

  const actions = canInvite
    ? [{ label: "Пригласить", onClick: () => { closeSheet(); openInviteUsersSheet(roomId); } }]
    : [];

  openSheet(`Управление #${roomName}`, canOwn ? "Сохранить" : "", fullBody, async (formData) => {
    if (!canOwn) {
      return;
    }
    const nextName = String(formData.get("roomName") || roomName).trim();
    const nextDescription = String(formData.get("roomDescription") || room.description || "").trim();
    const nextSlug = String(formData.get("roomSlug") || room.slug || "").trim();
    const nextAccessType = String(formData.get("roomAccessType") || room.accessType || "public");
    const nextWhoCanPost = String(formData.get("roomWhoCanPost") || room.whoCanPost || "members");
    const nextWhoCanInvite = String(formData.get("roomWhoCanInvite") || room.whoCanInvite || "admins");
    const changedName = nextName && nextName !== roomName;
    const changedAccess = nextAccessType !== (room.accessType || "public");
    const changedPostPolicy = nextWhoCanPost !== (room.whoCanPost || "members");
    const changedInvitePolicy = nextWhoCanInvite !== (room.whoCanInvite || "admins");
    const changedDescription = nextDescription !== (room.description || "");
    const changedSlug = nextSlug !== (room.slug || "");
    let avatarUrl = room.avatarUrl || "";
    const roomAvatarFile = formData.get("roomAvatar");
    if (roomAvatarFile && roomAvatarFile.name) {
      const uploaded = await uploadRoomAvatar(roomAvatarFile);
      avatarUrl = uploaded.avatarUrl;
    }
    const changedAvatar = avatarUrl !== (room.avatarUrl || "");
    if (!changedName && !changedAccess && !changedPostPolicy && !changedInvitePolicy && !changedDescription && !changedSlug && !changedAvatar) {
      return;
    }

    await api(`/api/rooms/${roomId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: nextName,
        description: nextDescription,
        slug: nextSlug,
        avatarUrl,
        accessType: nextAccessType,
        whoCanPost: nextWhoCanPost,
        whoCanInvite: nextWhoCanInvite,
      }),
    });
    await Promise.all([loadRooms(), loadInvitations()]);
    refreshInvitationsButton();
    renderEntityList();
    updateChatHeader();
  }, actions);

  els.sheetBody.querySelector("[data-room-audit]")?.addEventListener("click", async () => {
    await openRoomAuditSheet(roomId);
  });

  els.sheetBody.querySelector("[data-copy-room-link]")?.addEventListener("click", async (event) => {
    const value = String(event.currentTarget.dataset.copyRoomLink || "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast("Ссылка комнаты скопирована", "success");
    } catch {
      showToast(value, "info");
    }
  });

  async function refreshManagedRoomSheet() {
    await Promise.all([loadRooms(), loadInvitations()]);
    refreshInvitationsButton();
    renderEntityList();
    updateChatHeader();
    await openRoomMembersSheet(roomId);
  }

  els.sheetBody.querySelectorAll("[data-room-member-menu]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const userId = Number(button.dataset.roomMemberMenu);
      const member = members.find((item) => item.id === userId);
      if (!member) return;
      const items = [];
      if (canOwn && member.role !== "owner") {
        items.push({
          label: member.role === "admin" ? "Снять админа" : "Сделать админом",
          onClick: async () => {
            await api(`/api/rooms/${roomId}/members/${userId}`, {
              method: "PATCH",
              body: JSON.stringify({ role: member.role === "admin" ? "member" : "admin" }),
            });
            await refreshManagedRoomSheet();
          },
        });
      }
      items.push({
        label: member.isMuted ? "Снять mute" : "Mute",
        onClick: async () => {
          await api(`/api/rooms/${roomId}/members/${userId}`, {
            method: "PATCH",
            body: JSON.stringify({ isMuted: !member.isMuted }),
          });
          await refreshManagedRoomSheet();
        },
      });
      items.push({
        label: member.canPostMedia ? "Запретить медиа" : "Разрешить медиа",
        onClick: async () => {
          await api(`/api/rooms/${roomId}/members/${userId}`, {
            method: "PATCH",
            body: JSON.stringify({ canPostMedia: !member.canPostMedia }),
          });
          await refreshManagedRoomSheet();
        },
      });
      items.push({
        label: "Ban",
        danger: true,
        onClick: async () => {
          await api(`/api/rooms/${roomId}/ban-user`, {
            method: "POST",
            body: JSON.stringify({ userId }),
          });
          await refreshManagedRoomSheet();
        },
      });
      items.push({
        label: "Удалить",
        danger: true,
        onClick: async () => {
          await api(`/api/rooms/${roomId}/members/${userId}`, { method: "DELETE" });
          await refreshManagedRoomSheet();
        },
      });
      const rect = event.currentTarget.getBoundingClientRect();
      showContextMenu(rect.right, rect.bottom + 6, items, { forceFloating: true });
    });
  });

  const leaveBtn = els.sheetBody.querySelector("[data-room-leave]");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", async () => {
      try {
        await api(`/api/rooms/${roomId}/leave`, { method: "POST" });
        await Promise.all([loadRooms(), loadInvitations()]);
        refreshInvitationsButton();
        if (state.selected?.type === "room" && state.selected.id === roomId) {
          state.selected = state.users.length ? { type: "dm", id: state.users[0].id } : null;
          if (state.selected?.type === "dm") {
            await loadDmMessages(state.selected.id);
          }
        }
        renderEntityList();
        updateChatHeader();
        renderMessages();
        closeSheet();
      } catch (error) {
        alert(error.message);
      }
    });
  }
}

function auditActionLabel(action) {
  const map = {
    room_created: "Создана комната",
    room_settings_updated: "Обновлены настройки",
    invite_sent: "Отправлено приглашение",
    member_joined: "Участник присоединился",
    member_removed: "Участник удален",
    member_role_changed: "Изменена роль",
    member_left: "Участник вышел",
    room_deleted: "Комната удалена",
  };
  return map[action] || action;
}

async function openRoomAuditSheet(roomId) {
  const data = await api(`/api/rooms/${roomId}/audit?limit=120`);
  const events = data.events || [];
  const html = events.length
    ? `<div class="menu-contacts">${events
        .map((event) => {
          const actor = event.actor?.displayName || "Система";
          const target = event.target?.displayName ? ` · ${event.target.displayName}` : "";
          return `<div class="menu-contact-item"><div><strong>${escapeHtml(auditActionLabel(event.action))}</strong><p class="msg-time">${escapeHtml(actor)}${escapeHtml(target)} · ${formatTime(event.createdAt)}</p></div></div>`;
        })
        .join("")}</div>`
    : "<p class='msg-time'>Событий пока нет</p>";

  openSheet("Журнал модерации", "", html, async () => {});
}

async function openRoomProfileSheet(roomId, initialTab = "info") {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) {
    throw new Error("Комната не найдена");
  }

  const roomLink = room.slug ? `${location.origin}/room/${room.slug}` : "";
  const canManage = Boolean(room.canManage) || state.me?.isAdmin || room.createdBy === state.me?.id;
  renderSheetLoading(`# ${room.name}`, 5);
  const [mediaData, detailData] = await Promise.all([
    api(`/api/media/shared?scope=room&targetId=${roomId}&limit=80`),
    api(`/api/rooms/${roomId}`),
  ]);
  const media = mediaData.media || [];
  const files = mediaData.files || [];
  const links = mediaData.links || [];
  const members = detailData.members || [];
  const bansData = canManage ? await api(`/api/rooms/${roomId}/bans`).catch(() => ({ bans: [] })) : { bans: [] };
  const bans = bansData.bans || [];
  const requestsData = canManage ? await api(`/api/rooms/${roomId}/requests`).catch(() => ({ requests: [] })) : { requests: [] };
  const requests = requestsData.requests || [];

  const memberPreview = members.slice(0, 6);
  const membersHtml = memberPreview.length
    ? `<div class="member-preview-list">${memberPreview
        .map(
          (member) => `
            <button type="button" class="member-preview-item" data-open-member-dm="${member.id}">
              <div class="avatar small">${avatarMarkup(member)}</div>
              <div>
                <strong>${escapeHtml(member.displayName)}</strong>
                <p class="msg-time">@${escapeHtml(member.username)}</p>
                <div class="member-badges-row">${memberStatusBadges(member)}</div>
              </div>
              <span class="member-preview-arrow">${iconMarkup("arrowRight", "xs")}</span>
            </button>
          `
        )
        .join("")}</div>${members.length > memberPreview.length ? `<p class="msg-time">И еще ${members.length - memberPreview.length}</p>` : ""}`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Состав комнаты пока не загружен</p></div>`;

  const mediaPreview = media.slice(0, 3);
  const mediaSummaryHtml = `
    <div class="settings-meta-grid room-summary-grid">
      <div class="settings-pill">Участников: ${room.membersCount}</div>
      <div class="settings-pill">Медиа: ${media.length}</div>
      <div class="settings-pill">Ссылки: ${links.length}</div>
      <div class="settings-pill">Файлы: ${files.length}</div>
      <div class="settings-pill">Тип: ${room.accessType === "private" ? "private" : "public"}</div>
    </div>
    ${mediaPreview.length ? `<div class="room-media-strip">${mediaPreview.map((item) => `<button type="button" class="room-media-strip-item" data-open-image="${escapeHtml(item.imageUrl)}"><img src="${escapeHtml(item.imageUrl)}" alt="image" /></button>`).join("")}${media.length > mediaPreview.length ? `<button type="button" class="room-media-strip-more" data-room-profile-tab-jump="media">+${media.length - mediaPreview.length}</button>` : ""}</div>` : ""}
  `;

  const mediaHtml = media.length
    ? `<div class="shared-grid">${media
        .map((item) => `<button type="button" class="shared-media-card image" data-open-image="${escapeHtml(item.imageUrl)}"><img src="${escapeHtml(item.imageUrl)}" alt="image" /><span class="msg-time">${formatTime(item.createdAt)}</span></button>`)
        .join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Изображений пока нет</p></div>`;
  const filesHtml = files.length
    ? `<div class="menu-contacts search-results-list">${files.map((item) => `<a class="menu-contact-item settings-contact-card" href="${escapeHtml(item.fileUrl)}" target="_blank" rel="noopener noreferrer"><div><strong>${escapeHtml(item.fileName || "Файл")}</strong><p class="msg-time">${escapeHtml(formatFileSize(item.fileSize) || "Документ")} · ${formatTime(item.createdAt)}</p></div><span class="menu-badge">→</span></a>`).join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Файлов пока нет</p></div>`;

  const linksHtml = links.length
    ? `<div class="menu-contacts search-results-list">${links.map((item) => `<a class="menu-contact-item settings-contact-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><div><strong>${escapeHtml(item.url)}</strong><p class="msg-time">Сообщение #${item.id} · ${formatTime(item.createdAt)}</p></div><span class="menu-badge">→</span></a>`).join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Ссылок пока нет</p></div>`;
  const bansHtml = bans.length
    ? `<div class="member-preview-list">${bans.map((user) => `<div class="member-preview-item banned"><div class="avatar small">${avatarMarkup(user)}</div><div><strong>${escapeHtml(user.displayName)}</strong><p class="msg-time">@${escapeHtml(user.username)} · ${escapeHtml(user.bannedByName)} · ${formatTime(user.bannedAt)}</p></div><button type="button" class="ghost compact-btn" data-room-unban-user="${user.userId}">Unban</button></div>`).join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Забаненных пользователей нет</p></div>`;
  const requestsHtml = requests.length
    ? `<div class="member-preview-list">${requests.map((user) => `<div class="member-preview-item request"><div class="avatar small">${avatarMarkup(user)}</div><div><strong>${escapeHtml(user.displayName)}</strong><p class="msg-time">@${escapeHtml(user.username)} · ${formatTime(user.createdAt)}</p><div class="member-badges-row"><span class="role-chip pending">request</span></div></div><div class="member-actions request-actions"><button type="button" class="ghost compact-btn" data-room-approve-user="${user.userId}">Принять</button><button type="button" class="ghost danger compact-btn" data-room-decline-user="${user.userId}">Отклонить</button></div></div>`).join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Новых заявок нет</p></div>`;
  const moderationSummaryHtml = canManage
    ? `<div class="settings-meta-grid room-summary-grid moderation-summary-grid"><div class="settings-pill">Заявки: ${requests.length}</div><div class="settings-pill">Баны: ${bans.length}</div><div class="settings-pill">Участников: ${members.length}</div><div class="settings-pill">Инвайты: ${room.hasInvitation ? 1 : 0}</div></div>`
    : "";

  openSheet(
    `# ${room.name}`,
    "",
    `
      <div class="stack settings-layout room-profile-layout">
        <section class="settings-hero room-profile-hero">
          <div class="profile-hero-main">
            <div class="avatar profile-hero-avatar">${room.avatarUrl ? `<img src="${escapeHtml(room.avatarUrl)}" alt="${escapeHtml(room.name)}" />` : (isPrivateRoom(room) ? iconMarkup("lock") : iconMarkup("room"))}</div>
            <div>
              <strong>${escapeHtml(room.name)}</strong>
              <p class="msg-time">${room.accessType === "private" ? "Закрытая комната" : "Публичная комната"} · участников: ${room.membersCount}</p>
              ${room.description ? `<p class="msg-time">${escapeHtml(room.description)}</p>` : ""}
            </div>
          </div>
          <div class="room-profile-actions">
            ${roomLink ? `<button type="button" class="icon-btn" data-room-share-link="${escapeHtml(roomLink)}" aria-label="Поделиться ссылкой">${iconMarkup("arrowRight")}</button>` : ""}
            ${canManage ? `<button type="button" class="icon-btn" data-room-open-manage="${room.id}" aria-label="Настройки комнаты">${iconMarkup("room")}</button>` : ""}
          </div>
        </section>
        <section class="settings-card">
          <div class="segmented compact room-profile-tabs">
            <button class="seg-btn ${initialTab === "info" ? "active" : ""}" data-room-profile-tab="info" type="button">Инфо</button>
            <button class="seg-btn ${initialTab === "media" ? "active" : ""}" data-room-profile-tab="media" type="button">Медиа</button>
            <button class="seg-btn ${initialTab === "links" ? "active" : ""}" data-room-profile-tab="links" type="button">Ссылки</button>
            <button class="seg-btn ${initialTab === "files" ? "active" : ""}" data-room-profile-tab="files" type="button">Файлы</button>
            ${canManage ? `<button class="seg-btn ${initialTab === "moderation" ? "active" : ""}" data-room-profile-tab="moderation" type="button">Модерация</button>` : ""}
          </div>
        </section>
        <section class="settings-card room-profile-panel ${initialTab === "info" ? "" : "hidden"}" data-room-profile-panel="info">
          <div class="settings-card-head"><div><strong>О комнате</strong><p class="msg-time">Основная информация и ссылка для приглашения.</p></div></div>
          ${mediaSummaryHtml}
          ${room.description ? `<p>${escapeHtml(room.description)}</p>` : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Описание еще не заполнено</p></div>`}
          ${roomLink ? `<button type="button" class="settings-empty room-link-box" data-copy-room-link="${escapeHtml(roomLink)}"><strong>${escapeHtml(room.slug)}</strong><p class="msg-time">${escapeHtml(roomLink)}</p></button>` : ""}
          <div class="settings-card-head"><div><strong>Участники</strong><p class="msg-time">Основной состав комнаты.</p></div></div>
          ${membersHtml}
        </section>
        <section class="settings-card room-profile-panel ${initialTab === "media" ? "" : "hidden"}" data-room-profile-panel="media">
          <div class="settings-card-head"><div><strong>Медиа</strong><p class="msg-time">Все изображения комнаты.</p></div></div>
          ${mediaHtml}
        </section>
        <section class="settings-card room-profile-panel ${initialTab === "links" ? "" : "hidden"}" data-room-profile-panel="links">
          <div class="settings-card-head"><div><strong>Ссылки</strong><p class="msg-time">Все ссылки, найденные в сообщениях.</p></div></div>
          ${linksHtml}
        </section>
        <section class="settings-card room-profile-panel ${initialTab === "files" ? "" : "hidden"}" data-room-profile-panel="files">
          <div class="settings-card-head"><div><strong>Файлы</strong><p class="msg-time">Все документы и вложения комнаты.</p></div></div>
          ${filesHtml}
        </section>
        ${canManage ? `<section class="settings-card room-profile-panel ${initialTab === "moderation" ? "" : "hidden"}" data-room-profile-panel="moderation"><div class="settings-card-head"><div><strong>Модерация</strong><p class="msg-time">Управление заявками и ограничениями доступа.</p></div></div>${moderationSummaryHtml}<div class="settings-card-head"><div><strong>Заявки</strong><p class="msg-time">Запросы на вступление в комнату.</p></div></div>${requestsHtml}<div class="settings-card-head"><div><strong>Забаненные</strong><p class="msg-time">Пользователи без доступа в комнату.</p></div></div>${bansHtml}</section>` : ""}
      </div>
    `,
    async () => {}
  );

  els.sheetBody.querySelectorAll("[data-room-profile-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.roomProfileTab;
      els.sheetBody.querySelectorAll("[data-room-profile-tab]").forEach((item) => {
        item.classList.toggle("active", item.dataset.roomProfileTab === tab);
      });
      els.sheetBody.querySelectorAll("[data-room-profile-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.roomProfilePanel !== tab);
      });
    });
  });

  els.sheetBody.querySelectorAll("[data-open-image]").forEach((button) => {
    button.addEventListener("click", () => openImageViewer(button.dataset.openImage || ""));
  });

  els.sheetBody.querySelectorAll("[data-room-profile-tab-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.roomProfileTabJump;
      els.sheetBody.querySelectorAll("[data-room-profile-tab]").forEach((item) => {
        item.classList.toggle("active", item.dataset.roomProfileTab === tab);
      });
      els.sheetBody.querySelectorAll("[data-room-profile-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.roomProfilePanel !== tab);
      });
    });
  });

  els.sheetBody.querySelectorAll("[data-open-member-dm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.openMemberDm);
      if (!userId || userId === state.me?.id) {
        return;
      }
      closeSheet();
      await selectDm(userId);
    });
  });

  els.sheetBody.querySelectorAll("[data-room-unban-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.roomUnbanUser);
      await api(`/api/rooms/${roomId}/bans/${userId}`, { method: "DELETE" });
      showToast("Пользователь разбанен", "success");
      await openRoomProfileSheet(roomId, "info");
    });
  });

  els.sheetBody.querySelectorAll("[data-room-approve-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.roomApproveUser);
      await api(`/api/rooms/${roomId}/requests/${userId}/approve`, { method: "POST" });
      showToast("Заявка одобрена", "success");
      await Promise.all([loadRooms(), loadInvitations()]);
      await openRoomProfileSheet(roomId, "info");
    });
  });

  els.sheetBody.querySelectorAll("[data-room-decline-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.roomDeclineUser);
      await api(`/api/rooms/${roomId}/requests/${userId}`, { method: "DELETE" });
      showToast("Заявка отклонена", "success");
      await openRoomProfileSheet(roomId, "info");
    });
  });

  els.sheetBody.querySelector("[data-copy-room-link]")?.addEventListener("click", async (event) => {
    const value = String(event.currentTarget.dataset.copyRoomLink || "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast("Ссылка комнаты скопирована", "success");
    } catch {
      showToast(value, "info");
    }
  });

  els.sheetBody.querySelector("[data-room-open-manage]")?.addEventListener("click", async () => {
    await openRoomMembersSheet(roomId);
  });

  els.sheetBody.querySelector("[data-room-share-link]")?.addEventListener("click", async (event) => {
    const value = String(event.currentTarget.dataset.roomShareLink || "");
    if (!value) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: room.name, text: `Присоединяйся к комнате ${room.name}`, url: value });
      } else {
        await navigator.clipboard.writeText(value);
        showToast("Ссылка комнаты скопирована", "success");
      }
    } catch {
      // ignore cancel
    }
  });
}

async function openInviteUsersSheet(roomId) {
  if (!roomId) {
    throw new Error("Сначала выбери комнату");
  }

  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) {
    throw new Error("Комната не найдена");
  }

  const canInvite = Boolean(room.canInvite) || state.me?.isAdmin || room.createdBy === state.me?.id;
  if (!canInvite) {
    throw new Error("Приглашать может только владелец комнаты или админ");
  }

  const data = await api(`/api/rooms/${roomId}/invite-candidates`);
  const users = data.users || [];

  const body = users.length
    ? `<div class="stack"><input id="inviteUsersSearch" type="text" placeholder="Поиск пользователя" /><div id="inviteUsersList" class="menu-contacts">${users
        .map(
          (user) => `
        <button type="button" class="menu-contact-item" data-invite-user-id="${user.id}" data-invite-search="${escapeHtml(`${user.displayName} ${user.username}`.toLowerCase())}">
          <div class="avatar">${avatarMarkup(user)}</div>
          <div>
            <strong>${escapeHtml(user.displayName)}${user.isAdmin ? " 👑" : ""}</strong>
            <p class="msg-time">@${escapeHtml(user.username)} ${user.online ? "· онлайн" : "· офлайн"}</p>
          </div>
        </button>
      `
        )
        .join("")}</div></div>`
    : "<p class='msg-time'>Нет пользователей для приглашения</p>";

  openSheet("Пригласить в комнату", "Закрыть", body, async () => {});

  els.sheetBody.querySelectorAll("[data-invite-user-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.inviteUserId);
      await api(`/api/rooms/${roomId}/invite-user`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      button.disabled = true;
      button.classList.add("sent");
      button.innerHTML += "<span class='msg-time'>Приглашение отправлено</span>";
      setTimeout(() => button.remove(), 300);
      if (!els.sheetBody.querySelector("[data-invite-user-id]")) {
        const list = document.getElementById("inviteUsersList");
        if (list) {
          list.outerHTML = "<p class='msg-time'>Все доступные пользователи приглашены</p>";
        }
      }
    });
  });

  const searchInput = document.getElementById("inviteUsersSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      els.sheetBody.querySelectorAll("[data-invite-user-id]").forEach((button) => {
        const searchValue = String(button.dataset.inviteSearch || "");
        button.classList.toggle("hidden", Boolean(q) && !searchValue.includes(q));
      });
    });
  }
}

function renderInvitationItem(invitation) {
  const inviterLabel = invitation.inviter
    ? `${escapeHtml(invitation.inviter.displayName)} (@${escapeHtml(invitation.inviter.username)})`
    : "Система";

  return `
    <div class="invite-card settings-card" data-invite-id="${invitation.id}">
      <div class="invite-head">
        <div>
          <strong># ${escapeHtml(invitation.roomName)}</strong>
          <p class="msg-time">Пригласил: ${inviterLabel}</p>
        </div>
        <span class="role-chip admin">${formatTime(invitation.createdAt)}</span>
      </div>
      <div class="invite-actions">
        <button type="button" class="primary" data-invite-accept="${invitation.id}">Принять</button>
        <button type="button" class="ghost" data-invite-decline="${invitation.id}">Отклонить</button>
      </div>
    </div>
  `;
}

function bindInvitationSheetActions() {
  els.sheetBody.querySelectorAll("[data-invite-accept]").forEach((button) => {
    button.addEventListener("click", async () => {
      const invitationId = Number(button.dataset.inviteAccept);
      const invitation = state.invitations.find((item) => item.id === invitationId);
      if (!invitation) {
        return;
      }

      await api(`/api/invitations/${invitationId}/accept`, { method: "POST" });
      state.invitations = state.invitations.filter((item) => item.id !== invitationId);
      await loadRooms();
      refreshInvitationsButton();
      renderEntityList();
      updateChatHeader();
      if (!state.invitations.length) {
        closeSheet();
      } else {
        openInvitationsSheet();
      }
      await selectRoom(invitation.roomId);
    });
  });

  els.sheetBody.querySelectorAll("[data-invite-decline]").forEach((button) => {
    button.addEventListener("click", async () => {
      const invitationId = Number(button.dataset.inviteDecline);
      await api(`/api/invitations/${invitationId}/decline`, { method: "POST" });
      state.invitations = state.invitations.filter((item) => item.id !== invitationId);
      await loadRooms();
      refreshInvitationsButton();
      renderEntityList();
      updateChatHeader();
      if (!state.invitations.length) {
        closeSheet();
      } else {
        openInvitationsSheet();
      }
    });
  });
}

function openInvitationsSheet() {
  const list = state.invitations
    .map((invitation) => renderInvitationItem(invitation))
    .join("");

  openSheet(
    "Мои приглашения",
    "",
    `
      <div class="stack settings-layout">
        <section class="settings-hero">
          <div>
            <strong>Приглашения в комнаты</strong>
            <p class="msg-time">Здесь появляются персональные инвайты в закрытые комнаты.</p>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Входящие</strong>
              <p class="msg-time">Можно принять доступ сразу из этого окна.</p>
            </div>
          </div>
          ${list ? `<div class="stack">${list}</div>` : `<div class="settings-empty"><strong>Пусто</strong><p class='msg-time'>Пока нет новых приглашений</p></div>`}
        </section>
      </div>
    `,
    async () => {}
  );

  if (list) {
    bindInvitationSheetActions();
  }
}

async function clearDialogWithUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  const label = user ? user.displayName : "пользователем";

  openSheet(
    "Удалить диалог",
    "Подтвердить",
    `<div class="stack"><p>Удалить все сообщения с <strong>${escapeHtml(label)}</strong>?</p><p class="msg-time">Действие необратимо.</p></div>`,
    async () => {
      await api(`/api/dialogs/${userId}`, { method: "DELETE" });
      state.dmMessagesByUserId.set(userId, []);
      renderMessages();
      closeSheet();
    }
  );
}

async function deleteRoom(roomId) {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) {
    return;
  }

  openSheet(
    "Удалить комнату",
    "Удалить",
    `<div class="stack"><p>Удалить комнату <strong>${escapeHtml(room.name)}</strong>?</p><p class="msg-time">Удалятся сообщения, опросы и участники этой комнаты.</p></div>`,
    async () => {
      await api(`/api/rooms/${roomId}`, { method: "DELETE" });
      state.roomMessagesByRoomId.delete(roomId);
      await loadRooms();

      if (state.selected?.type === "room" && state.selected.id === roomId) {
        state.selected = state.users.length ? { type: "dm", id: state.users[0].id } : null;
      }

      renderEntityList();
      updateChatHeader();
      if (state.selected?.type === "dm") {
        await loadDmMessages(state.selected.id);
      }
      renderMessages();
      closeSheet();
    }
  );
}

function upsertDmMessage(message) {
  const peerId = message.senderId === state.me.id ? message.receiverId : message.senderId;
  const list = state.dmMessagesByUserId.get(peerId) || [];
  const index = list.findIndex((item) => item.id === message.id);
  const inserted = index < 0;
  if (index >= 0) {
    list[index] = message;
  } else {
    list.push(message);
  }
  state.dmMessagesByUserId.set(peerId, list);
  if (state.selected?.type === "dm" && state.selected.id === peerId) {
    const incoming = message.senderId !== state.me.id;
    const nearBottomBefore = isNearBottom(96);
    const key = chatKey("dm", peerId);
    if (inserted && incoming) {
      state.newlyArrivedMessageIds.add(message.id);
      if (!nearBottomBefore) {
        if (!state.unseenStartByChatKey.has(key)) {
          state.unseenStartByChatKey.set(key, message.id);
        }
        state.unseenCountByChatKey.set(key, Number(state.unseenCountByChatKey.get(key) || 0) + 1);
      } else {
        clearUnseenForKey(key);
      }
    }
    scheduleRenderMessages({ forceBottom: message.senderId === state.me.id });
  }
}

function upsertRoomMessage(message) {
  const roomId = message.roomId;
  const list = state.roomMessagesByRoomId.get(roomId) || [];
  const index = list.findIndex((item) => item.id === message.id);
  const inserted = index < 0;
  if (index >= 0) {
    list[index] = message;
  } else {
    list.push(message);
  }
  state.roomMessagesByRoomId.set(roomId, list);
  if (state.selected?.type === "room" && state.selected.id === roomId) {
    const incoming = message.senderId !== state.me.id;
    const nearBottomBefore = isNearBottom(96);
    const key = chatKey("room", roomId);
    if (inserted && incoming) {
      state.newlyArrivedMessageIds.add(message.id);
      if (!nearBottomBefore) {
        if (!state.unseenStartByChatKey.has(key)) {
          state.unseenStartByChatKey.set(key, message.id);
        }
        state.unseenCountByChatKey.set(key, Number(state.unseenCountByChatKey.get(key) || 0) + 1);
      } else {
        clearUnseenForKey(key);
      }
    }
    scheduleRenderMessages({ forceBottom: message.senderId === state.me.id });
  }
}

async function editMessage(messageId, content) {
  if (!state.selected) {
    return;
  }
  const payload = { content: String(content || "").trim() };
  if (!payload.content) {
    throw new Error("Пустой текст");
  }

  if (state.selected.type === "dm") {
    const data = await api(`/api/messages/item/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    upsertDmMessage(data.message);
  } else {
    const data = await api(`/api/rooms/${state.selected.id}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    upsertRoomMessage(data.message);
  }
}

async function deleteMessage(messageId) {
  if (!state.selected) {
    return;
  }

  if (state.selected.type === "dm") {
    const data = await api(`/api/messages/item/${messageId}`, { method: "DELETE" });
    upsertDmMessage(data.message);
  } else {
    const data = await api(`/api/rooms/${state.selected.id}/messages/${messageId}`, { method: "DELETE" });
    upsertRoomMessage(data.message);
  }
}

async function deleteSelectedMessages() {
  const ids = Array.from(state.selectedMessageIds);
  if (!ids.length) {
    return;
  }
  openSheet(
    `Удалить ${ids.length}`,
    "Удалить",
    `<div class="stack"><p>Удалить выбранные сообщения?</p><p class="msg-time">Это действие необратимо.</p></div>`,
    async () => {
      for (const id of ids) {
        await deleteMessage(id);
      }
      clearMessageSelection();
      showToast("Сообщения удалены", "success");
    }
  );
}

async function copySelectedMessages() {
  const ids = Array.from(state.selectedMessageIds);
  const messages = ids.map((id) => getMessageById(id)).filter(Boolean);
  if (!messages.length) {
    return;
  }
  const text = messages
    .map((message) => {
      if (message.deletedAt) return "[Удалено]";
      if (message.fileUrl) return message.fileName || "[Файл]";
      if (message.imageUrl) return message.content || "[Изображение]";
      if (message.poll) return message.poll.question;
      return message.content || "";
    })
    .filter(Boolean)
    .join("\n\n");
  if (!text) return;
  await navigator.clipboard.writeText(text);
  showToast("Сообщения скопированы", "success");
}

function buildForwardPayload(message) {
  if (message.deletedAt) return null;
  const forwardedFromName = state.selected?.type === "room"
    ? (message.sender?.displayName || "Комната")
    : (state.users.find((u) => u.id === message.senderId)?.displayName || state.me?.displayName || "Диалог");
  if (message.poll) {
    return { content: `${message.poll.question}

${message.poll.options.map((o) => `- ${o.text}`).join("\n")}`, forwardedFromName };
  }
  if (message.imageUrl) {
    return { content: message.content || "", imageUrl: message.imageUrl, forwardedFromName };
  }
  if (message.fileUrl) {
    return { content: "", fileUrl: message.fileUrl, fileName: message.fileName || "Файл", fileSize: message.fileSize || null, forwardedFromName };
  }
  return { content: message.content || "", forwardedFromName };
}

async function sendPayloadToTarget(target, payload) {
  if (target.scope === "dm") {
    await api(`/api/messages/${target.id}`, { method: "POST", body: JSON.stringify(payload) });
    return;
  }
  await api(`/api/rooms/${target.id}/messages`, { method: "POST", body: JSON.stringify(payload) });
}

function buildForwardTargets() {
  const dmTargets = state.users.map((user) => ({ id: user.id, scope: "dm", label: user.displayName, sublabel: `@${user.username}` }));
  const roomTargets = state.rooms.filter((room) => room.joined).map((room) => ({ id: room.id, scope: "room", label: `# ${room.name}`, sublabel: room.description || (room.accessType === "private" ? "Закрытая комната" : "Публичная комната") }));
  return [...dmTargets, ...roomTargets];
}

function openForwardSheet(messageIds) {
  const ids = messageIds.length ? messageIds : Array.from(state.selectedMessageIds);
  const messages = ids.map((id) => getMessageById(id)).filter(Boolean);
  if (!messages.length) return;
  const targets = buildForwardTargets();
  const previewHtml = messages
    .slice(0, 3)
    .map((message) => {
      const payload = buildForwardPayload(message);
      if (!payload) return "";
      const label = payload.fileName || payload.content || "Сообщение";
      return `<div class="forward-preview-item"><strong>${escapeHtml(label.slice(0, 72))}</strong><p class="msg-time">${message.forwardedFromName ? `Forwarded from ${escapeHtml(message.forwardedFromName)}` : "Будет переслано"}</p></div>`;
    })
    .join("");
  openSheet(
    "Переслать",
    "",
    `<div class="stack settings-layout"><section class="settings-hero"><div><strong>Переслать сообщения</strong><p class="msg-time">Выберите диалог или комнату для пересылки.</p></div></section><section class="settings-card"><div class="settings-card-head"><div><strong>Что будет переслано</strong><p class="msg-time">${messages.length} сообщ. выбрано</p></div></div><div class="stack">${previewHtml}${messages.length > 3 ? `<p class="msg-time">И еще ${messages.length - 3}</p>` : ""}</div></section><section class="settings-card"><div class="menu-contacts search-results-list">${targets.map((target) => `<button type="button" class="menu-contact-item settings-contact-card" data-forward-scope="${target.scope}" data-forward-id="${target.id}"><div><strong>${escapeHtml(target.label)}</strong><p class="msg-time">${escapeHtml(target.sublabel)}</p></div><span class="menu-badge">→</span></button>`).join("")}</div></section></div>`,
    async () => {}
  );
  els.sheetBody.querySelectorAll("[data-forward-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = { scope: button.dataset.forwardScope, id: Number(button.dataset.forwardId) };
      for (const message of messages) {
        const payload = buildForwardPayload(message);
        if (payload) {
          await sendPayloadToTarget(target, payload);
        }
      }
      closeSheet();
      clearMessageSelection();
      showToast("Сообщения пересланы", "success");
    });
  });
}

async function toggleReaction(messageId, emoji) {
  if (!state.selected) {
    return;
  }
  if (state.selected.type === "dm") {
    const data = await api(`/api/messages/item/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
    upsertDmMessage(data.message);
  } else {
    const data = await api(`/api/rooms/${state.selected.id}/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
    upsertRoomMessage(data.message);
  }
}

async function votePoll(poll, optionId) {
  let optionIds = [optionId];
  if (poll.allowMultiple) {
    const selected = poll.options.filter((opt) => opt.votedByMe).map((opt) => opt.id);
    optionIds = selected.includes(optionId)
      ? selected.filter((id) => id !== optionId)
      : [...selected, optionId];
    if (!optionIds.length) {
      optionIds = [optionId];
    }
  }

  const response = await api(`/api/polls/${poll.id}/vote`, {
    method: "POST",
    body: JSON.stringify({ optionIds }),
  });
  patchPoll(response.poll);
  renderMessages();
}

async function closePoll(pollId) {
  const response = await api(`/api/polls/${pollId}/close`, { method: "POST" });
  patchPoll(response.poll);
  renderMessages();
}

function patchPoll(poll) {
  for (const messages of state.dmMessagesByUserId.values()) {
    for (const message of messages) {
      if (message.poll?.id === poll.id) {
        message.poll = poll;
      }
    }
  }

  for (const messages of state.roomMessagesByRoomId.values()) {
    for (const message of messages) {
      if (message.poll?.id === poll.id) {
        message.poll = poll;
      }
    }
  }
}

function openMessageActions(messageId, x, y) {
  const message = getMessageById(messageId);
  if (!message) {
    return;
  }
  const mine = message.senderId === state.me.id;
  const canEdit = mine && !message.deletedAt;
  const canDelete = mine || state.me?.isAdmin;

  const pinnedMessage = state.selected?.type === "dm"
    ? state.pinnedByDialogId.get(state.selected.id)
    : state.pinnedByRoomId.get(state.selected.id);
  const isPinned = pinnedMessage?.id === messageId;

  const items = [
    { label: "Ответить", onClick: async () => setReply(messageId) },
    { label: state.selectedMessageIds.has(messageId) ? "Снять выбор" : "Выбрать", onClick: async () => toggleMessageSelection(messageId) },
    { label: "Реакция", onClick: async () => openReactionSheet(messageId) },
    {
      label: isPinned ? "Открепить" : "Закрепить",
      onClick: async () => {
        if (isPinned) {
          await unpinCurrentTarget();
        } else {
          await pinMessageForCurrentTarget(messageId);
        }
      },
    },
  ];

  if (canEdit) {
    items.push({ label: "Редактировать", onClick: async () => openEditMessageSheet(messageId) });
  }

  if (canDelete) {
    items.push({ label: "Удалить", danger: true, onClick: async () => deleteMessage(messageId) });
  }

  showContextMenu(x, y, items);
}

async function pinMessageForCurrentTarget(messageId) {
  if (!state.selected) {
    return;
  }
  const scope = state.selected.type === "room" ? "room" : "dm";
  const targetId = state.selected.id;
  await api("/api/pins", {
    method: "POST",
    body: JSON.stringify({ scope, targetId, messageId }),
  });

  if (scope === "dm") {
    const msg = getCurrentMessages().find((item) => item.id === messageId) || null;
    state.pinnedByDialogId.set(targetId, msg);
  } else {
    const msg = getCurrentMessages().find((item) => item.id === messageId) || null;
    state.pinnedByRoomId.set(targetId, msg);
  }
  renderMessages();
}

async function unpinCurrentTarget() {
  if (!state.selected) {
    return;
  }
  const scope = state.selected.type === "room" ? "room" : "dm";
  const targetId = state.selected.id;
  await api("/api/pins", {
    method: "DELETE",
    body: JSON.stringify({ scope, targetId }),
  });

  if (scope === "dm") {
    state.pinnedByDialogId.set(targetId, null);
  } else {
    state.pinnedByRoomId.set(targetId, null);
  }
  renderMessages();
}

function openReactionSheet(messageId) {
  const options = EMOJIS.slice(0, 12)
    .map((emoji) => `<button class="ghost" type="button" data-emoji="${emoji}">${emoji}</button>`)
    .join("");

  openSheet(
    "Выбери реакцию",
    "Отправить",
    `
      <div class="stack">
        <div class="segmented" style="flex-wrap: wrap;">${options}</div>
        <input name="emoji" placeholder="Или введи эмодзи" />
      </div>
    `,
    async (formData) => {
      const emoji = String(formData.get("emoji") || "").trim();
      if (emoji) {
        await toggleReaction(messageId, emoji);
      }
    }
  );

  els.sheetBody.querySelectorAll("[data-emoji]").forEach((button) => {
    button.addEventListener("click", async () => {
      await toggleReaction(messageId, button.dataset.emoji);
      closeSheet();
    });
  });
}

function openEditMessageSheet(messageId) {
  const message = getMessageById(messageId);
  if (!message) {
    return;
  }
  openSheet(
    "Редактирование",
    "Сохранить",
    `<textarea name="content" rows="5" maxlength="2000">${escapeHtml(message.content || "")}</textarea>`,
    async (formData) => {
      await editMessage(messageId, formData.get("content"));
    }
  );
}

function openCreateRoomSheet() {
  openSheet(
    "Новая комната",
    "Создать",
    `
      <label>
        <span>Аватар комнаты</span>
        <input name="avatar" type="file" accept="image/*" />
      </label>
      <label>
        <span>Название</span>
        <input name="name" minlength="2" maxlength="40" required />
      </label>
      <label>
        <span>Описание</span>
        <textarea name="description" rows="3" maxlength="300" placeholder="О чем будет эта комната"></textarea>
      </label>
      <label>
        <span>Ссылка комнаты</span>
        <input name="slug" minlength="3" maxlength="64" placeholder="general-chat" />
      </label>
      <label>
        <span>Доступ</span>
        <select name="accessType">
          <option value="public">Публичная</option>
          <option value="private">Закрытая (по приглашению)</option>
        </select>
      </label>
    `,
    async (formData) => {
      const name = String(formData.get("name") || "").trim();
      const description = String(formData.get("description") || "").trim();
      const slug = String(formData.get("slug") || "").trim();
      const accessType = String(formData.get("accessType") || "public");
      if (!name) {
        throw new Error("Укажи название");
      }
      let avatarUrl = "";
      const avatarFile = formData.get("avatar");
      if (avatarFile && avatarFile.name) {
        const uploaded = await uploadRoomAvatar(avatarFile);
        avatarUrl = uploaded.avatarUrl;
      }
      const response = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name, description, slug, avatarUrl, accessType }),
      });
      await loadRooms();
      renderEntityList();
      await selectRoom(response.room.id);
    }
  );
}

function openPollSheet() {
  openSheet(
    "Создать опрос",
    "Отправить",
    `
      <label>
        <span>Вопрос</span>
        <input name="question" maxlength="180" required />
      </label>
      <label>
        <span>Варианты (каждый с новой строки)</span>
        <textarea name="options" rows="5" required></textarea>
      </label>
      <label>
        <span>Тип голосования</span>
        <select name="allowMultiple">
          <option value="0">Один вариант</option>
          <option value="1">Несколько вариантов</option>
        </select>
      </label>
    `,
    async (formData) => {
      if (!state.selected) {
        return;
      }
      const question = String(formData.get("question") || "").trim();
      const options = String(formData.get("options") || "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      const allowMultiple = String(formData.get("allowMultiple") || "0") === "1";

      const payload = {
        content: "",
        replyToMessageId: state.replyToMessageId,
        poll: { question, options, allowMultiple },
      };

      if (state.selected.type === "dm") {
        const response = await api(`/api/messages/${state.selected.id}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        upsertDmMessage(response.message);
      } else {
        const response = await api(`/api/rooms/${state.selected.id}/messages`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        upsertRoomMessage(response.message);
      }
      clearReply();
    }
  );
}

function openSearchMessagesSheet() {
  if (!state.selected) {
    return;
  }

  const selectedScope = state.selected.type === "room" ? "room" : "dm";
  const selectedTargetId = state.selected.id;

  openSheet(
    "Поиск по сообщениям",
    "",
    `
      <div class="stack settings-layout">
        <section class="settings-hero">
          <div>
            <strong>Поиск по сообщениям</strong>
            <p class="msg-time">Ищите по текущему чату, всем диалогам или всем комнатам.</p>
          </div>
        </section>
        <section class="settings-card">
          <label>
            <span>Запрос</span>
            <input name="q" minlength="2" maxlength="120" required placeholder="Например: фото, договор, ссылка" />
          </label>
          <label>
            <span>Где искать</span>
            <select name="where">
              <option value="current">Текущий чат</option>
              <option value="all">Все чаты</option>
              <option value="dm">Все личные</option>
              <option value="room">Все комнаты</option>
            </select>
          </label>
          <div class="settings-actions-row">
            <button id="searchRunBtn" class="primary" type="button">Искать</button>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Результаты</strong>
              <p class="msg-time">Клик откроет нужный чат и переведет к сообщению.</p>
            </div>
          </div>
          <div id="searchResults" class="menu-contacts search-results-list"></div>
        </section>
      </div>
    `,
    async () => {}
  );

  const runSearch = async () => {
    try {
      const qInput = els.sheetBody.querySelector("input[name='q']");
      const whereSelect = els.sheetBody.querySelector("select[name='where']");
      const runBtn = els.sheetBody.querySelector("#searchRunBtn");
      const box = document.getElementById("searchResults");
      const q = String(qInput?.value || "").trim();
      if (q.length < 2) {
        throw new Error("Минимум 2 символа");
      }

      if (runBtn) {
        runBtn.disabled = true;
        runBtn.textContent = "Ищу...";
      }
      if (box) {
        box.innerHTML = `
          <div class="stack">
            <div class="settings-card skeleton-card"><div class="skeleton-line lg"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
            <div class="settings-card skeleton-card"><div class="skeleton-line lg"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
          </div>
        `;
      }

      const where = String(whereSelect?.value || "current");
      const params = new URLSearchParams({ q, limit: "60" });

      if (where === "current") {
        params.set("scope", selectedScope);
        params.set("targetId", String(selectedTargetId));
      } else if (where === "all") {
        params.set("scope", "all");
      } else if (where === "dm") {
        params.set("scope", "all");
        params.set("include", "dm");
      } else {
        params.set("scope", "all");
        params.set("include", "room");
      }

      const data = await api(`/api/search/messages?${params.toString()}`);

      const list = (data.results || [])
        .map(
          (item) =>
            `<button type="button" class="menu-contact-item settings-contact-card" data-jump-msg="${item.id}" data-jump-scope="${item.scope || selectedScope}" data-jump-target-id="${item.targetId || selectedTargetId}"><div><strong>${item.scope === "room" ? "#" : "@"} ${escapeHtml(item.targetName || "Текущий чат")}</strong><p class="msg-time">#${item.id} · ${formatTime(item.createdAt)}</p><p class="msg-time">${escapeHtml((item.content || "").slice(0, 120) || "[пусто]")}</p></div><span class="menu-badge">→</span></button>`
        )
        .join("") || `<div class="settings-empty"><strong>Ничего не найдено</strong><p class='msg-time'>Попробуйте изменить запрос или область поиска</p></div>`;

      if (box) {
        box.innerHTML = list;
      }

      box?.querySelectorAll("[data-jump-msg]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.dataset.jumpMsg);
          const scope = String(btn.dataset.jumpScope || selectedScope);
          const targetId = Number(btn.dataset.jumpTargetId || selectedTargetId);

          if (scope === "room") {
            if (state.selected?.type !== "room" || state.selected.id !== targetId) {
              await selectRoom(targetId);
            }
          } else {
            if (state.selected?.type !== "dm" || state.selected.id !== targetId) {
              await selectDm(targetId);
            }
          }
          await jumpToMessageInCurrentChat(id, { close: true });
        });
      });
    } catch (error) {
      alert(error.message || "Ошибка поиска");
    } finally {
      const runBtn = els.sheetBody.querySelector("#searchRunBtn");
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = "Искать";
      }
    }
  };

  els.sheetBody.querySelector("#searchRunBtn")?.addEventListener("click", runSearch);
  els.sheetBody.querySelector("input[name='q']")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  });
}

async function sendTextMessage(content) {
  if (!state.selected) {
    return;
  }

  const payload = {
    content: String(content || "").trim(),
    replyToMessageId: state.replyToMessageId,
  };

  if (!payload.content) {
    return;
  }

  if (state.selected.type === "dm") {
    const response = await api(`/api/messages/${state.selected.id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    upsertDmMessage(response.message);
    await loadDmMessages(state.selected.id);
    renderMessages({ forceBottom: true });
  } else {
    const response = await api(`/api/rooms/${state.selected.id}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    upsertRoomMessage(response.message);
    await loadRoomMessages(state.selected.id);
    renderMessages({ forceBottom: true });
  }
  clearReply();
}

async function sendImageMessage(file) {
  if (!file || !state.selected) {
    return;
  }

  const upload = await uploadMessageImage(file);
  const payload = {
    content: els.messageInput.value.trim(),
    imageUrl: upload.imageUrl,
    replyToMessageId: state.replyToMessageId,
  };

  if (state.selected.type === "dm") {
    const response = await api(`/api/messages/${state.selected.id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    upsertDmMessage(response.message);
    await loadDmMessages(state.selected.id);
    renderMessages({ forceBottom: true });
  } else {
    const response = await api(`/api/rooms/${state.selected.id}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    upsertRoomMessage(response.message);
    await loadRoomMessages(state.selected.id);
    renderMessages({ forceBottom: true });
  }

  els.messageInput.value = "";
  clearReply();
  setUploadProgress(100);
}

async function sendFileMessage(file) {
  if (!file || !state.selected) {
    return;
  }
  const upload = await uploadMessageFile(file);
  const payload = {
    content: "",
    fileUrl: upload.fileUrl,
    fileName: upload.fileName,
    fileSize: upload.fileSize,
    replyToMessageId: state.replyToMessageId,
  };
  if (state.selected.type === "dm") {
    const response = await api(`/api/messages/${state.selected.id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    upsertDmMessage(response.message);
    await loadDmMessages(state.selected.id);
    renderMessages({ forceBottom: true });
  } else {
    const response = await api(`/api/rooms/${state.selected.id}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    upsertRoomMessage(response.message);
    await loadRoomMessages(state.selected.id);
    renderMessages({ forceBottom: true });
  }
  clearReply();
}

async function fetchAdminData() {
  if (!state.me?.isAdmin) {
    return null;
  }
  const [overview, users] = await Promise.all([api("/api/admin/overview"), api("/api/admin/users")]);
  return { overview, users };
}

async function openProfileModal() {
  openSheet(
    "Профиль",
    "Сохранить",
    `
      <div class="stack settings-layout">
        <section class="settings-hero profile-hero">
          <div class="profile-hero-main">
            <div class="avatar profile-hero-avatar">${avatarMarkup(state.me)}</div>
            <div>
              <strong>${escapeHtml(state.me?.displayName || "Пользователь")}</strong>
              <p class="msg-time">@${escapeHtml(state.me?.username || "username")}${state.me?.isAdmin ? " · admin" : ""}</p>
            </div>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Быстрое поведение</strong>
              <p class="msg-time">Что открывать в профиле по умолчанию.</p>
            </div>
          </div>
          <div class="segmented compact profile-mode-switcher">
            <button class="seg-btn ${state.listMode === "dm" ? "active" : ""}" type="button" data-switch-list="dm">Чаты</button>
            <button class="seg-btn ${state.listMode === "room" ? "active" : ""}" type="button" data-switch-list="room">Комнаты</button>
          </div>
        </section>

        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Данные профиля</strong>
              <p class="msg-time">Имя и аватар видны другим пользователям.</p>
            </div>
          </div>
          <label>
            <span>Имя</span>
            <input name="displayName" maxlength="40" value="${escapeHtml(state.me?.displayName || "")}" />
          </label>
          <label>
            <span>Аватарка</span>
            <input name="avatar" type="file" accept="image/*" />
          </label>
        </section>

        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Смена пароля</strong>
              <p class="msg-time">Для безопасности аккаунта используйте новый уникальный пароль.</p>
            </div>
          </div>
          <label>
            <span>Текущий пароль</span>
            <input name="currentPassword" type="password" minlength="6" autocomplete="current-password" />
          </label>
          <label>
            <span>Новый пароль</span>
            <input name="newPassword" type="password" minlength="6" autocomplete="new-password" />
          </label>
          <label>
            <span>Повтори новый пароль</span>
            <input name="confirmPassword" type="password" minlength="6" autocomplete="new-password" />
          </label>
        </section>
      </div>
    `,
    async (formData) => {
      const displayName = String(formData.get("displayName") || "").trim();
      if (displayName.length < 2) {
        throw new Error("Имя слишком короткое");
      }
      const updated = await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      });
      state.me = updated.user;

      const avatarFile = formData.get("avatar");
      if (avatarFile && avatarFile.name) {
        const avatar = await uploadAvatar(avatarFile);
        state.me = avatar.user;
      }

      const currentPassword = String(formData.get("currentPassword") || "");
      const newPassword = String(formData.get("newPassword") || "");
      const confirmPassword = String(formData.get("confirmPassword") || "");
      const wantsPasswordChange = Boolean(currentPassword || newPassword || confirmPassword);
      if (wantsPasswordChange) {
        if (!currentPassword || !newPassword || !confirmPassword) {
          throw new Error("Заполни все поля для смены пароля");
        }
        if (newPassword.length < 6) {
          throw new Error("Новый пароль минимум 6 символов");
        }
        if (newPassword !== confirmPassword) {
          throw new Error("Новые пароли не совпадают");
        }
        await api("/api/profile/password", {
          method: "PATCH",
          body: JSON.stringify({ currentPassword, newPassword }),
        });
      }

      await loadUsers();
      renderMe();
      renderEntityList();
      renderMessages();
      updateChatHeader();
    }
  );

  els.sheetBody.querySelectorAll("[data-switch-list]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.switchList;
      setListMode(mode === "room" ? "room" : "dm");
      closeSheet();
      closeSideMenu();
    });
  });
}

async function openAdminConsoleModal() {
  renderSheetLoading("Admin Console", 6);
  const adminData = await fetchAdminData();
  if (!adminData) {
    throw new Error("Доступ только для админа");
  }

  els.sheetTitle.textContent = "Admin Console";
  els.sheetSubmit.classList.add("hidden");
  els.sheetBody.innerHTML = `
      <div class="stack admin-console-layout">
        <section class="settings-hero">
          <div>
            <strong>Admin Console</strong>
            <p class="msg-time">Управляйте пользователями, ролями и доступом из одного центра.</p>
          </div>
        </section>
        <div class="settings-card">
          <div class="segmented compact admin-tabs">
            <button class="seg-btn active" data-admin-tab="create" type="button">Создать</button>
            <button class="seg-btn" data-admin-tab="users" type="button">Пользователи</button>
          </div>
        </div>
        <div class="settings-card admin-panel" data-admin-panel="create">
          <div class="settings-card-head">
            <div>
              <strong>Новый пользователь</strong>
              <p class="msg-time">Создание аккаунта и назначение роли в системе.</p>
            </div>
          </div>
          <div class="stack compact-stack">
            <div class="admin-stats compact-grid admin-kpi-grid">
              <div class="settings-pill">Users: ${adminData.overview.stats.users}</div>
              <div class="settings-pill">Rooms: ${adminData.overview.stats.rooms}</div>
              <div class="settings-pill">DM: ${adminData.overview.stats.dmMessages}</div>
              <div class="settings-pill">Room Msg: ${adminData.overview.stats.roomMessages}</div>
              <div class="settings-pill">Polls: ${adminData.overview.stats.polls}</div>
            </div>
          </div>
          <div class="stack compact-stack">
          <label>
            <span>Новый логин</span>
            <input id="adminCreateUsername" type="text" minlength="3" maxlength="24" placeholder="username" />
          </label>
          <label>
            <span>Имя</span>
            <input id="adminCreateDisplayName" type="text" minlength="2" maxlength="40" placeholder="Имя в чате" />
          </label>
          <label>
            <span>Пароль</span>
            <input id="adminCreatePassword" type="password" minlength="6" placeholder="Минимум 6 символов" />
          </label>
          <label>
            <span>Права</span>
            <select id="adminCreateRole">
              <option value="user">Пользователь</option>
              <option value="admin">Админ</option>
            </select>
          </label>
          <button class="primary" type="button" id="adminCreateUserBtn">Создать пользователя</button>
        </div>
        </div>
        <div class="settings-card admin-panel hidden" data-admin-panel="users">
          <div class="settings-card-head">
            <div>
              <strong>Пользователи</strong>
              <p class="msg-time">Выдача прав, смена пароля и удаление учетных записей.</p>
            </div>
          </div>
        <div class="admin-users">
          ${adminData.users.users
            .map(
              (user) => `
            <div class="admin-user">
              <div class="admin-user-main">
                <div class="avatar">${avatarMarkup(user)}</div>
                <div>
                  <strong>${escapeHtml(user.displayName)}</strong>
                  <p class="msg-time">@${escapeHtml(user.username)}${user.isAdmin ? " · admin" : ""}</p>
                </div>
              </div>
              <div class="admin-user-actions">
                <button class="ghost" type="button" data-admin-user-id="${user.id}" data-admin-next="${user.isAdmin ? "0" : "1"}">
                  ${user.isAdmin ? "Снять" : "Сделать"}
                </button>
                <button class="ghost" type="button" data-admin-pass-user-id="${user.id}" data-admin-pass-user-name="${escapeHtml(user.displayName)}">
                  Пароль
                </button>
                ${user.id !== state.me?.id ? `<button class="ghost danger" type="button" data-admin-delete-user-id="${user.id}" data-admin-delete-user-name="${escapeHtml(user.displayName)}">Удалить</button>` : ""}
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;

  els.sheetBody.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.adminTab;
      els.sheetBody.querySelectorAll("[data-admin-tab]").forEach((item) => {
        item.classList.toggle("active", item.dataset.adminTab === tab);
      });
      els.sheetBody.querySelectorAll("[data-admin-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.adminPanel !== tab);
      });
    });
  });

  els.sheetBody.querySelectorAll("[data-admin-user-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.adminUserId);
      const isAdmin = button.dataset.adminNext === "1";
      try {
        await api(`/api/admin/users/${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ isAdmin }),
        });
        await Promise.all([loadMe(), loadUsers()]);
        renderMe();
        renderEntityList();
        closeSheet();
        showToast(isAdmin ? "Права администратора выданы" : "Права администратора сняты", "success");
        openAdminConsoleModal();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  els.sheetBody.querySelectorAll("[data-admin-delete-user-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.adminDeleteUserId);
      const userName = String(button.dataset.adminDeleteUserName || "");
      openSheet(
        `Удалить · ${userName}`,
        "Удалить",
        `<div class="stack"><p>Удалить пользователя <strong>${escapeHtml(userName)}</strong>?</p><p class="msg-time">Будут удалены его сессии, сообщения и созданные им комнаты.</p></div>`,
        async () => {
          await api(`/api/admin/users/${userId}`, { method: "DELETE" });
          await Promise.all([loadMe(), loadUsers(), loadRooms(), loadInvitations()]);
          if (state.selected?.type === "dm" && state.selected.id === userId) {
            state.selected = state.users.length ? { type: "dm", id: state.users[0].id } : null;
          }
          if (state.selected?.type === "room" && !state.rooms.some((room) => room.id === state.selected.id)) {
            state.selected = state.users.length ? { type: "dm", id: state.users[0].id } : null;
          }
          if (state.selected?.type === "dm") {
            await loadDmMessages(state.selected.id);
          }
          renderMe();
          renderEntityList();
          updateChatHeader();
          renderMessages({ forceBottom: true });
          closeSheet();
          showToast("Пользователь удален", "success");
          await openAdminConsoleModal();
        }
      );
    });
  });

  els.sheetBody.querySelectorAll("[data-admin-pass-user-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.adminPassUserId);
      const userName = String(button.dataset.adminPassUserName || "");
      if (!userId) {
        return;
      }

      openSheet(
        `Новый пароль · ${userName}`,
        "Сохранить",
        `
          <label>
            <span>Новый пароль</span>
            <input name="newPassword" type="password" minlength="6" required />
          </label>
          <label>
            <span>Подтверждение</span>
            <input name="confirmPassword" type="password" minlength="6" required />
          </label>
        `,
        async (formData) => {
          const newPassword = String(formData.get("newPassword") || "");
          const confirmPassword = String(formData.get("confirmPassword") || "");
          if (newPassword.length < 6) {
            throw new Error("Новый пароль минимум 6 символов");
          }
          if (newPassword !== confirmPassword) {
            throw new Error("Пароли не совпадают");
          }
          await api(`/api/admin/users/${userId}/password`, {
            method: "PATCH",
            body: JSON.stringify({ newPassword }),
          });
          showToast("Пароль пользователя обновлен", "success");
        }
      );
    });
  });

  const createBtn = document.getElementById("adminCreateUserBtn");
  if (createBtn) {
    createBtn.addEventListener("click", async () => {
      const username = String(document.getElementById("adminCreateUsername")?.value || "").trim();
      const displayName = String(document.getElementById("adminCreateDisplayName")?.value || "").trim();
      const password = String(document.getElementById("adminCreatePassword")?.value || "");
      const role = String(document.getElementById("adminCreateRole")?.value || "user");
      try {
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            username,
            displayName,
            password,
            isAdmin: role === "admin",
          }),
        });
        await Promise.all([loadMe(), loadUsers()]);
        renderMe();
        renderEntityList();
        closeSheet();
        showToast("Пользователь создан", "success");
        openAdminConsoleModal();
      } catch (error) {
        alert(error.message);
      }
    });
  }
}

async function openSettingsModal() {
  renderSheetLoading("Настройки", 5);
  const sessionsData = await api("/api/auth/sessions").catch(() => ({ sessions: [] }));
  const sessions = sessionsData.sessions || [];
  const notificationsData = await api("/api/notifications/status").catch(() => ({ pushEnabled: false, subscriptions: 0 }));

  const notificationSupported = isNotificationsAvailable();
  const permissionLabel = notificationSupported ? Notification.permission : "unsupported";
  const notificationsDenied = permissionLabel === "denied";
  const notificationsUnsupported = permissionLabel === "unsupported";
  const notificationsGranted = permissionLabel === "granted";

  if (notificationsDenied || notificationsUnsupported) {
    state.notificationsEnabled = false;
    localStorage.setItem("notificationsEnabled", "0");
  }

  const statusText = notificationsUnsupported
    ? "Уведомления не поддерживаются браузером"
    : notificationsDenied
      ? "Уведомления заблокированы в браузере"
      : notificationsGranted
        ? "Уведомления разрешены"
        : "Разрешение еще не выдано";

  const sessionsHtml = sessions.length
    ? `<div class="settings-device-list">${sessions
        .map(
          (session) => `
          <div class="settings-device-card ${session.isCurrent ? "current" : ""}">
            <div class="settings-device-main">
              <div>
                <strong>${session.isCurrent ? "Это устройство" : "Подключенное устройство"}</strong>
                <p class="msg-time">${escapeHtml((session.userAgent || "").slice(0, 90) || "Unknown client")}</p>
              </div>
              ${session.isCurrent ? `<span class="role-chip admin">online</span>` : ""}
            </div>
            <p class="msg-time">IP: ${escapeHtml(session.ip || "-")}</p>
            <p class="msg-time">Активность: ${escapeHtml(formatDateTime(session.lastSeenAt) || "-")}</p>
            ${session.isCurrent ? "" : `<button class="ghost danger compact-btn" type="button" data-session-revoke="${session.id}">Завершить</button>`}
          </div>
        `
        )
        .join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Нет данных по устройствам</p></div>`;

  const notificationCardClass = notificationsDenied || notificationsUnsupported
    ? "settings-card warning"
    : notificationsGranted
      ? "settings-card success"
      : "settings-card";

  els.sheetTitle.textContent = "Настройки";
  els.sheetSubmit.classList.add("hidden");
  els.sheetBody.innerHTML = `
      <div class="stack settings-layout">
        <section class="settings-hero">
          <div>
            <strong>Pulse Settings</strong>
            <p class="msg-time">Персонализируйте внешний вид, уведомления и контроль доступа к аккаунту.</p>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Тема интерфейса</strong>
              <p class="msg-time">Светлая и темная палитра переключаются мгновенно.</p>
            </div>
          </div>
          <div class="segmented compact settings-theme-switcher">
            <button class="seg-btn ${state.theme === "light" ? "active" : ""}" data-theme-btn="light" type="button">Светлая</button>
            <button class="seg-btn ${state.theme === "dark" ? "active" : ""}" data-theme-btn="dark" type="button">Темная</button>
          </div>
        </section>
        <section class="${notificationCardClass}">
          <div class="settings-card-head">
            <div>
              <strong>Уведомления</strong>
              <p class="msg-time">Управление доступом браузера и локальными оповещениями.</p>
            </div>
            <label class="settings-toggle ${notificationsDenied || notificationsUnsupported ? "disabled" : ""}">
              <input id="notificationsEnabledToggle" type="checkbox" ${state.notificationsEnabled ? "checked" : ""} ${notificationsDenied || notificationsUnsupported ? "disabled" : ""} />
              <span></span>
            </label>
          </div>
          <p class="settings-status" id="notificationsStatus">${statusText}</p>
          <div class="settings-meta-grid notifications-grid">
            <div class="settings-pill ${notificationsData.pushEnabled ? "" : "disabled"}">Push backend: ${notificationsData.pushEnabled ? "OK" : "OFF"}</div>
            <div class="settings-pill ${notificationsData.subscriptions ? "" : "disabled"}">Подписок: ${notificationsData.subscriptions}</div>
          </div>
          <div class="settings-actions-row">
            <button id="notificationsPermissionBtn" class="ghost ${notificationsGranted || notificationsUnsupported ? "hidden" : ""}" type="button">Разрешить уведомления</button>
            <button id="notificationsHelpBtn" class="ghost ${notificationsDenied ? "" : "hidden"}" type="button">Как включить</button>
            <button id="notificationsTestBtn" class="ghost ${notificationsGranted ? "" : "hidden"}" type="button">Тест уведомления</button>
            <button id="notificationsPushTestBtn" class="ghost ${notificationsGranted && notificationsData.pushEnabled && notificationsData.subscriptions ? "" : "hidden"}" type="button">Тест push</button>
            <button id="notificationsResetBtn" class="ghost ${notificationsData.subscriptions ? "" : "hidden"}" type="button">Сбросить подписку</button>
            <button id="notificationsRefreshBtn" class="ghost" type="button">Обновить статус</button>
          </div>
          <div class="settings-meta-grid">
            <div class="settings-pill disabled">Звуки скоро</div>
            <div class="settings-pill disabled">Компактный режим скоро</div>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Устройства и сессии</strong>
              <p class="msg-time">Список устройств, где есть доступ к аккаунту.</p>
            </div>
          </div>
          ${sessionsHtml}
        </section>
      </div>
    `;

  els.sheetBody.querySelectorAll("[data-theme-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeBtn);
      els.sheetBody.querySelectorAll("[data-theme-btn]").forEach((item) => {
        item.classList.toggle("active", item.dataset.themeBtn === state.theme);
      });
    });
  });

  const notifToggle = els.sheetBody.querySelector("#notificationsEnabledToggle");
  notifToggle?.addEventListener("change", async () => {
    if (notificationsDenied || notificationsUnsupported) {
      return;
    }
    state.notificationsEnabled = Boolean(notifToggle.checked);
    localStorage.setItem("notificationsEnabled", state.notificationsEnabled ? "1" : "0");
    await syncPushSubscription();
  });

  els.sheetBody.querySelector("#notificationsPermissionBtn")?.addEventListener("click", async () => {
    try {
      await requestNotificationPermissionAndSync();
      const status = els.sheetBody.querySelector("#notificationsStatus");
      if (status) {
        status.textContent = Notification.permission === "granted"
          ? "Уведомления разрешены"
          : Notification.permission === "denied"
            ? "Уведомления заблокированы в браузере"
            : "Разрешение еще не выдано";
      }
      closeSheet();
      await openSettingsModal();
    } catch (error) {
      alert(error.message);
    }
  });

  els.sheetBody.querySelector("#notificationsTestBtn")?.addEventListener("click", async () => {
    try {
      await showLocalNotification({
        title: "Pulse Messenger",
        body: "Тестовое уведомление работает корректно.",
      });
      showToast("Тестовое уведомление отправлено", "success");
    } catch (error) {
      alert(error.message || "Не удалось показать уведомление");
    }
  });

  els.sheetBody.querySelector("#notificationsPushTestBtn")?.addEventListener("click", async () => {
    try {
      await api("/api/notifications/test", { method: "POST" });
      showToast("Тестовый push отправлен", "success");
    } catch (error) {
      alert(error.message || "Не удалось отправить push");
    }
  });

  els.sheetBody.querySelector("#notificationsResetBtn")?.addEventListener("click", async () => {
    try {
      await removePushSubscriptionOnServer();
      const registration = await registerServiceWorkerIfNeeded();
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }
      await syncPushSubscription();
      showToast("Push-подписка обновлена", "success");
      closeSheet();
      await openSettingsModal();
    } catch (error) {
      alert(error.message || "Не удалось сбросить подписку");
    }
  });

  els.sheetBody.querySelector("#notificationsRefreshBtn")?.addEventListener("click", async () => {
    closeSheet();
    await openSettingsModal();
  });

  els.sheetBody.querySelector("#notificationsHelpBtn")?.addEventListener("click", () => {
    openSheet(
      "Как включить уведомления",
      "",
      `
        <div class="stack">
          <p class="msg-time">1. Откройте настройки сайта в адресной строке (иконка слева от URL).</p>
          <p class="msg-time">2. Для пункта «Уведомления» выберите «Разрешить».</p>
          <p class="msg-time">3. Обновите страницу и снова откройте «Настройки».</p>
        </div>
      `,
      async () => {}
    );
  });


  els.sheetBody.querySelectorAll("[data-session-revoke]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sessionId = button.dataset.sessionRevoke;
      try {
        await api(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
        closeSheet();
        await openSettingsModal();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function openContactsModal() {
  const contacts = state.users
    .map(
      (user) => `
      <button class="menu-contact-item settings-contact-card" type="button" data-open-dm="${user.id}">
        <div class="avatar">${avatarMarkup(user)}</div>
        <div>
          <strong>${escapeHtml(user.displayName)}</strong>
          <p class="msg-time">@${escapeHtml(user.username)}${user.online ? " · online" : ""}</p>
        </div>
        ${user.unreadCount ? `<span class="menu-badge">${user.unreadCount > 99 ? "99+" : user.unreadCount}</span>` : ""}
      </button>
    `
    )
    .join("");

  openSheet(
    "Контакты",
    "",
    `
      <div class="stack settings-layout">
        <section class="settings-hero">
          <div>
            <strong>Контакты</strong>
            <p class="msg-time">Откройте личный диалог одним нажатием.</p>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Все пользователи</strong>
              <p class="msg-time">Выберите человека, чтобы сразу перейти в диалог.</p>
            </div>
          </div>
          <div class="menu-contacts contacts-modal-list">${contacts || "<div class='settings-empty'><strong>Пусто</strong><p class='msg-time'>Контактов нет</p></div>"}</div>
        </section>
      </div>
    `,
    async () => {}
  );

  els.sheetBody.querySelectorAll("[data-open-dm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = Number(button.dataset.openDm);
      closeSheet();
      closeSideMenu();
      await selectDm(userId);
    });
  });
}

function openAboutModal() {
  openSheet(
    "О приложении",
    "",
    `
      <div class="stack settings-layout">
        <section class="settings-hero">
          <div>
            <strong>Pulse Messenger</strong>
            <p class="msg-time">v1.0 · realtime чат для личного круга, комнат и приватного общения.</p>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>Что уже умеет</strong>
              <p class="msg-time">Базовая платформа общения с акцентом на живой realtime UX.</p>
            </div>
          </div>
          <div class="settings-meta-grid about-grid">
            <div class="settings-pill">Личные чаты</div>
            <div class="settings-pill">Комнаты</div>
            <div class="settings-pill">Приглашения</div>
            <div class="settings-pill">Реакции</div>
            <div class="settings-pill">Опросы</div>
            <div class="settings-pill">Изображения</div>
          </div>
        </section>
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <strong>О проекте</strong>
              <p class="msg-time">Собран на Node.js, Socket.IO и SQLite, подходит для VPS и Raspberry Pi.</p>
            </div>
          </div>
        </section>
      </div>
    `,
    async () => {}
  );
}

async function openSharedMediaSheet() {
  if (!state.selected) return;
  renderSheetLoading("Медиа и ссылки", 5);
  const scope = state.selected.type === "room" ? "room" : "dm";
  const targetId = state.selected.id;
  const data = await api(`/api/media/shared?scope=${scope}&targetId=${targetId}&limit=80`);
  const media = data.media || [];
  const files = data.files || [];
  const links = data.links || [];

  const mediaHtml = media.length
    ? `<div class="shared-grid">${media
        .map((item) => item.type === "image"
          ? `<button type="button" class="shared-media-card image" data-open-image="${escapeHtml(item.imageUrl)}"><img src="${escapeHtml(item.imageUrl)}" alt="image" /><span class="msg-time">${formatTime(item.createdAt)}</span></button>`
          : ``)
        .join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Медиа еще не отправляли</p></div>`;

  const linksHtml = links.length
    ? `<div class="menu-contacts search-results-list">${links.map((item) => `<a class="menu-contact-item settings-contact-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><div><strong>${escapeHtml(item.url)}</strong><p class="msg-time">Сообщение #${item.id} · ${formatTime(item.createdAt)}</p></div><span class="menu-badge">→</span></a>`).join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Ссылок пока нет</p></div>`;
  const filesHtml = files.length
    ? `<div class="file-list">${files.map((item) => `<div class="file-box shared"><div class="file-kind-badge kind-${escapeHtml(fileKind(item.fileName).toLowerCase())}">${escapeHtml(fileKind(item.fileName))}</div><div class="file-box-main"><strong>${escapeHtml(item.fileName || "Файл")}</strong><p class="msg-time">${escapeHtml(formatFileSize(item.fileSize) || "Документ")} · ${formatTime(item.createdAt)}</p></div><div class="file-box-actions"><a class="ghost compact-btn" href="${escapeHtml(item.fileUrl)}" target="_blank" rel="noopener noreferrer">Открыть</a><button class="ghost compact-btn" type="button" data-copy-file-link="${escapeHtml(item.fileUrl)}">Копия</button></div></div>`).join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Файлов пока нет</p></div>`;

  openSheet(
    "Медиа и ссылки",
    "",
    `
      <div class="stack settings-layout">
        <section class="settings-hero"><div><strong>Shared media</strong><p class="msg-time">Все изображения, файлы и ссылки из выбранного чата.</p></div></section>
        <section class="settings-card"><div class="settings-card-head"><div><strong>Медиа</strong><p class="msg-time">Картинки, отправленные в этом чате.</p></div></div>${mediaHtml}</section>
        <section class="settings-card"><div class="settings-card-head"><div><strong>Файлы</strong><p class="msg-time">Документы и вложения из чата.</p></div></div>${filesHtml}</section>
        <section class="settings-card"><div class="settings-card-head"><div><strong>Ссылки</strong><p class="msg-time">Все URL, найденные в сообщениях.</p></div></div>${linksHtml}</section>
      </div>
    `,
    async () => {}
  );

  els.sheetBody.querySelectorAll("[data-open-image]").forEach((button) => {
    button.addEventListener("click", () => openImageViewer(button.dataset.openImage || ""));
  });
  els.sheetBody.querySelectorAll("[data-copy-file-link]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = String(button.dataset.copyFileLink || "");
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        showToast("Ссылка на файл скопирована", "success");
      } catch {
        showToast(value, "info");
      }
    });
  });
}

async function openDmProfileSheet(userId, initialTab = "info") {
  const user = state.users.find((item) => item.id === userId);
  if (!user) {
    throw new Error("Пользователь не найден");
  }

  renderSheetLoading(user.displayName, 5);
  const data = await api(`/api/media/shared?scope=dm&targetId=${userId}&limit=80`);
  const media = data.media || [];
  const files = data.files || [];
  const links = data.links || [];
  const mediaPreview = media.slice(0, 3);

  const mediaHtml = media.length
    ? `<div class="shared-grid">${media
        .map((item) => `<button type="button" class="shared-media-card image" data-open-image="${escapeHtml(item.imageUrl)}"><img src="${escapeHtml(item.imageUrl)}" alt="image" /><span class="msg-time">${formatTime(item.createdAt)}</span></button>`)
        .join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Изображений пока нет</p></div>`;

  const linksHtml = links.length
    ? `<div class="menu-contacts search-results-list">${links.map((item) => `<a class="menu-contact-item settings-contact-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><div><strong>${escapeHtml(item.url)}</strong><p class="msg-time">Сообщение #${item.id} · ${formatTime(item.createdAt)}</p></div><span class="menu-badge">→</span></a>`).join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Ссылок пока нет</p></div>`;
  const filesHtml = files.length
    ? `<div class="menu-contacts search-results-list">${files.map((item) => `<a class="menu-contact-item settings-contact-card" href="${escapeHtml(item.fileUrl)}" target="_blank" rel="noopener noreferrer"><div><strong>${escapeHtml(item.fileName || "Файл")}</strong><p class="msg-time">${escapeHtml(formatFileSize(item.fileSize) || "Документ")} · ${formatTime(item.createdAt)}</p></div><span class="menu-badge">→</span></a>`).join("")}</div>`
    : `<div class="settings-empty"><strong>Пусто</strong><p class="msg-time">Файлов пока нет</p></div>`;

  const statusLabel = presenceLabel(user);
  const summaryHtml = `
    <div class="settings-meta-grid room-summary-grid">
      <div class="settings-pill">Медиа: ${media.length}</div>
      <div class="settings-pill">Ссылки: ${links.length}</div>
      <div class="settings-pill">Файлы: ${files.length}</div>
      <div class="settings-pill ${state.onlineIds.has(user.id) ? "" : "disabled"}">${state.onlineIds.has(user.id) ? "online" : "last seen"}</div>
    </div>
    ${mediaPreview.length ? `<div class="room-media-strip">${mediaPreview.map((item) => `<button type="button" class="room-media-strip-item" data-open-image="${escapeHtml(item.imageUrl)}"><img src="${escapeHtml(item.imageUrl)}" alt="image" /></button>`).join("")}${media.length > mediaPreview.length ? `<button type="button" class="room-media-strip-more" data-dm-profile-tab-jump="media">+${media.length - mediaPreview.length}</button>` : ""}</div>` : ""}
  `;

  openSheet(
    user.displayName,
    "",
    `
      <div class="stack settings-layout room-profile-layout">
        <section class="settings-hero room-profile-hero">
          <div class="profile-hero-main">
            <div class="avatar profile-hero-avatar">${avatarMarkup(user)}</div>
            <div>
              <strong>${escapeHtml(user.displayName)}</strong>
              <p class="msg-time">@${escapeHtml(user.username)}${user.isAdmin ? " · admin" : ""}</p>
              <p class="msg-time">${escapeHtml(statusLabel)}</p>
            </div>
          </div>
        </section>
        <section class="settings-card">
          <div class="segmented compact room-profile-tabs">
            <button class="seg-btn ${initialTab === "info" ? "active" : ""}" data-dm-profile-tab="info" type="button">Инфо</button>
            <button class="seg-btn ${initialTab === "media" ? "active" : ""}" data-dm-profile-tab="media" type="button">Медиа</button>
            <button class="seg-btn ${initialTab === "links" ? "active" : ""}" data-dm-profile-tab="links" type="button">Ссылки</button>
            <button class="seg-btn ${initialTab === "files" ? "active" : ""}" data-dm-profile-tab="files" type="button">Файлы</button>
          </div>
        </section>
        <section class="settings-card room-profile-panel ${initialTab === "info" ? "" : "hidden"}" data-dm-profile-panel="info">
          <div class="settings-card-head"><div><strong>О пользователе</strong><p class="msg-time">Основная информация о собеседнике.</p></div></div>
          ${summaryHtml}
          <div class="settings-meta-grid">
            <div class="settings-pill">Диалог</div>
            <div class="settings-pill ${state.onlineIds.has(user.id) ? "" : "disabled"}">${state.onlineIds.has(user.id) ? "online" : "offline"}</div>
            ${user.isAdmin ? `<div class="settings-pill">admin</div>` : ""}
          </div>
          <div class="settings-actions-row">
            <button type="button" class="ghost" data-dm-open-search>Поиск</button>
            <button type="button" class="ghost" data-dm-open-media>Медиа</button>
            <button type="button" class="ghost danger" data-dm-clear>Очистить</button>
          </div>
          <div class="settings-empty room-link-box">
            <strong>Статус</strong>
            <p class="msg-time">${statusLabel}</p>
          </div>
        </section>
        <section class="settings-card room-profile-panel ${initialTab === "media" ? "" : "hidden"}" data-dm-profile-panel="media">
          <div class="settings-card-head"><div><strong>Медиа</strong><p class="msg-time">Все изображения из этого диалога.</p></div></div>
          ${mediaHtml}
        </section>
        <section class="settings-card room-profile-panel ${initialTab === "links" ? "" : "hidden"}" data-dm-profile-panel="links">
          <div class="settings-card-head"><div><strong>Ссылки</strong><p class="msg-time">Все ссылки, отправленные в этом диалоге.</p></div></div>
          ${linksHtml}
        </section>
        <section class="settings-card room-profile-panel ${initialTab === "files" ? "" : "hidden"}" data-dm-profile-panel="files">
          <div class="settings-card-head"><div><strong>Файлы</strong><p class="msg-time">Все документы и вложения из этого диалога.</p></div></div>
          ${filesHtml}
        </section>
      </div>
    `,
    async () => {}
  );

  els.sheetBody.querySelectorAll("[data-dm-profile-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.dmProfileTab;
      els.sheetBody.querySelectorAll("[data-dm-profile-tab]").forEach((item) => {
        item.classList.toggle("active", item.dataset.dmProfileTab === tab);
      });
      els.sheetBody.querySelectorAll("[data-dm-profile-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.dmProfilePanel !== tab);
      });
    });
  });

  els.sheetBody.querySelectorAll("[data-open-image]").forEach((button) => {
    button.addEventListener("click", () => openImageViewer(button.dataset.openImage || ""));
  });
  els.sheetBody.querySelectorAll("[data-dm-profile-tab-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.dmProfileTabJump;
      els.sheetBody.querySelectorAll("[data-dm-profile-tab]").forEach((item) => {
        item.classList.toggle("active", item.dataset.dmProfileTab === tab);
      });
      els.sheetBody.querySelectorAll("[data-dm-profile-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.dmProfilePanel !== tab);
      });
    });
  });

  els.sheetBody.querySelector("[data-dm-open-search]")?.addEventListener("click", async () => {
    await openSearchMessagesSheet();
  });
  els.sheetBody.querySelector("[data-dm-open-media]")?.addEventListener("click", () => {
    els.sheetBody.querySelectorAll("[data-dm-profile-tab]").forEach((item) => {
      item.classList.toggle("active", item.dataset.dmProfileTab === "media");
    });
    els.sheetBody.querySelectorAll("[data-dm-profile-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.dmProfilePanel !== "media");
    });
  });
  els.sheetBody.querySelector("[data-dm-clear]")?.addEventListener("click", async () => {
    await clearDialogWithUser(user.id);
    closeSheet();
  });
}

function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = io({ auth: { token: state.token } });

  state.socket.on("presence:update", (ids) => {
    state.onlineIds = new Set(ids || []);
    renderEntityList();
    updateChatHeader();
  });

  state.socket.on("message:new", async (message) => {
    upsertDmMessage(message);
    if (message.senderId && message.senderId !== state.me?.id) {
      setTypingPresence("dm", message.senderId, message.senderId, false);
    }
    const peerId = message.senderId === state.me?.id ? message.receiverId : message.senderId;
    const activeDm = state.selected?.type === "dm" && state.selected.id === peerId;
    const incoming = message.senderId !== state.me?.id;
    touchDmPreviewFromMessage(message, { incrementUnread: incoming && !activeDm });
    if (activeDm) {
      await loadDmMessages(peerId);
      renderMessages({ forceBottom: true });
    }
    if (incoming && (!activeDm || document.visibilityState !== "visible")) {
      const peer = state.users.find((u) => u.id === peerId);
      await showLocalNotification({
        title: peer ? peer.displayName : "Новое сообщение",
        body: messagePreviewText(message) || "Новое сообщение",
      });
    }
    renderEntityList();
    updateChatHeader();
  });
  state.socket.on("message:update", (message) => upsertDmMessage(message));
  state.socket.on("typing:update", ({ scope, targetId, userId, isTyping }) => {
    if (!scope || !targetId || !userId || userId === state.me?.id) {
      return;
    }
    if (scope === "dm") {
      setTypingPresence("dm", targetId, userId, Boolean(isTyping));
      return;
    }
    if (scope === "room") {
      setTypingPresence("room", targetId, userId, Boolean(isTyping));
    }
  });
  state.socket.on("dm:read", ({ peerUserId, readAt }) => {
    if (!peerUserId) {
      return;
    }
    const prev = asUtcMs(state.dmReadByPeerId.get(peerUserId));
    const next = asUtcMs(readAt);
    if (!next || next < prev) {
      return;
    }
    state.dmReadByPeerId.set(peerUserId, readAt);
    if (state.selected?.type === "dm" && state.selected.id === peerUserId) {
      renderMessages();
    }
  });
  state.socket.on("room:message:new", async (message) => {
    upsertRoomMessage(message);
    if (message.roomId && message.senderId && message.senderId !== state.me?.id) {
      setTypingPresence("room", message.roomId, message.senderId, false);
    }
    const activeRoom = state.selected?.type === "room" && state.selected.id === message.roomId;
    const incoming = message.senderId !== state.me?.id;
    touchRoomPreviewFromMessage(message, { incrementUnread: incoming && !activeRoom });
    if (activeRoom) {
      await loadRoomMessages(message.roomId);
      renderMessages({ forceBottom: true });
    }
    if (incoming && (!activeRoom || document.visibilityState !== "visible")) {
      const room = state.rooms.find((r) => r.id === message.roomId);
      await showLocalNotification({
        title: room ? `# ${room.name}` : "Новое сообщение в комнате",
        body: messagePreviewText(message) || "Новое сообщение",
      });
    }
    renderEntityList();
    updateChatHeader();
  });
  state.socket.on("room:message:update", (message) => upsertRoomMessage(message));

  state.socket.on("rooms:update", async () => {
    await Promise.all([loadRooms(), loadInvitations()]);
    refreshInvitationsButton();
    renderEntityList();
    updateChatHeader();
  });

  state.socket.on("room:invitation", async ({ invitation }) => {
    await Promise.all([loadRooms(), loadInvitations()]);
    refreshInvitationsButton();
    renderEntityList();
    if (invitation?.roomName) {
      openSheet(
        "Новое приглашение",
        "Открыть",
        `<div class="stack"><p>Вас пригласили в комнату <strong>${escapeHtml(invitation.roomName)}</strong>.</p><p class="msg-time">Откройте раздел «Приглашения», чтобы принять или отклонить.</p></div>`,
        async () => {
          openInvitationsSheet();
          return false;
        }
      );
    }
  });

  state.socket.on("room:member:kicked", async ({ roomId, roomName }) => {
    await Promise.all([loadRooms(), loadInvitations()]);
    refreshInvitationsButton();
    if (state.selected?.type === "room" && state.selected.id === roomId) {
      state.selected = state.users.length ? { type: "dm", id: state.users[0].id } : null;
      if (state.selected?.type === "dm") {
        await loadDmMessages(state.selected.id);
      }
      renderMessages();
    }
    renderEntityList();
    updateChatHeader();
    openSheet(
      "Доступ обновлен",
      "Понятно",
      `<p class='msg-time'>Вы были удалены из комнаты <strong>${escapeHtml(roomName || "")}</strong>.</p>`,
      async () => {}
    );
  });

  state.socket.on("dialog:cleared", ({ peerUserId }) => {
    if (!peerUserId) {
      return;
    }
    state.dmMessagesByUserId.set(peerUserId, []);
    if (state.selected?.type === "dm" && state.selected.id === peerUserId) {
      renderMessages();
    }
  });

  state.socket.on("room:deleted", async ({ roomId }) => {
    if (!roomId) {
      return;
    }
    state.roomMessagesByRoomId.delete(roomId);
    await loadRooms();
    if (state.selected?.type === "room" && state.selected.id === roomId) {
      state.selected = state.users.length ? { type: "dm", id: state.users[0].id } : null;
      if (state.selected?.type === "dm") {
        await loadDmMessages(state.selected.id);
      }
    }
    renderEntityList();
    updateChatHeader();
    renderMessages();
  });

  state.socket.on("pins:update", async ({ scope, targetId }) => {
    if (!scope || !targetId || !state.selected) {
      return;
    }
    if (scope === "dm" && state.selected.type === "dm" && state.selected.id === targetId) {
      await loadDmMessages(targetId);
      renderMessages();
      return;
    }
    if (scope === "room" && state.selected.type === "room" && state.selected.id === targetId) {
      await loadRoomMessages(targetId);
      renderMessages();
    }
  });

  state.socket.on("users:update", async () => {
    await Promise.all([loadMe(), loadUsers()]);
    renderMe();
    renderEntityList();
    updateChatHeader();
  });

  state.socket.on("poll:update", (poll) => {
    if (!poll?.id) {
      return;
    }
    patchPoll(poll);
    renderMessages();
  });
}

async function startSession() {
  await Promise.all([loadMe(), loadUsers(), loadRooms(), loadInvitations()]);
  await registerServiceWorkerIfNeeded();
  syncPushSubscription().catch(() => {});
  checkForAppUpdate().catch(() => {});
  setInterval(() => {
    checkForAppUpdate().catch(() => {});
  }, 60000);
  showChat();
  renderMe();
  refreshInvitationsButton();
  refreshListFiltersUI();
  await handleIncomingNavigation(location.href);
  const slugMatch = location.pathname.match(/^\/room\/([a-z0-9-]+)$/i);
  if (slugMatch?.[1]) {
    try {
      const data = await api(`/api/room-slug/${encodeURIComponent(slugMatch[1])}`);
      if (data.room?.id) {
        await selectRoom(data.room.id);
        history.replaceState({}, "", "/");
        return;
      }
    } catch (error) {
      showToast("Комната по ссылке не найдена или недоступна", "error");
      history.replaceState({}, "", "/");
    }
  }

  if (!state.selected && state.users.length) {
    state.selected = { type: "dm", id: state.users[0].id };
  }

  setListMode("dm");
  renderEntityList();
  updateChatHeader();

  if (state.selected?.type === "dm") {
    await loadDmMessages(state.selected.id);
    renderMessages({ forceBottom: true });
  }

  connectSocket();
}

function resetSession() {
  stopTypingEmit();
  clearPendingImage();
  refreshInFlight = null;
  removePushSubscriptionOnServer().catch(() => {});
  setToken("");
  state.me = null;
  state.users = [];
  state.rooms = [];
  state.invitations = [];
  state.listFilter = "all";
  state.selected = null;
  state.search = "";
  state.replyToMessageId = null;
  state.dmMessagesByUserId.clear();
  state.roomMessagesByRoomId.clear();
  state.dmHasMoreByUserId.clear();
  state.roomHasMoreByRoomId.clear();
  state.pinnedByDialogId.clear();
  state.pinnedByRoomId.clear();
  state.dmReadByPeerId.clear();
  state.typingDmByUserId.clear();
  state.typingRoomByRoomId.clear();
  state.unseenStartByChatKey.clear();
  state.unseenCountByChatKey.clear();
  state.newlyArrivedMessageIds.clear();
  state.renderWindowStartByChatKey.clear();
  for (const timer of typingClearTimers.values()) {
    clearTimeout(timer);
  }
  typingClearTimers.clear();
  state.onlineIds = new Set();
  if (els.menuAdminBtn) {
    els.menuAdminBtn.classList.add("hidden");
  }

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  closeSideMenu();
  closeLeftPanel();
  closeSheet();
  clearReply();
  refreshListFiltersUI();

  els.authForm.reset();
  setMode("login");
  showAuth();
}

function fillEmojiPanel() {
  els.emojiPanel.innerHTML = "";
  for (const emoji of EMOJIS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-btn";
    button.textContent = emoji;
    button.addEventListener("click", () => {
      els.messageInput.value += emoji;
      els.messageInput.focus();
    });
    els.emojiPanel.appendChild(button);
  }
}

els.loginTab?.addEventListener("click", () => setMode("login"));
els.registerTab?.addEventListener("click", () => setMode("register"));

els.openChatsBtn.addEventListener("click", () => openLeftPanel());
els.openMenuBtn.addEventListener("click", () => openSideMenu());
els.closeMenuBtn.addEventListener("click", () => closeSideMenu());
els.overlay.addEventListener("click", () => {
  closeLeftPanel();
  closeSideMenu();
  closeSheet();
});

els.sheetClose.addEventListener("click", () => closeSheet());
els.sheet.addEventListener("click", (event) => {
  if (event.target === els.sheet) {
    closeSheet();
  }
});

els.dmTab.addEventListener("click", () => setListMode("dm"));
els.roomsTab.addEventListener("click", () => setListMode("room"));
els.menuProfileBtn.addEventListener("click", async () => {
  try {
    closeSideMenu();
    await openProfileModal();
  } catch (error) {
    alert(error.message);
  }
});
els.menuAdminBtn?.addEventListener("click", async () => {
  try {
    closeSideMenu();
    await openAdminConsoleModal();
  } catch (error) {
    alert(error.message);
  }
});
els.menuSettingsBtn.addEventListener("click", async () => {
  closeSideMenu();
  try {
    await openSettingsModal();
  } catch (error) {
    alert(error.message);
  }
});
els.menuContactsBtn.addEventListener("click", () => {
  closeSideMenu();
  openContactsModal();
});
els.menuInvitesBtn?.addEventListener("click", () => {
  closeSideMenu();
  openInvitationsSheet();
});
els.menuAboutBtn.addEventListener("click", () => {
  closeSideMenu();
  openAboutModal();
});

els.chatSearchInput.addEventListener("input", () => {
  state.search = els.chatSearchInput.value.trim();
  renderEntityList();
});

els.createRoomBtn.addEventListener("click", () => openCreateRoomSheet());
els.invitationsBtn?.addEventListener("click", () => openInvitationsSheet());
els.listFilters?.querySelectorAll("[data-list-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.listFilter;
    state.listFilter = ["all", "unread", "archived"].includes(filter) ? filter : "all";
    refreshListFiltersUI();
    renderEntityList();
  });
});
function buildChatHeaderContextItems() {
  if (!state.selected) {
    return [];
  }

  const items = [];

  if (state.selected.type === "room") {
    const room = state.rooms.find((item) => item.id === state.selected.id);
    if (room?.joined) {
      items.push({ label: "Поиск по сообщениям", onClick: async () => openSearchMessagesSheet() });
    }
    const canDeleteRoom = state.me?.isAdmin || room?.createdBy === state.me?.id || room?.canOwn;
    if (canDeleteRoom) {
      items.push({ label: "Удалить комнату", danger: true, onClick: async () => deleteRoom(state.selected.id) });
    }
  } else {
    items.push({ label: "Поиск по сообщениям", onClick: async () => openSearchMessagesSheet() });
    items.push({ label: "Очистить диалог", danger: true, onClick: async () => clearDialogWithUser(state.selected.id) });
  }

  return items;
}

document.querySelector(".chat-head")?.addEventListener("contextmenu", (event) => {
  if (!state.selected) {
    return;
  }
  event.preventDefault();
  showContextMenu(event.clientX, event.clientY, buildChatHeaderContextItems());
});

const chatHeadEl = document.querySelector(".chat-head");
if (chatHeadEl) {
  attachLongPress(chatHeadEl, (x, y) => {
    if (!state.selected) {
      return;
    }
    showContextMenu(x, y, buildChatHeaderContextItems());
  });
}

els.chatActionsBtn.addEventListener("click", (event) => {
  if (!state.selected) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  showContextMenu(rect.right, rect.bottom + 6, buildChatHeaderContextItems(), { forceFloating: true });
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authError.textContent = "";

  const username = els.usernameInput.value.trim();
  const password = els.passwordInput.value;

  try {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(response.token);
    await startSession();
  } catch (error) {
    els.authError.textContent = error.message;
  }
});

els.logoutBtn.addEventListener("click", async () => {
  try {
    if (state.token) {
      await api("/api/auth/logout", { method: "POST" });
    }
  } catch (error) {
    // ignore network errors on logout
  } finally {
    resetSession();
  }
});

els.composeMetaCancel.addEventListener("click", () => clearReply());
els.reloadAppBtn?.addEventListener("click", () => {
  window.location.reload();
});
els.selectionCopyBtn?.addEventListener("click", async () => {
  await copySelectedMessages();
});
els.selectionAllBtn?.addEventListener("click", () => {
  if (allLoadedMessagesSelected()) {
    clearMessageSelection();
    return;
  }
  selectAllLoadedMessages();
});
els.selectionClearBtn?.addEventListener("click", () => clearMessageSelection());
els.selectionForwardBtn?.addEventListener("click", () => openForwardSheet([]));
els.selectionDeleteBtn?.addEventListener("click", async () => {
  await deleteSelectedMessages();
});

els.composeMetaText.addEventListener("click", async () => {
  const id = Number(els.composeMetaText.dataset.replyMsgId || 0);
  if (!id || !state.selected) {
    return;
  }
  await jumpToMessageInCurrentChat(id);
});

els.attachToggleBtn.addEventListener("click", () => {
  els.attachMenu.classList.toggle("hidden");
  els.emojiPanel.classList.add("hidden");
});

els.emojiToggle.addEventListener("click", () => {
  els.emojiPanel.classList.toggle("hidden");
  els.attachMenu.classList.add("hidden");
});

els.imageBtn.addEventListener("click", () => {
  els.attachMenu.classList.add("hidden");
  els.imageInput.click();
});

els.fileBtn?.addEventListener("click", () => {
  els.attachMenu.classList.add("hidden");
  els.fileInput.click();
});

els.imageInput.addEventListener("change", async () => {
  const file = els.imageInput.files?.[0];
  if (!file) {
    return;
  }
  try {
    setPendingImage(file);
  } catch (error) {
    setUploadProgress(0);
    alert(error.message);
  } finally {
    els.imageInput.value = "";
  }
});

els.fileInput?.addEventListener("change", async () => {
  const file = els.fileInput.files?.[0];
  if (!file) {
    return;
  }
  try {
    if (file.size > 25 * 1024 * 1024) {
      throw new Error("Файл слишком большой. Максимум 25 MB");
    }
    await sendFileMessage(file);
    renderMessages({ forceBottom: true });
    scrollMessagesToBottom(true);
    showToast("Файл отправлен", "success");
  } catch (error) {
    setUploadProgress(0);
    alert(error.message);
  } finally {
    els.fileInput.value = "";
  }
});

els.pollBtn.addEventListener("click", () => {
  els.attachMenu.classList.add("hidden");
  openPollSheet();
});

els.messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    stopTypingEmit();
    if (state.pendingImage?.file) {
      await sendImageMessage(state.pendingImage.file);
      clearPendingImage();
      renderMessages({ forceBottom: true });
      scrollMessagesToBottom(true);
    } else {
      await sendTextMessage(els.messageInput.value);
      els.messageInput.value = "";
      els.messageInput.focus();
      scrollMessagesToBottom(true);
    }
  } catch (error) {
    alert(error.message);
  }
});

els.messageInput.addEventListener("input", () => {
  onComposerInputChanged();
});

els.messageInput.addEventListener("blur", () => {
  stopTypingEmit();
});

els.messages.addEventListener("scroll", async () => {
  if (isNearBottom(96)) {
    clearUnseenForKey(selectedChatKey());
  }
  refreshJumpBottomButton();
  refreshStickyDayLabel();
  if (els.messages.scrollTop < 60) {
    if (expandRenderWindowBackwardIfNeeded()) {
      return;
    }
    await loadOlderMessagesIfNeeded();
  }
});

els.messages.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!state.selected) {
    return;
  }
  if (state.selected.type === "room") {
    const room = state.rooms.find((item) => item.id === state.selected.id);
    if (!room?.joined) {
      return;
    }
  }
  els.messages.classList.add("drop-active");
});

els.messages.addEventListener("dragleave", (event) => {
  if (event.target === els.messages) {
    els.messages.classList.remove("drop-active");
  }
});

els.messages.addEventListener("drop", async (event) => {
  event.preventDefault();
  els.messages.classList.remove("drop-active");
  const file = event.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith("image/")) {
    return;
  }

  try {
    setPendingImage(file);
  } catch (error) {
    setUploadProgress(0);
    alert(error.message);
  }
});

els.imagePreviewCancelBtn?.addEventListener("click", () => {
  clearPendingImage();
});

els.imagePreviewSendBtn?.addEventListener("click", async () => {
  if (!state.pendingImage?.file) {
    return;
  }
  try {
    stopTypingEmit();
    await sendImageMessage(state.pendingImage.file);
    clearPendingImage();
    renderMessages({ forceBottom: true });
    scrollMessagesToBottom(true);
    els.messageInput.focus();
  } catch (error) {
    setUploadProgress(0);
    alert(error.message);
  }
});

els.jumpBottomBtn?.addEventListener("click", () => {
  scrollMessagesToBottom(true);
});

document.addEventListener("click", (event) => {
  const insideContext = els.contextMenu.contains(event.target);
  if (!insideContext) {
    hideContextMenu();
  }
  const insideEmoji = els.emojiPanel.contains(event.target) || event.target === els.emojiToggle;
  const insideAttach = els.attachMenu.contains(event.target) || event.target === els.attachToggleBtn;
  if (!insideEmoji) {
    els.emojiPanel.classList.add("hidden");
  }
  if (!insideAttach) {
    els.attachMenu.classList.add("hidden");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideContextMenu();
  }
});

window.addEventListener("resize", hideContextMenu);
window.addEventListener("resize", refreshStickyDayLabel);
window.addEventListener("scroll", hideContextMenu, true);

els.chatHeadMain?.addEventListener("click", async () => {
  if (state.selected?.type === "room") {
    await openRoomProfileSheet(state.selected.id);
    return;
  }
  if (state.selected?.type === "dm") {
    await openDmProfileSheet(state.selected.id);
  }
});

fillEmojiPanel();
applyTheme(state.theme);
setMode("login");
refreshListFiltersUI();
loadPublicRoomPreviewIfNeeded().catch(() => {});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", async (event) => {
    if (event.data?.type === "open-url") {
      await handleIncomingNavigation(event.data.url || "/");
    }
  });
}

fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
  .then((response) => response.json().then((data) => ({ response, data })))
  .then(async ({ response, data }) => {
    if (!response.ok || !data.token) {
      showAuth();
      return;
    }
    setToken(data.token);
    if (data.user) {
      state.me = data.user;
    }
    await startSession();
  })
  .catch(() => showAuth());
