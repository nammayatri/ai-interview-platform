// Graceful shutdown for the custom server (CommonJS: server-custom.js is plain Node, not bundled).
// On SIGTERM: stop the WebSocket proxy, wait a few seconds for the load balancer to stop sending traffic, stop
// accepting connections, then wait until in-flight background jobs (scoring) and open requests are done, or the drain
// deadline passes. Only then close the database pool and exit. Before this, the pod exited after 5 seconds and killed
// any scoring run that was still going.
module.exports = function createGracefulShutdown(opts) {
  const {
    server, wss, pool,
    getActiveJobs = () => 0,
    drainMs = 600000,
    settleMs = 5000,
    pollMs = 1000,
    exit = process.exit,
    log = console.log,
  } = opts;
  let started = false;

  return function shutdown() {
    if (started) return;
    started = true;
    const t0 = Date.now();
    log("[shutdown] signal received, draining");
    try { wss.clients.forEach((ws) => ws.close(1001)); wss.close(); } catch (e) { /* already closed */ }

    setTimeout(() => {
      try { server.close(); } catch (e) { /* already closed */ }
      const tick = () => {
        if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
        server.getConnections((err, open) => {
          const jobs = getActiveJobs();
          const timedOut = Date.now() - t0 > drainMs;
          if ((jobs === 0 && (err || open === 0)) || timedOut) {
            log(`[shutdown] ${timedOut ? "drain deadline reached" : "drained"} (background jobs: ${jobs}, open connections: ${open})`);
            Promise.resolve(pool.end()).catch(() => {}).then(() => exit(timedOut && jobs > 0 ? 1 : 0));
          } else {
            setTimeout(tick, pollMs);
          }
        });
      };
      tick();
    }, settleMs);
  };
};
