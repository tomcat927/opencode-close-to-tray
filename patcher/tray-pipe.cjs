// Serialized into the Electron bundle by patch.cjs; keep dependencies explicit.
function createTrayPipeServer(net, electron, state, getWindow) {
  return net.createServer((socket) => {
    let pending = "";
    const dispatch = (line) => {
      const command = line.trim();
      if (command === "QUIT") {
        state.__oct_isQuitting = true;
        electron.app.quit();
        return;
      }
      if (!["SHOW", "HIDE", "TOGGLE"].includes(command)) return;
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      if (command === "HIDE" || (command === "TOGGLE" && win.isVisible())) {
        win.hide();
        return;
      }
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    };
    socket.on("data", (buffer) => {
      pending += buffer.toString("ascii");
      if (pending.length > 1024) {
        socket.destroy();
        return;
      }
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        dispatch(line);
      }
    });
    socket.on("end", () => {
      if (pending) dispatch(pending);
    });
    socket.on("error", () => {});
  });
}

module.exports = { createTrayPipeServer };
