import { lockMealPlanning } from "../mealPlans/postgresLock.js";
import { PostgresMealPlansRepository } from "../mealPlans/postgresRepository.js";
import { MaintenanceApplyConflict, type MaintenanceApplication, type MaintenanceChange } from "./queue.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { batchLimit, leaseDuration, MAINTENANCE_MAX_ATTEMPTS, MAINTENANCE_RULE_VERSION, retryAt, type MaintenanceJob, type MaintenanceQueueRepository } from "./queue.js";

export class PostgresMaintenanceQueueRepository implements MaintenanceQueueRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await action(client); await client.query("COMMIT"); return result; }
    catch(error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async enqueueEvents(now: Date, limit?: number) {
    return this.transaction(async client => {
      // Serialize only queue bookkeeping. Business event inserts never take this lock.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('plan-maintenance-queue'))");
      const events = (await client.query(`SELECT e.id,e.user_id FROM plan_maintenance_events e
        WHERE e.processed_at IS NULL AND e.created_at<=$1
          AND NOT EXISTS(SELECT 1 FROM plan_maintenance_job_events m WHERE m.event_id=e.id)
        ORDER BY e.created_at,e.id LIMIT $2`,[new Date(now.getTime()-30_000).toISOString(),batchLimit(limit)])).rows as { id: string; user_id: number }[];
      for (const userId of new Set(events.map(event => event.user_id))) {
        const queued = (await client.query("SELECT id FROM plan_maintenance_jobs WHERE user_id=$1 AND status='queued' AND attempts=0 ORDER BY created_at,id LIMIT 1",[userId])).rows[0];
        const id = queued?.id ?? randomUUID();
        if (!queued) await client.query("INSERT INTO plan_maintenance_jobs(id,user_id,rule_version,available_at) VALUES($1,$2,$3,$4)",[id,userId,MAINTENANCE_RULE_VERSION,now.toISOString()]);
        for (const event of events.filter(event => event.user_id === userId)) await client.query("INSERT INTO plan_maintenance_job_events(event_id,job_id) VALUES($1,$2)",[event.id,id]);
      }
      return events.length;
    });
  }

  async claim(now: Date, leaseMs?: number): Promise<MaintenanceJob | null> {
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('plan-maintenance-queue'))");
      await client.query(`UPDATE plan_maintenance_jobs SET status='failed',last_error='lease expired after final attempt',updated_at=$1
        WHERE status='running' AND lease_expires_at<=$1 AND attempts>=$2`,[now.toISOString(),MAINTENANCE_MAX_ATTEMPTS]);
      const row = (await client.query(`SELECT j.id,j.user_id,j.attempts FROM plan_maintenance_jobs j
        WHERE j.attempts<$1 AND ((j.status='queued' AND j.available_at<=$2) OR (j.status='running' AND j.lease_expires_at<=$2))
          AND NOT EXISTS(SELECT 1 FROM plan_maintenance_jobs other WHERE other.user_id=j.user_id AND other.id<>j.id
            AND other.status='running' AND other.lease_expires_at>$2)
        ORDER BY j.created_at,j.id LIMIT 1`,[MAINTENANCE_MAX_ATTEMPTS,now.toISOString()])).rows[0];
      if (!row) return null;
      const token = randomUUID();
      await client.query("UPDATE plan_maintenance_jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_expires_at=$2,updated_at=$3 WHERE id=$4",
        [token,new Date(now.getTime()+leaseDuration(leaseMs)).toISOString(),now.toISOString(),row.id]);
      const members = (await client.query("SELECT event_id FROM plan_maintenance_job_events WHERE job_id=$1 ORDER BY event_id",[row.id])).rows;
      return { id: row.id,userId: row.user_id,attempt: row.attempts+1,leaseToken: token,eventIds: members.map(row => row.event_id) };
    });
  }

  async applyChanges(job: MaintenanceJob, changes: MaintenanceChange[]): Promise<MaintenanceApplication> {
    try {
      return await this.transaction(async client => {
        await lockMealPlanning(client,job.userId);
        const lease = (await client.query(`SELECT id FROM plan_maintenance_jobs WHERE id=$1 AND user_id=$2
          AND status='running' AND attempts=$3 AND lease_token=$4 AND lease_expires_at>clock_timestamp() FOR UPDATE`,
          [job.id,job.userId,job.attempt,job.leaseToken])).rows[0];
        if (!lease) throw new MaintenanceApplyConflict("lease_lost");
        const plans = new PostgresMealPlansRepository(this.pool);
        const results: Record<string, unknown>[] = [];
        for (const change of changes) {
          const current = (await client.query(`SELECT i.version,p.version AS plan_version,p.start_date,p.end_date FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id
            WHERE i.id=$1 AND i.plan_id=$2 AND i.user_id=$3 AND p.user_id=i.user_id AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active' FOR UPDATE OF i,p`,
            [change.itemId,change.planId,job.userId])).rows[0];
          if (!current || Number(current.version) !== change.input.version || Number(current.plan_version) !== change.planVersion
            || (change.input.plannedDate && (change.input.plannedDate<current.start_date || change.input.plannedDate>current.end_date))) throw new MaintenanceApplyConflict("input_conflict");
          const result = await plans.updateItemWithClient(client,job.userId,change.planId,change.itemId,change.input,"maintenance",change.reason);
          if (result.kind !== "updated") throw new MaintenanceApplyConflict("input_conflict");
          results.push(result.value);
        }
        const completed = await client.query(`UPDATE plan_maintenance_jobs SET status='completed',result_json=$1::jsonb,lease_token=NULL,
          lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND lease_expires_at>clock_timestamp()`,[JSON.stringify({ changes: results }),job.id]);
        if (completed.rowCount !== 1) throw new MaintenanceApplyConflict("lease_lost");
        await client.query(`UPDATE plan_maintenance_events SET processed_at=CURRENT_TIMESTAMP WHERE user_id=$1
          AND id IN (SELECT event_id FROM plan_maintenance_job_events WHERE job_id=$2)`,[job.userId,job.id]);
        return { kind: "completed",changes: results };
      });
    } catch(error) {
      if (error instanceof MaintenanceApplyConflict) return { kind: error.kind };
      throw error;
    }
  }

  async fail(job: MaintenanceJob, now: Date, error: string) {
    const result = await this.pool.query(`UPDATE plan_maintenance_jobs SET status=$1,available_at=$2,last_error=$3,lease_token=NULL,lease_expires_at=NULL,updated_at=$4
      WHERE id=$5 AND user_id=$6 AND status='running' AND lease_token=$7 AND attempts=$8 AND lease_expires_at>$4`,
      [job.attempt>=MAINTENANCE_MAX_ATTEMPTS ? "failed" : "queued",retryAt(now,job.attempt),error.replace(/[\r\n]+/g," ").slice(0,1000),
        now.toISOString(),job.id,job.userId,job.leaseToken,job.attempt]);
    return result.rowCount === 1;
  }
}
