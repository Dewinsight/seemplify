const prisma = require('../db/client');
const nylasV3Service = require('../services/nylasV3Service');
const { handleNylasError } = require('../utils/errorHandler');

// CRITICAL: Handle grant lifecycle events
const handleGrantLifecycle = async (req, res) => {
  const { type, data } = req.body;
  
  try {
    console.log(`Processing grant lifecycle event: ${type}`, data);
    
    switch (type) {
      case 'grant.expired':
        await handleGrantExpired(data);
        break;
        
      case 'grant.deleted':
        await handleGrantDeleted(data);
        break;
        
      case 'grant.invalid':
        await handleGrantInvalid(data);
        break;
        
      case 'grant.stopped':
        await handleGrantStopped(data);
        break;
        
      default:
        console.log(`Unhandled grant event type: ${type}`);
    }
    
    res.json({ received: true, processed: type });
  } catch (error) {
    console.error('Grant lifecycle error:', error);
    res.status(500).json({ error: 'Failed to process grant lifecycle event' });
  }
};

// Handle calendar events
const handleCalendarEvents = async (req, res) => {
  const { type, data } = req.body;
  
  try {
    console.log(`Processing calendar event: ${type}`, data);
    
    switch (type) {
      case 'calendar.event.created':
        await handleEventCreated(data);
        break;
        
      case 'calendar.event.updated':
        await handleEventUpdated(data);
        break;
        
      case 'calendar.event.deleted':
        await handleEventDeleted(data);
        break;
        
      default:
        console.log(`Unhandled calendar event type: ${type}`);
    }
    
    res.json({ received: true, processed: type });
  } catch (error) {
    console.error('Calendar event error:', error);
    res.status(500).json({ error: 'Failed to process calendar event' });
  }
};

// Handle scheduler events
const handleSchedulerEvents = async (req, res) => {
  const { type, data } = req.body;
  
  try {
    console.log(`Processing scheduler event: ${type}`, data);
    
    switch (type) {
      case 'scheduler.booking.created':
        await handleBookingCreated(data);
        break;
        
      case 'scheduler.booking.updated':
        await handleBookingUpdated(data);
        break;
        
      case 'scheduler.booking.cancelled':
        await handleBookingCancelled(data);
        break;
        
      default:
        console.log(`Unhandled scheduler event type: ${type}`);
    }
    
    res.json({ received: true, processed: type });
  } catch (error) {
    console.error('Scheduler event error:', error);
    res.status(500).json({ error: 'Failed to process scheduler event' });
  }
};

// Grant lifecycle handlers
async function handleGrantExpired(data) {
  const user = await prisma.user.findFirst({ where: { nylasGrantId: data.grant_id } });

  if (user) {
    console.log(`Grant expired for user: ${user.email}`);

    user.nylasGrantId = null;
    user.nylasGrantStatus = 'expired';
    user.calendarConnected = false;
    // NOTE: lastGrantExpiry is not a schema column; persist only known fields.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        nylasGrantId: null,
        nylasGrantStatus: 'expired',
        calendarConnected: false
      }
    });

    // Cancel future interviews for this user
    const cancelledInterviews = await prisma.interview.updateMany({
      where: {
        interviewerId: user.id,
        status: 'scheduled',
        scheduledAt: { gte: new Date() }
      },
      data: {
        status: 'cancelled',
        cancellationReason: 'Calendar access expired - please reconnect',
        cancelledAt: new Date(),
        cancelledBy: user.id
      }
    });

    console.log(`Cancelled ${cancelledInterviews.count} interviews due to expired grant`);
    
    // TODO: Send notification email to user
    // await emailService.sendGrantExpiredNotification(user.email);
  }
}

async function handleGrantDeleted(data) {
  const user = await prisma.user.findFirst({ where: { nylasGrantId: data.grant_id } });

  if (user) {
    console.log(`Grant deleted for user: ${user.email}`);

    user.nylasGrantId = null;
    user.nylasGrantStatus = 'revoked';
    user.calendarConnected = false;
    user.lastGrantRevocation = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        nylasGrantId: null,
        nylasGrantStatus: 'revoked',
        calendarConnected: false,
        lastGrantRevocation: new Date()
      }
    });

    // Cancel and notify for revoked access
    const cancelledInterviews = await prisma.interview.updateMany({
      where: {
        interviewerId: user.id,
        status: 'scheduled',
        scheduledAt: { gte: new Date() }
      },
      data: {
        status: 'cancelled',
        cancellationReason: 'Calendar access revoked',
        cancelledAt: new Date(),
        cancelledBy: user.id
      }
    });

    console.log(`Cancelled ${cancelledInterviews.count} interviews due to revoked grant`);
    
    // TODO: Send notification email to user
    // await emailService.sendGrantRevokedNotification(user.email);
  }
}

async function handleGrantInvalid(data) {
  const user = await prisma.user.findFirst({ where: { nylasGrantId: data.grant_id } });

  if (user) {
    console.log(`Grant invalid for user: ${user.email}`);

    user.nylasGrantStatus = 'invalid';
    user.calendarConnected = false;
    await prisma.user.update({
      where: { id: user.id },
      data: { nylasGrantStatus: 'invalid', calendarConnected: false }
    });

    // TODO: Send notification to reconnect calendar
    // await emailService.sendGrantInvalidNotification(user.email);
  }
}

async function handleGrantStopped(data) {
  const user = await prisma.user.findFirst({ where: { nylasGrantId: data.grant_id } });

  if (user) {
    console.log(`Grant stopped for user: ${user.email}`);

    user.nylasGrantStatus = 'stopped';
    user.calendarConnected = false;
    await prisma.user.update({
      where: { id: user.id },
      data: { nylasGrantStatus: 'stopped', calendarConnected: false }
    });
  }
}

// Calendar event handlers
async function handleEventCreated(data) {
  // Check if this is one of our interview events
  const interview = await prisma.interview.findFirst({ where: { nylasEventId: data.id } });

  if (interview) {
    console.log(`Interview event created: ${data.id}`);
    interview.webhookStatus = {
      lastSync: new Date(),
      eventVersion: data.version || '1'
    };
    await prisma.interview.update({
      where: { id: interview.id },
      data: { webhookStatus: interview.webhookStatus }
    });
  }
}

async function handleEventUpdated(data) {
  const interview = await prisma.interview.findFirst({ where: { nylasEventId: data.id } });

  if (interview) {
    console.log(`Interview event updated: ${data.id}`);

    // Update interview details if the event was modified
    if (data.when) {
      interview.scheduledAt = new Date(data.when.start_time * 1000);
      interview.duration = Math.floor((data.when.end_time - data.when.start_time) / 60);
    }

    if (data.title) {
      interview.title = data.title;
    }

    if (data.description) {
      interview.description = data.description;
    }

    interview.webhookStatus = {
      lastSync: new Date(),
      eventVersion: data.version || '1'
    };

    await prisma.interview.update({
      where: { id: interview.id },
      data: {
        scheduledAt: interview.scheduledAt,
        duration: interview.duration,
        title: interview.title,
        description: interview.description,
        webhookStatus: interview.webhookStatus
      }
    });

    console.log(`Updated interview ${interview._id} from webhook`);
  }
}

async function handleEventDeleted(data) {
  const interview = await prisma.interview.findFirst({ where: { nylasEventId: data.id } });

  if (interview) {
    console.log(`Interview event deleted: ${data.id}`);

    // Mark interview as cancelled if it was deleted externally
    if (interview.status !== 'cancelled') {
      interview.status = 'cancelled';
      interview.cancellationReason = 'Event deleted from calendar';
      interview.cancelledAt = new Date();
    }

    interview.webhookStatus = {
      lastSync: new Date(),
      syncErrors: ['Event deleted from calendar']
    };

    await prisma.interview.update({
      where: { id: interview.id },
      data: {
        status: interview.status,
        cancellationReason: interview.cancellationReason,
        cancelledAt: interview.cancelledAt,
        webhookStatus: interview.webhookStatus
      }
    });

    console.log(`Marked interview ${interview._id} as cancelled due to event deletion`);
  }
}

// Scheduler event handlers
async function handleBookingCreated(data) {
  console.log('New booking created:', data);
  
  // TODO: Create interview record from scheduler booking
  // This would be used when candidates book through the scheduler widget
}

async function handleBookingUpdated(data) {
  console.log('Booking updated:', data);
  
  // TODO: Update interview record from scheduler booking
}

async function handleBookingCancelled(data) {
  console.log('Booking cancelled:', data);
  
  // TODO: Cancel interview record from scheduler booking
}

// Main webhook handler that routes to appropriate handlers
const handleWebhook = async (req, res) => {
  try {
    const { type } = req.body;
    
    // Route to appropriate handler based on event type
    if (type.startsWith('grant.')) {
      return handleGrantLifecycle(req, res);
    } else if (type.startsWith('calendar.')) {
      return handleCalendarEvents(req, res);
    } else if (type.startsWith('scheduler.')) {
      return handleSchedulerEvents(req, res);
    } else {
      console.log(`Unhandled webhook type: ${type}`);
      res.json({ received: true, message: `Unhandled event type: ${type}` });
    }
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Internal server error processing webhook' });
  }
};

module.exports = {
  handleWebhook,
  handleGrantLifecycle,
  handleCalendarEvents,
  handleSchedulerEvents
}; 