import type { ConnectionProfile } from "@/lib/types";
import type { DatabaseDriver } from "./types";
import { PostgresDriver } from "./postgres";
import { MysqlDriver } from "./mysql";
import { SqlServerDriver } from "./sqlserver";
import { MongodbDriver } from "./mongodb";

export function createDriver(config: ConnectionProfile): DatabaseDriver {
  if (config.type === "postgres") {
    return new PostgresDriver(config);
  }
  if (config.type === "mysql") {
    return new MysqlDriver(config);
  }
  if (config.type === "sqlserver") {
    return new SqlServerDriver(config);
  }
  if (config.type === "mongodb") {
    return new MongodbDriver(config);
  }
  throw new Error(`Unsupported database type: ${(config as ConnectionProfile).type}`);
}
