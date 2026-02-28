const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const createSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Check if super admin already exists
    const existingAdmin = await Admin.findOne({ email: 'michael.egbo@aiinnigeria.com' });
    
    if (existingAdmin) {
      console.log('Super admin already exists');
      
      // Update to ensure it's a super admin with all permissions
      existingAdmin.role = 'super_admin';
      existingAdmin.permissions = Admin.getSuperAdminPermissions();
      await existingAdmin.save();
      
      console.log('Super admin permissions updated');
    } else {
      // Create super admin
      const superAdmin = new Admin({
        email: 'michael.egbo@aiinnigeria.com',
        password: 'SmartHR@Admin2024', // Change this password after first login!
        name: 'Michael Egbo',
        role: 'super_admin',
        permissions: Admin.getSuperAdminPermissions()
      });
      
      await superAdmin.save();
      console.log('Super admin created successfully');
      console.log('Email: michael.egbo@aiinnigeria.com');
      console.log('Default Password: SmartHR@Admin2024');
      console.log('⚠️  IMPORTANT: Please change the password after first login!');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating super admin:', error);
    process.exit(1);
  }
};

createSuperAdmin();
