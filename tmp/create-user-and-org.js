import mongoose from 'mongoose';

const DB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

console.log('=== Test Organization Creation with Zulip Provisioning ===');
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
    
    // Step 1: Create or find test user
    console.log('Step 1: Creating test user...');
    let user = await Account.findOne({ email: 'test@seemplify.ai' });
    
    if (!user) {
      user = await Account.create({
        email: 'test@seemplify.ai',
        sub: 'test-user-' + Date.now(),
        profile: {
          name: 'Test User',
          givenName: 'Test',
          familyName: 'User',
          email: 'test@seemplify.ai'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log('✅ Test user created:', user.email);
    } else {
      console.log('✅ Test user found:', user.email);
    }
    
    console.log('   User ID:', user._id.toString());
    console.log('');
    
    // Step 2: Create organization
    console.log('Step 2: Creating organization...');
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
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    console.log('✅ Organization created:', organization._id.toString());
    console.log('   Name:', organization.name);
    console.log('   Description:', organization.description);
    console.log('');
    
    // Step 3: Import and use zulipService to provision realm
    console.log('Step 3: Provisioning Zulip realm...');
    try {
      // Dynamically import the zulipService
      const { default: zulipService } = await import('./src/services/zulipService.js');
      
      const zulipRealmInfo = await zulipService.createZulipRealm(organization, user);
      
      console.log('✅ Zulip realm provisioned successfully!');
      console.log('   Realm ID:', zulipRealmInfo.realmId);
      console.log('   Realm String ID:', zulipRealmInfo.realmStringId);
      console.log('   Chat URL:', zulipRealmInfo.chatUrl);
      console.log('');
      
      // Update organization with Zulip info
      await Organization.updateOne(
        { _id: organization._id },
        {
          $set: {
            zulipRealmId: zulipRealmInfo.realmId,
            zulipRealmStringId: zulipRealmInfo.realmStringId,
            updatedAt: new Date()
          }
        }
      );
      
      console.log('✅ Organization updated with Zulip info');
    } catch (zulipError) {
      console.error('❌ Failed to provision Zulip realm:', zulipError.message);
      console.error(zulipError.stack);
    }
    
    // Step 4: Update user's organizations
    console.log('');
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
    
    console.log('✅ User updated with organization membership');
    console.log('');
    console.log('=== SUMMARY ===');
    console.log('Organization ID:', organization._id.toString());
    console.log('Organization Name:', organization.name);
    console.log('User Email:', user.email);
    console.log('');
    console.log('✅ Test complete!');
    
    await mongoose.disconnect();
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
