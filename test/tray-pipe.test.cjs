const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");
const { createTrayPipeServer } = require("../patcher/tray-pipe.cjs");

test("serialized pipe server restores hidden windows and only quits explicitly", { timeout: 5000 }, async (t) => {
  let visible = false;
  let minimized = false;
  let destroyed = false;
  let focused = 0;
  let quit = 0;
  const state = {};
  // Initially hidden: no native MainWindowHandle is available to the helper.
  const win = {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized,
    hide: () => { visible = false; },
    restore: () => { minimized = false; },
    show: () => { visible = true; },
    focus: () => { focused++; },
  };
  const serialized = vm.runInNewContext(`(${createTrayPipeServer.toString()})`);
  const server = serialized(net, { app: { quit: () => quit++ } }, state, () => win);
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const pipe = process.platform === "win32"
    ? `\\\\.\\pipe\\opencode-tray-test-${process.pid}`
    : path.join(os.tmpdir(), `opencode-tray-test-${process.pid}.sock`);
  server.listen(pipe);
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    for (const socket of sockets) socket.destroy();
    server.close(resolve);
  }));

  async function send(command) {
    const accepted = once(server, "connection");
    const client = net.createConnection(pipe);
    const connected = once(client, "connect");
    const [socket] = await accepted;
    const closed = once(socket, "close");
    await connected;
    client.end(command);
    await closed;
  }

  await send("SHOW\n");
  assert.equal(visible, true);
  assert.equal(focused, 1);
  await send("HIDE\n");
  assert.equal(visible, false);
  assert.equal(quit, 0);
  await send("TOGGLE\n");
  assert.equal(visible, true);
  await send("TOGGLE\n");
  assert.equal(visible, false);

  // Force one command across two real pipe data events.
  const accepted = once(server, "connection");
  const client = net.createConnection(pipe);
  const connected = once(client, "connect");
  const [socket] = await accepted;
  const firstData = once(socket, "data");
  const closed = once(socket, "close");
  await connected;
  client.write("SH");
  await firstData;
  assert.equal(visible, false);
  client.end("OW\n");
  await closed;
  assert.equal(visible, true);

  minimized = true;
  await send("SHOW\r\n");
  assert.equal(minimized, false);
  await send("HIDE\nSHOW\nHIDE\n");
  assert.equal(visible, false);
  await send("SHOW"); // Compatible with clients closing without a newline.
  assert.equal(visible, true);
  destroyed = true;
  await send("HIDE\n");
  assert.equal(visible, true);
  await send("UNKNOWN\n");
  assert.equal(quit, 0);
  assert.equal(state.__oct_isQuitting, undefined);
  await send("QUIT\n");
  assert.equal(state.__oct_isQuitting, true);
  assert.equal(quit, 1);
});
