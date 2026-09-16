export class Multiplayer {
  constructor() {
    this.socket = null;
    this.code = '';
    this.onMessage = () => {};
    this.onStatus = () => {};
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.hostname || 'localhost';
    this.socket = new WebSocket(`${protocol}://${host}:8787`);
    this.socket.addEventListener('open', () => this.onStatus('Connected to multiplayer server'));
    this.socket.addEventListener('message', event => {
      try { this.onMessage(JSON.parse(event.data)); } catch { /* ignore malformed packets */ }
    });
    this.socket.addEventListener('close', () => this.onStatus('Multiplayer disconnected'));
    this.socket.addEventListener('error', () => this.onStatus('Start the multiplayer server with npm run server'));
  }

  create() { this.connect(); this.waitToSend({ type: 'create' }); }
  join(code) { this.connect(); this.waitToSend({ type: 'join', code: code.trim().toUpperCase() }); }
  waitToSend(message) {
    const send = () => this.socket?.send(JSON.stringify(message));
    if (this.socket?.readyState === WebSocket.OPEN) send();
    else this.socket?.addEventListener('open', send, { once: true });
  }

  sendState(state) {
    if (this.socket?.readyState === WebSocket.OPEN && this.code) this.socket.send(JSON.stringify({ type: 'state', state }));
  }
}
