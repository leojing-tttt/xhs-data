import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONTINUATION = 0;
const OP_TEXT = 1;
const OP_BINARY = 2;
const OP_CLOSE = 8;
const OP_PING = 9;
const OP_PONG = 10;

export function acceptWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '');
  if (!key || upgrade.toLowerCase() !== 'websocket') return null;
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n`
    + '\r\n',
  );
  if (head && head.length) socket.unshift(head);
  socket.setNoDelay(true);
  socket.setTimeout(0);
  return createConnection(socket);
}

function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = body.length;
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, body]);
}

function createConnection(socket) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentOp = 0;
  let closed = false;
  let messageHandler = null;
  let closeHandler = null;
  const early = [];

  function send(opcode, payload) {
    if (closed || socket.destroyed) return false;
    socket.write(encodeFrame(opcode, payload));
    return true;
  }

  function close(code = 1000, reason = '') {
    if (closed) return;
    closed = true;
    const reasonBuf = Buffer.from(String(reason));
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    try {
      send(OP_CLOSE, payload);
    } catch {
      // The socket may already be gone.
    }
    socket.end();
  }

  function deliver(message) {
    if (!messageHandler) {
      early.push(message);
      return;
    }
    messageHandler(message);
  }

  function handleFrame(fin, opcode, payload) {
    if (opcode === OP_CLOSE) {
      close();
      return;
    }
    if (opcode === OP_PING) {
      send(OP_PONG, payload);
      return;
    }
    if (opcode === OP_PONG) return;
    if (opcode === OP_CONTINUATION) {
      if (!fragmentOp) {
        close(1002, 'unexpected continuation');
        return;
      }
      fragments.push(payload);
      if (fin) {
        const combined = Buffer.concat(fragments);
        const kind = fragmentOp;
        fragments = [];
        fragmentOp = 0;
        deliver({ binary: kind === OP_BINARY, data: combined });
      }
      return;
    }
    if (opcode !== OP_TEXT && opcode !== OP_BINARY) {
      close(1002, 'unsupported opcode');
      return;
    }
    if (!fin) {
      fragmentOp = opcode;
      fragments = [payload];
      return;
    }
    deliver({ binary: opcode === OP_BINARY, data: payload });
  }

  function consume() {
    while (!closed) {
      if (buffer.length < 2) return;
      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > 1024n * 1024n) {
          close(1009, 'message too large');
          return;
        }
        length = Number(big);
        offset = 10;
      }
      if (!masked) {
        close(1002, 'client frames must be masked');
        return;
      }
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index & 3];
      }
      buffer = buffer.subarray(offset + 4 + length);
      handleFrame(fin, opcode, payload);
    }
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    consume();
  });
  socket.on('close', () => {
    if (closed) {
      if (closeHandler) closeHandler();
      return;
    }
    closed = true;
    if (closeHandler) closeHandler();
  });
  socket.on('error', () => {
    if (!closed) close();
  });

  return {
    sendText(text) {
      return send(OP_TEXT, Buffer.from(String(text)));
    },
    sendBinary(payload) {
      return send(OP_BINARY, payload);
    },
    close,
    get bufferedAmount() {
      return socket.writableLength;
    },
    onMessage(handler) {
      messageHandler = handler;
      while (early.length) handler(early.shift());
    },
    onClose(handler) {
      closeHandler = handler;
    },
  };
}

export function rejectUpgrade(socket, status, message) {
  const body = String(message);
  const reason = status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Bad Request';
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n`
    + 'Connection: close\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + '\r\n'
    + body,
  );
  socket.destroy();
}
