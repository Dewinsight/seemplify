'use strict';

const {
  initSessionStore,
  invalidateUserSessions,
} = require('../sessionStore');

describe('Leave session store compatibility', () => {
  test('uses the connect-mongo v5 collectionP promise', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 2 });
    initSessionStore({ collectionP: Promise.resolve({ deleteMany }) });

    await expect(invalidateUserSessions('user-1')).resolves.toBe(2);
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });

  test('retains compatibility with a directly exposed collection', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 1 });
    initSessionStore({ collection: { deleteMany } });

    await expect(invalidateUserSessions('user-2')).resolves.toBe(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });
});
