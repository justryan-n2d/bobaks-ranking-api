import "dotenv/config";
import { collectOnce } from "./services/collector";

async function main(): Promise<void> {
  try {
    await collectOnce();
  } catch (error) {
    console.error("Collector process failed:", error);
    process.exitCode = 1;
  }
}

void main();
