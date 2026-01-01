const mongoose = require('mongoose');

const DepartmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for better performance
DepartmentSchema.index({ organization: 1, name: 1 }, { unique: true });
DepartmentSchema.index({ organization: 1, isActive: 1 });

// Virtual for job count
DepartmentSchema.virtual('jobCount', {
  ref: 'Job',
  localField: '_id',
  foreignField: 'department',
  count: true
});

// Methods
DepartmentSchema.methods.getJobCount = async function() {
  const Job = mongoose.model('Job');
  return await Job.countDocuments({ department: this._id });
};

// Pre-save middleware to update updatedAt
DepartmentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to create default departments
DepartmentSchema.statics.createDefaultDepartments = async function(organizationId, createdBy) {
  const defaultDepartments = [
    { name: 'Engineering', description: 'Software development and technical roles' },
    { name: 'Product', description: 'Product management and strategy' },
    { name: 'Design', description: 'UI/UX and creative roles' },
    { name: 'Marketing', description: 'Growth, content, and brand roles' },
    { name: 'Sales', description: 'Revenue generation and client relations' },
    { name: 'Human Resources', description: 'People and talent management' },
    { name: 'Finance', description: 'Financial planning and analysis' },
    { name: 'Operations', description: 'Business operations and logistics' }
  ];

  const departments = defaultDepartments.map(dept => ({
    ...dept,
    organization: organizationId,
    createdBy
  }));

  return await this.insertMany(departments);
};

module.exports = mongoose.model('Department', DepartmentSchema);
