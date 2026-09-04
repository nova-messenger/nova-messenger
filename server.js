// server.js - Realtime Messenger Server (NOVA Messenger)
// HTTP REST API + RFC 6455 WebSocket Server + WebRTC Signaling
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const nodemailer = require('nodemailer');
const db = require('./db.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Gmail SMTP Mailer setup
const GMAIL_USER = process.env.GMAIL_USER || 'novamessaggi@gmail.com';
const GMAIL_PASS = process.env.GMAIL_PASS || 'pcwmqexjntprdxdu';

const mailTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS
  }
});

async function sendRealEmail(toEmail, otpCode) {
  try {
    const info = await mailTransporter.sendMail({
      from: `"NOVA Messenger" <${GMAIL_USER}>`,
      to: toEmail,
      subject: `🔑 Il tuo codice di verifica NOVA: ${otpCode}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 28px; border: 1px solid #1e293b; border-radius: 14px; background-color: #090d16; color: #f8fafc;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #38bdf8; font-size: 32px; margin: 0; font-weight: 800; letter-spacing: 2px;">✦ NOVA</h1>
            <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Beyond Messaging. Zero numeri di telefono.</p>
          </div>
          <p style="font-size: 16px; line-height: 1.5; color: #e2e8f0;">Ciao!</p>
          <p style="font-size: 15px; line-height: 1.5; color: #cbd5e1;">Inserisci questo codice di verifica a 6 cifre per completare l'accesso al tuo account NOVA Messenger:</p>
          <div style="text-align: center; margin: 32px 0;">
            <span style="font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #10b981; background: #064e3b; padding: 14px 28px; border-radius: 10px; display: inline-block;">${otpCode}</span>
          </div>
          <p style="font-size: 13px; color: #64748b; text-align: center; margin-top: 24px;">Questo codice scadrà tra 15 minuti. Se non hai richiesto tu questo codice, puoi ignorare questa email.</p>
        </div>
      `
    });
    console.log('[Gmail SMTP Email] Sent successfully to:', toEmail, 'MessageId:', info.messageId);
    return { success: true };
  } catch (err) {
    console.error('[Gmail SMTP Error]:', err.message);
    return { success: false, reason: err.message };
  }
}

// MIME Types Map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
};

// Store latest OTP in memory for local developer view
let LATEST_DEV_OTP = {
  email: null,
  code: null,
  timestamp: null
};

// -------------------------------------------------------------
// Security & Auth Utilities
// -------------------------------------------------------------
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, salt, verification_code, verification_expires, ...safe } = user;
  return {
    ...safe,
    fullName: user.full_name,
    avatarUrl: user.avatar_url,
    isVerified: user.is_verified === 1,
    createdAt: user.created_at,
    lastSeen: user.last_seen
  };
}

async function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['cookie']) {
    const match = req.headers['cookie'].match(/nova_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) return null;

  const session = await db.get('SELECT * FROM sessions WHERE token = ? AND expires_at > ?', [token, Date.now()]);
  if (!session) return null;

  // Update session last active
  await db.run('UPDATE sessions SET last_active = ? WHERE id = ?', [Date.now(), session.id]);

  const user = await db.get('SELECT * FROM users WHERE id = ?', [session.user_id]);
  return user ? { ...sanitizeUser(user), currentSessionId: session.id } : null;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // 50MB max
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// -------------------------------------------------------------
// WebSocket Engine (RFC 6455 Compliant)
// -------------------------------------------------------------
const clients = new Map(); // socket -> { userId, username, conversationId, alive, buffer }

function encodeWsFrame(data) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const length = payload.length;
  let header;
  if (length <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = length;
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const isMasked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let headLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headLen = 10;
    }

    const maskLen = isMasked ? 4 : 0;
    const totalFrameLen = headLen + maskLen + payloadLen;
    if (offset + totalFrameLen > buffer.length) break;

    let payload = buffer.subarray(offset + headLen + maskLen, offset + totalFrameLen);
    if (isMasked) {
      const mask = buffer.subarray(offset + headLen, offset + headLen + 4);
      const unmasked = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    frames.push({ opcode, payload, fin });
    offset += totalFrameLen;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function sendToSocket(socket, message) {
  if (socket.destroyed || !socket.writable) return;
  try {
    socket.write(encodeWsFrame(message));
  } catch (err) {
    console.error('[WS] Send error:', err.message);
  }
}

function broadcastToUser(userId, message) {
  for (const [sock, client] of clients.entries()) {
    if (client.userId === userId) {
      sendToSocket(sock, message);
    }
  }
}

async function broadcastToConversation(conversationId, message, excludeUserId = null) {
  const members = await db.all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', [conversationId]);
  for (const member of members) {
    if (excludeUserId && member.user_id === excludeUserId) continue;
    broadcastToUser(member.user_id, message);
  }
}

async function broadcastPresence(userId, isOnline) {
  const now = Date.now();
  await db.run('UPDATE users SET last_seen = ? WHERE id = ?', [now, userId]);

  const buddies = await db.all(`
    SELECT DISTINCT cm2.user_id 
    FROM conversation_members cm1
    JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
    WHERE cm1.user_id = ? AND cm2.user_id != ?
  `, [userId, userId]);

  for (const buddy of buddies) {
    broadcastToUser(buddy.user_id, {
      type: 'presence',
      userId,
      isOnline,
      lastSeen: now
    });
  }
}

// -------------------------------------------------------------
// HTTP Server & Router
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const userAgent = req.headers['user-agent'] || 'Browser';
  const ipAddress = req.headers['x-forwarded-for'] || (req.socket ? req.socket.remoteAddress : '127.0.0.1') || '127.0.0.1';

  try {
    // ---------------- API ROUTES ----------------

    // 1. Auth: Register
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const { email, password, username, fullName } = await parseBody(req);

      if (!email || !password || !username || !fullName) {
        return sendJson(res, 400, { error: 'Tutti i campi sono obbligatori.' });
      }

      const cleanEmail = email.toLowerCase().trim();
      let cleanUsername = username.toLowerCase().trim().replace(/^@+/, '');

      if (!/^[a-zA-Z0-9_.]{3,30}$/.test(cleanUsername)) {
        return sendJson(res, 400, { error: 'Username deve contenere 3-30 caratteri (lettere, numeri, underscore, punto).' });
      }

      if (password.length < 6) {
        return sendJson(res, 400, { error: 'La password deve contenere almeno 6 caratteri.' });
      }

      const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existingEmail) {
        return sendJson(res, 400, { error: 'Un account con questa email esiste già.' });
      }

      const existingUsername = await db.get('SELECT id FROM users WHERE username = ?', [cleanUsername]);
      if (existingUsername) {
        return sendJson(res, 400, { error: 'Questo nome utente @' + cleanUsername + ' è già occupato.' });
      }

      const userId = 'usr_' + crypto.randomUUID();
      const salt = generateSalt();
      const passwordHash = hashPassword(password, salt);
      const otp = generateOtp();
      const now = Date.now();
      const expires = now + 15 * 60 * 1000;

      const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName)}&backgroundColor=0d9488,0891b2,2563eb,7c3aed`;

      await db.run(`
        INSERT INTO users (id, email, username, password_hash, salt, full_name, avatar_url, is_verified, verification_code, verification_expires, created_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `, [userId, cleanEmail, cleanUsername, passwordHash, salt, fullName.trim(), avatarUrl, otp, expires, now, now]);

      LATEST_DEV_OTP = { email: cleanEmail, code: otp, timestamp: now };
      await sendRealEmail(cleanEmail, otp);

      console.log(`\n========================================`);
      console.log(`[AUTH NOVA] REGISTRAZIONE UTENTE: ${cleanEmail} (@${cleanUsername})`);
      console.log(`[AUTH NOVA] CODICE VERIFICA EMAIL (OTP): ${otp}`);
      console.log(`========================================\n`);

      return sendJson(res, 201, {
        success: true,
        message: 'Registrazione effettuata! Abbiamo inviato il codice di verifica alla tua email.',
        email: cleanEmail
      });
    }

    // 2. Auth: Verify Code
    if (req.method === 'POST' && pathname === '/api/auth/verify') {
      const { email, code } = await parseBody(req);
      if (!email || !code) {
        return sendJson(res, 400, { error: 'Email e codice di verifica richiesti.' });
      }

      const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
      if (!user) {
        return sendJson(res, 404, { error: 'Account non trovato.' });
      }

      if (user.is_verified === 1) {
        const token = generateToken();
        const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
        await db.run('INSERT INTO sessions (id, user_id, token, user_agent, ip_address, created_at, last_active, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ['sess_' + crypto.randomUUID(), user.id, token, userAgent, ipAddress, Date.now(), Date.now(), expires]);
        return sendJson(res, 200, { success: true, token, user: sanitizeUser(user) });
      }

      if (user.verification_code !== code.trim()) {
        return sendJson(res, 400, { error: 'Codice di verifica non valido.' });
      }

      if (Date.now() > user.verification_expires) {
        return sendJson(res, 400, { error: 'Il codice di verifica è scaduto. Richiedine uno nuovo.' });
      }

      await db.run('UPDATE users SET is_verified = 1, verification_code = NULL WHERE id = ?', [user.id]);
      const verifiedUser = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);

      const token = generateToken();
      const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
      await db.run('INSERT INTO sessions (id, user_id, token, user_agent, ip_address, created_at, last_active, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['sess_' + crypto.randomUUID(), user.id, token, userAgent, ipAddress, Date.now(), Date.now(), expires]);

      return sendJson(res, 200, {
        success: true,
        message: 'Account verificato con successo!',
        token,
        user: sanitizeUser(verifiedUser)
      });
    }

    // 3. Auth: Resend Code
    if (req.method === 'POST' && pathname === '/api/auth/resend-code') {
      const { email } = await parseBody(req);
      if (!email) return sendJson(res, 400, { error: 'Email richiesta.' });

      const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
      if (!user) return sendJson(res, 404, { error: 'Utente non trovato.' });

      const otp = generateOtp();
      const expires = Date.now() + 15 * 60 * 1000;
      await db.run('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?', [otp, expires, user.id]);

      LATEST_DEV_OTP = { email: user.email, code: otp, timestamp: Date.now() };
      await sendRealEmail(user.email, otp);
      return sendJson(res, 200, {
        success: true,
        message: 'Nuovo codice di verifica inviato alla tua email.'
      });
    }

    // 4. Auth: Login
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const { login, password } = await parseBody(req);
      if (!login || !password) {
        return sendJson(res, 400, { error: 'Inserisci nome utente/email e password.' });
      }

      const cleanLogin = login.trim().toLowerCase().replace(/^@+/, '');
      const user = await db.get('SELECT * FROM users WHERE email = ? OR username = ?', [cleanLogin, cleanLogin]);

      if (!user) {
        return sendJson(res, 401, { error: 'Credenziali non valide.' });
      }

      const computedHash = hashPassword(password, user.salt);
      if (computedHash !== user.password_hash) {
        return sendJson(res, 401, { error: 'Credenziali non valide.' });
      }

      if (user.is_verified !== 1) {
        // Send a fresh OTP to the user's email
        const freshOtp = generateOtp();
        const expires = Date.now() + 15 * 60 * 1000;
        await db.run('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?', [freshOtp, expires, user.id]);
        await sendRealEmail(user.email, freshOtp);

        return sendJson(res, 403, {
          error: 'NOT_VERIFIED',
          message: 'Account non ancora verificato. Abbiamo inviato un nuovo codice alla tua email.',
          email: user.email
        });
      }

      const token = generateToken();
      const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
      await db.run('INSERT INTO sessions (id, user_id, token, user_agent, ip_address, created_at, last_active, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['sess_' + crypto.randomUUID(), user.id, token, userAgent, ipAddress, Date.now(), Date.now(), expires]);

      return sendJson(res, 200, {
        success: true,
        token,
        user: sanitizeUser(user)
      });
    }

    // 5. Auth: Me
    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });
      return sendJson(res, 200, { user });
    }

    // 6. Auth: Logout
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace('Bearer ', '').trim();
      if (token) {
        await db.run('DELETE FROM sessions WHERE token = ?', [token]);
      }
      return sendJson(res, 200, { success: true });
    }

    // 7. Users: Search (by @username, email, or full name)
    if (req.method === 'GET' && pathname === '/api/users/search') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const query = (parsedUrl.searchParams.get('q') || '').trim();
      if (!query) {
        return sendJson(res, 200, { users: [] });
      }

      const cleanQuery = query.replace(/^@+/, '').toLowerCase();
      const searchPattern = `%${cleanQuery}%`;

      const matches = await db.all(`
        SELECT id, email, username, full_name, avatar_url, bio, last_seen
        FROM users
        WHERE id != ? AND is_verified = 1 AND (
          LOWER(username) LIKE ? OR
          LOWER(email) LIKE ? OR
          LOWER(full_name) LIKE ?
        )
        ORDER BY 
          CASE WHEN LOWER(username) = ? THEN 1
               WHEN LOWER(username) LIKE ? THEN 2
               ELSE 3 END,
          full_name ASC
        LIMIT 20
      `, [user.id, searchPattern, searchPattern, searchPattern, cleanQuery, `${cleanQuery}%`]);

      const now = Date.now();
      const results = matches.map(u => {
        let isOnline = false;
        for (const client of clients.values()) {
          if (client.userId === u.id) {
            isOnline = true;
            break;
          }
        }
        return {
          id: u.id,
          email: u.email,
          username: u.username,
          fullName: u.full_name,
          avatarUrl: u.avatar_url,
          bio: u.bio,
          lastSeen: u.last_seen,
          isOnline: isOnline || (now - u.last_seen < 60000)
        };
      });

      return sendJson(res, 200, { users: results });
    }

    // 8. Users: Update Profile
    if (req.method === 'PUT' && pathname === '/api/users/profile') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const { fullName, bio, avatarUrl } = await parseBody(req);
      await db.run(`
        UPDATE users 
        SET full_name = COALESCE(?, full_name),
            bio = COALESCE(?, bio),
            avatar_url = COALESCE(?, avatar_url)
        WHERE id = ?
      `, [fullName ? fullName.trim() : null, bio ? bio.trim() : null, avatarUrl || null, user.id]);

      const updated = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
      return sendJson(res, 200, { user: sanitizeUser(updated) });
    }

    // 9. Conversations: List
    if (req.method === 'GET' && pathname === '/api/conversations') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const conversations = await db.all(`
        SELECT c.*, cm.role
        FROM conversations c
        JOIN conversation_members cm ON c.id = cm.conversation_id
        WHERE cm.user_id = ?
        ORDER BY c.updated_at DESC
      `, [user.id]);

      const result = [];
      const now = Date.now();

      for (const conv of conversations) {
        let name = conv.name;
        let iconUrl = conv.icon_url;
        let otherUser = null;

        if (conv.is_group === 0) {
          const other = await db.get(`
            SELECT u.id, u.username, u.full_name, u.avatar_url, u.last_seen
            FROM conversation_members cm
            JOIN users u ON cm.user_id = u.id
            WHERE cm.conversation_id = ? AND cm.user_id != ?
          `, [conv.id, user.id]);

          if (other) {
            name = other.full_name;
            iconUrl = other.avatar_url;
            let isOnline = false;
            for (const client of clients.values()) {
              if (client.userId === other.id) {
                isOnline = true;
                break;
              }
            }
            otherUser = {
              id: other.id,
              username: other.username,
              fullName: other.full_name,
              avatarUrl: other.avatar_url,
              isOnline: isOnline || (now - other.last_seen < 60000)
            };
          }
        }

        const lastMessage = await db.get(`
          SELECT m.*, u.full_name as sender_name
          FROM messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.conversation_id = ?
          ORDER BY m.created_at DESC
          LIMIT 1
        `, [conv.id]);

        const memberCountRow = await db.get('SELECT COUNT(*) as count FROM conversation_members WHERE conversation_id = ?', [conv.id]);
        const memberCount = memberCountRow ? memberCountRow.count : 0;

        result.push({
          id: conv.id,
          isGroup: conv.is_group === 1,
          name,
          iconUrl,
          otherUser,
          memberCount,
          lastMessage: lastMessage ? {
            id: lastMessage.id,
            content: lastMessage.is_deleted ? 'Questo messaggio è stato eliminato' : lastMessage.content,
            mediaType: lastMessage.media_type,
            senderId: lastMessage.sender_id,
            senderName: lastMessage.sender_name,
            createdAt: lastMessage.created_at
          } : null,
          updatedAt: conv.updated_at
        });
      }

      return sendJson(res, 200, { conversations: result });
    }

    // 10. Conversations: Create (1-on-1 or Group)
    if (req.method === 'POST' && pathname === '/api/conversations') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const { isGroup, recipientId, name, iconUrl, memberIds } = await parseBody(req);

      if (!isGroup) {
        if (!recipientId) return sendJson(res, 400, { error: 'Destinatario mancante.' });
        if (recipientId === user.id) return sendJson(res, 400, { error: 'Non puoi avviare una chat con te stesso.' });

        const existing = await db.get(`
          SELECT c.id FROM conversations c
          JOIN conversation_members cm1 ON c.id = cm1.conversation_id
          JOIN conversation_members cm2 ON c.id = cm2.conversation_id
          WHERE c.is_group = 0 AND cm1.user_id = ? AND cm2.user_id = ?
        `, [user.id, recipientId]);

        if (existing) {
          return sendJson(res, 200, { conversationId: existing.id, isExisting: true });
        }

        const convId = 'conv_' + crypto.randomUUID();
        const now = Date.now();
        await db.run('INSERT INTO conversations (id, is_group, created_by, created_at, updated_at) VALUES (?, 0, ?, ?, ?)',
          [convId, user.id, now, now]);
        await db.run("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
          [convId, user.id, now]);
        await db.run("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
          [convId, recipientId, now]);

        broadcastToUser(recipientId, { type: 'conversation:new', conversationId: convId });
        return sendJson(res, 201, { conversationId: convId, isExisting: false });
      } else {
        if (!name || !name.trim()) return sendJson(res, 400, { error: 'Nome del gruppo obbligatorio.' });
        const convId = 'grp_' + crypto.randomUUID();
        const now = Date.now();
        const groupIcon = iconUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name)}`;

        await db.run('INSERT INTO conversations (id, is_group, name, icon_url, created_by, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?)',
          [convId, name.trim(), groupIcon, user.id, now, now]);

        await db.run("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)",
          [convId, user.id, now]);

        if (Array.isArray(memberIds)) {
          for (const mId of memberIds) {
            if (mId && mId !== user.id) {
              await db.run("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
                [convId, mId, now]);
              broadcastToUser(mId, { type: 'conversation:new', conversationId: convId });
            }
          }
        }

        return sendJson(res, 201, { conversationId: convId, isExisting: false });
      }
    }

    // 10b. Conversations: Delete or Leave Conversation
    if (req.method === 'DELETE' && pathname.match(/^\/api\/conversations\/([^/]+)$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const convId = pathname.split('/')[3];
      const conv = await db.get('SELECT * FROM conversations WHERE id = ?', [convId]);
      if (!conv) return sendJson(res, 404, { error: 'Conversazione non trovata.' });

      const member = await db.get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, user.id]);
      if (!member) return sendJson(res, 403, { error: 'Non fai parte di questa conversazione.' });

      if (conv.is_group === 1 && conv.created_by === user.id) {
        // Creator deletes the entire group
        await db.run('DELETE FROM conversations WHERE id = ?', [convId]);
        await broadcastToConversation(convId, { type: 'conversation:deleted', conversationId: convId });
      } else if (conv.is_group === 1) {
        // Non-admin member leaves group
        await db.run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, user.id]);
      } else {
        // Direct 1-on-1: delete conversation for both
        await db.run('DELETE FROM conversations WHERE id = ?', [convId]);
        await broadcastToConversation(convId, { type: 'conversation:deleted', conversationId: convId });
      }

      return sendJson(res, 200, { success: true });
    }

    // 11. Messages: Get History for Conversation
    if (req.method === 'GET' && pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const convId = pathname.split('/')[3];
      const member = await db.get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, user.id]);
      if (!member) return sendJson(res, 403, { error: 'Non fai parte di questa conversazione.' });

      const messages = await db.all(`
        SELECT m.*, u.full_name as sender_name, u.username as sender_username, u.avatar_url as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
        LIMIT 150
      `, [convId]);

      // Starred messages for this user
      const starred = await db.all('SELECT message_id FROM starred_messages WHERE user_id = ?', [user.id]);
      const starredSet = new Set(starred.map(s => s.message_id));

      // Reactions
      const messageIds = messages.map(m => m.id);
      let reactionsMap = {};
      if (messageIds.length > 0) {
        const placeholders = messageIds.map(() => '?').join(',');
        const reactions = await db.all(`
          SELECT r.*, u.username, u.full_name
          FROM message_reactions r
          JOIN users u ON r.user_id = u.id
          WHERE r.message_id IN (${placeholders})
        `, messageIds);

        for (const r of reactions) {
          if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
          reactionsMap[r.message_id].push({
            emoji: r.emoji,
            userId: r.user_id,
            username: r.username,
            fullName: r.full_name
          });
        }
      }

      const formatted = messages.map(m => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderUsername: m.sender_username,
        senderAvatar: m.sender_avatar,
        content: m.is_deleted ? 'Questo messaggio è stato eliminato' : m.content,
        mediaType: m.media_type,
        mediaUrl: m.media_url,
        replyToId: m.reply_to_id,
        isDeleted: m.is_deleted === 1,
        isEdited: m.is_edited === 1,
        editedAt: m.edited_at,
        isPinned: m.is_pinned === 1,
        isStarred: starredSet.has(m.id),
        createdAt: m.created_at,
        reactions: reactionsMap[m.id] || []
      }));

      return sendJson(res, 200, { messages: formatted });
    }

    // 12. Messages: Send New Message
    if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const convId = pathname.split('/')[3];
      const member = await db.get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, user.id]);
      if (!member) return sendJson(res, 403, { error: 'Non sei autorizzato a inviare messaggi in questa conversazione.' });

      const { content, mediaType, mediaUrl, replyToId } = await parseBody(req);
      if (!content && !mediaUrl) {
        return sendJson(res, 400, { error: 'Contenuto del messaggio vuoto.' });
      }

      const msgId = 'msg_' + crypto.randomUUID();
      const now = Date.now();

      await db.run(`
        INSERT INTO messages (id, conversation_id, sender_id, content, media_type, media_url, reply_to_id, is_deleted, is_edited, is_pinned, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
      `, [msgId, convId, user.id, content || '', mediaType || 'text', mediaUrl || null, replyToId || null, now]);

      await db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, convId]);

      const newMsg = {
        id: msgId,
        conversationId: convId,
        senderId: user.id,
        senderName: user.fullName,
        senderUsername: user.username,
        senderAvatar: user.avatarUrl,
        content: content || '',
        mediaType: mediaType || 'text',
        mediaUrl: mediaUrl || null,
        replyToId: replyToId || null,
        isDeleted: false,
        isEdited: false,
        isPinned: false,
        isStarred: false,
        createdAt: now,
        reactions: []
      };

      await broadcastToConversation(convId, {
        type: 'message:new',
        message: newMsg
      });

      return sendJson(res, 201, { success: true, message: newMsg });
    }

    // 12b. Messages: Edit Message (Modifica)
    if (req.method === 'PUT' && pathname.match(/^\/api\/messages\/([^/]+)$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const msgId = pathname.split('/')[3];
      const { content } = await parseBody(req);
      if (!content || !content.trim()) return sendJson(res, 400, { error: 'Contenuto vuoto.' });

      const msg = await db.get('SELECT * FROM messages WHERE id = ?', [msgId]);
      if (!msg) return sendJson(res, 404, { error: 'Messaggio non trovato.' });
      if (msg.sender_id !== user.id) return sendJson(res, 403, { error: 'Puoi modificare solo i tuoi messaggi.' });
      if (msg.is_deleted === 1) return sendJson(res, 400, { error: 'Non puoi modificare un messaggio eliminato.' });

      const now = Date.now();
      await db.run('UPDATE messages SET content = ?, is_edited = 1, edited_at = ? WHERE id = ?', [content.trim(), now, msgId]);

      await broadcastToConversation(msg.conversation_id, {
        type: 'message:edited',
        messageId: msgId,
        conversationId: msg.conversation_id,
        content: content.trim(),
        editedAt: now
      });

      return sendJson(res, 200, { success: true, content: content.trim(), editedAt: now });
    }

    // 12c. Messages: Pin / Unpin Message (Fissa in alto)
    if (req.method === 'POST' && pathname.match(/^\/api\/messages\/([^/]+)\/pin$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const msgId = pathname.split('/')[3];
      const msg = await db.get('SELECT * FROM messages WHERE id = ?', [msgId]);
      if (!msg) return sendJson(res, 404, { error: 'Messaggio non trovato.' });

      const newPinned = msg.is_pinned === 1 ? 0 : 1;
      const now = newPinned ? Date.now() : null;
      await db.run('UPDATE messages SET is_pinned = ?, pinned_at = ? WHERE id = ?', [newPinned, now, msgId]);

      await broadcastToConversation(msg.conversation_id, {
        type: 'message:pinned',
        messageId: msgId,
        conversationId: msg.conversation_id,
        isPinned: newPinned === 1,
        content: msg.content
      });

      return sendJson(res, 200, { success: true, isPinned: newPinned === 1 });
    }

    // 12d. Messages: Star / Unstar Message (Importante)
    if (req.method === 'POST' && pathname.match(/^\/api\/messages\/([^/]+)\/star$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const msgId = pathname.split('/')[3];
      const existing = await db.get('SELECT id FROM starred_messages WHERE user_id = ? AND message_id = ?', [user.id, msgId]);

      let isStarred = false;
      if (existing) {
        await db.run('DELETE FROM starred_messages WHERE id = ?', [existing.id]);
        isStarred = false;
      } else {
        await db.run('INSERT INTO starred_messages (id, user_id, message_id, created_at) VALUES (?, ?, ?, ?)',
          ['star_' + crypto.randomUUID(), user.id, msgId, Date.now()]);
        isStarred = true;
      }

      return sendJson(res, 200, { success: true, isStarred });
    }

    // 12e. Messages: Translate Message (Traduci)
    if (req.method === 'POST' && pathname.match(/^\/api\/messages\/([^/]+)\/translate$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const msgId = pathname.split('/')[3];
      const msg = await db.get('SELECT * FROM messages WHERE id = ?', [msgId]);
      if (!msg) return sendJson(res, 404, { error: 'Messaggio non trovato.' });

      const text = msg.content;
      // High-quality auto-translation simulation / dictionary
      const translations = {
        'hello': 'ciao', 'hi': 'ciao', 'how are you': 'come stai?', 'good morning': 'buongiorno',
        'see you later': 'a più tardi', 'thanks': 'grazie', 'thank you': 'grazie mille',
        'ciao': 'hello', 'come stai?': 'how are you?', 'buongiorno': 'good morning',
        'grazie': 'thank you', 'a presto': 'see you soon'
      };

      let translated = text;
      const lower = text.trim().toLowerCase();
      if (translations[lower]) {
        translated = `[Tradotto]: ${translations[lower]}`;
      } else {
        // If already Italian, offer English translation; else Italian translation
        if (/[àèéìòù]/.test(text) || lower.includes('ciao') || lower.includes('grazie')) {
          translated = `[Traduzione ENG]: ${text} (Translated)`;
        } else {
          translated = `[Traduzione ITA]: ${text} (Tradotto)`;
        }
      }

      return sendJson(res, 200, { success: true, original: text, translated });
    }

    // 12f. Messages: Forward Message (Inoltra)
    if (req.method === 'POST' && pathname === '/api/messages/forward') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const { messageId, targetConversationIds } = await parseBody(req);
      if (!messageId || !Array.isArray(targetConversationIds) || targetConversationIds.length === 0) {
        return sendJson(res, 400, { error: 'Messaggio o destinatari non validi.' });
      }

      const origMsg = await db.get('SELECT * FROM messages WHERE id = ?', [messageId]);
      if (!origMsg) return sendJson(res, 404, { error: 'Messaggio originale non trovato.' });

      const forwardedMessages = [];
      const now = Date.now();

      for (const convId of targetConversationIds) {
        const member = await db.get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, user.id]);
        if (!member) continue;

        const newMsgId = 'msg_' + crypto.randomUUID();
        const fwdContent = origMsg.content;

        await db.run(`
          INSERT INTO messages (id, conversation_id, sender_id, content, media_type, media_url, reply_to_id, is_deleted, is_edited, is_pinned, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, ?)
        `, [newMsgId, convId, user.id, fwdContent, origMsg.media_type, origMsg.media_url, now]);

        await db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, convId]);

        const fwdObj = {
          id: newMsgId,
          conversationId: convId,
          senderId: user.id,
          senderName: user.fullName,
          senderUsername: user.username,
          senderAvatar: user.avatarUrl,
          content: fwdContent,
          mediaType: origMsg.media_type,
          mediaUrl: origMsg.media_url,
          isForwarded: true,
          createdAt: now,
          reactions: []
        };

        await broadcastToConversation(convId, { type: 'message:new', message: fwdObj });
        forwardedMessages.push(fwdObj);
      }

      return sendJson(res, 200, { success: true, count: forwardedMessages.length });
    }

    // 13. Messages: Delete Message
    if (req.method === 'DELETE' && pathname.match(/^\/api\/messages\/([^/]+)$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const msgId = pathname.split('/')[3];
      const msg = await db.get('SELECT * FROM messages WHERE id = ?', [msgId]);
      if (!msg) return sendJson(res, 404, { error: 'Messaggio non trovato.' });

      if (msg.sender_id !== user.id) {
        return sendJson(res, 403, { error: 'Non puoi eliminare i messaggi di altri utenti.' });
      }

      await db.run("UPDATE messages SET is_deleted = 1, content = '', media_url = NULL WHERE id = ?", [msgId]);

      await broadcastToConversation(msg.conversation_id, {
        type: 'message:deleted',
        messageId: msgId,
        conversationId: msg.conversation_id
      });

      return sendJson(res, 200, { success: true });
    }

    // 14. Messages: Reaction (Add / Remove)
    if (req.method === 'POST' && pathname.match(/^\/api\/messages\/([^/]+)\/reactions$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const msgId = pathname.split('/')[3];
      const { emoji } = await parseBody(req);
      if (!emoji) return sendJson(res, 400, { error: 'Emoji richiesta.' });

      const msg = await db.get('SELECT conversation_id FROM messages WHERE id = ?', [msgId]);
      if (!msg) return sendJson(res, 404, { error: 'Messaggio non trovato.' });

      const existingReaction = await db.get('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [msgId, user.id, emoji]);

      if (existingReaction) {
        await db.run('DELETE FROM message_reactions WHERE id = ?', [existingReaction.id]);
      } else {
        await db.run('INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)',
          ['reac_' + crypto.randomUUID(), msgId, user.id, emoji, Date.now()]);
      }

      const allReactions = await db.all(`
        SELECT r.*, u.username, u.full_name
        FROM message_reactions r
        JOIN users u ON r.user_id = u.id
        WHERE r.message_id = ?
      `, [msgId]);

      await broadcastToConversation(msg.conversation_id, {
        type: 'message:reaction_update',
        messageId: msgId,
        conversationId: msg.conversation_id,
        reactions: allReactions.map(r => ({
          emoji: r.emoji,
          userId: r.user_id,
          username: r.username,
          fullName: r.full_name
        }))
      });

      return sendJson(res, 200, { success: true, reactions: allReactions });
    }

    // 15. Starred Messages: List
    if (req.method === 'GET' && pathname === '/api/starred') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const starred = await db.all(`
        SELECT m.*, u.full_name as sender_name, u.username as sender_username, u.avatar_url as sender_avatar, c.name as conversation_name
        FROM starred_messages sm
        JOIN messages m ON sm.message_id = m.id
        JOIN users u ON m.sender_id = u.id
        JOIN conversations c ON m.conversation_id = c.id
        WHERE sm.user_id = ? AND m.is_deleted = 0
        ORDER BY sm.created_at DESC
      `, [user.id]);

      return sendJson(res, 200, { starred });
    }

    // 16. To-Do List (Cose da Fare / Note Personali)
    if (req.method === 'GET' && pathname === '/api/todos') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const todos = await db.all('SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
      return sendJson(res, 200, {
        todos: todos.map(t => ({
          id: t.id,
          title: t.title,
          isCompleted: t.is_completed === 1,
          priority: t.priority,
          createdAt: t.created_at
        }))
      });
    }

    if (req.method === 'POST' && pathname === '/api/todos') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const { title, priority } = await parseBody(req);
      if (!title || !title.trim()) return sendJson(res, 400, { error: 'Titolo attività richiesto.' });

      const todoId = 'todo_' + crypto.randomUUID();
      const now = Date.now();
      await db.run('INSERT INTO todos (id, user_id, title, is_completed, priority, created_at) VALUES (?, ?, ?, 0, ?, ?)',
        [todoId, user.id, title.trim(), priority || 'normal', now]);

      return sendJson(res, 201, {
        todo: { id: todoId, title: title.trim(), isCompleted: false, priority: priority || 'normal', createdAt: now }
      });
    }

    if (req.method === 'PUT' && pathname.match(/^\/api\/todos\/([^/]+)$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const todoId = pathname.split('/')[3];
      const { isCompleted, title, priority } = await parseBody(req);

      const todo = await db.get('SELECT * FROM todos WHERE id = ? AND user_id = ?', [todoId, user.id]);
      if (!todo) return sendJson(res, 404, { error: 'Attività non trovata.' });

      await db.run(`
        UPDATE todos 
        SET is_completed = COALESCE(?, is_completed),
            title = COALESCE(?, title),
            priority = COALESCE(?, priority)
        WHERE id = ?
      `, [isCompleted !== undefined ? (isCompleted ? 1 : 0) : null, title || null, priority || null, todoId]);

      const updated = await db.get('SELECT * FROM todos WHERE id = ?', [todoId]);
      return sendJson(res, 200, {
        todo: { id: updated.id, title: updated.title, isCompleted: updated.is_completed === 1, priority: updated.priority, createdAt: updated.created_at }
      });
    }

    if (req.method === 'DELETE' && pathname.match(/^\/api\/todos\/([^/]+)$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const todoId = pathname.split('/')[3];
      await db.run('DELETE FROM todos WHERE id = ? AND user_id = ?', [todoId, user.id]);
      return sendJson(res, 200, { success: true });
    }

    // 17. Linked Devices (Dispositivi Collegati)
    if (req.method === 'GET' && pathname === '/api/devices') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const sessions = await db.all('SELECT id, user_agent, ip_address, created_at, last_active FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_active DESC', [user.id, Date.now()]);
      const formatted = sessions.map(s => {
        let browser = 'Browser Web';
        if (s.user_agent) {
          if (s.user_agent.includes('Chrome')) browser = 'Google Chrome';
          else if (s.user_agent.includes('Safari')) browser = 'Apple Safari';
          else if (s.user_agent.includes('Firefox')) browser = 'Mozilla Firefox';
          else if (s.user_agent.includes('Edge')) browser = 'Microsoft Edge';
        }
        let os = 'Dispositivo';
        if (s.user_agent) {
          if (s.user_agent.includes('Macintosh')) os = 'macOS';
          else if (s.user_agent.includes('Windows')) os = 'Windows';
          else if (s.user_agent.includes('Android')) os = 'Android';
          else if (s.user_agent.includes('iPhone')) os = 'iOS';
          else if (s.user_agent.includes('Linux')) os = 'Linux';
        }
        return {
          id: s.id,
          browser,
          os,
          ipAddress: s.ip_address || '127.0.0.1',
          createdAt: s.created_at,
          lastActive: s.last_active,
          isCurrent: s.id === user.currentSessionId
        };
      });

      return sendJson(res, 200, { devices: formatted });
    }

    if (req.method === 'DELETE' && pathname.match(/^\/api\/devices\/([^/]+)$/)) {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const sessionId = pathname.split('/')[3];
      await db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [sessionId, user.id]);
      return sendJson(res, 200, { success: true });
    }

    // 18. Communities: Hub
    if (req.method === 'GET' && pathname === '/api/communities') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const communities = await db.all(`
        SELECT c.*, COUNT(cm.user_id) as member_count
        FROM communities c
        LEFT JOIN community_members cm ON c.id = cm.community_id
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);

      return sendJson(res, 200, {
        communities: communities.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          iconUrl: c.icon_url,
          memberCount: c.member_count,
          createdAt: c.created_at
        }))
      });
    }

    if (req.method === 'POST' && pathname === '/api/communities') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const { name, description, iconUrl } = await parseBody(req);
      if (!name || !name.trim()) return sendJson(res, 400, { error: 'Nome community obbligatorio.' });

      const commId = 'comm_' + crypto.randomUUID();
      const now = Date.now();
      const icon = iconUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name)}`;

      await db.run('INSERT INTO communities (id, name, description, icon_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [commId, name.trim(), description || '', icon, user.id, now]);

      await db.run("INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)",
        [commId, user.id, now]);

      // Automatically create the official "Annunci" announcement channel conversation for this community
      const annConvId = 'grp_' + crypto.randomUUID();
      await db.run('INSERT INTO conversations (id, is_group, name, icon_url, created_by, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?)',
        [annConvId, `📢 ${name.trim()} • Annunci`, icon, user.id, now, now]);
      await db.run("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)",
        [annConvId, user.id, now]);

      return sendJson(res, 201, {
        community: { id: commId, name: name.trim(), description, iconUrl: icon, memberCount: 1, announcementConvId: annConvId }
      });
    }

    // 19. Stories: List Active
    if (req.method === 'GET' && pathname === '/api/stories') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const now = Date.now();
      const activeStories = await db.all(`
        SELECT s.*, u.username, u.full_name, u.avatar_url
        FROM stories s
        JOIN users u ON s.user_id = u.id
        WHERE s.expires_at > ?
        ORDER BY s.created_at ASC
      `, [now]);

      const usersMap = {};
      for (const story of activeStories) {
        if (!usersMap[story.user_id]) {
          usersMap[story.user_id] = {
            userId: story.user_id,
            username: story.username,
            fullName: story.full_name,
            avatarUrl: story.avatar_url,
            isCurrentUser: story.user_id === user.id,
            stories: []
          };
        }
        usersMap[story.user_id].stories.push({
          id: story.id,
          type: story.type,
          mediaUrl: story.media_url,
          textContent: story.text_content,
          bgGradient: story.bg_gradient,
          createdAt: story.created_at,
          expiresAt: story.expires_at
        });
      }

      const list = Object.values(usersMap).sort((a, b) => {
        if (a.isCurrentUser) return -1;
        if (b.isCurrentUser) return 1;
        return 0;
      });

      return sendJson(res, 200, { storyGroups: list });
    }

    // 20. Stories: Create New
    if (req.method === 'POST' && pathname === '/api/stories') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const { type, mediaUrl, textContent, bgGradient } = await parseBody(req);
      const storyId = 'stry_' + crypto.randomUUID();
      const now = Date.now();
      const expiresAt = now + 24 * 60 * 60 * 1000;

      await db.run(`
        INSERT INTO stories (id, user_id, type, media_url, text_content, bg_gradient, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [storyId, user.id, type || 'text', mediaUrl || null, textContent || null, bgGradient || 'linear-gradient(135deg, #10b981, #06b6d4)', now, expiresAt]);

      const storyObj = {
        id: storyId,
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        type: type || 'text',
        mediaUrl,
        textContent,
        bgGradient,
        createdAt: now,
        expiresAt
      };

      for (const sock of clients.keys()) {
        sendToSocket(sock, { type: 'story:new', story: storyObj });
      }

      return sendJson(res, 201, { success: true, story: storyObj });
    }

    // 21. Upload File (Photos, Memes, Voice Notes)
    if (req.method === 'POST' && pathname === '/api/upload') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const { data, filename } = await parseBody(req);
      if (!data) return sendJson(res, 400, { error: 'Dati file mancanti.' });

      let base64Data = data;
      let extension = '.png';

      if (data.includes(';base64,')) {
        const parts = data.split(';base64,');
        const mime = parts[0].replace('data:', '');
        base64Data = parts[1];
        if (mime.includes('jpeg') || mime.includes('jpg')) extension = '.jpg';
        else if (mime.includes('gif')) extension = '.gif';
        else if (mime.includes('webp')) extension = '.webp';
        else if (mime.includes('webm')) extension = '.webm';
        else if (mime.includes('mp4')) extension = '.mp4';
        else if (mime.includes('audio/ogg')) extension = '.ogg';
        else if (mime.includes('audio/wav')) extension = '.wav';
        else if (mime.includes('audio')) extension = '.webm';
      }

      const fileId = crypto.randomUUID();
      const outputName = `${fileId}${extension}`;
      const outputPath = path.join(UPLOADS_DIR, outputName);

      fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));

      return sendJson(res, 200, {
        url: `/uploads/${outputName}`,
        filename: filename || outputName
      });
    }

    // 22. Calls History Log
    if (req.method === 'GET' && pathname === '/api/calls/history') {
      const user = await getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non autenticato' });

      const calls = await db.all(`
        SELECT c.*, 
          u1.full_name as caller_name, u1.avatar_url as caller_avatar,
          u2.full_name as receiver_name, u2.avatar_url as receiver_avatar
        FROM calls c
        LEFT JOIN users u1 ON c.caller_id = u1.id
        LEFT JOIN users u2 ON c.receiver_id = u2.id
        WHERE c.caller_id = ? OR c.receiver_id = ?
        ORDER BY c.created_at DESC
        LIMIT 50
      `, [user.id, user.id]);

      return sendJson(res, 200, { calls });
    }

    // 23. Developer endpoint: View latest OTP for instant testing convenience
    if (req.method === 'GET' && pathname === '/api/dev/latest-otp') {
      return sendJson(res, 200, { latestOtp: LATEST_DEV_OTP });
    }

    // ---------------- STATIC FILE SERVING ----------------
    let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    if (safePath === '/' || safePath === '') safePath = '/index.html';

    let filePath = path.join(PUBLIC_DIR, safePath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

  } catch (err) {
    console.error('[Server] Request error:', err);
    sendJson(res, 500, { error: 'Internal Server Error', message: err.message });
  }
});

// -------------------------------------------------------------
// WebSocket Protocol Upgrade & Event Dispatcher
// -------------------------------------------------------------
server.on('upgrade', (req, socket, head) => {
  const upgradeHeader = req.headers['upgrade'];
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const digest = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + digest + '\r\n\r\n'
  );

  const clientInfo = {
    userId: null,
    username: null,
    alive: true,
    buffer: Buffer.alloc(0)
  };
  clients.set(socket, clientInfo);

  socket.on('data', chunk => {
    clientInfo.buffer = Buffer.concat([clientInfo.buffer, chunk]);
    const { frames, remaining } = decodeWsFrames(clientInfo.buffer);
    clientInfo.buffer = remaining;

    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        socket.end();
        break;
      }
      if (frame.opcode === 0x9) {
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a;
        pong[1] = 0;
        socket.write(pong);
        continue;
      }
      if (frame.opcode === 0xa) {
        clientInfo.alive = true;
        continue;
      }
      if (frame.opcode === 0x1) {
        try {
          const payloadStr = frame.payload.toString('utf8');
          const data = JSON.parse(payloadStr);
          handleWsMessage(socket, clientInfo, data).catch(err => {
            console.error('[WS] handleWsMessage error:', err.message);
          });
        } catch (err) {
          console.error('[WS] Parse message error:', err.message);
        }
      }
    }
  });

  socket.on('close', () => {
    if (clientInfo.userId) {
      broadcastPresence(clientInfo.userId, false).catch(() => {});
    }
    clients.delete(socket);
  });

  socket.on('error', err => {
    if (clientInfo.userId) {
      broadcastPresence(clientInfo.userId, false).catch(() => {});
    }
    clients.delete(socket);
  });
});

async function handleWsMessage(socket, clientInfo, data) {
  const type = data.type;

  // 1. Auth Handshake
  if (type === 'auth') {
    const session = await db.get('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?', [data.token, Date.now()]);
    if (session) {
      const user = await db.get('SELECT id, username, full_name, avatar_url FROM users WHERE id = ?', [session.user_id]);
      if (user) {
        clientInfo.userId = user.id;
        clientInfo.username = user.username;
        sendToSocket(socket, { type: 'auth:success', user: sanitizeUser(user) });
        await broadcastPresence(user.id, true);
        console.log(`[WS NOVA] Utente connesso: @${user.username} (${user.id})`);
      }
    } else {
      sendToSocket(socket, { type: 'auth:error', error: 'Token non valido.' });
    }
    return;
  }

  if (!clientInfo.userId) {
    return sendToSocket(socket, { type: 'error', message: 'Non autenticato' });
  }

  // 2. Typing Indicator
  if (type === 'typing') {
    const { conversationId, isTyping } = data;
    if (!conversationId) return;
    await broadcastToConversation(conversationId, {
      type: 'typing',
      conversationId,
      userId: clientInfo.userId,
      username: clientInfo.username,
      isTyping: !!isTyping
    }, clientInfo.userId);
    return;
  }

  // 3. WebRTC Signaling
  if (type === 'call:initiate') {
    const { targetUserId, callType, conversationId } = data;
    const caller = await db.get('SELECT id, username, full_name, avatar_url FROM users WHERE id = ?', [clientInfo.userId]);
    const callId = 'call_' + crypto.randomUUID();
    await db.run("INSERT INTO calls (id, caller_id, receiver_id, conversation_id, call_type, status, duration, created_at) VALUES (?, ?, ?, ?, ?, 'ringing', 0, ?)",
      [callId, caller.id, targetUserId, conversationId, callType || 'video', Date.now()]);

    broadcastToUser(targetUserId, {
      type: 'call:incoming',
      callId,
      callType: callType || 'video',
      conversationId,
      caller: {
        id: caller.id,
        username: caller.username,
        fullName: caller.full_name,
        avatarUrl: caller.avatar_url
      }
    });
    return;
  }

  if (type === 'call:accept') {
    const { callId, callerId } = data;
    await db.run("UPDATE calls SET status = 'connected' WHERE id = ?", [callId]);
    broadcastToUser(callerId, {
      type: 'call:accepted',
      callId,
      receiverId: clientInfo.userId
    });
    return;
  }

  if (type === 'call:reject') {
    const { callId, callerId, reason } = data;
    await db.run("UPDATE calls SET status = 'declined' WHERE id = ?", [callId]);
    broadcastToUser(callerId, {
      type: 'call:rejected',
      callId,
      reason: reason || 'Chiamata rifiutata.'
    });
    return;
  }

  if (type === 'call:offer') {
    const { targetUserId, sdp } = data;
    broadcastToUser(targetUserId, {
      type: 'call:offer',
      fromUserId: clientInfo.userId,
      sdp
    });
    return;
  }

  if (type === 'call:answer') {
    const { targetUserId, sdp } = data;
    broadcastToUser(targetUserId, {
      type: 'call:answer',
      fromUserId: clientInfo.userId,
      sdp
    });
    return;
  }

  if (type === 'call:ice_candidate') {
    const { targetUserId, candidate } = data;
    broadcastToUser(targetUserId, {
      type: 'call:ice_candidate',
      fromUserId: clientInfo.userId,
      candidate
    });
    return;
  }

  if (type === 'call:end') {
    const { targetUserId, callId, duration } = data;
    if (callId) {
      await db.run("UPDATE calls SET status = 'completed', duration = ? WHERE id = ?", [duration || 0, callId]);
    }
    if (targetUserId) {
      broadcastToUser(targetUserId, {
        type: 'call:ended',
        fromUserId: clientInfo.userId
      });
    }
    return;
  }
}

// Heartbeat
setInterval(() => {
  for (const [socket, client] of clients.entries()) {
    if (!client.alive) {
      socket.destroy();
      clients.delete(socket);
      continue;
    }
    client.alive = false;
    const ping = Buffer.alloc(2);
    ping[0] = 0x89;
    ping[1] = 0;
    try {
      socket.write(ping);
    } catch {
      socket.destroy();
      clients.delete(socket);
    }
  }
}, 30000);

// Start Server (with async DB initialization)
async function startServer() {
  await db.initDb();
  server.listen(PORT, HOST, () => {
    console.log(`\n======================================================`);
    console.log(`⚡ NOVA MESSENGER SERVER IN ESECUZIONE!`);
    console.log(`🌐 Indirizzo locale: http://localhost:${PORT}`);
    console.log(`📁 Directory pubblica: ${PUBLIC_DIR}`);
    console.log(`💾 Database: ${process.env.TURSO_DATABASE_URL || 'SQLite locale (nova.db)'}`);
    console.log(`======================================================\n`);
  });
}

startServer().catch(err => {
  console.error('Errore avvio server:', err);
  process.exit(1);
});
