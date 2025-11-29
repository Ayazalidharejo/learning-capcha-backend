const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
require('dotenv').config();
const mongoose = require('mongoose');
const cors = require('cors');
const svgCaptcha = require('svg-captcha');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// For production use MongoDB via mongoose. If MONGO_URI is not provided or
// connection fails, the server will fall back to file-based storage for demo purposes.
const MONGO_URI = process.env.MONGO_URI || null;

let useMongo = false;
let UserModel = null;
let CalendarModel = null;

async function connectMongo() {
  if (!MONGO_URI) return;
  try {
    await mongoose.connect(MONGO_URI, { dbName: 'capcha_demo', autoIndex: true });
    useMongo = true;

    // define schemas
    const QuestionSchema = new mongoose.Schema({ question: String, answer: String }, { _id: false });
    const UserSchema = new mongoose.Schema({ name: String, email: { type: String, index: true, unique: true }, passwordHash: String, questions: [QuestionSchema], createdAt: { type: Date, default: Date.now } });
    UserModel = mongoose.model('User', UserSchema);

    const DaySchema = new mongoose.Schema({ id: String, date: String, status: String, holder: String }, { _id: false });
    const MonthSchema = new mongoose.Schema({ label: String, year: Number, month: Number, days: [DaySchema] }, { _id: false });
    const CalendarSchema = new mongoose.Schema({ months: [MonthSchema], createdAt: { type: Date, default: Date.now } });
    CalendarModel = mongoose.model('Calendar', CalendarSchema);

    console.log('Connected to MongoDB');
  } catch (e) {
    console.warn('MongoDB connection failed. Falling back to file storage. Error:', e && e.message);
    useMongo = false;
  }
}

// file fallback
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CAL_FILE = path.join(DATA_DIR, 'calendar.json');

function loadJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8')) || fallback;
  } catch (e) { return fallback; }
}

function saveJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

let users = loadJson(USERS_FILE, { users: [] });
let calendarData = loadJson(CAL_FILE, {});

// If calendar not setup, create 6 months from now each with 5 available dates
function initCalendar() {
  const months = [];
  const now = new Date();
  for (let m = 0; m < 6; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const monthLabel = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    // select 5 days: 3, 8, 13, 18, 23 (if exceed month days choose nearest)
    const days = [3,8,13,18,23].map(day => {
      const date = new Date(d.getFullYear(), d.getMonth(), Math.min(day, new Date(d.getFullYear(), d.getMonth()+1,0).getDate()));
      const id = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
      return { id, date: date.toISOString().slice(0,10), status: 'available', holder: null };
    });
    months.push({ label: monthLabel, year: d.getFullYear(), month: d.getMonth()+1, days });
  }
  calendarData = { months };
  saveJson(CAL_FILE, calendarData);
}

// if using mongo, we will ensure calendar doc exists after connecting
async function ensureCalendar() {
  if (useMongo && CalendarModel) {
    const existing = await CalendarModel.findOne({}).exec();
    if (!existing) {
      const months = [];
      const now = new Date();
      for (let m = 0; m < 6; m++) {
        const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
        const monthLabel = d.toLocaleString('default', { month: 'long', year: 'numeric' });
        const days = [3,8,13,18,23].map(day => {
          const date = new Date(d.getFullYear(), d.getMonth(), Math.min(day, new Date(d.getFullYear(), d.getMonth()+1,0).getDate()));
          const id = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
          return { id, date: date.toISOString().slice(0,10), status: 'available', holder: null };
        });
        months.push({ label: monthLabel, year: d.getFullYear(), month: d.getMonth()+1, days });
      }
      const cal = new CalendarModel({ months });
      await cal.save();
      calendarData = { months };
      return;
    }
    calendarData = existing.toObject();
    return;
  }
  if (!calendarData.months || calendarData.months.length === 0) initCalendar();
}

const app = express();
// Allow requests from development and production frontends. You can override using FRONTEND_URL in environment.
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://learning-capcha.vercel.app',
  'http://localhost:5173',
  'http://localhost:3030',
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (e.g. curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    const msg = `CORS policy: origin '${origin}' not allowed`;
    return callback(new Error(msg), false);
  }
}));
app.use(bodyParser.json());
// Serve the frontend -- prefer a built React app in client/dist, fall back to public/ for older static content
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('/', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
} else {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
}

// basic request logging — makes it easier to see incoming API calls
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Global uncaught handlers to log unexpected crashes in serverless environment
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err && err.stack ? err.stack : err);
});

// In-memory maps for pending registrations, captchas, pending logins, sessions
const pendingRegs = {}; // id -> {name,email,passwordHash}
const captchas = {}; // id -> {text, expiresAt}
const pendingLogin = {}; // loginId -> { userId }
const sessions = {}; // token -> { userId }

// Periodic cleanup for captchas/pending regs
setInterval(() => {
  const now = Date.now();
  for (const k of Object.keys(captchas)) if (captchas[k].expiresAt < now) delete captchas[k];
  for (const k of Object.keys(pendingRegs)) if (pendingRegs[k].expiresAt < now) delete pendingRegs[k];
}, 1000 * 30);

// Security questions
const QUESTIONS = [
  'What was the name of your first pet?',
  'Which city were you born in?',
  'What is your favourite book?',
];

app.get('/api/questions', (req, res) => {
  res.json({ questions: QUESTIONS });
});

app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));

app.post('/api/register-stage1', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body || {};
  console.log('register-stage1 payload:', { name, email, password: !!password, confirmPassword: !!confirmPassword });
  if (!name || !email || !password || !confirmPassword) return res.status(400).json({ error: 'All fields required' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
  let exists = null;
  if (useMongo && UserModel) {
    exists = await UserModel.findOne({ email: email.toLowerCase() }).exec();
  } else {
    exists = users.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }
  if (exists) return res.status(400).json({ error: 'Email already registered' });
  const passHash = await bcrypt.hash(password, 10);
  const regId = uuidv4();
  pendingRegs[regId] = { name, email, passwordHash: passHash, createdAt: Date.now(), expiresAt: Date.now() + 1000 * 60 * 15 };
  res.json({ registrationId: regId });
});

app.post('/api/register-stage2', (req, res) => {
  const { registrationId, answers } = req.body || {};
  console.log('register-stage2 payload:', { registrationId, answers });
  // answers should be array of { question, answer }
  // guard against literal 'undefined' or 'null' strings sent by some clients
  if (!registrationId || registrationId === 'undefined' || registrationId === 'null' || !answers || !Array.isArray(answers) || answers.length !== 3) return res.status(400).json({ error: 'Invalid payload' });
  const pending = pendingRegs[registrationId];
  if (!pending) return res.status(400).json({ error: 'Registration not found or expired' });
  // store user
  const id = uuidv4();
  const questions = answers.map(a => ({ question: (a.question||'').toString(), answer: (a.answer||'').toString().trim().toLowerCase() }));
  if (useMongo && UserModel) {
    const userDoc = new UserModel({ name: pending.name, email: pending.email.toLowerCase(), passwordHash: pending.passwordHash, questions });
    userDoc.save().catch(e => console.error('Save user failed', e && e.message));
  } else {
    const user = { id, name: pending.name, email: pending.email, passwordHash: pending.passwordHash, questions };
    users.users.push(user);
    saveJson(USERS_FILE, users);
  }
  delete pendingRegs[registrationId];
  res.json({ success: true });
});

app.get('/api/captcha', (req, res) => {
  const cap = svgCaptcha.create({ noise: 2, size: 5, width: 160, height: 50, ignoreChars: '0oO1ilI' });
  const id = uuidv4();
  captchas[id] = { text: cap.text.toLowerCase(), expiresAt: Date.now() + 1000*60 }; // 60s
  res.json({ captchaId: id, svg: cap.data });
});

app.post('/api/login-step1', async (req, res) => {
  const { username, password, captchaId, captchaAnswer } = req.body || {};
  if (!username || !password || !captchaId || !captchaAnswer) return res.status(400).json({ error: 'Missing fields' });
  const cap = captchas[captchaId];
  if (!cap || cap.text !== captchaAnswer.toString().toLowerCase()) return res.status(400).json({ error: 'Captcha mismatch or expired' });
  delete captchas[captchaId];
  let user = null;
  if (useMongo && UserModel) user = await UserModel.findOne({ email: username.toLowerCase() }).exec(); else user = users.users.find(u=> u.email.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(400).json({ error: 'Invalid username/password' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid username/password' });
  const loginId = uuidv4();
  pendingLogin[loginId] = { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + 1000*60*5 };
  res.json({ loginId, questions: user.questions.map(q=>q.question) });
});

app.post('/api/login-step2', (req, res) => {
  const { loginId, answers } = req.body || {};
  if (!loginId || !answers || !Array.isArray(answers) || answers.length !== 3) return res.status(400).json({ error: 'Invalid payload' });
  const pending = pendingLogin[loginId];
  if (!pending) return res.status(400).json({ error: 'Login session expired or not found' });
  let user = null;
  if (useMongo && UserModel) {
    // pending.userId should contain the user.id (string of the Mongo _id) from login-step1
    try {
      user = UserModel.findById(pending.userId).lean();
    } catch(e) { user = null; }
    // if user is a promise, resolve it synchronously (since we are in non-async handler) — use then/catch
    if (user && typeof user.then === 'function') {
      user.then(u => {
        if (!u) return res.status(400).json({ error: 'User not found' });
        const good = u.questions.every((q,i)=> q.answer === (answers[i]||'').toString().trim().toLowerCase());
        if (!good) return res.status(400).json({ error: 'Security answers do not match' });
        const token = uuidv4();
        sessions[token] = { userId: u._id.toString(), createdAt: Date.now() };
        delete pendingLogin[loginId];
        return res.json({ success: true, token, user: { id: u._id.toString(), name: u.name, email: u.email } });
      }).catch(err => res.status(400).json({ error: 'User not found' }));
      return;
    }
  } else {
    user = users.users.find(u=> u.id === pending.userId);
  }
  if (!user) return res.status(400).json({ error: 'User not found' });
  const good = user.questions.every((q,i)=> q.answer === (answers[i]||'').toString().trim().toLowerCase());
  if (!good) return res.status(400).json({ error: 'Security answers do not match' });
  const token = uuidv4();
  sessions[token] = { userId: user.id, createdAt: Date.now() };
  delete pendingLogin[loginId];
  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
});

// Calendar endpoints
app.get('/api/calendar', (req, res) => {
  // if using mongo, refresh calendarData from the DB
  if (useMongo && CalendarModel) {
    CalendarModel.findOne({}).lean().then(doc => {
      if (doc) res.json(doc); else res.json(calendarData);
    }).catch(e => res.json(calendarData));
    return;
  }
  res.json(calendarData);
});

function saveCalendar() { saveJson(CAL_FILE, calendarData); }

// store timers for reserved -> booked
const reserveTimers = {}; // dateId -> timerId

app.post('/api/calendar/reserve', (req, res) => {
  const { token, dateId } = req.body || {};
  if (!token || !dateId) return res.status(400).json({ error: 'Missing token/dateId' });
  const session = sessions[token];
  if (!session) return res.status(401).json({ error: 'Invalid session token' });
  // find date
  for (const month of calendarData.months) {
    for (const d of month.days) {
      if (d.id === dateId) {
        if (d.status !== 'available') return res.status(400).json({ error: 'Not available' });
        d.status = 'reserved';
        d.holder = session.userId;
        // after 5 seconds book it
        if (reserveTimers[dateId]) clearTimeout(reserveTimers[dateId]);
        reserveTimers[dateId] = setTimeout(async ()=>{
          d.status = 'booked';
          if (useMongo && CalendarModel) {
            await CalendarModel.findOneAndUpdate({}, { $set: { months: calendarData.months } }).exec().catch(e=>console.error(e));
          } else saveCalendar();
          delete reserveTimers[dateId];
        }, 5000);
        if (useMongo && CalendarModel) {
          // update immediately
          CalendarModel.findOneAndUpdate({}, { $set: { months: calendarData.months } }).exec().catch(e=>console.error(e));
        } else saveCalendar();
        return res.json({ success: true, message: 'Date reserved and will be booked in ~5 seconds' });
      }
    }
  }
  res.status(404).json({ error: 'Date not found' });
});

app.get('/api/calendar/status', (req, res) => {
  res.json(calendarData);
});

// simple logout
app.post('/api/logout', (req, res)=>{
  const { token } = req.body || {};
  if (token && sessions[token]) delete sessions[token];
  res.json({ success: true });
});

const serverless = require('serverless-http');
const PORT = process.env.PORT || 3030;

async function start() {
  await connectMongo();
  await ensureCalendar();
  app.listen(PORT, ()=> console.log('Server running on', PORT, useMongo ? '(MongoDB enabled)' : '(file fallback)'));
}

if (process.env.VERCEL || process.env.GITHUB_ACTIONS || process.env.NOW) {
  // In serverless/deploy environments, try to establish DB connection at
  // module load time but also ensure we attempt to connect on every invocation
  connectMongo().then(()=>ensureCalendar()).catch((e)=>console.warn('Initial Mongo connect failed:', e && e.message));

  const handler = serverless(app);

  // Wrap the serverless handler to attempt to connect to MongoDB on each invocation
  module.exports = async (req, res) => {
    try {
      if (MONGO_URI && (!mongoose.connection || mongoose.connection.readyState !== 1)) {
        try {
          await connectMongo();
          await ensureCalendar();
        } catch (e) {
          console.warn('Mongo connect during invocation failed:', e && e.message);
          // don't fail here — allow fallback to file-based storage
        }
      }
    } catch (wrapErr) {
      console.error('Error while preparing handler:', wrapErr && wrapErr.stack ? wrapErr.stack : wrapErr);
    }

    try {
      // Call the serverless handler
      return await handler(req, res);
    } catch (fnErr) {
      console.error('Serverless handler error:', fnErr && fnErr.stack ? fnErr.stack : fnErr);
      // Return a clearer 500 error to the frontend
      try { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Internal server error', details: String(fnErr && fnErr.message) })); } catch(e) {}
    }
  };
} else {
  start().catch(e=>{
    console.error('Failed to start server', e && e.message);
    process.exit(1);
  });
}
