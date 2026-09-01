import { agentOperationsService } from "../../modules/agentOperations/runtime.js";
import type { AgentActionProposal } from "./types.js";

export function executeAgentActions(userId: number, runId: string, proposals: Array<AgentActionProposal & { id?: string }>) {
  return agentOperationsService().executeActions(userId, runId, proposals);
}

export function undoAgentRunActions(userId: number, runId: string) {
  return agentOperationsService().undoActions(userId, runId);
}
