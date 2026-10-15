// Cloudflare Worker: the game files are served as static assets from public/,
// and each house code gets its own Durable Object that runs the shared Room.

import { DurableObject } from 'cloudflare:workers';
import { Room, cleanRoom } from '../src/room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket', { status: 426 });
      }
      const code = cleanRoom(url.searchParams.get('room'));
      return env.HOUSES.get(env.HOUSES.idFromName(code)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class House extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
  }

  async fetch(request) {
    if (!this.room) {
      const code = cleanRoom(new URL(request.url).searchParams.get('room'));
      this.room = new Room(code);
    }
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.room.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }
}
