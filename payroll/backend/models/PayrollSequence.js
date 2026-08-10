const mongoose = require('mongoose');

const PayrollSequenceSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  value: { type: Number, min: 0, default: 0 },
}, { timestamps: true, versionKey: false });

PayrollSequenceSchema.statics.reserve = async function reserve(key, count = 1) {
  const size = Math.max(1, Math.floor(Number(count) || 1));
  const row = await this.findOneAndUpdate(
    { _id: String(key) },
    { $inc: { value: size } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return Number(row.value) - size + 1;
};

module.exports = mongoose.models.PayrollSequence
  || mongoose.model('PayrollSequence', PayrollSequenceSchema);
