import { WebSocketServer } from "ws";

let wss = null;

export function initWebSocketServer(server) {
  wss = new WebSocketServer({ server });
  console.log("WebSocket server ready");
}

export function sendToClients(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(message);
  });
}
