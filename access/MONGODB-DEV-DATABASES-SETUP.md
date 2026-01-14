# MongoDB Atlas Dev Databases Setup Guide

**Created:** January 14, 2026  
**Purpose:** Create development databases in MongoDB Atlas for dev environment

---

## 🎯 Overview

This guide shows how to create development databases in MongoDB Atlas. These databases will be used by the development environment and are completely isolated from production.

---

## 📋 Current Production Databases

| Backend | Production Database | Dev Database to Create |
|---------|-------------------|----------------------|
| Identity Provider | `identity` | `identity-dev` |
| Recruiter | `smart_hr_db` | `smart_hr_db-dev` |
| Leave Management | `leave-management` | `leave-management-dev` |
| Performance | `performance_db` | `performance_db-dev` |
| Payroll | `payroll_db` | `payroll_db-dev` |

**Total:** 5 new databases to create

---

## 🔐 MongoDB Atlas Credentials

**Connection String Pattern:**
```
mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/<database-name>?retryWrites=true&w=majority&appName=Cluster0
```

**Components:**
- **Username:** `tonyegbo1`
- **Password:** `IHjykby58BtH5zyC`
- **Cluster:** `cluster0.8hdkzxw.mongodb.net`
- **Database:** Variable (changes for each app)

---

## 🛠️ Setup Methods

### Method 1: Automatic Creation (Recommended)

MongoDB Atlas automatically creates databases when you first connect to them. Simply configure your Dokploy applications with the dev database names, and they'll be created on first deployment.

**Pros:**
- ✅ Simplest method
- ✅ No manual steps
- ✅ Works automatically

**Cons:**
- ⚠️ Can't pre-configure settings (sharding, indexes, etc.)

**To Use:**
- Just use the dev database names in your Dokploy environment variables
- Databases will be created automatically on first connection

---

### Method 2: Manual Creation via MongoDB Atlas UI

#### Step 1: Access MongoDB Atlas

1. Go to: https://cloud.mongodb.com/
2. Login with your MongoDB Atlas account
3. Select your project (likely "Cluster0" or similar)

#### Step 2: Navigate to Collections

1. Click on **"Browse Collections"** button for your cluster
2. This shows all existing databases

#### Step 3: Create New Database

1. Click **"Create Database"** button (or "+ Create Database")
2. Enter database details:
   - **Database Name:** `identity-dev` (first one)
   - **Collection Name:** `users` (create an initial collection)
3. Click **"Create"**

#### Step 4: Repeat for All Dev Databases

Create these databases:

1. **identity-dev**
   - Initial collection: `users`
   
2. **smart_hr_db-dev**
   - Initial collection: `candidates`
   
3. **leave-management-dev**
   - Initial collection: `leave_requests`
   
4. **performance_db-dev**
   - Initial collection: `reviews`
   
5. **payroll_db-dev**
   - Initial collection: `payroll_records`

---

### Method 3: Using MongoDB Compass (GUI Tool)

#### Step 1: Install MongoDB Compass

Download from: https://www.mongodb.com/try/download/compass

#### Step 2: Connect to Cluster

1. Open MongoDB Compass
2. Enter connection string:
   ```
   mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```
3. Click **"Connect"**

#### Step 3: Create Databases

1. Click **"Create Database"** button
2. Enter:
   - **Database Name:** `identity-dev`
   - **Collection Name:** `users`
3. Click **"Create Database"**

4. Repeat for all 5 dev databases

---

### Method 4: Using MongoDB Shell (mongosh)

#### Step 1: Install mongosh

**Windows:**
```powershell
winget install MongoDB.Shell
```

Or download from: https://www.mongodb.com/try/download/shell

#### Step 2: Connect to Cluster

```bash
mongosh "mongodb+srv://cluster0.8hdkzxw.mongodb.net/test" --username tonyegbo1
```

Enter password when prompted: `IHjykby58BtH5zyC`

#### Step 3: Create Databases

```javascript
// Create identity-dev database
use identity-dev
db.users.insertOne({_createdAt: new Date(), _note: "Initial setup"})

// Create smart_hr_db-dev database
use smart_hr_db-dev
db.candidates.insertOne({_createdAt: new Date(), _note: "Initial setup"})

// Create leave-management-dev database
use leave-management-dev
db.leave_requests.insertOne({_createdAt: new Date(), _note: "Initial setup"})

// Create performance_db-dev database
use performance_db-dev
db.reviews.insertOne({_createdAt: new Date(), _note: "Initial setup"})

// Create payroll_db-dev database
use payroll_db-dev
db.payroll_records.insertOne({_createdAt: new Date(), _note: "Initial setup"})

// Verify all databases
show dbs
```

---

## ✅ Verification

### Check Databases Exist

**Option 1: MongoDB Atlas UI**
1. Go to your cluster in Atlas
2. Click "Browse Collections"
3. Verify all 5 `-dev` databases are listed

**Option 2: MongoDB Compass**
1. Connect to cluster
2. View left sidebar - all `-dev` databases should be visible

**Option 3: MongoDB Shell**
```bash
mongosh "mongodb+srv://cluster0.8hdkzxw.mongodb.net/test" --username tonyegbo1
```
```javascript
show dbs
```

Look for:
- `identity-dev`
- `smart_hr_db-dev`
- `leave-management-dev`
- `performance_db-dev`
- `payroll_db-dev`

---

## 🔗 Connection Strings for Dokploy

Use these exact connection strings in your Dokploy environment variables:

### Identity Provider Dev
```
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/identity-dev?retryWrites=true&w=majority&appName=Cluster0
```

### Recruiter Backend Dev
```
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/smart_hr_db-dev?retryWrites=true&w=majority&appName=Cluster0
```

### Leave Backend Dev
```
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/leave-management-dev?retryWrites=true&w=majority&appName=Cluster0
```

### Performance Backend Dev
```
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/performance_db-dev?retryWrites=true&w=majority&appName=Cluster0
```

### Payroll Backend Dev
```
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/payroll_db-dev?retryWrites=true&w=majority&appName=Cluster0
```

---

## 💰 Cost Implications

### Current Setup
- Using shared M0 cluster (free tier) or paid tier
- Same cluster, just additional databases

### Additional Costs
- **Storage:** Dev databases will consume storage
- **Operations:** Read/write operations count toward quota
- **Data Transfer:** Bandwidth usage

### Estimated Cost Impact
- **Free Tier (M0):** No additional cost (within limits)
- **Paid Tier:** +$10-30/month depending on usage
- **Recommendation:** Monitor usage in Atlas dashboard

---

## 📊 Database Management

### Seeding Dev Data

To populate dev databases with test data:

**Option 1: Manual via Compass**
- Create collections and insert documents manually

**Option 2: Copy from Production (⚠️ Use with Caution)**
```bash
# Export from production database
mongodump --uri="mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/smart_hr_db" --out=./backup

# Import to dev database
mongorestore --uri="mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/smart_hr_db-dev" --drop ./backup/smart_hr_db
```

**⚠️ Warning:** 
- Anonymize production data before copying to dev
- Never use real customer data in dev without permission
- Consider GDPR/data protection regulations

**Option 3: Use Seed Scripts**
- Create seed scripts in your application
- Run on first deployment to dev environment

---

## 🔐 Security Considerations

### Database Access Control

**Current:** Using shared credentials for all databases

**Recommended for Production:**
1. Create separate database users for dev vs prod
2. Restrict dev user access to only dev databases
3. Use different passwords for dev and prod

**To Create Separate User:**
```javascript
// Connect to cluster admin
use admin

// Create dev-only user
db.createUser({
  user: "seemplify-dev",
  pwd: "dev_password_here",
  roles: [
    { role: "readWrite", db: "identity-dev" },
    { role: "readWrite", db: "smart_hr_db-dev" },
    { role: "readWrite", db: "leave-management-dev" },
    { role: "readWrite", db: "performance_db-dev" },
    { role: "readWrite", db: "payroll_db-dev" }
  ]
})
```

---

## 🧹 Maintenance

### Cleaning Dev Databases

Periodically clean dev databases to:
- Reduce storage costs
- Remove test data
- Reset to fresh state

**Method 1: Drop Database**
```javascript
use smart_hr_db-dev
db.dropDatabase()
```

**Method 2: Clear Collections**
```javascript
use smart_hr_db-dev
db.candidates.deleteMany({})
db.interviews.deleteMany({})
// ... for each collection
```

**Method 3: Via Atlas UI**
1. Browse Collections
2. Select database
3. Click "..." menu → "Drop Database"

---

## ✅ Checklist

- [ ] MongoDB Atlas account accessible
- [ ] All 5 dev databases created (or will auto-create)
- [ ] Connection strings verified
- [ ] Dev databases visible in Atlas/Compass
- [ ] Ready to use in Dokploy environment variables
- [ ] Monitoring set up in Atlas dashboard

---

## 🔍 Troubleshooting

### Can't Connect to MongoDB

**Check:**
- Network access whitelist in Atlas (allow 4.180.153.209 or 0.0.0.0/0)
- Username and password are correct
- Cluster is running (not paused)

**Solution:**
- Go to Atlas → Network Access → Add IP Address
- Add your Azure VM IP: `4.180.153.209`
- Or allow all: `0.0.0.0/0` (less secure)

### Database Not Appearing

**If using auto-creation:**
- Database won't appear until first connection
- Deploy application and check again

**If created manually:**
- Refresh Atlas/Compass view
- Ensure collection was created (MongoDB requires at least one collection)

### Authentication Failed

**Error:** `Authentication failed`

**Solution:**
- Verify username: `tonyegbo1`
- Verify password: `IHjykby58BtH5zyC`
- Check user has permissions for database
- Connection string format is correct

---

## 📝 Next Steps

After database setup:

1. ✅ Dev databases created/ready
2. Use connection strings in Dokploy apps
3. Deploy applications to dev environment
4. Verify database connections work
5. Seed initial data if needed

See `DOKPLOY-DEV-APPS-SETUP-GUIDE.md` for Dokploy configuration.

---

**Note:** MongoDB Atlas automatically handles backups, replication, and high availability. Your dev databases are as reliable as production.
