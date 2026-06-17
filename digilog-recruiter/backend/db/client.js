// Prisma client singleton for the Postgres migration.
//
// Two extensions keep the rest of the codebase working with minimal changes:
//   1. `query`  — injects an ObjectId-format `id` on create/createMany/upsert so
//                 call-sites never have to generate ids themselves (mirrors how
//                 MongoDB auto-assigned `_id`).
//   2. `result` — exposes a computed `_id = id` on every model result so the
//                 thousands of in-process `record._id` reads keep resolving.
//
// The wire-format `_id` (JSON responses) is additionally guaranteed by the
// idCompat middleware; this extension covers in-memory reads.
const { PrismaClient } = require('@prisma/client');
const { newId } = require('./objectId');

const basePrisma = new PrismaClient({
  log: ['warn', 'error'],
});

const prisma = basePrisma
  .$extends({
    query: {
      $allModels: {
        async create({ args, query }) {
          if (args.data && args.data.id == null) args.data.id = newId();
          return query(args);
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            for (const row of args.data) {
              if (row && row.id == null) row.id = newId();
            }
          } else if (args.data && args.data.id == null) {
            args.data.id = newId();
          }
          return query(args);
        },
        async upsert({ args, query }) {
          if (args.create && args.create.id == null) args.create.id = newId();
          return query(args);
        },
      },
    },
    result: {
      $allModels: {
        _id: {
          needs: { id: true },
          compute(record) {
            return record.id;
          },
        },
      },
    },
  });

module.exports = prisma;
module.exports.prisma = prisma;
