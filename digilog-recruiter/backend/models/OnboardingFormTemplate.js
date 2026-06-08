const mongoose = require('mongoose');

const FormFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: [
      'text',
      'textarea',
      'email',
      'phone',
      'date',
      'number',
      'select',
      'checkbox',
      'bank_account',
      'routing_number',
      'tax_id',
      'address',
      'file'
    ],
    default: 'text'
  },
  required: { type: Boolean, default: false },
  sensitive: { type: Boolean, default: false },
  options: [{ type: String, trim: true }],
  placeholder: { type: String, trim: true },
  helpText: { type: String, trim: true },
  defaultValuePath: { type: String, trim: true },
  validation: {
    minLength: Number,
    maxLength: Number,
    pattern: String
  },
  order: { type: Number, default: 0 }
}, { _id: false });

const OnboardingFormTemplateSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    trim: true,
    default: 'custom',
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
    index: true
  },
  version: {
    type: Number,
    default: 1
  },
  isSystem: {
    type: Boolean,
    default: false,
    index: true
  },
  fields: {
    type: [FormFieldSchema],
    default: []
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

OnboardingFormTemplateSchema.index({ organization: 1, status: 1, name: 1 });
OnboardingFormTemplateSchema.index({ organization: 1, category: 1, createdAt: -1 });

module.exports = mongoose.model('OnboardingFormTemplate', OnboardingFormTemplateSchema);
