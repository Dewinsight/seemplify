import express from "express";
import { z } from "zod";
import { currentSessionUser } from "./auth.js";
import {
  createWorkflowDraft,
  decideWorkflowAction,
  getSimulationRun,
  getWorkflow,
  JourneyOrchestrationRepositoryError,
  listSimulationRuns,
  listWorkflows,
  publishWorkflow,
  readJourneyOrchestrationAccess,
  retireWorkflow,
  simulatePersistedWorkflow,
  updateWorkflowDraft,
} from "./journeyOrchestrationRepository.js";
import { resolveRequestSpace, SpaceError } from "./spaces.js";
import { SubscriptionEntitlementError } from "./subscriptionEntitlements.js";
import {
  cancelJourneyAction,
  JourneyActionRuntimeError,
  listJourneyActionQueue,
  readJourneyActionOperatorStatus,
  retryJourneyAction,
} from "./journeyActionRuntimeRepository.js";
import { workflowActionSchema } from "./journeyAdapterContracts.js";
import {
  createJourneyWebhookDestination,
  JourneyReviewedAdapterError,
  listJourneyWebhookDestinations,
  updateJourneyWebhookDestination,
} from "./journeyReviewedAdapters.js";
import { reviewedWorkerAdapters } from "./journeyReviewedAdapterWorker.js";
import { config } from "./config.js";
import { readJourneyOperationsConsole } from "./journeyOperationsConsole.js";

const token = z.string().trim().min(1).max(128);
const scalar = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const trigger = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("event"), eventName: token, sourceId: token })
    .strict(),
  z
    .object({
      type: z.literal("metric_threshold"),
      metricDefinitionId: token,
      operator: z.enum(["gt", "gte", "lt", "lte"]),
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal("schedule"),
      scheduleKey: token,
      timezone: z.string().trim().min(1).max(100),
    })
    .strict(),
]);
const condition = z
  .object({
    key: token,
    fact: token,
    operator: z.enum([
      "equals",
      "not_equals",
      "greater_than",
      "less_than",
      "in",
      "exists",
    ]),
    value: z.union([scalar, z.array(scalar).min(1).max(100)]).optional(),
  })
  .strict();
const adapters = [
  "survey_invitation",
  "service_recovery_ticket",
  "assistant_action",
  "internal_notification",
  "signed_webhook",
] as const;
const automationPolicy = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("human_approval") }).strict(),
  z
    .object({
      mode: z.literal("bounded_automatic"),
      maximumActionsPerRun: z.number().int().min(1).max(1000),
      maximumActionsPerSubjectPerDay: z.number().int().min(1).max(100),
      allowedAdapters: z.array(z.enum(adapters)).min(1),
      recipientScopes: z.array(token).min(1),
      purpose: z.string().trim().min(1).max(500),
      authorisedByUserId: token,
    })
    .strict(),
]);
const draftFields = {
  name: z.string().trim().min(1).max(160),
  trigger,
  conditions: z.array(condition).max(64),
  actions: z.array(workflowActionSchema).min(1).max(32),
  automationPolicy,
};
const gate = z.enum(["allow", "deny", "unknown"]);
const gates = z
  .object({
    consent: gate,
    suppression: gate,
    entitlement: gate,
    quota: gate,
    quiet_hours: gate,
    frequency_cap: gate,
    source_state: gate,
    platform_kill_switch: gate,
    space_kill_switch: gate,
    workflow_kill_switch: gate,
    adapter_kill_switch: gate,
    profile_kill_switch: gate,
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
  if (error instanceof z.ZodError)
    return response.status(400).json({
      error: "Validation failed.",
      code: "VALIDATION_FAILED",
      details: error.issues,
    });
  if (
    error instanceof JourneyOrchestrationRepositoryError ||
    error instanceof SpaceError ||
    error instanceof SubscriptionEntitlementError ||
    error instanceof JourneyActionRuntimeError ||
    error instanceof JourneyReviewedAdapterError
  )
    return response.status(error.status).json({
      error: error.message,
      code: error.code,
      details: "details" in error ? error.details : {},
    });
  console.error(
    "Journey orchestration request failed:",
    error instanceof Error ? error.message : String(error),
  );
  return response.status(500).json({
    error: "Journey orchestration request failed.",
    code: "JOURNEY_ORCHESTRATION_INTERNAL_ERROR",
  });
}

export const journeyOrchestrationRouter = express.Router();
journeyOrchestrationRouter.use((_request, response, next) => {
  response.setHeader("Cache-Control", "private, no-store");
  next();
});
journeyOrchestrationRouter.get("/access", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(readJourneyOrchestrationAccess({
      spaceId: space.id,
      actorUserId: user.id,
    }));
  } catch (error) {
    return sendError(response, error);
  }
});
journeyOrchestrationRouter.get("/workflows", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({
      workflows: listWorkflows({ spaceId: space.id, actorUserId: user.id }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});
journeyOrchestrationRouter.post("/workflows", (request, response) => {
  try {
    const { user, space } = context(request);
    const body = z
      .object(draftFields)
      .strict()
      .parse(request.body || {});
    return response.status(201).json({
      workflow: createWorkflowDraft({
        spaceId: space.id,
        actorUserId: user.id,
        ...body,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});
journeyOrchestrationRouter.get(
  "/workflows/:workflowId",
  (request, response) => {
    try {
      const { user, space } = context(request);
      return response.json({
        workflow: getWorkflow({
          spaceId: space.id,
          actorUserId: user.id,
          workflowId: String(request.params.workflowId),
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.patch(
  "/workflows/:workflowId",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          expectedRevision: z.number().int().min(1),
          ...Object.fromEntries(
            Object.entries(draftFields).map(([key, value]) => [
              key,
              value.optional(),
            ]),
          ),
        })
        .strict()
        .refine(
          (value) =>
            Object.keys(value).some((key) => key !== "expectedRevision"),
          { message: "At least one draft change is required." },
        )
        .parse(request.body || {});
      const { expectedRevision, ...patch } = body;
      return response.json({
        workflow: updateWorkflowDraft({
          spaceId: space.id,
          actorUserId: user.id,
          workflowId: String(request.params.workflowId),
          expectedRevision,
          patch,
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.post(
  "/workflows/:workflowId/publish",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({ expectedRevision: z.number().int().min(1) })
        .strict()
        .parse(request.body || {});
      return response.json(
        publishWorkflow({
          spaceId: space.id,
          actorUserId: user.id,
          workflowId: String(request.params.workflowId),
          ...body,
        }),
      );
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.post(
  "/workflows/:workflowId/retire",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({ expectedRevision: z.number().int().min(1) })
        .strict()
        .parse(request.body || {});
      return response.json({
        workflow: retireWorkflow({
          spaceId: space.id,
          actorUserId: user.id,
          workflowId: String(request.params.workflowId),
          ...body,
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.post(
  "/workflows/:workflowId/simulations",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          mode: z.enum(["dry_run", "historical"]),
          triggerFingerprint: token,
          triggerMatched: z.boolean(),
          subjectId: token,
          facts: z.record(z.string(), scalar),
          gates,
          approvedActionKeys: z.array(token).max(32).optional(),
        })
        .strict()
        .parse(request.body || {});
      return response.status(201).json({
        run: simulatePersistedWorkflow({
          spaceId: space.id,
          actorUserId: user.id,
          workflowId: String(request.params.workflowId),
          ...body,
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.get("/simulations", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({ workflowId: token.optional() })
      .strict()
      .parse(request.query);
    return response.json({
      runs: listSimulationRuns({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});
journeyOrchestrationRouter.get("/simulations/:runId", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({
      run: getSimulationRun({
        spaceId: space.id,
        actorUserId: user.id,
        runId: String(request.params.runId),
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});
journeyOrchestrationRouter.post(
  "/actions/:actionId/approval",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          decision: z.enum(["approved", "rejected"]),
          reason: z.string().trim().min(3).max(1000),
        })
        .strict()
        .parse(request.body || {});
      return response.status(201).json({
        approval: decideWorkflowAction({
          spaceId: space.id,
          actorUserId: user.id,
          actionId: String(request.params.actionId),
          ...body,
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.get("/queue", (request, response) => {
  try {
    const { user, space } = context(request);
    const query = z
      .object({
        state: z
          .enum([
            "held",
            "ready",
            "leased",
            "retry_scheduled",
            "succeeded",
            "dead_letter",
            "cancelled",
          ])
          .optional(),
      })
      .strict()
      .parse(request.query);
    return response.json({
      queue: listJourneyActionQueue({
        spaceId: space.id,
        actorUserId: user.id,
        ...query,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});
journeyOrchestrationRouter.get("/operator-status", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(
      readJourneyActionOperatorStatus({
        spaceId: space.id,
        actorUserId: user.id,
        workerEnabled: config.journeyActionWorkerEnabled,
        configuredSpaceIds: config.journeyActionWorkerSpaceIds,
        configuredAdapters: config.journeyActionWorkerAdapters,
        supportedAdapters: reviewedWorkerAdapters,
      }),
    );
  } catch (error) {
    return sendError(response, error);
  }
});
journeyOrchestrationRouter.get("/operations", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json(readJourneyOperationsConsole({ spaceId: space.id, actorUserId: user.id }));
  } catch (error) {
    return sendError(response, error);
  }
});
const operatorReason = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u);
journeyOrchestrationRouter.post(
  "/queue/:queueId/retry",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          reasonCode: operatorReason,
        })
        .strict()
        .parse(request.body || {});
      return response.json({
        item: retryJourneyAction({
          spaceId: space.id,
          actorUserId: user.id,
          queueId: String(request.params.queueId),
          ...body,
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.post(
  "/queue/:queueId/cancel",
  (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          reasonCode: operatorReason,
        })
        .strict()
        .parse(request.body || {});
      return response.json({
        item: cancelJourneyAction({
          spaceId: space.id,
          actorUserId: user.id,
          queueId: String(request.params.queueId),
          ...body,
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.get("/webhook-destinations", (request, response) => {
  try {
    const { user, space } = context(request);
    return response.json({
      destinations: listJourneyWebhookDestinations({
        spaceId: space.id,
        actorUserId: user.id,
      }),
    });
  } catch (error) {
    return sendError(response, error);
  }
});
journeyOrchestrationRouter.post(
  "/webhook-destinations",
  async (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          name: z.string().trim().min(1).max(160),
          url: z.string().trim().url().max(2048),
          secret: z.string().min(32).max(512),
        })
        .strict()
        .parse(request.body || {});
      return response.status(201).json({
        destination: await createJourneyWebhookDestination({
          spaceId: space.id,
          actorUserId: user.id,
          ...body,
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
journeyOrchestrationRouter.patch(
  "/webhook-destinations/:destinationId",
  async (request, response) => {
    try {
      const { user, space } = context(request);
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          name: z.string().trim().min(1).max(160).optional(),
          url: z.string().trim().url().max(2048).optional(),
          secret: z.string().min(32).max(512).optional(),
          state: z.enum(["active", "disabled"]).optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 1, {
          message: "At least one destination change is required.",
        })
        .parse(request.body || {});
      return response.json({
        destination: await updateJourneyWebhookDestination({
          spaceId: space.id,
          actorUserId: user.id,
          id: String(request.params.destinationId),
          ...body,
        }),
      });
    } catch (error) {
      return sendError(response, error);
    }
  },
);
