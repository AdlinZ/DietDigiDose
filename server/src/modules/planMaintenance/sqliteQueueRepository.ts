import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { batchLimit, leaseDuration, MAINTENANCE_MAX_ATTEMPTS, MAINTENANCE_RULE_VERSION, retryAt, type MaintenanceJob, type MaintenanceQueueRepository } from "./queue.js";

export class SqliteMaintenanceQueueRepository implements MaintenanceQueueRepository {
  private readonly db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  async enqueueEvents(now: Date, limit?: number) {
    return this.db.transaction(() => {
      const events = this.db.prepare(`SELECT e.id,e.user_id FROM plan_maintenance_events e
        WHERE e.processed_at IS NULL AND julianday(e.created_at)<=julianday(?)
          AND NOT EXISTS(SELECT 1 FROM plan_maintenance_job_events m WHERE m.event_id=e.id)
        ORDER BY e.created_at,e.id LIMIT ?`).all(new Date(now.getTime()-30_000).toISOString(),batchLimit(limit)) as { id: string; user_id: number }[];
      for (const userId of new Set(events.map(event => event.user_id))) {
        const queued = this.db.prepare("SELECT id FROM plan_maintenance_jobs WHERE user_id=? AND status='queued' AND attempts=0 ORDER BY created_at,id LIMIT 1").get(userId) as { id: string } | undefined;
        const id = queued?.id ?? randomUUID();
        if (!queued) this.db.prepare("INSERT INTO plan_maintenance_jobs(id,user_id,rule_version,available_at) VALUES(?,?,?,?)").run(id,userId,MAINTENANCE_RULE_VERSION,now.toISOString());
        for (const event of events.filter(event => event.user_id === userId)) this.db.prepare("INSERT INTO plan_maintenance_job_events(event_id,job_id) VALUES(?,?)").run(event.id,id);
      }
      return events.length;
    })();
  }

  async claim(now: Date, leaseMs?: number): Promise<MaintenanceJob | null> {
    return this.db.transaction(() => {
      // An exhausted crashed attempt must not remain running forever.
      this.db.prepare(`UPDATE plan_maintenance_jobs SET status='failed',last_error='lease expired after final attempt',updated_at=?
        WHERE status='running' AND julianday(lease_expires_at)<=julianday(?) AND attempts>=?`).run(now.toISOString(),now.toISOString(),MAINTENANCE_MAX_ATTEMPTS);
      const row = this.db.prepare(`SELECT j.id,j.user_id,j.attempts FROM plan_maintenance_jobs j
        WHERE j.attempts<? AND ((j.status='queued' AND julianday(j.available_at)<=julianday(?))
          OR (j.status='running' AND julianday(j.lease_expires_at)<=julianday(?)))
          AND NOT EXISTS(SELECT 1 FROM plan_maintenance_jobs other WHERE other.user_id=j.user_id AND other.id<>j.id
            AND other.status='running' AND julianday(other.lease_expires_at)>julianday(?))
        ORDER BY j.created_at,j.id LIMIT 1`).get(MAINTENANCE_MAX_ATTEMPTS,now.toISOString(),now.toISOString(),now.toISOString()) as { id: string; user_id: number; attempts: number } | undefined;
      if (!row) return null;
      const token = randomUUID();
      this.db.prepare("UPDATE plan_maintenance_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=?")
        .run(token,new Date(now.getTime()+leaseDuration(leaseMs)).toISOString(),now.toISOString(),row.id);
      const members = this.db.prepare("SELECT event_id FROM plan_maintenance_job_events WHERE job_id=? ORDER BY event_id").all(row.id) as { event_id: string }[];
      return { id: row.id,userId: row.user_id,attempt: row.attempts+1,leaseToken: token,eventIds: members.map(row => row.event_id) };
    })();
  }

  async fail(job: MaintenanceJob, now: Date, error: string) {
    return this.db.prepare(`UPDATE plan_maintenance_jobs SET status=?,available_at=?,last_error=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE id=? AND user_id=? AND status='running' AND lease_token=? AND attempts=? AND julianday(lease_expires_at)>julianday(?)`)
      .run(job.attempt>=MAINTENANCE_MAX_ATTEMPTS ? "failed" : "queued",retryAt(now,job.attempt),error.replace(/[\r\n]+/g," ").slice(0,1000),
        now.toISOString(),job.id,job.userId,job.leaseToken,job.attempt,now.toISOString()).changes === 1;
  }
}
