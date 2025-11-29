const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
require('dotenv').config();
const mongoose = require('mongoose');
const cors = require('cors');
const svgCaptcha = require('svg-captcha');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI required');
  process.exit(1);
}

let UserModel, CalendarModel, isConnected = false;

const connectMongo = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }
  
  await mongoose.connect(MONGO_URI, { 
    dbName: 'capcha_demo',
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10
  });
  
  isConnected = true;
  console.log('✅ MongoDB connected');

  if (!UserModel) {
    const QuestionSchema = new mongoose.Schema(
      { question: String, answer: String }, 
      { _id: false }
    );
    
    const UserSchema = new mongoose.Schema({
      name: String,
      email: { type: String, index: true, unique: true },
      passwordHash: String,
      questions: [QuestionSchema],
      createdAt: { type: Date, default: Date.now }
    });
    UserModel = mongoose.models.User || mongoose.model('User', UserSchema);

    const DaySchema = new mongoose.Schema(
      { id: String, date: String, status: String, holder: String }, 
      { _id: false }
    );
    
    const MonthSchema = new mongoose.Schema(
      { label: String, year: Number, month: Number, days: [DaySchema] }, 
      { _id: false }
    );
    
    const CalendarSchema = new mongoose.Schema({
      months: [MonthSchema],
      createdAt: { type: Date, default: Date.now }
    });
    CalendarModel = mongoose.models.Calendar || mongoose.model('Calendar', CalendarSchema);
  }
};

const ensureCalendar = async () => {
  const existing = await CalendarModel.findOne().exec();
  if (existing) return existing;

  const months = [];
  const now = new Date();
  
  for (let m = 0; m < 6; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const monthLabel = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    
    const days = [3, 8, 13, 18, 23].map(day => {
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const date = new Date(d.getFullYear(), d.getMonth(), Math.min(day, maxDay));
      const id = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      
      return {
        id,
        date: date.toISOString().slice(0, 10),
        status: 'available',
        holder: null
      };
    });
    
    months.push({ label: monthLabel, year: d.getFullYear(), month: d.getMonth() + 1, days });
  }

  const cal = new CalendarModel({ months });
  await cal.save();
  return cal;
};

const app = express();

// CORS - Production ready
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

app.use(bodyParser.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const pendingRegs = {};
const captchas = {};
const pendingLogin = {};
const sessions = {};
const reserveTimers = {};

const QUESTIONS = [
  'What was the name of your first pet?',
  'Which city were you born in?',
  'What is your favourite book?',
];

// Routes
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, time: Date.now(), mongo: isConnected });
});

app.get('/api/questions', (req, res) => {
  res.json({ questions: QUESTIONS });
});

app.get('/api/captcha', (req, res) => {
  const cap = svgCaptcha.create({ noise: 2, size: 5, width: 160, height: 50 });
  const id = uuidv4();
  captchas[id] = { text: cap.text.toLowerCase(), expiresAt: Date.now() + 60_000 };
  res.json({ captchaId: id, svg: cap.data });
});

app.post('/api/register-stage1', async (req, res) => {
  try {
    await connectMongo();
    
    const { name, email, password, confirmPassword } = req.body || {};
    
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }
    
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const existing = await UserModel.findOne({ email: email.toLowerCase() }).exec();
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passHash = await bcrypt.hash(password, 10);
    const regId = uuidv4();
    
    pendingRegs[regId] = {
      name, email, passwordHash: passHash,
      expiresAt: Date.now() + 15 * 60_000
    };
    
    res.json({ registrationId: regId });
  } catch (e) {
    console.error('Register stage 1 error:', e);
    res.status(500).json({ error: 'Registration failed', details: e.message });
  }
});

// ... (add all other routes similarly)

// Local development
if (require.main === module) {
  const PORT = process.env.PORT || 3030;
  connectMongo()
    .then(() => ensureCalendar())
    .then(() => {
      app.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
    })
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}

// Export for Vercel
module.exports = app;