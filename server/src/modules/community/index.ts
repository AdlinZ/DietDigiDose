import { db } from "../../storage/db.js";
import { createCommunityRouter } from "./route.js";
import { CommunityService } from "./service.js";
import { SqliteCommunityRepository } from "./sqliteRepository.js";

const repository = new SqliteCommunityRepository(db);
const service = new CommunityService(repository);

export default createCommunityRouter(service);
