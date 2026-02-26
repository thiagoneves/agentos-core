import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

export class DashboardServer {
  private app = express();
  private httpServer = createServer(this.app);
  private io = new Server(this.httpServer, { cors: { origin: "*" } });
  private sessionsDir = path.join(process.cwd(), '.agentos', 'state', 'sessions');

  constructor(private port: number = 3000) {
    this.app.use(cors());
    this.app.use(express.json());
    const pkgRoot = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
    this.app.use(express.static(path.join(pkgRoot, 'src', 'public')));

    this.app.get('/api/sessions', async (_req, res) => {
      try {
        const sessions = await this.getAllSessions();
        res.json(sessions);
      } catch (err) {
        res.status(500).json({ error: 'Failed to load sessions' });
      }
    });

    this.app.post('/api/report', async (req, res) => {
      try {
        const { sessionId, step, status, tokens, cost } = req.body;
        if (!sessionId) {
          res.status(400).json({ error: 'sessionId is required' });
          return;
        }

        await fs.mkdir(this.sessionsDir, { recursive: true });
        const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);

        interface ReportSession {
          sessionId: string;
          workflowId: string;
          activeMission: string;
          currentAgent: string;
          currentPhase: string;
          status: string;
          tokens: number;
          costUsd: number;
          events: Array<{ timestamp: string; type: string; agent: string; data?: Record<string, unknown> }>;
        }

        let session: ReportSession;
        try {
          const content = await fs.readFile(sessionPath, 'utf8');
          session = JSON.parse(content);
        } catch {
          session = {
            sessionId,
            workflowId: 'manual',
            activeMission: step || 'Manual session',
            currentAgent: 'unknown',
            currentPhase: 'Starting',
            status: 'running',
            tokens: 0,
            costUsd: 0,
            events: [],
          };
        }

        if (step) session.currentPhase = step;
        if (status) session.status = status;
        session.tokens += (tokens || 0);
        session.costUsd += (cost || 0);
        session.events.push({
          timestamp: new Date().toISOString(),
          type: status === 'completed' ? 'STEP_COMPLETE' : 'METRICS_UPDATE',
          agent: session.currentAgent,
          data: { step, status, tokens, cost },
        });

        await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
        this.io.emit('sessions_update', await this.getAllSessions());
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    this.app.get('/api/metrics', async (_req, res) => {
      try {
        const sessions = await this.getAllSessions();
        const agentMap: Record<string, { tokens: number; cost: number; sessions: number }> = {};

        let totalTokens = 0;
        let totalCost = 0;
        let activeSessions = 0;

        for (const s of sessions) {
          totalTokens += s.tokens || 0;
          totalCost += s.costUsd || 0;
          if (s.status === 'running') activeSessions++;

          // Aggregate per-agent from events
          for (const ev of (s.events || [])) {
            const agent = ev.data?.agent || ev.agent || 'unknown';
            const evTokens = ev.data?.tokens || 0;
            const evCost = ev.data?.cost || 0;
            if (evTokens > 0 || evCost > 0) {
              if (!agentMap[agent]) agentMap[agent] = { tokens: 0, cost: 0, sessions: 0 };
              agentMap[agent].tokens += evTokens;
              agentMap[agent].cost += evCost;
            }
          }

          // Count sessions per agent
          const mainAgent = s.currentAgent || 'unknown';
          if (!agentMap[mainAgent]) agentMap[mainAgent] = { tokens: 0, cost: 0, sessions: 0 };
          agentMap[mainAgent].sessions++;
        }

        res.json({
          totalSessions: sessions.length,
          activeSessions,
          totalTokens,
          totalCost,
          agentBreakdown: Object.entries(agentMap).map(([name, data]) => ({
            agent: name, ...data,
          })),
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    // ─── Session detail (drill-down) ───
    this.app.get('/api/sessions/:sessionId', async (req, res) => {
      try {
        const sessionPath = path.join(this.sessionsDir, `${req.params.sessionId}.json`);
        const content = await fs.readFile(sessionPath, 'utf8');
        res.json(JSON.parse(content));
      } catch {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // ─── Pause a session ───
    this.app.post('/api/sessions/:sessionId/pause', async (req, res) => {
      try {
        const sessionPath = path.join(this.sessionsDir, `${req.params.sessionId}.json`);
        const content = await fs.readFile(sessionPath, 'utf8');
        const session = JSON.parse(content);

        if (session.status !== 'running') {
          res.status(400).json({ error: `Session is ${session.status}, not running` });
          return;
        }

        session.status = 'paused';
        session.events.push({
          timestamp: new Date().toISOString(),
          type: 'GATE_PAUSE',
          agent: session.currentAgent,
          data: { reason: 'Paused via dashboard' },
        });

        await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
        this.io.emit('sessions_update', await this.getAllSessions());
        res.json({ ok: true, status: 'paused' });
      } catch {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // ─── Resume a session ───
    this.app.post('/api/sessions/:sessionId/resume', async (req, res) => {
      try {
        const sessionPath = path.join(this.sessionsDir, `${req.params.sessionId}.json`);
        const content = await fs.readFile(sessionPath, 'utf8');
        const session = JSON.parse(content);

        if (session.status !== 'paused') {
          res.status(400).json({ error: `Session is ${session.status}, not paused` });
          return;
        }

        session.status = 'running';
        session.events.push({
          timestamp: new Date().toISOString(),
          type: 'SESSION_RESUME',
          agent: session.currentAgent,
          data: { reason: 'Resumed via dashboard' },
        });

        await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
        this.io.emit('sessions_update', await this.getAllSessions());
        res.json({ ok: true, status: 'running' });
      } catch {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    this.setupSocket();
  }

  private setupSocket() {
    this.io.on('connection', (socket) => {
      console.log(chalk.dim(`  Dashboard client connected: ${socket.id}`));

      socket.on('pause_session', async (sessionId: string) => {
        try {
          const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
          const content = await fs.readFile(sessionPath, 'utf8');
          const session = JSON.parse(content);
          if (session.status === 'running') {
            session.status = 'paused';
            session.events.push({
              timestamp: new Date().toISOString(),
              type: 'GATE_PAUSE',
              agent: session.currentAgent,
              data: { reason: 'Paused via dashboard socket' },
            });
            await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
          }
          this.io.emit('sessions_update', await this.getAllSessions());
        } catch (err) {
          if (process.env.DEBUG) console.error(`Socket session error: ${err instanceof Error ? err.message : err}`);
        }
      });

      socket.on('resume_session', async (sessionId: string) => {
        try {
          const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
          const content = await fs.readFile(sessionPath, 'utf8');
          const session = JSON.parse(content);
          if (session.status === 'paused') {
            session.status = 'running';
            session.events.push({
              timestamp: new Date().toISOString(),
              type: 'SESSION_RESUME',
              agent: session.currentAgent,
              data: { reason: 'Resumed via dashboard socket' },
            });
            await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
          }
          this.io.emit('sessions_update', await this.getAllSessions());
        } catch (err) {
          if (process.env.DEBUG) console.error(`Socket session error: ${err instanceof Error ? err.message : err}`);
        }
      });
    });

    setInterval(async () => {
      try {
        const sessions = await this.getAllSessions();
        this.io.emit('sessions_update', sessions);
      } catch (err) {
        if (process.env.DEBUG) console.error(`Polling error: ${err instanceof Error ? err.message : err}`);
      }
    }, 2000);
  }

  private async getAllSessions() {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessions = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(path.join(this.sessionsDir, file), 'utf8');
            sessions.push(JSON.parse(content));
          } catch { /* corrupt file */ }
        }
      }
      return sessions;
    } catch { return []; }
  }

  start() {
    this.httpServer.listen(this.port, () => {
      console.log(chalk.bold.green(`
  AgentOS Monitor running at http://localhost:${this.port}`));
      console.log(chalk.dim(`  Watching sessions in .agentos/state/sessions/
`));
    });
  }
}
