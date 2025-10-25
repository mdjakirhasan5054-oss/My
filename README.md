Auto Robot Screenshot Reward — Render + GitHub Ready

Features
- Accept screenshot uploads and reward 0.5 Taka each (max 3 per user).
- Withdraw requests with minimum 50 Taka.
- Sends Telegram notifications for uploads and withdraws if BOT_TOKEN and CHANNEL_ID are set.
- Background worker runs every hour and auto-marks withdraws pending for >=72 hours as 'auto_completed' (does NOT perform actual payment).

How to use (local)
1. unzip the package
2. copy .env.example to .env and fill BOT_TOKEN, CHANNEL_ID, ADMIN_SECRET
3. npm install
4. npm start
5. open http://localhost:3000/index.html

Deploy to Render (GitHub)
1. Create a GitHub repo and push the project.
2. On Render.com, connect GitHub and create a new Web Service.
   - Build Command: npm install
   - Start Command: npm start
3. Add Environment Variables in Render Dashboard:
   - BOT_TOKEN = your bot token
   - CHANNEL_ID = @YourChannel or numeric id
   - ADMIN_SECRET = strong secret
4. Deploy. The service will keep running and the background worker will operate automatically.

Security notes
- Regenerate your bot token if you have accidentally exposed it.
- The worker marks withdraw entries as 'auto_completed' after 72 hours, but does NOT send money — please process real payouts yourself or integrate a payment provider.
