// server.js - Auto Robot ready server
// Node 18+; run with `node server.js`
// Features:
// - Accept screenshot uploads and reward 0.5 Taka each (max 3 per user)
// - Withdraw requests when balance >= 50 Taka
// - Sends Telegram notifications (sendPhoto / sendMessage) when BOT_TOKEN and CHANNEL_ID are configured
// - Background worker runs every 1 hour to check pending withdraws older than 72 hours and mark them 'auto_completed' (not doing real payouts)

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import fetch from "node-fetch"; // use node-fetch for simplicity in ESM
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static(process.cwd()));

const upload = multer({ dest: "uploads/" });
const DB_FILE = "db.json";
const REWARD = 0.5;
const MAX_SCREENSHOTS = 3;
const WITHDRAW_MIN = 50.0;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const CHANNEL_ID = process.env.CHANNEL_ID || ""; // @username or numeric
const ADMIN_SECRET = process.env.ADMIN_SECRET || "change_this";

function loadDB(){ try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch(e){ return { users:{} }; } }
function saveDB(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

// helper send to telegram
async function telegramSendMessage(text){
  if(!BOT_TOKEN || !CHANNEL_ID) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, { method: "POST", body: JSON.stringify({ chat_id: CHANNEL_ID, text }), headers: {'Content-Type':'application/json'} });
  } catch(e){ console.error("tg msg err", e.message || e); }
}
async function telegramSendPhoto(caption, filepath){
  if(!BOT_TOKEN || !CHANNEL_ID) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const fd = new FormData();
  fd.append("chat_id", CHANNEL_ID);
  fd.append("caption", caption);
  fd.append("photo", fs.createReadStream(filepath));
  try {
    await fetch(url, { method: "POST", body: fd });
  } catch(e){ console.error("tg photo err", e.message || e); }
}

// Routes
app.post("/api/upload", upload.single("screenshot"), async (req, res) => {
  try {
    const username = (req.body.username || "guest").toString().substring(0,64);
    if(!req.file) return res.status(400).json({ error: "no file" });
    const db = loadDB();
    const user = db.users[username] || { screenshots:0, balance:0, withdraws:[] };
    if(user.screenshots >= MAX_SCREENSHOTS){
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "max screenshots reached" });
    }
    user.screenshots += 1;
    user.balance = Number((user.balance + REWARD).toFixed(2));
    db.users[username] = user;
    saveDB(db);

    // send to telegram (photo)
    const caption = `📸 New screenshot\nUser: ${username}\nScreenshots: ${user.screenshots}\nBalance: ${user.balance} Taka`;
    await telegramSendPhoto(caption, req.file.path);

    // cleanup file
    try { fs.unlinkSync(req.file.path); } catch(e){}

    return res.json({ message: "Uploaded and rewarded", username, screenshots: user.screenshots, balance: user.balance });
  } catch(e){ console.error(e); return res.status(500).json({ error: "server error" }); }
});

app.get("/api/balance", (req, res) => {
  const username = (req.query.username || "guest").toString().substring(0,64);
  const db = loadDB();
  const user = db.users[username] || { screenshots:0, balance:0, withdraws:[] };
  res.json({ username, screenshots: user.screenshots, balance: Number(user.balance.toFixed(2)), withdraws: user.withdraws || [] });
});

app.post("/api/withdraw", (req, res) => {
  const username = (req.body?.username || "").toString().substring(0,64);
  if(!username) return res.status(400).json({ error: "username required" });
  const db = loadDB();
  const user = db.users[username] || { screenshots:0, balance:0, withdraws:[] };
  if(user.balance < WITHDRAW_MIN) return res.status(400).json({ error: `minimum ${WITHDRAW_MIN} Taka required` });
  const id = Date.now();
  const entry = { id, amount: Number(user.balance.toFixed(2)), status: "pending", requestedAt: (new Date()).toISOString() };
  user.withdraws = user.withdraws || [];
  user.withdraws.push(entry);
  user.balance = 0.0;
  db.users[username] = user;
  saveDB(db);

  telegramSendMessage(`💳 Withdraw requested\nUser: ${username}\nAmount: ${entry.amount} Taka\nID: ${id}\nStatus: pending`);
  return res.json({ message: "Withdraw requested. Admin will process within 72 hours.", withdraw: entry });
});

// Admin endpoint to update withdraw status (protected by ADMIN_SECRET header)
app.post("/api/admin/update_withdraw", (req, res) => {
  const secret = req.headers['x-admin-secret'] || "";
  if(secret !== ADMIN_SECRET) return res.status(403).json({ error: "forbidden" });
  const { username, withdrawId, status } = req.body || {};
  if(!username || !withdrawId || !status) return res.status(400).json({ error: "missing" });
  const db = loadDB();
  const user = db.users[username];
  if(!user) return res.status(404).json({ error: "user not found" });
  const w = (user.withdraws || []).find(w=>String(w.id)===String(withdrawId));
  if(!w) return res.status(404).json({ error: "withdraw not found" });
  w.status = status;
  w.processedAt = (new Date()).toISOString();
  saveDB(db);
  telegramSendMessage(`🔔 Withdraw ${withdrawId} for ${username} updated to: ${status}`);
  res.json({ message: "updated", withdraw: w });
});

// Background worker: runs every hour, checks pending withdraws older than 72 hours and marks 'auto_completed' (NOTE: does not perform money transfer).
function startBackgroundWorker(){
  console.log("Background worker started - checks every 1 hour");
  setInterval(()=>{
    try {
      const db = loadDB();
      let changed = false;
      const now = Date.now();
      for(const [username, user] of Object.entries(db.users)){
        if(!user.withdraws) continue;
        user.withdraws.forEach(w => {
          if(w.status === "pending"){
            const reqAt = new Date(w.requestedAt).getTime();
            if(!isNaN(reqAt) && (now - reqAt) >= (72*60*60*1000)){
              w.status = "auto_completed";
              w.processedAt = (new Date()).toISOString();
              changed = true;
              telegramSendMessage(`✅ Withdraw ID ${w.id} for ${username} marked auto_completed by worker. Please process actual payout manually.`);
            }
          }
        });
      }
      if(changed) saveDB(db);
    } catch(e){ console.error("worker error", e); }
  }, 60*60*1000); // 1 hour
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>{
  console.log("Server listening on port", PORT);
  // ensure DB exists
  if(!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users:{} }, null, 2));
  startBackgroundWorker();
});
