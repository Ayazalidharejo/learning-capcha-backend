const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
require('dotenv').config();
const mongoose = require('mongoose');
const cors = require('cors');
const svgCaptcha = require('svg-captcha');

// ============================================
// 🔧 Configuration
// ============================================
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI environment variable is required');
  process.exit(1);
}

let UserModel, CalendarModel, isConnected = false;

// ============================================
// 🗄️ MongoDB Connection
// ============================================
const connectMongo = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    console.log('♻️ Reusing MongoDB connection');
    return;
  }
  
  try {
    await mongoose.connect(MONGO_URI, { 
      dbName: 'capcha_demo',
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10
    });
    
    isConnected = true;
    console.log('✅ MongoDB connected');

    // Define schemas only once
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
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    isConnected = false;
    throw err;
  }
};

// ============================================
// 📅 Calendar Initialization
// ============================================
const ensureCalendar = async () => {
  const existing = await CalendarModel.findOne().exec();
  if (existing) return existing;

  console.log('📅 Creating calendar...');
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
    
    months.push({ 
      label: monthLabel, 
      year: d.getFullYear(), 
      month: d.getMonth() + 1, 
      days 
    });
  }

  const cal = new CalendarModel({ months });
  await cal.save();
  console.log('✅ Calendar created');
  return cal;
};

// ============================================
// 🚀 Express App Setup
// ============================================
const app = express();

// CORS Configuration
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

app.use(bodyParser.json());

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ============================================
// 💾 In-Memory Storage (Serverless)
// ============================================
const pendingRegs = {};
const captchas = {};
const pendingLogin = {};
const sessions = {};
const reserveTimers = {};

// Cleanup expired data
setInterval(() => {
  const now = Date.now();
  Object.keys(captchas).forEach(k => {
    if (captchas[k].expiresAt < now) delete captchas[k];
  });
  Object.keys(pendingRegs).forEach(k => {
    if (pendingRegs[k].expiresAt < now) delete pendingRegs[k];
  });
  Object.keys(pendingLogin).forEach(k => {
    if (pendingLogin[k].expiresAt < now) delete pendingLogin[k];
  });
}, 30_000);

// ============================================
// 📋 Security Questions
// ============================================
const QUESTIONS = [
  'What was the name of your first pet?',
  'Which city were you born in?',
  'What is your favourite book?',
];

// ============================================
// 🔗 API Routes
// ============================================

// Health check
app.get('/api/ping', (req, res) => {
  res.json({ 
    ok: true, 
    time: Date.now(),
    mongo: isConnected,
    env: process.env.NODE_ENV || 'development'
  });
});

// Get security questions
app.get('/api/questions', (req, res) => {
  res.json({ questions: QUESTIONS });
});

// Generate CAPTCHA
app.get('/api/captcha', (req, res) => {
  try {
    const cap = svgCaptcha.create({ 
      noise: 2, 
      size: 5, 
      width: 160, 
      height: 50,
      ignoreChars: '0oO1ilI'
    });
    const id = uuidv4();
    captchas[id] = { 
      text: cap.text.toLowerCase(), 
      expiresAt: Date.now() + 60_000 
    };
    res.json({ captchaId: id, svg: cap.data });
  } catch (e) {
    console.error('Captcha generation error:', e);
    res.status(500).json({ error: 'Failed to generate CAPTCHA' });
  }
});

// Register - Stage 1
app.post('/api/register-stage1', async (req, res) => {
  try {
    await connectMongo();
    
    const { name, email, password, confirmPassword } = req.body || {};
    
    console.log('📝 Register Stage 1:', { name, email });
    
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const existing = await UserModel.findOne({ 
      email: email.toLowerCase() 
    }).exec();
    
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passHash = await bcrypt.hash(password, 10);
    const regId = uuidv4();
    
    pendingRegs[regId] = {
      name, 
      email: email.toLowerCase(), 
      passwordHash: passHash,
      expiresAt: Date.now() + 15 * 60_000
    };
    
    console.log('✅ Registration ID created:', regId);
    res.json({ registrationId: regId });
    
  } catch (e) {
    console.error('❌ Register stage 1 error:', e);
    res.status(500).json({ 
      error: 'Registration failed', 
      details: e.message 
    });
  }
});

// Register - Stage 2
app.post('/api/register-stage2', async (req, res) => {
  try {
    await connectMongo();
    
    const { registrationId, answers } = req.body || {};
    
    console.log('📝 Register Stage 2:', { registrationId });
    
    if (!registrationId || !Array.isArray(answers) || answers.length !== 3) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    const pending = pendingRegs[registrationId];
    if (!pending) {
      return res.status(400).json({ error: 'Registration session expired' });
    }

    const questions = answers.map(a => ({
      question: a.question?.toString() || '',
      answer: a.answer?.toString().trim().toLowerCase() || ''
    }));

    const userDoc = new UserModel({
      name: pending.name,
      email: pending.email,
      passwordHash: pending.passwordHash,
      questions
    });
    
    await userDoc.save();
    delete pendingRegs[registrationId];
    
    console.log('✅ User registered:', pending.email);
    res.json({ success: true });
    
  } catch (e) {
    console.error('❌ Register stage 2 error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login - Step 1
app.post('/api/login-step1', async (req, res) => {
  try {
    await connectMongo();
    
    const { username, password, captchaId, captchaAnswer } = req.body || {};
    
    console.log('🔐 Login Step 1:', { username });
    
    if (!username || !password || !captchaId || !captchaAnswer) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const cap = captchas[captchaId];
    if (!cap || cap.text !== captchaAnswer.toLowerCase()) {
      return res.status(400).json({ error: 'Invalid CAPTCHA' });
    }
    delete captchas[captchaId];

    const user = await UserModel.findOne({ 
      email: username.toLowerCase() 
    }).exec();
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }
    
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const loginId = uuidv4();
    pendingLogin[loginId] = { 
      userId: user._id.toString(), 
      expiresAt: Date.now() + 5 * 60_000 
    };
    
    console.log('✅ Login ID created:', loginId);
    res.json({ 
      loginId, 
      questions: user.questions.map(q => q.question) 
    });
    
  } catch (e) {
    console.error('❌ Login step 1 error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Login - Step 2
app.post('/api/login-step2', async (req, res) => {
  try {
    await connectMongo();
    
    const { loginId, answers } = req.body || {};
    
    console.log('🔐 Login Step 2:', { loginId });
    
    if (!loginId || !Array.isArray(answers) || answers.length !== 3) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    const pending = pendingLogin[loginId];
    if (!pending) {
      return res.status(400).json({ error: 'Login session expired' });
    }

    const user = await UserModel.findById(pending.userId).exec();
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const answersValid = user.questions.every((q, i) =>
      q.answer === (answers[i] || '').toString().trim().toLowerCase()
    );
    
    if (!answersValid) {
      return res.status(400).json({ error: 'Security answers incorrect' });
    }

    const token = uuidv4();
    sessions[token] = { 
      userId: user._id.toString(), 
      createdAt: Date.now() 
    };
    delete pendingLogin[loginId];
    
    console.log('✅ User logged in:', user.email);
    res.json({
      success: true,
      token,
      user: { 
        id: user._id.toString(), 
        name: user.name, 
        email: user.email 
      }
    });
    
  } catch (e) {
    console.error('❌ Login step 2 error:', e);
    res.status(500).json({ error: 'Login verification failed' });
  }
});

// Get Calendar
app.get('/api/calendar', async (req, res) => {
  try {
    await connectMongo();
    const cal = await ensureCalendar();
    res.json({ months: cal.months });
  } catch (e) {
    console.error('❌ Calendar fetch error:', e);
    res.status(500).json({ error: 'Failed to load calendar' });
  }
});

// Get Calendar Status
app.get('/api/calendar/status', async (req, res) => {
  try {
    await connectMongo();
    const cal = await CalendarModel.findOne().exec();
    res.json({ months: cal?.months || [] });
  } catch (e) {
    console.error('❌ Calendar status error:', e);
    res.status(500).json({ error: 'Failed to load status' });
  }
});

// Reserve Calendar Date
app.post('/api/calendar/reserve', async (req, res) => {
  try {
    await connectMongo();
    
    const { token, dateId } = req.body || {};
    
    console.log('📅 Reserve request:', { dateId });
    
    if (!token || !dateId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!sessions[token]) {
      return res.status(401).json({ error: 'Invalid session token' });
    }

    const cal = await CalendarModel.findOne().exec();
    let reserved = false;
    
    for (const month of cal.months) {
      for (const d of month.days) {
        if (d.id === dateId && d.status === 'available') {
          d.status = 'reserved';
          d.holder = sessions[token].userId;
          reserved = true;

          if (reserveTimers[dateId]) {
            clearTimeout(reserveTimers[dateId]);
          }
          
          reserveTimers[dateId] = setTimeout(async () => {
            try {
              const updated = await CalendarModel.findOne().exec();
              for (const m of updated.months) {
                for (const day of m.days) {
                  if (day.id === dateId && day.status === 'reserved') {
                    day.status = 'booked';
                    break;
                  }
                }
              }
              await CalendarModel.findOneAndUpdate(
                {}, 
                { months: updated.months }
              );
              delete reserveTimers[dateId];
              console.log('✅ Date booked:', dateId);
            } catch (err) {
              console.error('❌ Auto-booking error:', err);
            }
          }, 5000);
          
          break;
        }
      }
      if (reserved) break;
    }

    if (!reserved) {
      return res.status(400).json({ error: 'Date not available' });
    }

    await CalendarModel.findOneAndUpdate({}, { months: cal.months });
    
    console.log('✅ Date reserved:', dateId);
    res.json({ 
      success: true, 
      message: 'Date reserved, will be booked in 5 seconds' 
    });
    
  } catch (e) {
    console.error('❌ Reservation error:', e);
    res.status(500).json({ error: 'Reservation failed' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  const { token } = req.body || {};
  if (token && sessions[token]) {
    delete sessions[token];
    console.log('👋 User logged out');
  }
  res.json({ success: true });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================
// 🚀 Server Export
// ============================================

// For Vercel serverless
module.exports = async (req, res) => {
  try {
    await connectMongo();
    return app(req, res);
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
};

// For local development
if (require.main === module) {
  const PORT = process.env.PORT || 3030;
  connectMongo()
    .then(() => ensureCalendar())
    .then(() => {
      app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📊 MongoDB: ${isConnected ? 'Connected' : 'Disconnected'}`);
      });
    })
    .catch(e => {
      console.error('❌ Failed to start server:', e);
      process.exit(1);
    });
}