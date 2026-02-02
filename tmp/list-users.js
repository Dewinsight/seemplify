import mongoose from 'mongoose';

const DB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

console.log('=== Connecting to MongoDB ===');

mongoose.connect(DB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    
    const accountSchema = new mongoose.Schema({
      email: String,
      sub: String,
      profile: Object
    }, { collection: 'accounts' });
    
    const Account = mongoose.model('Account', accountSchema);
    
    // List first 10 users
    const users = await Account.find({}).limit(10).select('email sub profile.name');
    
    console.log(`Found ${users.length} users:`);
    users.forEach((user, index) => {
      console.log(`${index + 1}. Email: ${user.email}`);
      console.log(`   Sub: ${user.sub}`);
      console.log(`   Name: ${user.profile?.name || 'N/A'}`);
      console.log(`   ID: ${user._id.toString()}`);
      console.log('');
    });
    
    await mongoose.disconnect();
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
