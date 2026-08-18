const mongoose = require('mongoose');

function isTransactionUnsupportedError(error) {
  const message = String(error?.message || '');
  return error?.code === 20
    || error?.codeName === 'IllegalOperation' && /transaction/i.test(message)
    || /Transaction numbers are only allowed on a replica set member or mongos/i.test(message);
}

async function runWithTransactionFallback(
  operation,
  { startSession = () => mongoose.startSession() } = {}
) {
  const session = await startSession();

  try {
    session.startTransaction();
    const result = await operation(session);
    await session.commitTransaction();
    return { mode: 'transaction', result };
  } catch (error) {
    if (!isTransactionUnsupportedError(error)) {
      try {
        if (session.inTransaction?.()) await session.abortTransaction();
      } catch {
        // Preserve the original operation error.
      }
      throw error;
    }

    try {
      if (session.inTransaction?.()) await session.abortTransaction();
    } catch {
      // A standalone server can reject both the transaction and its abort.
    }
  } finally {
    await session.endSession();
  }

  return { mode: 'standalone', result: await operation(null) };
}

async function saveWithoutTransaction(leaveRequest, balance) {
  await leaveRequest.save();

  try {
    await balance.save();
  } catch (error) {
    try {
      await leaveRequest.deleteOne();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }
}

async function persistLeaveRequestAndBalance(
  leaveRequest,
  balance,
  { startSession = () => mongoose.startSession() } = {}
) {
  const session = await startSession();
  let transactionUnsupported = false;

  try {
    session.startTransaction();
    await leaveRequest.save({ session });
    await balance.save({ session });
    await session.commitTransaction();
    return { mode: 'transaction' };
  } catch (error) {
    transactionUnsupported = isTransactionUnsupportedError(error);
    if (!transactionUnsupported) throw error;

    // A standalone MongoDB server rejects the first transactional write, so
    // neither document has been persisted and it is safe to retry normally.
    try {
      if (session.inTransaction?.()) await session.abortTransaction();
    } catch {
      // The server may reject aborting a transaction it never accepted.
    }
  } finally {
    await session.endSession();
  }

  if (transactionUnsupported) {
    await saveWithoutTransaction(leaveRequest, balance);
    return { mode: 'standalone' };
  }

  throw new Error('Leave request persistence failed');
}

module.exports = {
  isTransactionUnsupportedError,
  persistLeaveRequestAndBalance,
  runWithTransactionFallback,
  saveWithoutTransaction,
};
