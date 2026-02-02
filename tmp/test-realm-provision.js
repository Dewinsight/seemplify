import mongoose from 'mongoose';

const DB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

console.log('=== Test Zulip Realm Provisioning (Management Command Method) ===');
console.log('');

mongoose.connect(DB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    
    // Define schemas
    const accountSchema = new mongoose.Schema({
      email: String,
      sub: String,
      profile: Object,
      currentOrganization: mongoose.Schema.Types.ObjectId,
      organizations: Array,
      createdAt: Date,
      updatedAt: Date
    }, { collection: 'accounts', timestamps: true });
    
    const orgSchema = new mongoose.Schema({
      name: String,
      description: String,
      owner: mongoose.Schema.Types.ObjectId,
      members: Array,
      zulipRealmId: Number,
      zulipRealmStringId: String,
      createdAt: Date,
      updatedAt: Date
    }, { collection: 'organizations', timestamps: true });
    
    const Account = mongoose.model('Account', accountSchema);
    const Organization = mongoose.model('Organization', orgSchema);
    
    // Find or create test user
    console.log('Step 1: Checking for test user...');
    let user = await Account.findOne({ email: 'test@seemplifyai.com' });
    
    if (!user) {
      user = await Account.create({
        email: 'test@seemplifyai.com',
        sub: 'test-user-' + Date.now(),
        profile: {
          name: 'Test User',
          givenName: 'Test',
          familyName: 'User',
          email: 'test@seemplifyai.com'
        }
      });
      console.log('✅ Test user created:', user.email);
    } else {
      console.log('✅ Test user found:', user.email);
    }
    console.log('');
    
    // Create organization
    console.log('Step 2: Creating organization...');
    const organization = await Organization.create({
      name: 'Test Org Management Cmd',
      description: 'Testing realm provisioning with management commands',
      owner: user._id,
      members: [{
        account: user._id,
        role: 'owner',
        joinedAt: new Date(),
        status: 'active'
      }]
    });
    
    console.log('✅ Organization created:', organization._id.toString());
    console.log('   Name:', organization.name);
    console.log('');
    
    // Import and use zulipService
    console.log('Step 3: Provisioning Zulip realm via management command...');
    try {
      const { default: zulipService } = await import('./src/services/zulipService.js');
      
      const zulipRealmInfo = await zulipService.createZulipRealm(organization, user);
      
      console.log('');
      console.log('✅✅✅ Zulip realm provisioned successfully! ✅✅✅');
      console.log('   Realm ID:', zulipRealmInfo.realmId);
      console.log('   Realm String ID:', zulipRealmInfo.realmStringId);
      console.log('   Chat URL:', zulipRealmInfo.chatUrl);
      console.log('');
    } catch (zulipError) {
      console.error('❌ Failed to provision Zulip realm:', zulipError.message);
      console.error(zulipError.stack);
    }
    
    // Update user
    console.log('Step 4: Updating user organizations...');
    await Account.updateOne(
      { _id: user._id },
      {
        $push: {
          organizations: {
            organization: organization._id,
            role: 'owner',
            joinedAt: new Date(),
            isActive: true
          }
        },
        $set: { 
          currentOrganization: organization._id,
          updatedAt: new Date()
        }
      }
    );
    
    console.log('✅ User updated');
    console.log('');
    console.log('=== SUMMARY ===');
    console.log('Organization ID:', organization._id.toString());
    console.log('Organization Name:', organization.name);
    console.log('User Email:', user.email);
    
    await mongoose.disconnect();
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
