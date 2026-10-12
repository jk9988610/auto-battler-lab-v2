var token = localStorage.getItem("token") || "";
var socket = null;
var me = null;
var currentRoom = null;

function log(s, cls) {
  var el = document.getElementById("log");
  var line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = s;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function api(path, body) {
  return fetch("/api" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  }).then(function (r) {
    return r.json().then(function (j) { return { status: r.status, body: j }; });
  });
}

function show(view) {
  document.getElementById("view-auth").className = view === "auth" ? "" : "hidden";
  document.getElementById("view-lobby").className = view === "lobby" ? "" : "hidden";
  document.getElementById("view-room").className = view === "room" ? "" : "hidden";
}

function doRegister() {
  var u = document.getElementById("u").value;
  var p = document.getElementById("p").value;
  api("/auth/register", { username: u, password: p }).then(function (r) {
    if (r.status === 200) {
      token = r.body.token;
      localStorage.setItem("token", token);
      log("注册成功: " + r.body.user.username, "ok");
    } else {
      log("注册失败 " + r.status + ": " + JSON.stringify(r.body), "err");
    }
  });
}

function doLogin() {
  var u = document.getElementById("u").value;
  var p = document.getElementById("p").value;
  api("/auth/login", { username: u, password: p }).then(function (r) {
    if (r.status === 200) {
      token = r.body.token;
      localStorage.setItem("token", token);
      log("登录成功: " + r.body.user.username, "ok");
    } else {
      log("登录失败 " + r.status + ": " + JSON.stringify(r.body), "err");
    }
  });
}

function doMe() {
  fetch("/api/me", { headers: { "Authorization": "Bearer " + token } })
    .then(function (r) { return r.json(); })
    .then(function (j) { log("me: " + JSON.stringify(j)); });
}

function doConnect() {
  if (socket) { log("已连接"); return; }
  socket = io({ auth: { token: token } });
  socket.on("connect", function () {
    log("socket 已连接 id=" + socket.id, "ok");
    show("lobby");
    loadRooms();
  });
  socket.on("hello", function (data) { me = data.user; log("hello: " + JSON.stringify(data), "ok"); });
  socket.on("connect_error", function (e) { log("socket 错误: " + e.message, "err"); });
  socket.on("disconnect", function (r) {
    log("socket 断开: " + r);
    socket = null; me = null; currentRoom = null;
    show("auth");
  });
  socket.on("room:list", function (list) { renderRoomList(list); });
  socket.on("room:update", function (room) {
    currentRoom = room;
    renderRoom();
    show("room");
  });
  socket.on("room:started", function (data) { log("游戏开始 roomId=" + data.roomId, "ok"); });
}

function loadRooms() {
  if (!socket) { log("未连接", "err"); return; }
  socket.emit("room:list");
}

function renderRoomList(list) {
  var el = document.getElementById("roomList");
  el.innerHTML = "";
  if (!list || list.length === 0) {
    el.textContent = "暂无房间 创建一个吧";
    return;
  }
  list.forEach(function (r) {
    var div = document.createElement("div");
    div.className = "room-item";
    var info = document.createElement("span");
    info.textContent = r.name + " (" + r.count + "/" + r.maxPlayers + ") " + r.status;
    var btn = document.createElement("button");
    btn.textContent = "加入";
    btn.onclick = function () { doJoinRoom(r.id); };
    div.appendChild(info);
    div.appendChild(btn);
    el.appendChild(div);
  });
}

function doCreateRoom() {
  if (!socket) { log("未连接", "err"); return; }
  var name = document.getElementById("roomName").value;
  socket.emit("room:create", { name: name }, function (res) {
    if (res.ok) log("房间已创建 " + res.room.id, "ok");
    else log("创建失败 " + res.error, "err");
  });
}

function doJoinRoom(id) {
  if (!socket) return;
  socket.emit("room:join", { id: id }, function (res) {
    if (res.ok) log("已加入房间 " + res.room.id, "ok");
    else log("加入失败 " + res.error, "err");
  });
}

function doLeave() {
  if (!socket) return;
  socket.emit("room:leave", function () {
    currentRoom = null;
    show("lobby");
    loadRooms();
  });
}

function toggleReady() {
  if (!socket || !currentRoom || !me) return;
  var myPlayer = null;
  currentRoom.players.forEach(function (p) { if (p.uid === me.uid) myPlayer = p; });
  if (!myPlayer) return;
  socket.emit("room:ready", { ready: !myPlayer.ready });
}

function doStart() {
  if (!socket) return;
  socket.emit("room:start", function (res) {
    if (!res.ok) log("开始失败 " + res.error, "err");
  });
}

function renderRoom() {
  if (!currentRoom) return;
  document.getElementById("roomTitle").textContent =
    currentRoom.name + " id=" + currentRoom.id + " 状态=" + currentRoom.status;

  var seats = document.getElementById("seats");
  seats.innerHTML = "";
  var max = currentRoom.maxPlayers;
  for (var i = 0; i < max; i++) {
    var p = currentRoom.players[i];
    var div = document.createElement("div");
    div.className = "seat";
    if (p) {
      if (me && p.uid === me.uid) div.className = div.className + " me";
      if (p.isHost) div.className = div.className + " host";
      var nameSpan = document.createElement("div");
      nameSpan.textContent = p.username;
      div.appendChild(nameSpan);
      if (p.isHost) {
        var hostTag = document.createElement("span");
        hostTag.className = "tag";
        hostTag.textContent = "房主";
        div.appendChild(hostTag);
      }
      var readyTag = document.createElement("span");
      readyTag.className = p.ready ? "tag ready" : "tag";
      readyTag.textContent = p.ready ? "已准备" : "未准备";
      div.appendChild(readyTag);
    } else {
      div.className = div.className + " empty";
      div.textContent = "空位";
    }
    seats.appendChild(div);
  }

  var myPlayer = null;
  if (me) currentRoom.players.forEach(function (x) { if (x.uid === me.uid) myPlayer = x; });
  var isHost = myPlayer && myPlayer.isHost;

  var btnReady = document.getElementById("btnReady");
  var btnStart = document.getElementById("btnStart");
  if (myPlayer && myPlayer.ready) btnReady.textContent = "取消准备";
  else btnReady.textContent = "准备";
  btnReady.disabled = !myPlayer;
  btnStart.style.display = isHost ? "" : "none";
}