import mongoose from 'mongoose';

// Import models - need to adjust paths
const DB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

console.log('=== Connecting to MongoDB ===');

mongoose.connect(DB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    
    // Define schemas inline
    const accountSchema = new mongoose.Schema({
      email: String,
      currentOrganization: mongoose.Schema.Types.ObjectId,
      organizations: Array,
      updatedAt: Date
    }, { collection: 'accounts' });
    
    const orgSchema = new mongoose.Schema({
      name: String,
      description: String,
      owner: mongoose.Schema.Types.ObjectId,
      members: Array,
      zulipRealmId: Number,
      zulipRealmStringId: String,
      createdAt: Date
    }, { collection: 'organizations', timestamps: true });
    
    const Account = mongoose.model('Account', accountSchema);
    const Organization = mongoose.model('Organization', orgSchema);
    
    // Find user
    const user = await Account.findOne({ email: 'michaelegbo@gmail.com' });
    if (!user) {
      console.log('❌ User michaelegbo@gmail.com not found');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log('✅ Found user:', user.email);
    console.log('   User ID:', user._id.toString());
    
    // Create organization
    const organization = await Organization.create({
      name: 'SSH Test Org 0420',
      description: 'Testing realm provisioning',
      owner: user._id,
      members: [{
        account: user._id,
        role: 'owner',
        joinedAt: new Date(),
        status: 'active'
      }],
      createdAt: new Date()
    });
    
    console.log('✅ Organization created:', organization._id.toString());
    console.log('   Name:', organization.name);
    console.log('   Description:', organization.description);
    
    // Now we need to trigger the Zulip provisioning
    // This requires the zulipService which is more complex
    console.log('');
    console.log('⚠️  Organization created in database');
    console.log('   Next: Trigger Zulip provisioning via zulipService');
    
    await mongoose.disconnect();
    console.log('');
    console.log('✅ Done!');
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
