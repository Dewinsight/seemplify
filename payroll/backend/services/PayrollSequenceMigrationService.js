const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const PayrollSequence = require('../models/PayrollSequence');

function buildSequenceOperations(runRows = [], payslipRows = []) {
  const build = (prefix, rows) => rows.map((row) => ({
    updateOne: {
      filter: { _id: `${prefix}:${row._id.organizationId}:${row._id.yearMonth}` },
      update: { $max: { value: Number(row.maxSequence || 0) } },
      upsert: true,
    },
  }));
  return [
    ...build('payroll-run', runRows),
    ...build('payslip', payslipRows),
  ];
}

class PayrollSequenceMigrationService {
  async maxIdentifierSequences(model, fieldName) {
    return model.aggregate([
      { $match: { [fieldName]: { $type: 'string', $regex: /^(PR|PS)-\d{4}-\d{2}-\d+$/ } } },
      { $project: {
        organizationId: 1,
        parts: { $split: [`$${fieldName}`, '-'] },
      } },
      { $project: {
        organizationId: 1,
        yearMonth: {
          $concat: [
            { $arrayElemAt: ['$parts', 1] },
            '-',
            { $arrayElemAt: ['$parts', 2] },
          ],
        },
        sequence: {
          $convert: {
            input: { $arrayElemAt: ['$parts', 3] },
            to: 'int',
            onError: 0,
            onNull: 0,
          },
        },
      } },
      { $group: {
        _id: { organizationId: '$organizationId', yearMonth: '$yearMonth' },
        maxSequence: { $max: '$sequence' },
      } },
    ]);
  }

  async seedCounters() {
    const [runRows, payslipRows] = await Promise.all([
      this.maxIdentifierSequences(PayrollRun, 'runNumber'),
      this.maxIdentifierSequences(Payslip, 'payslipNumber'),
    ]);
    const operations = buildSequenceOperations(runRows, payslipRows);
    if (operations.length > 0) {
      await PayrollSequence.bulkWrite(operations, { ordered: false });
    }
    return operations.length;
  }
}

module.exports = new PayrollSequenceMigrationService();
module.exports.PayrollSequenceMigrationService = PayrollSequenceMigrationService;
module.exports.buildSequenceOperations = buildSequenceOperations;
