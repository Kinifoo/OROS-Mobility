// Proxy pour le broadcaster WebSocket (évite la dépendance circulaire)
let _broadcaster = null;
function getWebSocketBroadcaster() { return _broadcaster; }
function setWebSocketBroadcaster(fn) { _broadcaster = fn; }
module.exports = { getWebSocketBroadcaster, setWebSocketBroadcaster };
