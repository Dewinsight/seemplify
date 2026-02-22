# 📧 Auto Mailer - Real-Time Email Client

A clean, simple email client built with React and Node.js that connects to Nylas to show **only new incoming emails** and allows quick replies. No spam, no promotions, no clutter.

## ✨ Features

- ✅ **Real-Time Email Updates** - New emails appear instantly (10-second polling + Socket.io)
- ✅ **Spam-Free Inbox** - Automatically filters out spam and promotional emails
- ✅ **Quick Reply** - Click any email to read and reply instantly
- ✅ **Clean UI** - Minimal, beautiful design focused on email conversations
- ✅ **No Historical Emails** - Only shows emails received after connection
- ✅ **Browser Notifications** - Get notified when new emails arrive
- ✅ **Secure Authentication** - JWT-based auth with password hashing

## 🏗️ Architecture

### Backend (Node.js + Express)
- **Nylas v3 Integration** - OAuth connection and Messages API
- **Email Polling Service** - Checks for new emails every 10 seconds
- **Socket.io** - Real-time email notifications to frontend
- **MongoDB** - Stores users and incoming emails
- **RESTful API** - Clean endpoints for all operations

### Frontend (React + Vite + TypeScript)
- **Beautiful UI** - Tailwind CSS with clean, modern design
- **Real-Time Updates** - Socket.io client for instant email notifications
- **Responsive** - Works on desktop, tablet, and mobile
- **State Management** - React Context for authentication

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- MongoDB Atlas account (or local MongoDB)
- Nylas v3 account with API credentials

### 1. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment variables
# The .env file is already configured with your Nylas credentials

# Start backend server
npm run dev
```

**Expected output:**
```
✅ Connected to MongoDB
🚀 Auto Mailer API server running on port 5001
📧 Email endpoints: http://localhost:5001/api/emails
🔗 Nylas endpoints: http://localhost:5001/api/nylas
⚡ Socket.io enabled for real-time updates
🚀 Starting email polling service (10-second intervals)
```

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies  
npm install

# Start frontend dev server
npm run dev
```

**Expected output:**
```
Local: http://localhost:5173/
```

### 3. Access the Application

1. Open `http://localhost:5173`
2. **Sign up** for a new account
3. **Login** with your credentials
4. **Connect your email** via Nylas OAuth
5. **Wait for new emails** to arrive!

## 📁 Project Structure

```
auto-mailer/
├── backend/
│   ├── models/
│   │   ├── User.js           # User model with Nylas grant
│   │   └── Email.js          # Email model
│   ├── services/
│   │   ├── nylasService.js   # Nylas API integration
│   │   └── emailPollingService.js  # Polling service
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── nylasController.js
│   │   └── emailController.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── nylas.js
│   │   └── emails.js
│   └── server.js             # Main server with Socket.io
│
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Login.jsx
    │   │   ├── Signup.jsx
    │   │   └── Dashboard.jsx  # Main email inbox
    │   ├── components/
    │   │   ├── ConnectEmail.jsx
    │   │   ├── EmailInbox.jsx
    │   │   ├── EmailListItem.jsx
    │   │   ├── EmailDetail.jsx
    │   │   └── QuickReply.jsx
    │   ├── api/
    │   │   ├── client.js
    │   │   ├── emails.js
    │   │   └── nylas.js
    │   └── hooks/
    │       └── useSocket.js   # Socket.io hook
    └── App.tsx

```

## 🔗 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get user profile

### Nylas Integration
- `GET /api/nylas/connect` - Start OAuth flow
- `GET /api/nylas/callback` - OAuth callback
- `GET /api/nylas/status` - Check connection status
- `POST /api/nylas/disconnect` - Disconnect email

### Emails
- `GET /api/emails` - Get all emails
- `GET /api/emails/:messageId` - Get single email
- `POST /api/emails/:messageId/reply` - Send reply
- `GET /api/emails/unread-count` - Get unread count

## 🎯 How It Works

### Email Polling Flow
```
1. User connects email via Nylas OAuth
   ↓
2. Backend stores grant_id in database
   ↓
3. Polling service runs every 10 seconds
   ↓
4. Fetches new messages from Nylas API
   ↓
5. Filters out spam/promotional emails
   ↓
6. Saves emails to MongoDB
   ↓
7. Emits real-time event via Socket.io
   ↓
8. Frontend receives and displays new email
```

### Real-Time Updates
- Backend polling service checks Nylas every 10 seconds
- New emails are filtered (no spam/promos)
- Socket.io emits events to connected clients
- Frontend updates inbox instantly
- Browser notifications alert user

## 🎨 Design Principles

- **Minimal** - Only essential features, no bloat
- **Clean** - White space, clear typography
- **Fast** - Real-time updates, instant replies
- **Focused** - Email conversations, nothing else
- **Accessible** - Keyboard navigation, screen reader friendly

## 🔒 Security

- ✅ JWT authentication with secure tokens
- ✅ Password hashing with bcryptjs
- ✅ CORS protection
- ✅ Helmet.js security headers
- ✅ Environment variables for secrets
- ✅ OAuth state verification

## 🧪 Testing the App

### Send yourself a test email:
1. Connect your email account
2. From another email account, send an email to your connected account
3. Within 10 seconds, the email should appear in Auto Mailer
4. Click to read and reply

### Check filtering:
- Spam emails will not appear
- Promotional emails will not appear
- Only primary inbox messages show up

## 🌟 Key Technologies

**Backend:**
- Node.js + Express
- Nylas SDK v7
- Socket.io
- MongoDB + Mongoose
- JWT + bcryptjs

**Frontend:**
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Socket.io Client
- Axios
- Moment.js

## 📝 Environment Variables

### Backend (.env)
```env
# MongoDB
MONGODB_URL=your_mongodb_url
MONGODB_DB_NAME=automail

# Nylas v3
NYLAS_CLIENT_ID=your_client_id
NYLAS_API_KEY=your_api_key
NYLAS_CLIENT_SECRET=your_client_secret
NYLAS_REDIRECT_URI=http://localhost:5001/api/nylas/callback
NYLAS_API_URI=https://api.us.nylas.com

# Server
PORT=5001
SECRET_KEY=your_secret_key
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:5001
```

## 🐛 Troubleshooting

### Backend won't start
- Check MongoDB connection string
- Ensure port 5001 is available
- Verify Nylas API credentials

### No emails appearing
- Check backend logs for polling status
- Verify Nylas grant_id is saved
- Ensure emails are going to primary inbox (not spam/promotions)

### Real-time not working
- Check Socket.io connection in browser console
- Verify backend Socket.io server is running
- Check CORS settings

## 🚀 Production Deployment

### Backend
1. Set `NODE_ENV=production`
2. Use proper SECRET_KEY
3. Configure production CORS origins
4. Set up process manager (PM2)
5. Enable HTTPS

### Frontend
1. Build: `npm run build`
2. Deploy `dist` folder to CDN/hosting
3. Update `VITE_API_URL` to production API

## 📄 License

MIT

## 👨‍💻 Author

Built with ❤️ for simple, focused email management
