const socket = io();
const $ = id => document.getElementById(id);
const state = { mode: "create", roomId: null, nickname: "", color: "#D9FF45", peers: new Map(), connections: new Map(), localStream: null, isHost: false };
const iceConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

function randomRoom() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "MGS-";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}
function showStatus(message, error = false) {
  const el = $("room-status"); el.textContent = message; el.classList.remove("hidden");
  el.style.color = error ? "#ff9cac" : "#eaff9a";
  el.style.borderColor = error ? "#ff35d355" : "#d9ff4530";
}
function getRoomFromUrl() {
  const p = new URLSearchParams(location.search);
  return p.get("sala") || p.get("room") || "";
}
function updateMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === mode));
  $("room-code-wrap").classList.toggle("hidden", mode !== "join");
  $("room-name").classList.toggle("hidden", mode === "join");
  $("room-label").classList.toggle("hidden", mode === "join");
  $("room-name").required = mode === "create";
  $("room-code").required = mode === "join";
  $("submit-room").innerHTML = mode === "create" ? 'Criar minha sala <span>↗</span>' : 'Entrar na sala <span>↗</span>';
  $("room-status").classList.add("hidden");
}
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => updateMode(b.dataset.tab)));

function setParticipantList() {
  const container = $("participants"); container.innerHTML = "";
  const me = { id: socket.id, nickname: state.nickname, color: state.color, self: true };
  const all = [me, ...state.peers.values()];
  all.forEach(p => {
    const row = document.createElement("div"); row.className = "participant";
    const avatar = document.createElement("span"); avatar.className = "participant-avatar"; avatar.style.background = p.color || "#d9ff45"; avatar.textContent = (p.nickname || "?").slice(0, 1).toUpperCase();
    const name = document.createElement("span"); name.className = "participant-name"; name.textContent = p.nickname + (p.self ? " (você)" : "");
    row.append(avatar, name);
    if (p.self && state.isHost) { const tag = document.createElement("span"); tag.className = "host-tag"; tag.textContent = "HOST"; row.append(tag); }
    container.append(row);
  });
  $("participant-count").textContent = `${all.length} / 8`;
}
function addVideo(id, stream, nickname, color) {
  let tile = document.querySelector(`[data-video-id="${id}"]`);
  if (!tile) {
    tile = document.createElement("div"); tile.className = "video-tile"; tile.dataset.videoId = id;
    const video = document.createElement("video"); video.autoplay = true; video.playsInline = true; video.controls = true;
    const label = document.createElement("div"); label.className = "video-label";
    const dot = document.createElement("span"); dot.className = "avatar-dot"; dot.style.background = color || "#d9ff45";
    const name = document.createElement("span"); name.textContent = nickname || "Tela compartilhada";
    label.append(dot, name); tile.append(video, label); $("videos").querySelector(".empty-screen")?.remove(); $("videos").append(tile);
  }
  const video = tile.querySelector("video");
  if (video.srcObject !== stream) video.srcObject = stream;
  $("screen-state").textContent = "TELA CONECTADA";
}
function removeVideo(id) {
  document.querySelector(`[data-video-id="${id}"]`)?.remove();
  if (!$("videos").querySelector(".video-tile")) {
    $("videos").innerHTML = '<div class="empty-screen"><div class="screen-icon">▣</div><h3>Nenhuma tela por aqui ainda</h3><p>Inicie o compartilhamento para mostrar sua tela aos participantes.</p></div>';
    $("screen-state").textContent = "AGUARDANDO TELA";
  }
}
function sendSignal(to, data) { socket.emit("webrtc:signal", { to, data }); }
function makeConnection(peer, initiator) {
  if (state.connections.has(peer.id)) return state.connections.get(peer.id);
  const pc = new RTCPeerConnection(iceConfig);
  state.connections.set(peer.id, pc);
  if (state.localStream) state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
  pc.onicecandidate = e => { if (e.candidate) sendSignal(peer.id, { candidate: e.candidate }); };
  pc.ontrack = e => addVideo(peer.id, e.streams[0], peer.nickname, peer.color);
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState) && pc.connectionState !== "disconnected") removeVideo(peer.id);
  };
  if (initiator) pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => sendSignal(peer.id, { description: pc.localDescription })).catch(err => console.error(err));
  return pc;
}
async function handleSignal({ from, data }) {
  const peer = state.peers.get(from) || { id: from, nickname: "Participante", color: "#D9FF45" };
  const pc = makeConnection(peer, false);
  try {
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        sendSignal(from, { description: pc.localDescription });
      }
    } else if (data.candidate) await pc.addIceCandidate(data.candidate);
  } catch (err) { console.error("Falha na sinalização WebRTC:", err); }
}
async function enterRoom(roomId) {
  state.roomId = roomId; state.isHost = state.mode === "create";
  state.nickname = $("nickname").value.trim() || "Convidado"; state.color = $("user-color").value;
  showStatus("Conectando à sala...");
  socket.emit("room:join", { roomId, nickname: state.nickname, color: state.color }, result => {
    if (!result?.ok) { showStatus(result?.error || "Não foi possível entrar na sala.", true); return; }
    state.roomId = result.roomId;
    result.peers.forEach(p => state.peers.set(p.id, p));
    $("active-room-title").textContent = result.roomId;
    $("active-room-sub").textContent = `Você está conectado como ${state.nickname}. Compartilhe o link para convidar sua equipe.`;
    const url = new URL(location.href); url.searchParams.set("sala", result.roomId); url.hash = "sala";
    history.replaceState({}, "", url);
    $("workspace").classList.remove("hidden"); $("room-status").classList.add("hidden");
    setParticipantList(); $("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
    result.peers.forEach(p => makeConnection(p, true));
  });
}
$("room-form").addEventListener("submit", e => {
  e.preventDefault();
  const nick = $("nickname").value.trim();
  if (!nick) return showStatus("Digite seu nickname para continuar.", true);
  if (state.mode === "create") enterRoom($("room-name").value.trim() ? $("room-name").value.trim().toUpperCase().replace(/[^A-Z0-9 -]/g, "").replace(/\s+/g, "-").slice(0, 20) + "-" + randomRoom().slice(-4) : randomRoom());
  else enterRoom($("room-code").value.trim().toUpperCase());
});
function appendChatMessage(item) {
  const container = $("chat-messages");
  container.querySelector(".chat-empty")?.remove();
  const row = document.createElement("div"); row.className = "chat-message";
  const avatar = document.createElement("span"); avatar.className = "participant-avatar"; avatar.style.background = item.color || "#D9FF45"; avatar.textContent = (item.nickname || "?").slice(0, 1).toUpperCase();
  const body = document.createElement("div");
  const head = document.createElement("div"); head.className = "chat-message-head";
  const name = document.createElement("b"); name.textContent = item.nickname || "Convidado";
  const time = document.createElement("time"); time.textContent = new Date(item.at || Date.now()).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const message = document.createElement("p"); message.textContent = item.message;
  head.append(name, time); body.append(head, message); row.append(avatar, body); container.append(row); container.scrollTop = container.scrollHeight;
}
$("chat-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = $("chat-input"); const message = input.value.trim();
  if (!state.roomId) return toast("Entre em uma sala para conversar.");
  if (!message) return;
  socket.emit("chat:message", { message }); input.value = ""; input.focus();
});
socket.on("chat:message", appendChatMessage);
function showReaction(item) {
  const feed = $("reaction-feed");
  const row = document.createElement("div"); row.className = "reaction-item";
  const name = document.createElement("strong"); name.textContent = item.nickname || "Alguém";
  row.append(name, document.createTextNode(` reagiu ${item.emoji}`)); feed.prepend(row);
  while (feed.children.length > 4) feed.lastElementChild.remove();
  const burst = document.createElement("div"); burst.className = "reaction-burst"; burst.textContent = item.emoji; document.body.append(burst);
  setTimeout(() => burst.remove(), 1800);
}
document.querySelectorAll("[data-emoji]").forEach(button => button.addEventListener("click", () => {
  if (!state.roomId) return toast("Entre em uma sala para enviar reações.");
  socket.emit("room:reaction", { emoji: button.dataset.emoji });
}));
socket.on("room:reaction", showReaction);

socket.on("room:peer-joined", p => {
  state.peers.set(p.id, p); setParticipantList(); toast(`${p.nickname} entrou na sala.`);
  // The newcomer creates the offer to existing peers, avoiding offer collisions.
});
socket.on("room:count", count => { $("participant-count").textContent = `${count} / 8`; });
socket.on("webrtc:signal", handleSignal);
socket.on("room:peer-left", ({ id }) => {
  state.peers.delete(id); state.connections.get(id)?.close(); state.connections.delete(id);
  removeVideo(id); setParticipantList(); toast("Um participante saiu da sala.");
});

$("start-share").addEventListener("click", async () => {
  if (!state.roomId) return toast("Entre em uma sala primeiro.");
  try {
    state.localStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 } }, audio: $("share-audio").checked });
    addVideo(socket.id, state.localStream, `${state.nickname} — sua tela`, state.color);
    state.localStream.getVideoTracks()[0].addEventListener("ended", stopShare);
    state.connections.forEach(pc => {
      state.localStream.getTracks().forEach(track => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
        if (sender) sender.replaceTrack(track); else pc.addTrack(track, state.localStream);
      });
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => sendSignal([...state.connections.entries()].find(([, p]) => p === pc)?.[0], { description: pc.localDescription })).catch(console.error);
    });
    $("start-share").classList.add("hidden"); $("stop-share").classList.remove("hidden"); $("screen-state").textContent = "SUA TELA AO VIVO";
    toast("Compartilhamento iniciado.");
  } catch (err) {
    if (err.name !== "NotAllowedError") toast("Não foi possível iniciar o compartilhamento. Verifique as permissões do navegador.");
  }
});
function stopShare() {
  if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
  removeVideo(socket.id); $("start-share").classList.remove("hidden"); $("stop-share").classList.add("hidden");
  state.connections.forEach((pc, id) => {
    pc.getSenders().filter(s => s.track).forEach(s => { if (s.track.kind === "video" || s.track.kind === "audio") pc.removeTrack(s); });
    pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => sendSignal(id, { description: pc.localDescription })).catch(console.error);
  });
  toast("Transmissão encerrada.");
}
$("stop-share").addEventListener("click", stopShare);
async function copyInvite() {
  const url = new URL(location.href); url.searchParams.set("sala", state.roomId || getRoomFromUrl()); url.hash = "sala";
  try { await navigator.clipboard.writeText(url.toString()); toast("Link da sala copiado!"); }
  catch { prompt("Copie o link da sala:", url.toString()); }
}
$("copy-link").addEventListener("click", copyInvite); $("copy-link-2").addEventListener("click", copyInvite);
$("leave-room").addEventListener("click", () => {
  stopShare(); socket.emit("room:leave");
  state.connections.forEach(pc => pc.close()); state.connections.clear(); state.peers.clear(); state.roomId = null; state.isHost = false;
  $("workspace").classList.add("hidden"); history.replaceState({}, "", location.pathname); updateMode("create"); toast("Você saiu da sala.");
});
const initialRoom = getRoomFromUrl();
if (initialRoom) { updateMode("join"); $("room-code").value = initialRoom; $("room-name").value = initialRoom; }
