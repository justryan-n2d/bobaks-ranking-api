import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "../config/database";

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl()
    }
  }
});
