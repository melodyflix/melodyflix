// melodyflix videos - support routes (FAQ + Tickets + Chatbot)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  listFaq, listFaqCategories,
  createTicket, listMyTickets, listAllTickets, getTicketById,
  listTicketMessages, addTicketMessage, updateTicketStatus,
  chatbotReply, logChatbotMessage, listChatbotHistory,
  getSupportStats,
} from '../services/support.service.js';

const CreateTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  category: z.string().max(50).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  message: z.string().min(1).max(5000),
});

const AddMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
});

const ChatbotSchema = z.object({
  message: z.string().min(1).max(2000),
  conversation_id: z.string().max(100).optional(),
});

function optionalUser(auth?: string) {
  const token = extractBearerToken(auth);
  if (!token) return null;
  return verifyJwt(token);
}

export async function supportRoutes(app: FastifyInstance) {
  // ============ FAQ (public) ============

  // GET /api/v1/videos/support/faq
  app.get('/support/faq', async (req, reply) => {
    const q = req.query as { category?: string };
    const items = listFaq(q.category);
    const categories = listFaqCategories();
    return reply.send({ success: true, data: { faq: items, categories } });
  });

  // ============ Chatbot ============

  // POST /api/v1/videos/support/chatbot
  app.post('/support/chatbot', async (req, reply) => {
    const parsed = ChatbotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const user = optionalUser(req.headers.authorization);
    const conversationId = parsed.data.conversation_id || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Log user message + generate reply
    logChatbotMessage(conversationId, user?.sub ?? null, 'user', parsed.data.message);
    const response = chatbotReply(parsed.data.message);
    logChatbotMessage(conversationId, user?.sub ?? null, 'assistant', response);

    return reply.send({
      success: true,
      data: {
        reply: response,
        conversation_id: conversationId,
      },
    });
  });

  // GET /api/v1/videos/support/chatbot/history/:conversationId
  app.get('/support/chatbot/history/:conversationId', async (req, reply) => {
    const { conversationId } = req.params as { conversationId: string };
    const history = listChatbotHistory(conversationId, 100);
    return reply.send({ success: true, data: { history } });
  });

  // ============ Tickets (user) ============

  // POST /api/v1/videos/support/tickets
  app.post('/support/tickets', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateTicketSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const userName = (user as any).username ?? user.sub.slice(0, 8);
      const ticket = createTicket({
        user_id: user.sub,
        user_name: userName,
        subject: parsed.data.subject,
        category: parsed.data.category,
        priority: parsed.data.priority,
        message: parsed.data.message,
      });
      return reply.code(201).send({ success: true, data: ticket });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/videos/support/tickets/me
  app.get('/support/tickets/me', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const tickets = listMyTickets(user.sub);
    return reply.send({ success: true, data: { tickets } });
  });

  // GET /api/v1/videos/support/tickets/:id
  app.get('/support/tickets/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const ticket = getTicketById(id);
    if (!ticket) return reply.code(404).send({ success: false, error: 'Ticket not found' });

    // User can only view own tickets unless admin
    if (ticket.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }

    const messages = listTicketMessages(id);
    return reply.send({ success: true, data: { ticket, messages } });
  });

  // POST /api/v1/videos/support/tickets/:id/messages — user reply
  app.post('/support/tickets/:id/messages', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = AddMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const { id } = req.params as { id: string };
    const ticket = getTicketById(id);
    if (!ticket) return reply.code(404).send({ success: false, error: 'Ticket not found' });
    if (ticket.user_id !== user.sub) return reply.code(403).send({ success: false, error: 'Not authorized' });

    const senderName = (user as any).username ?? user.sub.slice(0, 8);
    const msg = addTicketMessage(id, 'user', user.sub, senderName, parsed.data.content);
    return reply.code(201).send({ success: true, data: msg });
  });

  // ============ Admin ============

  // GET /api/v1/videos/admin/support/tickets
  app.get('/support/admin/tickets', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { status?: string };
    const tickets = listAllTickets(q.status);
    const stats = getSupportStats();
    return reply.send({ success: true, data: { tickets, stats } });
  });

  // POST /api/v1/videos/admin/support/tickets/:id/messages — admin reply
  app.post('/support/admin/tickets/:id/messages', async (req, reply) => {
    let user;
    try { user = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const parsed = AddMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const { id } = req.params as { id: string };
    const ticket = getTicketById(id);
    if (!ticket) return reply.code(404).send({ success: false, error: 'Ticket not found' });

    const adminName = (user as any).username ?? 'Support';
    const msg = addTicketMessage(id, 'admin', user.sub, adminName, parsed.data.content);
    return reply.code(201).send({ success: true, data: msg });
  });

  // PATCH /api/v1/videos/admin/support/tickets/:id/status
  app.patch('/support/admin/tickets/:id/status', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const parsed = UpdateStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const { id } = req.params as { id: string };
    const updated = updateTicketStatus(id, parsed.data.status);
    if (!updated) return reply.code(404).send({ success: false, error: 'Ticket not found' });
    return reply.send({ success: true, data: updated });
  });
}
