import express from "express";
import { z } from "zod";
import { currentSessionUser } from "./auth.js";
import {
  assessJourneyPortfolioItem,
  bulkUpdateJourneyPortfolioItems,
  captureJourneyInitiativeBaseline,
  createJourneyInitiativeOutcomeComparison,
  createJourneyInitiativeDependency,
  createJourneyPortfolioOperationalLink,
  createJourneyPortfolioItem,
  createJourneyPortfolioJourneyLink,
  createJourneyPortfolioRelationship,
  createJourneyPortfolioScoringPolicy,
  createJourneyPortfolioScoringPolicyVersion,
  deleteJourneyInitiativeDependency,
  deleteJourneyPortfolioJourneyLink,
  deleteJourneyPortfolioRelationship,
  getJourneyPortfolioItem,
  JourneyPortfolioError,
  listJourneyInitiativeDependencies,
  listJourneyInitiativeBaselines,
  listJourneyInitiativeOutcomes,
  listJourneyPortfolioItems,
  listJourneyPortfolioJourneyLinks,
  listJourneyPortfolioOperationalLinks,
  listJourneyPortfolioRelationships,
  listJourneyPortfolioScoringPolicies,
  updateJourneyPortfolioItem,
  updateJourneyPortfolioOperationalOutcome,
  updateJourneyPortfolioScoringPolicyState,
} from "./journeyPortfolio.js";
import { resolveRequestSpace, SpaceError } from "./spaces.js";
import { SubscriptionEntitlementError } from "./subscriptionEntitlements.js";
import {
  buildJourneyPortfolioExecutiveReport,
  exportJourneyPortfolioExecutiveReport,
} from "./journeyPortfolioReporting.js";
import {
  cancelPortfolioTransition,
  createPortfolioSavedView,
  decidePortfolioTransition,
  exportPortfolioSavedViews,
  listPortfolioSavedViews,
  listPortfolioTransitionRequests,
  requestPortfolioTransition,
  revisePortfolioSavedView,
  setPortfolioDefaultView,
} from "./journeyPortfolioGovernance.js";

const lifecycleValues = [
  "draft",
  "validated",
  "approved",
  "archived",
  "planned",
  "active",
  "blocked",
  "completed",
  "cancelled",
] as const;
const priorityValues = ["low", "medium", "high", "critical"] as const;
const riskValues = ["low", "medium", "high", "unknown"] as const;
const frequencyValues = [
  "rare",
  "occasional",
  "frequent",
  "pervasive",
  "unknown",
] as const;
const portfolioKindValues = [
  "pain_point",
  "opportunity",
  "solution",
  "initiative",
] as const;
const relationshipTypeValues = [
  "pain_point_to_opportunity",
  "opportunity_to_solution",
  "solution_to_initiative",
] as const;
const journeyTargetTypeValues = [
  "journey",
  "stage",
  "touchpoint",
  "persona",
] as const;
const journeyRelationshipValues = [
  "occurs_at",
  "affects",
  "improves",
  "changes",
  "delivers",
] as const;
const dependencyTypeValues = ["finish_to_start", "blocks"] as const;
const scoringMethodValues = ["rice", "ice", "weighted"] as const;
const scoringPolicyStateValues = ["draft", "active", "retired"] as const;
const scoringPolicyCreateStateValues = ["draft", "active"] as const;
const sortValues = ["updated", "priority", "due", "score"] as const;
const evidenceStateValues = ["with_evidence", "without_evidence"] as const;
const stateValues = ["active", "deleted"] as const;
const operationalKindValues = ["assistant_action", "recovery_ticket"] as const;
const operationalRelationshipValues = [
  "informs",
  "supports",
  "delivers_follow_up",
] as const;
const operationalOutcomeValues = [
  "linked",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;
const viewConfiguration = z
  .object({
    presentation: z.enum(["table", "board", "matrix"]),
    filters: z
      .object({
        kind: z.enum(portfolioKindValues).optional(),
        lifecycle: z.enum(lifecycleValues).optional(),
        priority: z.enum(priorityValues).optional(),
        risk: z.enum(riskValues).optional(),
        evidenceState: z.enum(evidenceStateValues).optional(),
        search: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    sort: z.enum(sortValues),
    columns: z
      .array(
        z.enum([
          "item",
          "type",
          "state",
          "priority",
          "score",
          "evidence",
          "journeys",
          "due",
        ]),
      )
      .min(1)
      .max(8),
  })
  .strict();

const objectBody = z.object({}).passthrough();
const revision = z.number().int().min(1);
const idempotencyKey = z.string().trim().min(1).max(200);
const token = z.string().trim().min(1).max(200);
const isoDate = z.string().datetime({ offset: true });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const nullableNumber = z.number().finite().nullable().optional();
const nullableString = z.string().nullable().optional();

const metricTargetSchema = z
  .object({
    metricId: token,
    metricDefinitionVersion: token,
    direction: z.enum(["higher_is_better", "lower_is_better"]),
    targetValue: z.number().finite(),
    unit: z.string().trim().min(1).max(120),
  })
  .strict();

const itemDraftSchema = z
  .object({
    kind: z.enum(portfolioKindValues),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).optional().default(""),
    lifecycle: z.enum(lifecycleValues),
    ownerUserId: nullableString,
    ownerTeamId: nullableString,
    priority: z.enum(priorityValues).nullable().optional(),
    risk: z.enum(riskValues).nullable().optional(),
    severity: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
      ])
      .nullable()
      .optional(),
    frequency: z.enum(frequencyValues).nullable().optional(),
    desiredOutcome: nullableString,
    hypothesis: nullableString,
    constraints: z.array(z.string().max(5_000)).optional().default([]),
    estimatedEffort: nullableNumber,
    estimatedCost: nullableNumber,
    expectedOutcome: nullableString,
    plannedStart: z.union([isoDate, z.null()]).optional(),
    plannedEnd: z.union([isoDate, z.null()]).optional(),
    actualStart: z.union([isoDate, z.null()]).optional(),
    actualEnd: z.union([isoDate, z.null()]).optional(),
    dueDate: z.union([dateOnly, z.null()]).optional(),
    progressPercent: z.number().int().min(0).max(100).nullable().optional(),
    reviewCadenceDays: z.number().int().min(1).max(3650).nullable().optional(),
    targetMetrics: z.array(metricTargetSchema).optional().default([]),
    evidenceLinkIds: z.array(token).optional().default([]),
    tags: z.array(z.string().trim().min(1).max(80)).optional().default([]),
  })
  .strict();

const itemPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10_000).optional(),
    lifecycle: z.enum(lifecycleValues).optional(),
    ownerUserId: z.union([token, z.null()]).optional(),
    ownerTeamId: z.union([token, z.null()]).optional(),
    priority: z.enum(priorityValues).nullable().optional(),
    risk: z.enum(riskValues).nullable().optional(),
    severity: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.null(),
      ])
      .optional(),
    frequency: z.enum(frequencyValues).nullable().optional(),
    desiredOutcome: z.union([z.string().max(10_000), z.null()]).optional(),
    hypothesis: z.union([z.string().max(10_000), z.null()]).optional(),
    constraints: z.array(z.string().max(5_000)).optional(),
    estimatedEffort: nullableNumber,
    estimatedCost: nullableNumber,
    expectedOutcome: z.union([z.string().max(10_000), z.null()]).optional(),
    plannedStart: z.union([isoDate, z.null()]).optional(),
    plannedEnd: z.union([isoDate, z.null()]).optional(),
    actualStart: z.union([isoDate, z.null()]).optional(),
    actualEnd: z.union([isoDate, z.null()]).optional(),
    dueDate: z.union([dateOnly, z.null()]).optional(),
    progressPercent: z.number().int().min(0).max(100).nullable().optional(),
    reviewCadenceDays: z.number().int().min(1).max(3650).nullable().optional(),
    targetMetrics: z.array(metricTargetSchema).optional(),
    evidenceLinkIds: z.array(token).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).optional(),
  })
  .strict();

function context(request: express.Request) {
  const user = currentSessionUser(request);
  if (!user)
    throw new SpaceError(
      "Authentication required.",
      401,
      "AUTHENTICATION_REQUIRED",
    );
  return { user, space: resolveRequestSpace(request, user.id) };
}

function sendError(response: express.Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return response
      .status(400)
      .json({
        error: "Validation failed.",
        code: "VALIDATION_FAILED",
        details: error.issues,
      });
  }
  if (
    error instanceof JourneyPortfolioError ||
    error instanceof SpaceError ||
    error instanceof SubscriptionEntitlementError
  ) {
    return response.status(error.status).json({
      error: error.message,
      code: error.code,
      details: "details" in error ? error.details : {},
    });
  }
  console.error(
    "Journey portfolio request failed:",
    error instanceof Error ? error.message : String(error),
  );
  return response.status(500).json({
    error: "The journey portfolio request could not be completed.",
    code: "JOURNEY_PORTFOLIO_INTERNAL_ERROR",
  });
}

export const journeyPortfolioRouter = express.Router();
journeyPortfolioRouter.use((_request, response, next) => {
  response.setHeader("Cache-Control", "private, no-store");
  next();
});

journeyPortfolioRouter.get("/saved-views", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(
      listPortfolioSavedViews({ spaceId: space.id, actorUserId: user.id }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});
journeyPortfolioRouter.get("/saved-views.csv", (request, response) => {
  try {
    const { user, space } = context(request);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="journey-portfolio-saved-views.csv"',
    );
    return response.send(
      exportPortfolioSavedViews({ spaceId: space.id, actorUserId: user.id }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});
journeyPortfolioRouter.post("/saved-views", (request, response) => {
  try {
    const { user, space } = context(request);
    const body = z
      .object({
        name: z.string().trim().min(1).max(160),
        configuration: viewConfiguration,
        makeDefault: z.boolean().optional(),
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response
      .status(201)
      .json(
        createPortfolioSavedView({
          spaceId: space.id,
          actorUserId: user.id,
          ...body,
        }),
      );
  } catch (error) {
    return sendError(response, error);
  }
});
journeyPortfolioRouter.patch("/saved-views/:viewId", (request, response) => {
  try {
    const { user, space } = context(request);
    const body = z
      .object({
        expectedRevision: revision,
        name: z.string().trim().min(1).max(160).optional(),
        configuration: viewConfiguration,
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.json(
      revisePortfolioSavedView({
        spaceId: space.id,
        actorUserId: user.id,
        viewId: String(request.params.viewId),
        ...body,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});
journeyPortfolioRouter.put("/saved-views/default", (request, response) => {
  try {
    const { user, space } = context(request);
    const body = z
      .object({
        viewId: token.nullable(),
        expectedRevision: z.number().int().min(0),
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.json(
      setPortfolioDefaultView({
        spaceId: space.id,
        actorUserId: user.id,
        ...body,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});
journeyPortfolioRouter.get("/transition-requests", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({
        status: z
          .enum(["pending", "applied", "rejected", "cancelled", "superseded"])
          .optional(),
      })
      .strict()
      .parse(request.query);
    return response.json({
      requests: listPortfolioTransitionRequests({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});
journeyPortfolioRouter.post("/transition-requests", (request, response) => {
  try {
    const { user, space } = context(request);
    const body = z
      .object({
        itemId: token,
        expectedItemRevision: revision,
        targetLifecycle: z.enum(lifecycleValues),
        reason: z.string().trim().min(3).max(1000),
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response
      .status(201)
      .json(
        requestPortfolioTransition({
          spaceId: space.id,
          actorUserId: user.id,
          ...body,
        }),
      );
  } catch (error) {
    return sendError(response, error);
  }
});
journeyPortfolioRouter.post(
  "/transition-requests/:requestId/decision",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          expectedRevision: revision,
          decision: z.enum(["approve", "reject"]),
          reason: z.string().trim().min(3).max(1000),
          idempotencyKey,
        })
        .strict()
        .parse(request.body || {});
      return response.json(
        decidePortfolioTransition({
          spaceId: space.id,
          actorUserId: user.id,
          requestId: String(request.params.requestId),
          ...body,
        }),
      );
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyPortfolioRouter.post(
  "/transition-requests/:requestId/cancel",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          expectedRevision: revision,
          reason: z.string().trim().min(3).max(1000),
          idempotencyKey,
        })
        .strict()
        .parse(request.body || {});
      return response.json(
        cancelPortfolioTransition({
          spaceId: space.id,
          actorUserId: user.id,
          requestId: String(request.params.requestId),
          ...body,
        }),
      );
    } catch (error) {
      return sendError(response, error);
    }
  },
);

journeyPortfolioRouter.get("/executive-report", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({
      report: buildJourneyPortfolioExecutiveReport({
        spaceId: space.id,
        actorUserId: user.id,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.get("/executive-report.csv", (request, response) => {
  try {
    const { user, space } = context(request);
    const report = buildJourneyPortfolioExecutiveReport({
      spaceId: space.id,
      actorUserId: user.id,
    });
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="journey-portfolio-executive-report.csv"',
    );
    return response.send(exportJourneyPortfolioExecutiveReport(report));
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.get("/items", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({
        kind: z.enum(portfolioKindValues).optional(),
        lifecycle: z.enum(lifecycleValues).optional(),
        ownerUserId: token.optional(),
        priority: z.enum(priorityValues).optional(),
        risk: z.enum(riskValues).optional(),
        tag: z.string().trim().min(1).max(80).optional(),
        search: z.string().trim().min(1).max(200).optional(),
        state: z.enum(stateValues).optional(),
        dueBefore: dateOnly.optional(),
        evidenceState: z.enum(evidenceStateValues).optional(),
        sort: z.enum(sortValues).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .strict()
      .parse(request.query);
    return response.json(
      listJourneyPortfolioItems({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      } as Parameters<typeof listJourneyPortfolioItems>[0]),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/items", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({ draft: itemDraftSchema, idempotencyKey })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      createJourneyPortfolioItem({
        spaceId: space.id,
        actorUserId: user.id,
        draft: input.draft as Parameters<
          typeof createJourneyPortfolioItem
        >[0]["draft"],
        idempotencyKey: input.idempotencyKey,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/items/bulk", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        idempotencyKey,
        updates: z
          .array(
            z
              .object({
                itemId: token,
                expectedRevision: revision,
                patch: itemPatchSchema,
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(request.body || {});
    return response.json(
      bulkUpdateJourneyPortfolioItems({
        spaceId: space.id,
        actorUserId: user.id,
        updates: input.updates as Parameters<
          typeof bulkUpdateJourneyPortfolioItems
        >[0]["updates"],
        idempotencyKey: input.idempotencyKey,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.get("/items/:itemId", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({ includeDeleted: z.coerce.boolean().optional() })
      .strict()
      .parse(request.query);
    return response.json(
      getJourneyPortfolioItem({
        spaceId: space.id,
        actorUserId: user.id,
        itemId: String(request.params.itemId),
        includeDeleted: query.includeDeleted,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.patch("/items/:itemId", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        expectedRevision: revision,
        patch: itemPatchSchema,
        changeReason: z.string().trim().max(1_000).nullable().optional(),
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.json(
      updateJourneyPortfolioItem({
        spaceId: space.id,
        actorUserId: user.id,
        itemId: String(request.params.itemId),
        expectedRevision: input.expectedRevision,
        patch: input.patch as Parameters<
          typeof updateJourneyPortfolioItem
        >[0]["patch"],
        changeReason: input.changeReason,
        idempotencyKey: input.idempotencyKey,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.get("/relationships", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({ itemId: token.optional() })
      .strict()
      .parse(request.query);
    return response.json({
      relationships: listJourneyPortfolioRelationships({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/relationships", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        type: z.enum(relationshipTypeValues),
        fromItemId: token,
        toItemId: token,
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      createJourneyPortfolioRelationship({
        spaceId: space.id,
        actorUserId: user.id,
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.delete(
  "/relationships/:relationshipId",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const input = z
        .object({ idempotencyKey })
        .strict()
        .parse(request.body || {});
      return response.json(
        deleteJourneyPortfolioRelationship({
          spaceId: space.id,
          actorUserId: user.id,
          relationshipId: String(request.params.relationshipId),
          idempotencyKey: input.idempotencyKey,
        }),
      );
    } catch (error) {
      return sendError(response, error);
    }
  },
);

journeyPortfolioRouter.get("/journey-links", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({
        itemId: token.optional(),
        journeyDefinitionId: token.optional(),
      })
      .strict()
      .parse(request.query);
    return response.json({
      links: listJourneyPortfolioJourneyLinks({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/journey-links", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        itemId: token,
        journeyDefinitionId: token,
        journeyVersionId: token.nullable().optional(),
        targetType: z.enum(journeyTargetTypeValues),
        targetId: token,
        relationship: z.enum(journeyRelationshipValues),
        validFrom: z.union([isoDate, z.null()]).optional(),
        validUntil: z.union([isoDate, z.null()]).optional(),
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      createJourneyPortfolioJourneyLink({
        spaceId: space.id,
        actorUserId: user.id,
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.delete("/journey-links/:linkId", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({ idempotencyKey })
      .strict()
      .parse(request.body || {});
    return response.json(
      deleteJourneyPortfolioJourneyLink({
        spaceId: space.id,
        actorUserId: user.id,
        linkId: String(request.params.linkId),
        idempotencyKey: input.idempotencyKey,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.get("/dependencies", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(
      listJourneyInitiativeDependencies({
        spaceId: space.id,
        actorUserId: user.id,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/dependencies", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        initiativeId: token,
        dependsOnInitiativeId: token,
        type: z.enum(dependencyTypeValues),
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      createJourneyInitiativeDependency({
        spaceId: space.id,
        actorUserId: user.id,
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.delete(
  "/dependencies/:dependencyId",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const input = z
        .object({ idempotencyKey })
        .strict()
        .parse(request.body || {});
      return response.json(
        deleteJourneyInitiativeDependency({
          spaceId: space.id,
          actorUserId: user.id,
          dependencyId: String(request.params.dependencyId),
          idempotencyKey: input.idempotencyKey,
        }),
      );
    } catch (error) {
      return sendError(response, error);
    }
  },
);

journeyPortfolioRouter.get("/policies", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({ includeRetired: z.coerce.boolean().optional() })
      .strict()
      .parse(request.query);
    return response.json({
      policies: listJourneyPortfolioScoringPolicies({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/policies", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        name: z.string().trim().min(1).max(160),
        method: z.enum(scoringMethodValues),
        configuration: objectBody,
        state: z.enum(scoringPolicyCreateStateValues).optional(),
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      createJourneyPortfolioScoringPolicy({
        spaceId: space.id,
        actorUserId: user.id,
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post(
  "/policies/:policyId/versions",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const input = z
        .object({
          expectedRevision: revision,
          configuration: objectBody,
          idempotencyKey,
        })
        .strict()
        .parse(request.body || {});
      return response.status(201).json(
        createJourneyPortfolioScoringPolicyVersion({
          spaceId: space.id,
          actorUserId: user.id,
          policyId: String(request.params.policyId),
          expectedRevision: input.expectedRevision,
          configuration: input.configuration,
          idempotencyKey: input.idempotencyKey,
        }),
      );
    } catch (error) {
      return sendError(response, error);
    }
  },
);

journeyPortfolioRouter.patch("/policies/:policyId", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        expectedRevision: revision,
        name: z.string().trim().min(1).max(160).optional(),
        state: z.enum(scoringPolicyStateValues).optional(),
      })
      .strict()
      .parse(request.body || {});
    return response.json(
      updateJourneyPortfolioScoringPolicyState({
        spaceId: space.id,
        actorUserId: user.id,
        policyId: String(request.params.policyId),
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/assessments", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        itemId: token,
        policyId: token.nullable().optional(),
        scoreInput: objectBody,
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      assessJourneyPortfolioItem({
        spaceId: space.id,
        actorUserId: user.id,
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.get("/operational-links", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({ initiativeId: token.optional() })
      .strict()
      .parse(request.query);
    return response.json({
      operationalLinks: listJourneyPortfolioOperationalLinks({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/operational-links", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({
        initiativeId: token,
        operationalKind: z.enum(operationalKindValues),
        operationalId: token,
        relationship: z.enum(operationalRelationshipValues),
        idempotencyKey,
      })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      createJourneyPortfolioOperationalLink({
        spaceId: space.id,
        actorUserId: user.id,
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.patch(
  "/operational-links/:linkId/outcome",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const input = z
        .object({
          expectedRevision: revision,
          outcomeState: z.enum(operationalOutcomeValues),
          outcomeDetail: z.record(z.string(), z.unknown()).default({}),
        })
        .strict()
        .parse(request.body || {});
      return response.json(
        updateJourneyPortfolioOperationalOutcome({
          spaceId: space.id,
          actorUserId: user.id,
          linkId: String(request.params.linkId),
          ...input,
        }),
      );
    } catch (error) {
      return sendError(response, error);
    }
  },
);

journeyPortfolioRouter.get("/baselines", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({ initiativeId: token.optional() })
      .strict()
      .parse(request.query);
    return response.json({
      baselines: listJourneyInitiativeBaselines({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/baselines", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({ initiativeId: token, observationId: token, idempotencyKey })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      captureJourneyInitiativeBaseline({
        spaceId: space.id,
        actorUserId: user.id,
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.get("/outcomes", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({ initiativeId: token.optional() })
      .strict()
      .parse(request.query);
    return response.json({
      outcomes: listJourneyInitiativeOutcomes({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});

journeyPortfolioRouter.post("/outcomes", (request, response) => {
  try {
    const { user, space } = context(request);
    const input = z
      .object({ baselineId: token, afterObservationId: token, idempotencyKey })
      .strict()
      .parse(request.body || {});
    return response.status(201).json(
      createJourneyInitiativeOutcomeComparison({
        spaceId: space.id,
        actorUserId: user.id,
        ...input,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});
