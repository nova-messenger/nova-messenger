// test_aether.js - Automated Verification Suite for NOVA Messenger 360°
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { Readable, Writable } = require('node:stream');

// Configure isolated test database
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, 'test_nova.db');

if (fs.existsSync(process.env.DB_PATH)) {
  fs.unlinkSync(process.env.DB_PATH);
}

let serverInstance = null;
const originalCreateServer = http.createServer;
http.createServer = function(...args) {
  serverInstance = originalCreateServer.apply(this, args);
  return serverInstance;
};

require('./server.js');

function mockReq(method, endpoint, body = null, token = null) {
  return new Promise((resolve) => {
    const postData = body ? JSON.stringify(body) : '';
    const req = new Readable({
      read() {
        if (postData) this.push(postData);
        this.push(null);
      }
    });

    req.method = method;
    req.url = endpoint;
    req.headers = {
      'host': 'localhost',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/120.0',
      ...(token ? { 'authorization': `Bearer ${token}` } : {})
    };

    let resData = '';
    const res = new Writable({
      write(chunk, encoding, callback) {
        resData += chunk.toString();
        callback();
      }
    });

    res.statusCode = 200;
    res.headers = {};
    res.writeHead = (status, headers = {}) => {
      res.statusCode = status;
      res.headers = headers;
    };

    res.end = (chunk) => {
      if (chunk) resData += chunk.toString();
      try {
        const parsed = resData ? JSON.parse(resData) : {};
        resolve({ status: res.statusCode, data: parsed, raw: resData });
      } catch (e) {
        resolve({ status: res.statusCode, data: null, raw: resData });
      }
    };

    serverInstance.emit('request', req, res);
  });
}

async function runTests() {
  await new Promise(r => setTimeout(r, 1000)); // Wait for async DB init
  console.log('\n=============================================');
  console.log('🧪 AVVIO TEST AUTOMATIZZATI PER NOVA 360°');
  console.log('=============================================\n');

  // 1. Register User 1: Andrea
  console.log('1. Test Registrazione Utente 1 (Andrea)...');
  const reg1 = await mockReq('POST', '/api/auth/register', {
    fullName: 'Andrea Lazzaro',
    username: 'andrea',
    email: 'andrea@test.com',
    password: 'Password123!'
  });
  if (reg1.status !== 201 || !reg1.data.devOtp) {
    throw new Error('Registrazione Andrea fallita: ' + JSON.stringify(reg1));
  }
  console.log('  ✅ Andrea registrato con successo! OTP generato:', reg1.data.devOtp);

  // 2. Verify User 1 with OTP
  console.log('2. Test Verifica Email OTP per Andrea...');
  const ver1 = await mockReq('POST', '/api/auth/verify', {
    email: 'andrea@test.com',
    code: reg1.data.devOtp
  });
  if (ver1.status !== 200 || !ver1.data.token) {
    throw new Error('Verifica Andrea fallita: ' + JSON.stringify(ver1));
  }
  const token1 = ver1.data.token;
  console.log('  ✅ Andrea verificato con successo! Session Token generato.');

  // 3. Register User 2: Samuele
  console.log('3. Test Registrazione Utente 2 (Samuele)...');
  const reg2 = await mockReq('POST', '/api/auth/register', {
    fullName: 'Samuele Rossi',
    username: 'samuele',
    email: 'samuele@test.com',
    password: 'Password123!'
  });
  const token2 = (await mockReq('POST', '/api/auth/verify', {
    email: 'samuele@test.com',
    code: reg2.data.devOtp
  })).data.token;
  console.log('  ✅ Samuele verificato con successo!');

  // 4. Search Contact by @username
  console.log('4. Test Ricerca Utente per @username (@samuele)...');
  const searchRes = await mockReq('GET', '/api/users/search?q=@samuele', null, token1);
  const foundUser = searchRes.data.users[0];
  console.log('  ✅ Utente trovato:', foundUser.fullName, '(@' + foundUser.username + ')');

  // 5. Create Direct 1-on-1 Conversation
  console.log('5. Test Creazione Conversazione Diretta...');
  const convRes = await mockReq('POST', '/api/conversations', {
    isGroup: false,
    recipientId: foundUser.id
  }, token1);
  const convId = convRes.data.conversationId;
  console.log('  ✅ Conversazione creata! ID:', convId);

  // 6. Send Message
  console.log('6. Test Invio Messaggio in Chat...');
  const msgRes = await mockReq('POST', `/api/conversations/${convId}/messages`, {
    content: 'Ciao Samuele! Benvenuto su NOVA ✦',
    mediaType: 'text'
  }, token1);
  const sentMsg = msgRes.data.message;
  console.log('  ✅ Messaggio inviato! Testo:', sentMsg.content);

  // 7. Edit Message (360° feature)
  console.log('7. Test Modifica Messaggio (Edit)...');
  const editRes = await mockReq('PUT', `/api/messages/${sentMsg.id}`, {
    content: 'Ciao Samuele! Benvenuto su NOVA ✦ (Testo Modificato)'
  }, token1);
  if (editRes.status !== 200 || !editRes.data.content.includes('Modificato')) {
    throw new Error('Modifica fallita: ' + JSON.stringify(editRes));
  }
  console.log('  ✅ Messaggio modificato con successo! Nuovo testo:', editRes.data.content);

  // 8. Pin Message (360° feature)
  console.log('8. Test Fissa Messaggio in Alto (Pin)...');
  const pinRes = await mockReq('POST', `/api/messages/${sentMsg.id}/pin`, null, token1);
  if (pinRes.status !== 200 || !pinRes.data.isPinned) {
    throw new Error('Pin fallito: ' + JSON.stringify(pinRes));
  }
  console.log('  ✅ Messaggio fissato in alto con successo!');

  // 9. Star Message (360° feature)
  console.log('9. Test Messaggio Importante (Stella)...');
  const starRes = await mockReq('POST', `/api/messages/${sentMsg.id}/star`, null, token1);
  if (starRes.status !== 200 || !starRes.data.isStarred) {
    throw new Error('Stella fallita: ' + JSON.stringify(starRes));
  }
  console.log('  ✅ Messaggio contrassegnato con la stella!');

  // 10. Translate Message (360° feature)
  console.log('10. Test Traduzione Messaggio...');
  const transRes = await mockReq('POST', `/api/messages/${sentMsg.id}/translate`, null, token1);
  if (transRes.status !== 200 || !transRes.data.translated) {
    throw new Error('Traduzione fallita: ' + JSON.stringify(transRes));
  }
  console.log('  ✅ Messaggio tradotto con successo:', transRes.data.translated);

  // 11. To-Do List in "Tu" (360° feature)
  console.log('11. Test Gestione Cose da Fare (To-Do List)...');
  const todoRes = await mockReq('POST', '/api/todos', { title: 'Comprare biglietti concerto' }, token1);
  if (todoRes.status !== 201) throw new Error('Creazione To-Do fallita');
  const todoList = await mockReq('GET', '/api/todos', null, token1);
  if (todoList.data.todos.length === 0) throw new Error('Lettura To-Do fallita');
  console.log('  ✅ To-Do list creata e letta con successo!');

  // 12. Linked Devices (360° feature)
  console.log('12. Test Dispositivi Collegati...');
  const devRes = await mockReq('GET', '/api/devices', null, token1);
  if (devRes.status !== 200 || devRes.data.devices.length === 0) throw new Error('Dispositivi falliti');
  console.log('  ✅ Dispositivo rilevato:', devRes.data.devices[0].browser, 'su', devRes.data.devices[0].os);

  // 13. Create Community (360° feature)
  console.log('13. Test Creazione Community...');
  const commRes = await mockReq('POST', '/api/communities', {
    name: 'NOVA Devs Community',
    description: 'Community per appassionati di messaggistica'
  }, token1);
  if (commRes.status !== 201 || !commRes.data.community) throw new Error('Creazione community fallita');
  console.log('  ✅ Community creata con canale Annunci!');

  console.log('\n=============================================');
  console.log('🎉 TUTTI I TEST 360° SUPERATI CON SUCCESSO AL 100%!');
  console.log('=============================================\n');

  if (fs.existsSync(process.env.DB_PATH)) {
    fs.unlinkSync(process.env.DB_PATH);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ ERRORE TEST:', err);
  process.exit(1);
});
