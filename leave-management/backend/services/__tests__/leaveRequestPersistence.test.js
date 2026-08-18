const {
  isTransactionUnsupportedError,
  persistLeaveRequestAndBalance,
  saveWithoutTransaction,
} = require('../leaveRequestPersistence');

function sessionMock() {
  return {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
    inTransaction: jest.fn().mockReturnValue(true),
  };
}

test('recognizes the standalone MongoDB transaction error', () => {
  expect(isTransactionUnsupportedError(Object.assign(
    new Error('Transaction numbers are only allowed on a replica set member or mongos'),
    { code: 20, codeName: 'IllegalOperation' }
  ))).toBe(true);
  expect(isTransactionUnsupportedError(new Error('validation failed'))).toBe(false);
});

test('persists both documents in a transaction when supported', async () => {
  const session = sessionMock();
  const leaveRequest = { save: jest.fn().mockResolvedValue(undefined) };
  const balance = { save: jest.fn().mockResolvedValue(undefined) };

  await expect(persistLeaveRequestAndBalance(
    leaveRequest,
    balance,
    { startSession: async () => session }
  )).resolves.toEqual({ mode: 'transaction' });

  expect(leaveRequest.save).toHaveBeenCalledWith({ session });
  expect(balance.save).toHaveBeenCalledWith({ session });
  expect(session.commitTransaction).toHaveBeenCalledTimes(1);
  expect(session.endSession).toHaveBeenCalledTimes(1);
});

test('retries without a transaction on standalone MongoDB', async () => {
  const session = sessionMock();
  const unsupported = Object.assign(new Error(
    'Transaction numbers are only allowed on a replica set member or mongos'
  ), { code: 20, codeName: 'IllegalOperation' });
  const leaveRequest = {
    save: jest.fn()
      .mockRejectedValueOnce(unsupported)
      .mockResolvedValueOnce(undefined),
    deleteOne: jest.fn(),
  };
  const balance = { save: jest.fn().mockResolvedValue(undefined) };

  await expect(persistLeaveRequestAndBalance(
    leaveRequest,
    balance,
    { startSession: async () => session }
  )).resolves.toEqual({ mode: 'standalone' });

  expect(leaveRequest.save).toHaveBeenNthCalledWith(1, { session });
  expect(leaveRequest.save).toHaveBeenNthCalledWith(2);
  expect(balance.save).toHaveBeenCalledWith();
  expect(session.abortTransaction).toHaveBeenCalledTimes(1);
});

test('removes the request if the standalone balance write fails', async () => {
  const leaveRequest = {
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
  };
  const balanceError = new Error('balance write failed');
  const balance = { save: jest.fn().mockRejectedValue(balanceError) };

  await expect(saveWithoutTransaction(leaveRequest, balance)).rejects.toThrow(balanceError);
  expect(leaveRequest.deleteOne).toHaveBeenCalledTimes(1);
});

test('does not retry unrelated transaction errors outside the transaction', async () => {
  const session = sessionMock();
  const validationError = new Error('request validation failed');
  const leaveRequest = { save: jest.fn().mockRejectedValue(validationError) };
  const balance = { save: jest.fn() };

  await expect(persistLeaveRequestAndBalance(
    leaveRequest,
    balance,
    { startSession: async () => session }
  )).rejects.toThrow(validationError);

  expect(leaveRequest.save).toHaveBeenCalledTimes(1);
  expect(balance.save).not.toHaveBeenCalled();
  expect(session.endSession).toHaveBeenCalledTimes(1);
});
